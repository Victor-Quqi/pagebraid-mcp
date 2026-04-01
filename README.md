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

If you want Codex to launch a local build instead of `npx`, use:

```toml
[mcp_servers]

[mcp_servers.pagebraid]
command = "node"
args = ["<path-to-pagebraid-mcp>/dist/index.js"]
```

For a local build, prepare the project with:

```bash
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

For a local build, point the client at the compiled entry:

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

Replace `<path-to-pagebraid-mcp>` with your own local path.

## Model And Usage Notes

- The PDF path must be accessible on the same machine that runs this MCP server.
- `auto` returns extracted text and rendered page images.
- `image_only` requires a model that can consume image content.
- If the model is text-only, use `text_only`.

## Tool

### `read_pdf`

Input:

- `file_path`: local PDF path
- `mode`: `auto` | `text_only` | `image_only`
- `pages`: optional page selector

`pages` only supports these formats:

- `"23"`: read only page 23
- `"23-27"`: read pages 23 through 27
- `"23-"`: read from page 23 onward until the payload budget is reached or the document ends

Behavior:

- `auto` returns text plus page images
- `text_only` returns only text
- `image_only` returns only page images
- If truncation happens, the response includes the remaining page range and a recommended next call

## Status

- Primarily built and tuned for Codex
- Claude Code may aggressively truncate large MCP tool responses on the client side, so its built-in document/PDF tool is usually a better choice there
- Other MCP clients have not been tested yet

## Notes

- Cache is currently in-memory, keyed by `path + size + mtimeMs`
- No OCR fallback yet
- Implementation notes: `docs/implementation-notes.md`
