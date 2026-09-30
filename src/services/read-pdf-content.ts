import { DEFAULT_IMAGE_MIME_TYPE } from "../constants.js";
import type { ReadPdfResult, RenderedPage } from "../types.js";

export function buildPdfTextBlock(
  page: RenderedPage,
  hasImage = Boolean(page.image_base64)
): string {
  const flags = [
    hasImage ? "img=next" : null,
    page.text ? null : "empty=1"
  ].filter((flag): flag is string => flag !== null);
  const header = [`@@PDF_TEXT p=${page.page_number}`, ...flags].join(" ");

  return page.text ? `${header}\n${page.text}` : header;
}

export function buildPdfImageMarker(pageNumber: number, textOmitted = false): string {
  return `@@PDF_IMAGE p=${pageNumber}${textOmitted ? " text=omitted" : ""}`;
}

export function limitTextBytes(text: string, maxBytes: number): string {
  const bytes = Buffer.from(text, "utf8");
  let end = Math.min(bytes.length, maxBytes);
  while (end > 0 && (bytes[end] & 0xc0) === 0x80) {
    end -= 1;
  }
  return bytes.subarray(0, end).toString("utf8");
}

type ReadPdfContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string };

export function buildReadPdfContent(result: ReadPdfResult): ReadPdfContentBlock[] {
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
          text: buildPdfImageMarker(page.page_number, page.text_omitted)
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
