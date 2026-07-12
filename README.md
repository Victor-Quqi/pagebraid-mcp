# `pagebraid-mcp`

[中文说明](./README.zh-CN.md)

`pagebraid-mcp` is an MCP server for reading local PDF files in agents that can call MCP tools but do not provide native PDF reading.

It currently exposes a single tool: `read_pdf`.

## Requirements

- An MCP client that supports `stdio` servers
- `npm` available on the machine that launches the MCP server
- A multimodal model if you want to use `auto` or `image_only`, because the server can return page images
- A text-only model can still use `text_only`

## Codex Configuration

Add the server to `~/.codex/config.toml`:

```toml
[mcp_servers]

[mcp_servers.pagebraid]
command = "npx"
args = ["-y", "pagebraid-mcp"]
```

To use a local build (`<path-to-pagebraid-mcp>` is this project's local directory):

```toml
[mcp_servers]

[mcp_servers.pagebraid]
command = "node"
args = ["<path-to-pagebraid-mcp>/dist/index.js"]
```

Enter that directory, then install dependencies and build:

```bash
cd <path-to-pagebraid-mcp>
npm install
npm run build
```

## Other MCP Clients

For MCP clients that use a JSON `stdio` server configuration, the equivalent setup is:

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

To use a local build:

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

## Model And Usage Notes

- The PDF path must be accessible on the same machine that runs this MCP server.
- `auto` returns extracted text and rendered page images.
- `image_only` requires a model that can consume image content.
- If the model is text-only, use `text_only`.
- Tuned and tested end to end for Codex and Claude Code; other MCP clients have not been tested yet.

## Debug CLI

`pagebraid-debug` starts the server over stdio and calls `read_pdf`. Returned text blocks are written as `.txt`, image blocks are decoded to files, and `manifest.json` keeps the MCP block order.
`PAGEBRAID_*` and `MAX_MCP_OUTPUT_TOKENS` from the current shell are forwarded to the debug server.

```bash
pagebraid-debug read-pdf ./paper.pdf --pages 3 --mode auto
pagebraid-debug read-pdf ./paper.pdf --pages 3 --out .tmp/pagebraid-debug --raw-result
pagebraid-debug read-pdf ./paper.pdf --server-command node --server-arg dist/index.js
```

## Tool

### `read_pdf`

Input:

- `file_path`: local PDF path
- `mode`: `auto` | `text_only` | `image_only`
- `pages`: optional page selector

`pages` only supports these formats:

- `"23"`: read only page 23
- `"23-27"`: read pages 23 through 27
- `"23-"`: read from page 23 onward until the current response budget is reached or the document ends

Behavior:

- `auto` returns text plus page images
- `text_only` returns only text
- `image_only` returns only page images
- Response size adapts to detected Codex and Claude Code clients; unknown clients use a conservative fallback
- Image clarity does not decrease with the requested page count; large image reads are split by context, rendering, and transfer budgets
- If truncation happens, the response includes the remaining page range and a recommended next call

## Budget Overrides

Set these variables in the MCP server's environment configuration:

- `PAGEBRAID_CLIENT_PROFILE` selects `codex`, `claude-code`, or `generic` explicitly
- `PAGEBRAID_TOKEN_BUDGET` overrides the detected token budget

Image resource budgets normally need no configuration. Advanced overrides are documented in `docs/implementation-notes.md`.

## Notes

- Cache is currently in-memory, keyed by `path + size + mtimeMs`
- No OCR fallback yet
- Implementation notes: `docs/implementation-notes.md`
