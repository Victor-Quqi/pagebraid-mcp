import { CLIENT_INFO_META_KEY } from "@modelcontextprotocol/server";
import type { McpServer, ServerContext } from "@modelcontextprotocol/server";

import { DEFAULT_IMAGE_MIME_TYPE } from "../constants.js";
import { ReadPdfInputSchema } from "../schemas/read-pdf.js";
import { resolveClientBudgetPolicy } from "../services/client-budget-policy.js";
import { readPdf } from "../services/pdf-service.js";
import { buildPdfImageMarker, buildPdfTextBlock } from "../services/read-pdf-content.js";

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
    async (params, context) => {
      try {
        const budgetPolicy = resolveClientBudgetPolicy(getClientInfo(server, context));
        const result = await readPdf({
          file_path: params.file_path,
          mode: params.mode ?? "auto",
          pages: params.pages,
          continuation_tool_name: READ_PDF_TOOL_NAME,
          budget_policy: budgetPolicy
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

function getClientInfo(
  server: McpServer,
  context: ServerContext
): { name?: string; version?: string } | undefined {
  const envelope = context.mcpReq.envelope as Record<string, unknown> | undefined;
  const modernClientInfo = envelope?.[CLIENT_INFO_META_KEY];

  if (isClientInfo(modernClientInfo)) {
    return modernClientInfo;
  }

  // Legacy clients provide their identity during initialize only.
  return server.server.getClientVersion();
}

function isClientInfo(value: unknown): value is { name?: string; version?: string } {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    (candidate.name === undefined || typeof candidate.name === "string") &&
    (candidate.version === undefined || typeof candidate.version === "string")
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
          text: buildPdfImageMarker(page.page_number)
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

