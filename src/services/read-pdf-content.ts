import type { RenderedPage } from "../types.js";

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

export function buildPdfImageMarker(pageNumber: number): string {
  return `@@PDF_IMAGE p=${pageNumber}`;
}
