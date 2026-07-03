import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { readPdf } from "../services/pdf-service.js";
import { ReadPdfInputSchema } from "../schemas/read-pdf.js";
import { DEFAULT_IMAGE_MIME_TYPE } from "../constants.js";

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
        "Read local PDF pages.",
        "Output markers: @@PB_META, @@PDF_TEXT p=N, @@PDF_IMAGE p=N.",
        "Omit pages to start at page 1; large reads may truncate with rem/next in @@PB_META."
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
    if (page.text !== undefined) {
      content.push({
        type: "text",
        text: buildPdfTextBlock(page)
      });
    }

    if (page.image_base64) {
      if (page.text === undefined) {
        content.push({
          type: "text",
          text: `@@PDF_IMAGE p=${page.page_number}`
        });
      }

      content.push({
        type: "image",
        data: page.image_base64,
        mimeType: page.image_mime_type ?? DEFAULT_IMAGE_MIME_TYPE
      });
    }
  }

  return content;
}

type ReadPdfResult = Awaited<ReturnType<typeof readPdf>>;
type ReadPdfPage = ReadPdfResult["pages"][number];

function buildPdfTextBlock(page: ReadPdfPage): string {
  const flags = [
    page.image_base64 ? "img=next" : null,
    page.text ? null : "empty=1"
  ].filter((flag): flag is string => flag !== null);
  const header = [`@@PDF_TEXT p=${page.page_number}`, ...flags].join(" ");

  return page.text ? `${header}\n${page.text}` : header;
}

