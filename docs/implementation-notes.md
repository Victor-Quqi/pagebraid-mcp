# 实现说明

本文档只记录当前实现中的关键取舍，面向维护者。

## 当前范围

当前实现只暴露一个工具：`read_pdf`。

服务端通过 SDK v2 的 `serveStdio` 工厂入口建立连接。入口按每条连接的首个消息选择 2026-07-28 或 2025 时代，并为该连接固定一个独立的 `McpServer` 实例。工具业务层不感知协商过程。调试 CLI 使用 v2 client 的 `versionNegotiation.mode = "auto"`，验证新协议并兼容旧服务。

需要确认实际客户端走的协议时，在 server 环境中设置 `PAGEBRAID_PROTOCOL_DEBUG=1`。服务端会把 `protocol=2026-07-28` 或 `protocol=2025-11-25` 写到 stderr，stdout 的 MCP 流不受影响。

输入约定保持简洁：

- `file_path`：本地 PDF 路径
- `mode`：`auto`、`text_only`、`image_only`
- `pages`：只接受 `"23"`、`"23-27"`、`"23-"`

## 渲染与提取栈

当前使用 `pdfjs-dist` + `@napi-rs/canvas`。

发布包的依赖打包、PDF.js 资源和第三方声明维护见[发布构建](packaging.md)。

这条路线替代了更早的 `pdf-to-img` 方案，主要原因是后者在 Windows 上更容易拉入原生 `canvas` 依赖，安装成本更高。当前实现更适合本项目的本地 `npx` 启动场景。

## 日志控制

`pdf.js` 在部分文档上会输出字体或解析警告。对走 `stdio` 的 MCP server 来说，这类输出会污染传输流。

因此服务端在 `getDocument(...)` 中显式设置了 `verbosity: VerbosityLevel.ERRORS`，默认只保留真正的错误。

## 读取策略

工具从 MCP initialize 信息读取客户端名称，并在每次调用时选择预算 profile。`PAGEBRAID_CLIENT_PROFILE` 可显式覆盖为 `codex`、`claude-code`、`grok-build` 或 `generic`。读取按页累加，直到下一页会使结果超出客户端预算或下文的图片资源预算。

- Codex profile 默认 11,991 token：模型 `truncation_policy` 的 10,000 token 乘 1.2 为 12,000 上限，Codex 在结果前插入的 `Wall time` 头占 9 token；每个文本 block 按 `ceil(UTF-8 字节数 ÷ 4)` 累计，图片不计入
- Claude Code profile 默认 25,000 token；server 进程环境中存在有效的 `MAX_MCP_OUTPUT_TOKENS` 时继承该值
- 含图片的结果由 Claude Code 判定：各文本块 `round(字符数 ÷ 4)` 之和加每张图 1,600 不超过预算一半时直接放行，否则按 `count_tokens` 判定。pagebraid 按同样的两级规则计算，以便不截断地返回最多页数。交互式会话会在判定前为每张图追加 `[Image: source: <保存路径>]`，实测约 180 字符、110 token，两级估算分别为每张图另计 64 和 128
- `read_pdf` 声明 `_meta["anthropic/maxResultSizeChars"] = 500000`，避免纯文本结果超过 50,000 字符即被转存。Claude Code 因此不再检查不含图片的结果，pagebraid 只用详细估算对照预算，作为防止失控的上限
- Grok Build profile 匹配 `grok-shell-*`，默认 20,000 UTF-8 字节，按实际文本、图片占位符和块间换行累计，每次最多 5 张图片
- Generic profile 默认 10,000 token，累计文本和图片，并取两路详细估算的较大值
- `PAGEBRAID_TOKEN_BUDGET` 的优先级最高，可覆盖上述 token 预算；Grok 默认只检查字节，显式设置此项时增加一项 token 限制
- Grok 字节预算依次取 `PAGEBRAID_BYTE_BUDGET`、`GROK_MAX_MCP_OUTPUT_BYTES`、`MAX_MCP_OUTPUT_BYTES`、20,000；只读取 server 进程环境中有效的正整数

上述行为对应 Codex CLI 0.160.1、Claude Code 2.1.284 和 grok 1.0.46。

模型上下文的两路详细估算参数对应当前 Claude 与 GPT 旗舰模型。文本分别使用 `o200k_base` 计数，以及 `ceil(o200k_base 计数 × 1.7)`；Claude 5 系列实测英文正文约为 `o200k_base` 的 1.6 倍，中文约 1.2 倍，代码可达 1.86 倍。图片按实际渲染宽高，分别使用 32 px patch 和带尺寸、token 上限的 28 px patch 算法。摘要和内容 marker 也计入文本。Codex profile 的客户端预算只使用字节近似值。

MCP 不协商工具输出预算，客户端侧的额度调整无法由 server 读取，需通过 `PAGEBRAID_TOKEN_BUDGET` 对齐，例如 Claude Code 的远程灰度值。Codex 的 `tool_output_token_limit` 或 `[mcp_servers.<name>.tools.read_pdf] output_token_limit` 设为 N 时，该值取 `ceil(N × 1.2) − 9`。

图片批次另有三项资源预算：图片上下文估算默认 40,000 token，累计渲染量默认 60,000,000 px，base64 图像载荷默认 6 MiB。它们分别可用 `PAGEBRAID_IMAGE_CONTEXT_TOKEN_BUDGET`、`PAGEBRAID_IMAGE_RENDER_PIXEL_BUDGET` 和 `PAGEBRAID_IMAGE_WIRE_BUDGET_BYTES` 覆盖。Codex 与 Claude Code profile 分别采用对应的图片估算，Grok 按客户端上下文粗估计每张图 765 token，Generic profile 取两路较大值。

`PAGEBRAID_MAX_IMAGES_PER_RESPONSE` 提供显式的运维硬上限。Grok 与内置 5 张上限取较小值，其它客户端默认不限张数。停止原因区分客户端 token、客户端字节、图片上下文、渲染量、传输量和图片数量限制；结果同时附带剩余页范围和下一次调用建议。

逐页累加时使用最小摘要，返回前再校验包含实际停止原因和续读信息的完整摘要，超限则退回最后一页。这也允许完整请求因省去续读信息而恰好装入预算。

既有 token 和图片资源预算保留至少返回一页的行为。Grok 字节上限始终检查；首页文字超限时，`auto` 返回该页图像并用 `@@PDF_IMAGE p=N text=omitted` 标明文字省略，`text_only` 返回错误并提示使用 `image_only`。错误文本也受字节上限约束。

## Grok Build 源码依据与回归

实现对齐官方源码提交 `2bdd1d6a6369de0e8c68132ea4539e9abd9e14a8`：

- [call_result.rs](https://github.com/xai-org/grok-build/blob/2bdd1d6a6369de0e8c68132ea4539e9abd9e14a8/crates/codegen/xai-grok-mcp/src/call_result.rs#L7)：文本块和图像 data URI 通过 `\n` 拼接。适配使用默认的 `expose_image_base64 = false`。
- [mcp_truncate.rs](https://github.com/xai-org/grok-build/blob/2bdd1d6a6369de0e8c68132ea4539e9abd9e14a8/crates/codegen/xai-grok-tools/src/util/mcp_truncate.rs#L199)：先提取图片，再按 UTF-8 字节限制文本，恰好等于上限时保留全文。
- [base64_images.rs](https://github.com/xai-org/grok-build/blob/2bdd1d6a6369de0e8c68132ea4539e9abd9e14a8/crates/codegen/xai-grok-tools/src/util/base64_images.rs#L25)：每张正常图片替换为 43 字节的占位符；Base64 长度小于 1,024 时保留 data URI；最多提取 5 张图，第 6 张起省略。
- [token-estimation](https://github.com/xai-org/grok-build/blob/2bdd1d6a6369de0e8c68132ea4539e9abd9e14a8/crates/codegen/xai-token-estimation/src/lib.rs#L10)：客户端上下文粗估为文本 `floor(bytes / 4)`、图片 765 token/张。
- [额度解析](https://github.com/xai-org/grok-build/blob/2bdd1d6a6369de0e8c68132ea4539e9abd9e14a8/crates/codegen/xai-grok-shell/src/util/config/resolve/mcp.rs#L208)：客户端还可由 requirements、项目/用户配置、远程设置或工具覆盖项改变额度。此类配置需用 `PAGEBRAID_BYTE_BUDGET` 与 server 对齐。

字节统计覆盖本工具实际返回的摘要、页码 marker、正文、图片占位符和块间换行。图片 Base64、渲染量仍单独受资源预算控制。服务层结果通过 `byte_budget` 和 `estimated_client_bytes` 暴露字节额度及用量，`token_budget` 在 Grok 未显式设置 token 限制时为 `null`。

本地回归生成 PDF，并检查字节临界点、末页摘要缩短、完整续读、5 图上限、单页超限和其它客户端 profile。调试 CLI 的四种 profile、三种模式均校验 manifest、文本块和解码图像，临时文件自动清理：

```bash
npm run check
node --import tsx scripts/check-grok-budget.mjs
```

## 图像策略

图片质量由用途决定，不受请求页数和当前批次位置影响：

- `auto` 默认按 2.0× 渲染
- `image_only` 默认按 2.25× 渲染
- 两种模式均使用 WebP quality 80，长边最多 2,000 px，单图最多 4,000,000 px
- 单图编码结果以 512 KiB 为熔断值；超限时逐级降低渲染尺寸，保持 quality 80，最后的编码回退为 quality 70

这些默认值来自文字表格、扫描页、公式幻灯、普通报告和密集图文页的本地基准。与 3× 渲染相比，2.25× 档位在样本中平均减少约 43% 的 32 px patch、32% 的 28 px patch 和 36% 的处理时间。固定质量也避免了旧策略为满足很小的逐页字节目标而降到 quality 0。

服务端先读取页面尺寸，预估客户端 token、图片上下文和渲染量；候选页已经超限时不执行完整渲染。传输量在编码后按实际 base64 长度检查。编码后重新检查客户端预算，覆盖小图片仍以 Base64 文本传入 Grok 的情况。

## 缓存

当前缓存为进程内缓存，键为 `path + size + mtimeMs`。

缓存命中后可复用：

- `PDFDocumentProxy`
- 单页文本提取结果
- 单页渲染图

渲染图缓存按 base64 载荷控制在 64 MiB 左右，并按最近使用顺序淘汰。

## 文档边界

用户侧用法、安装方式和工具说明放在 `README.md`。
