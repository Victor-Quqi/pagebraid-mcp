import { CLIENT_INFO_META_KEY } from "@modelcontextprotocol/server";
import type { McpServer, ServerContext } from "@modelcontextprotocol/server";

import { ReadPdfInputSchema } from "../schemas/read-pdf.js";
import { resolveClientBudgetPolicy } from "../services/client-budget-policy.js";
import { readPdf } from "../services/pdf-service.js";
import { buildReadPdfContent, limitTextBytes } from "../services/read-pdf-content.js";

const READ_PDF_TOOL_NAME = "read_pdf";

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
      const budgetPolicy = resolveClientBudgetPolicy(getClientInfo(server, context));
      try {
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
        const errorText = `Error: ${message}`;
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: budgetPolicy.byte_budget === null
                ? errorText
                : limitTextBytes(errorText, budgetPolicy.byte_budget)
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
