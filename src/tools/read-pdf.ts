import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { readPdf } from "../services/pdf-service.js";
import { ReadPdfInputSchema } from "../schemas/read-pdf.js";

const READ_PDF_TOOL_NAME = "read_pdf";

type ReadPdfContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string };

export function registerReadPdfTool(server: McpServer): void {
  server.registerTool(
    READ_PDF_TOOL_NAME,
    {
      title: "Read PDF Pages",
      description: [
        "Read a local PDF file and return page text plus rendered page images directly as model-visible content blocks.",
        "Arguments: file_path is required and must point to a local PDF file. mode is optional and defaults to auto. pages is optional and accepts exactly one of: \"23\", \"23-27\", or \"23-\".",
        "Behavior: if pages is omitted, the tool reads forward from page 1 until the payload budget is reached or the document ends. If pages is provided, the tool reads as much of that requested range as fits in the payload budget.",
        "Mode semantics: auto returns both extracted text and rendered page images. text_only returns text without images. image_only returns page images without text.",
        "When truncation happens, the first text block includes the remaining page range and a ready-to-run recommended next call. Use this tool when the agent needs to actually read or visually inspect the PDF."
      ].join(" "),
      inputSchema: ReadPdfInputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async params => {
      try {
        const result = await readPdf({
          file_path: params.file_path,
          mode: params.mode ?? "auto",
          pages: params.pages,
          continuation_tool_name: READ_PDF_TOOL_NAME
        });

        return {
          content: buildReadPdfContent(result)
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: `Error: ${message}`
            }
          ]
        };
      }
    }
  );
}

function buildReadPdfContent(result: Awaited<ReturnType<typeof readPdf>>): ReadPdfContentBlock[] {
  const content: ReadPdfContentBlock[] = [
    {
      type: "text",
      text: result.summary_text
    }
  ];

  for (const page of result.pages) {
    content.push({
      type: "text",
      text: `Page ${page.page_number}`
    });

    if (page.text !== undefined) {
      content.push({
        type: "text",
        text: page.text || "[No extractable text found on this page.]"
      });
    }

    if (page.image_base64) {
      content.push({
        type: "image",
        data: page.image_base64,
        mimeType: page.image_mime_type ?? "image/jpeg"
      });
    }
  }

  return content;
}

