# 实现说明

本文档只记录当前实现中的关键取舍，面向维护者。

## 当前范围

当前实现只暴露一个工具：`read_pdf`。

服务端通过 SDK v2 的 `serveStdio` 工厂入口建立连接。入口按每条连接的首个消息选择 2026-07-28 或 2025 时代，并为该连接固定一个独立的 `McpServer` 实例。工具业务层不感知协商过程。调试 CLI 使用 v2 client 的 `versionNegotiation.mode = "auto"`，验证新协议并兼容旧服务。

输入约定保持简洁：

- `file_path`：本地 PDF 路径
- `mode`：`auto`、`text_only`、`image_only`
- `pages`：只接受 `"23"`、`"23-27"`、`"23-"`

## 渲染与提取栈

当前使用 `pdfjs-dist` + `@napi-rs/canvas`。

这条路线替代了更早的 `pdf-to-img` 方案，主要原因是后者在 Windows 上更容易拉入原生 `canvas` 依赖，安装成本更高。当前实现更适合本项目的本地 `npx` 启动场景。

## 日志控制

`pdf.js` 在部分文档上会输出字体或解析警告。对走 `stdio` 的 MCP server 来说，这类输出会污染传输流。

因此服务端在 `getDocument(...)` 中显式设置了 `verbosity: VerbosityLevel.ERRORS`，默认只保留真正的错误。

## 读取策略

工具从 MCP initialize 信息读取客户端名称，并在每次调用时选择预算 profile。`PAGEBRAID_CLIENT_PROFILE` 可显式覆盖为 `codex`、`claude-code` 或 `generic`。

- Codex profile 默认 11,900 token；每个文本 block 按 `ceil(UTF-8 字节数 ÷ 4)` 累计，图片不进入客户端的 MCP 输出截断预算
- Claude Code profile 默认 25,000 token；server 进程环境中存在有效的 `MAX_MCP_OUTPUT_TOKENS` 时继承该值
- Claude Code 先用 `文本字符数 ÷ 4 + 图片数 × 1600` 走快速判断；不超过预算一半时直接放行，超过后使用详细估算
- Generic profile 默认 10,000 token，累计文本和图片，并取两路详细估算的较大值
- `PAGEBRAID_TOKEN_BUDGET` 的优先级最高，可覆盖上述 token 预算

Codex 默认值来自当前 agent-facing 挂载 MCP 路径的 12,000 token 实测上限，预留 100 token 给外层包装和估算误差。

预算策略已通过最新版 Codex CLI 0.144.1 和 Claude Code 2.1.205 的 agent-facing E2E；后者落后当前版本两个补丁，其间无相关改动。

模型上下文的两路详细估算参数对应当前 Claude 与 GPT 旗舰模型。文本分别使用 `o200k_base` 计数，以及 `ceil(o200k_base 计数 × 1.3)`；图片按实际渲染宽高，分别使用 32 px patch 和带尺寸、token 上限的 28 px patch 算法。摘要和内容 marker 也计入文本。Codex profile 的客户端预算判断采用上一条的字节近似值。

MCP initialize 当前不协商工具输出预算。Claude Code 的远程灰度值和 Codex 的模型侧配置无法由 server 直接读取；默认值变化时需同步实现，或通过 `PAGEBRAID_TOKEN_BUDGET` 对齐客户端。

图片批次另有三项资源预算：图片上下文估算默认 40,000 token，累计渲染量默认 60,000,000 px，base64 图像载荷默认 6 MiB。它们分别可用 `PAGEBRAID_IMAGE_CONTEXT_TOKEN_BUDGET`、`PAGEBRAID_IMAGE_RENDER_PIXEL_BUDGET` 和 `PAGEBRAID_IMAGE_WIRE_BUDGET_BYTES` 覆盖。Codex 与 Claude Code profile 分别采用对应的图片估算，Generic profile 取两路较大值。

`PAGEBRAID_MAX_IMAGES_PER_RESPONSE` 只提供显式的运维硬上限，默认不限制图片数量。停止原因会区分客户端 token、图片上下文、渲染量、传输量和显式图片数量限制；结果同时附带剩余页范围和下一次调用建议。

为保证续读能推进，每次至少返回一页。单页内容本身超过预算时，该次返回可能高于配置值。

## 图像策略

图片质量由用途决定，不受请求页数和当前批次位置影响：

- `auto` 默认按 2.0× 渲染
- `image_only` 默认按 2.25× 渲染
- 两种模式均使用 WebP quality 80，长边最多 2,000 px，单图最多 4,000,000 px
- 单图编码结果以 512 KiB 为熔断值；超限时逐级降低渲染尺寸，保持 quality 80，最后的编码回退为 quality 70

这些默认值来自文字表格、扫描页、公式幻灯、普通报告和密集图文页的本地基准。与 3× 渲染相比，2.25× 档位在样本中平均减少约 43% 的 32 px patch、32% 的 28 px patch 和 36% 的处理时间。固定质量也避免了旧策略为满足很小的逐页字节目标而降到 quality 0。

服务端先读取页面尺寸，预估客户端 token、图片上下文和渲染量；候选页已经超限时不执行完整渲染。传输量在编码后按实际 base64 长度检查。每次至少返回一页，因此单页本身超过任一预算时仍可推进续读。

## 缓存

当前缓存为进程内缓存，键为 `path + size + mtimeMs`。

缓存命中后可复用：

- `PDFDocumentProxy`
- 单页文本提取结果
- 单页渲染图

渲染图缓存按 base64 载荷控制在 64 MiB 左右，并按最近使用顺序淘汰。

## 文档边界

用户侧用法、安装方式和工具说明放在 `README.md`。
