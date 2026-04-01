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

如果你希望 Codex 直接启动本地构建产物，而不是通过 `npx`，可以写成：

```toml
[mcp_servers]

[mcp_servers.pagebraid]
command = "node"
args = ["<path-to-pagebraid-mcp>/dist/index.js"]
```

如果使用本地构建产物，先准备项目：

```bash
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

如果希望直接运行本地构建产物，把客户端指向编译后的入口文件：

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

把 `<path-to-pagebraid-mcp>` 替换成你自己的本地路径。

## 模型与使用说明

- PDF 路径必须对运行该 MCP server 的机器可访问。
- `auto` 返回提取文本和整页图像。
- `image_only` 需要模型能够消费图像内容。
- 如果模型只支持文本，请使用 `text_only`。

## 工具

### `read_pdf`

输入：

- `file_path`：本地 PDF 路径
- `mode`：`auto` | `text_only` | `image_only`
- `pages`：可选页选择器

`pages` 只支持三种格式：

- `"23"`：只读第 23 页
- `"23-27"`：读取 23 到 27 页
- `"23-"`：从第 23 页向后读到 payload budget 上限或文档结束

行为：

- `auto` 返回文本和页面图像
- `text_only` 只返回文本
- `image_only` 只返回页面图像
- 发生截断时，返回结果会给出剩余页范围和建议的下一次调用

## 当前状态

- 目前主要为 Codex 使用场景设计和调优
- Claude Code 在处理较大的 MCP 工具返回时，客户端侧可能会截断内容，因此通常更建议直接使用它自带的文档 / PDF 工具
- 其它 MCP 客户端暂未测试

## 备注

- 当前缓存为内存缓存，键为 `path + size + mtimeMs`
- 当前版本没有 OCR fallback
- 工程实现说明见 `docs/implementation-notes.md`
