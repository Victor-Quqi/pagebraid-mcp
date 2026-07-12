# `pagebraid-mcp`

[English README](./README.md)

`pagebraid-mcp` 是一个面向本地 PDF 的 MCP server，适用于能调用 MCP 工具、但没有原生 PDF 阅读能力的 agent。

当前只提供一个工具：`read_pdf`。

## 要求

- MCP 客户端支持 `stdio` 方式启动 server
- 启动 MCP server 的机器上有 `npm`
- 如果要使用 `auto` 或 `image_only`，客户端所用模型需要支持多模态 / 图像输入
- 如果模型只支持文本，可使用 `text_only`

## Codex 配置

把下面这段加到 `~/.codex/config.toml`：

```toml
[mcp_servers]

[mcp_servers.pagebraid]
command = "npx"
args = ["-y", "pagebraid-mcp"]
```

使用本地构建（`<path-to-pagebraid-mcp>` 为本项目的本地目录）：

```toml
[mcp_servers]

[mcp_servers.pagebraid]
command = "node"
args = ["<path-to-pagebraid-mcp>/dist/index.js"]
```

先进入该目录，再安装依赖并构建：

```bash
cd <path-to-pagebraid-mcp>
npm install
npm run build
```

## 其它 MCP 客户端配置

如果你的 MCP 客户端使用 JSON 形式配置 `stdio` server，对应写法如下：

```json
{
  "mcpServers": {
    "pagebraid": {
      "command": "npx",
      "args": ["-y", "pagebraid-mcp"]
    }
  }
}
```

使用本地构建：

```json
{
  "mcpServers": {
    "pagebraid": {
      "command": "node",
      "args": ["<path-to-pagebraid-mcp>/dist/index.js"]
    }
  }
}
```

## 模型与使用说明

- PDF 路径必须对运行该 MCP server 的机器可访问。
- `auto` 返回提取文本和整页图像。
- `image_only` 需要模型能够消费图像内容。
- 如果模型只支持文本，请使用 `text_only`。
- 已针对 Codex 和 Claude Code 调优并完成端到端测试；其它 MCP 客户端暂未测试。

## 调试 CLI

`pagebraid-debug` 通过 stdio 启动 server 并调用 `read_pdf`。返回的 text block 写成 `.txt`，image block 解码成图片，`manifest.json` 保留 MCP block 顺序。
当前 shell 中的 `PAGEBRAID_*` 和 `MAX_MCP_OUTPUT_TOKENS` 会传给调试 server。

```bash
pagebraid-debug read-pdf ./paper.pdf --pages 3 --mode auto
pagebraid-debug read-pdf ./paper.pdf --pages 3 --out .tmp/pagebraid-debug --raw-result
pagebraid-debug read-pdf ./paper.pdf --server-command node --server-arg dist/index.js
```

## 工具

### `read_pdf`

输入：

- `file_path`：本地 PDF 路径
- `mode`：`auto` | `text_only` | `image_only`
- `pages`：可选页选择器

`pages` 只支持三种格式：

- `"23"`：只读第 23 页
- `"23-27"`：读取 23 到 27 页
- `"23-"`：从第 23 页向后读到当前返回预算上限或文档结束

行为：

- `auto` 返回文本和页面图像
- `text_only` 只返回文本
- `image_only` 只返回页面图像
- 返回量会适配检测到的 Codex 和 Claude Code 客户端；未知客户端使用保守回退值
- 图片清晰度不随请求页数降低；较大的图片读取会按上下文、渲染量和传输量自动分批
- 发生截断时，返回结果会给出剩余页范围和建议的下一次调用

## 预算设置

以下变量需要配置在 MCP server 的启动环境中：

- `PAGEBRAID_CLIENT_PROFILE` 可显式选择 `codex`、`claude-code` 或 `generic`
- `PAGEBRAID_TOKEN_BUDGET` 可覆盖检测到的 token 预算

图片资源预算通常无需配置，高级覆盖项见 `docs/implementation-notes.md`。

## 备注

- 当前缓存为内存缓存，键为 `path + size + mtimeMs`
- 当前版本没有 OCR fallback
- 工程实现说明见 `docs/implementation-notes.md`
