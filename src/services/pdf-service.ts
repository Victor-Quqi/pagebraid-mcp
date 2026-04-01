import { promises as fs } from "node:fs";
import path from "node:path";

import { createCanvas } from "@napi-rs/canvas";
import { getDocument, VerbosityLevel, type PDFDocumentProxy, type PDFPageProxy } from "pdfjs-dist/legacy/build/pdf.mjs";

import {
  DEFAULT_IMAGE_JPEG_QUALITY,
  DEFAULT_IMAGE_SCALE,
  DEFAULT_PAYLOAD_BUDGET_CHARS,
  LINE_MERGE_TOLERANCE,
  WORD_BREAK_GAP
} from "../constants.js";
import type { PageRange, ReadMode, ReadPdfRequest, ReadPdfResult } from "../types.js";

interface PdfTextItemLike {
  str: string;
  transform: number[];
  width: number;
  hasEOL?: boolean;
}

interface EncodedPageImage {
  base64: string;
  mime_type: "image/jpeg";
}

interface CachedPdfDocument {
  cache_key: string;
  file_path: string;
  total_pages: number;
  text_document: PDFDocumentProxy;
  text_pages: Map<number, Promise<string>>;
  image_pages: Map<number, Promise<EncodedPageImage>>;
}

const documentCache = new Map<string, CachedPdfDocument>();
const documentPathIndex = new Map<string, string>();

export async function readPdf(request: ReadPdfRequest): Promise<ReadPdfResult> {
  const filePath = await resolvePdfPath(request.file_path);
  const cachedDocument = await getCachedDocument(filePath);
  const mode = request.mode;
  const continuationToolName = request.continuation_tool_name ?? "read_pdf";
  const requestedRange = resolveRequestedRange(request.pages, cachedDocument.total_pages);

  const pages: ReadPdfResult["pages"] = [];
  let accumulatedChars = 0;
  let truncatedByPayload = false;

  for (let pageNumber = requestedRange.start_page; pageNumber <= requestedRange.end_page; pageNumber += 1) {
    const text = mode === "image_only" ? undefined : await getPageText(cachedDocument, pageNumber);
    const image = mode === "text_only" ? undefined : await getPageImage(cachedDocument, pageNumber);

    const estimatedPageChars = estimatePagePayloadChars(text, image?.base64);
    const wouldOverflow =
      pages.length > 0 &&
      accumulatedChars + estimatedPageChars > DEFAULT_PAYLOAD_BUDGET_CHARS;

    if (wouldOverflow) {
      truncatedByPayload = true;
      break;
    }

    pages.push({
      page_number: pageNumber,
      text,
      image_base64: image?.base64,
      image_mime_type: image?.mime_type
    });
    accumulatedChars += estimatedPageChars;
  }

  if (pages.length === 0) {
    const firstPage = requestedRange.start_page;
    const text = mode === "image_only" ? undefined : await getPageText(cachedDocument, firstPage);
    const image = mode === "text_only" ? undefined : await getPageImage(cachedDocument, firstPage);

    pages.push({
      page_number: firstPage,
      text,
      image_base64: image?.base64,
      image_mime_type: image?.mime_type
    });
    truncatedByPayload = requestedRange.end_page > firstPage;
  }

  const returnedRange = {
    start_page: pages[0].page_number,
    end_page: pages[pages.length - 1].page_number
  };

  const remainingRanges = collectRemainingRanges(requestedRange, returnedRange);
  const truncateReason = truncatedByPayload ? "payload_budget" : "none";
  const truncated = truncateReason !== "none" || remainingRanges.length > 0;
  const recommendedNextCall =
    remainingRanges.length > 0
      ? buildRecommendedNextCall(filePath, continuationToolName, mode, remainingRanges[0])
      : null;

  const summaryText = buildSummaryText({
    filePath,
    totalPages: cachedDocument.total_pages,
    requestedRange,
    returnedRange,
    truncated,
    truncateReason,
    mode,
    recommendedNextCall,
    remainingRanges
  });

  return {
    file_path: filePath,
    total_pages: cachedDocument.total_pages,
    mode,
    requested_range: requestedRange,
    returned_range: returnedRange,
    remaining_ranges: remainingRanges,
    returned_pages: pages.map(page => page.page_number),
    truncated,
    truncate_reason: truncateReason,
    recommended_next_call: recommendedNextCall,
    pages,
    summary_text: summaryText
  };
}

async function resolvePdfPath(inputPath: string): Promise<string> {
  const resolvedPath = path.resolve(inputPath);
  const stats = await fs.stat(resolvedPath).catch(() => null);

  if (!stats || !stats.isFile()) {
    throw new Error(`PDF file not found: ${resolvedPath}. Provide a valid local file path.`);
  }

  const extension = path.extname(resolvedPath).toLowerCase();
  if (extension !== ".pdf") {
    throw new Error(`Expected a .pdf file, received: ${resolvedPath}`);
  }

  return resolvedPath;
}

async function getCachedDocument(filePath: string): Promise<CachedPdfDocument> {
  const stats = await fs.stat(filePath);
  const cacheKey = `${filePath}:${stats.size}:${stats.mtimeMs}`;
  const existingKey = documentPathIndex.get(filePath);

  if (existingKey && existingKey !== cacheKey) {
    const staleDocument = documentCache.get(existingKey);
    if (staleDocument) {
      await staleDocument.text_document.destroy();
      documentCache.delete(existingKey);
    }
    documentPathIndex.delete(filePath);
  }

  const cached = documentCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const fileBuffer = await fs.readFile(filePath);
  const loadingTask = getDocument({
    data: new Uint8Array(fileBuffer),
    isEvalSupported: false,
    useWorkerFetch: false,
    disableFontFace: true,
    useSystemFonts: true,
    verbosity: VerbosityLevel.ERRORS,
    cMapUrl: getPdfJsAssetUrl("cmaps"),
    cMapPacked: true,
    standardFontDataUrl: getPdfJsAssetUrl("standard_fonts")
  });
  const textDocument = await loadingTask.promise;

  const created: CachedPdfDocument = {
    cache_key: cacheKey,
    file_path: filePath,
    total_pages: textDocument.numPages,
    text_document: textDocument,
    text_pages: new Map(),
    image_pages: new Map()
  };

  documentCache.set(cacheKey, created);
  documentPathIndex.set(filePath, cacheKey);

  return created;
}

function resolveRequestedRange(pages: string | undefined, totalPages: number): PageRange {
  if (!pages) {
    return {
      start_page: 1,
      end_page: totalPages
    };
  }

  const trimmed = pages.trim();
  if (trimmed.endsWith("-")) {
    const start = clampPage(Number.parseInt(trimmed.slice(0, -1), 10), totalPages);
    return {
      start_page: start,
      end_page: totalPages
    };
  }

  if (!trimmed.includes("-")) {
    const page = clampPage(Number.parseInt(trimmed, 10), totalPages);
    return {
      start_page: page,
      end_page: page
    };
  }

  const [startText, endText] = trimmed.split("-");
  const start = clampPage(Number.parseInt(startText ?? "1", 10), totalPages);
  const end = clampPage(Number.parseInt(endText ?? String(totalPages), 10), totalPages, start);

  return {
    start_page: start,
    end_page: end
  };
}

function clampPage(value: number, totalPages: number, minimum = 1): number {
  if (!Number.isInteger(value)) {
    return minimum;
  }

  return Math.min(Math.max(value, minimum), totalPages);
}

function estimatePagePayloadChars(text: string | undefined, imageBase64: string | undefined): number {
  return 384 + (text?.length ?? 0) + (imageBase64?.length ?? 0);
}

async function getPageText(cachedDocument: CachedPdfDocument, pageNumber: number): Promise<string> {
  let existing = cachedDocument.text_pages.get(pageNumber);
  if (!existing) {
    existing = extractPageText(cachedDocument.text_document, pageNumber);
    cachedDocument.text_pages.set(pageNumber, existing);
  }

  return existing;
}

async function getPageImage(cachedDocument: CachedPdfDocument, pageNumber: number): Promise<EncodedPageImage> {
  let existing = cachedDocument.image_pages.get(pageNumber);
  if (!existing) {
    existing = renderPageImage(cachedDocument.text_document, pageNumber);
    cachedDocument.image_pages.set(pageNumber, existing);
  }

  return existing;
}

async function extractPageText(textDocument: PDFDocumentProxy, pageNumber: number): Promise<string> {
  const page = await textDocument.getPage(pageNumber);

  try {
    const textContent = await page.getTextContent();
    const items = textContent.items.filter(isPdfTextItem) as PdfTextItemLike[];

    if (items.length === 0) {
      return "";
    }

    const lines: string[] = [];
    let currentLine = "";
    let lastY: number | null = null;
    let lastRight: number | null = null;

    for (const item of items) {
      const x = item.transform[4] ?? 0;
      const y = item.transform[5] ?? 0;
      const width = item.width ?? 0;
      const nextChunk = item.str.replace(/\s+/g, " ").trim();

      if (!nextChunk) {
        continue;
      }

      const movedToNewLine = lastY !== null && Math.abs(y - lastY) > LINE_MERGE_TOLERANCE;
      if (movedToNewLine && currentLine.trim()) {
        lines.push(currentLine.trim());
        currentLine = "";
        lastRight = null;
      }

      const needsWordBreak =
        currentLine.length > 0 &&
        lastRight !== null &&
        x - lastRight > WORD_BREAK_GAP;

      currentLine += needsWordBreak ? ` ${nextChunk}` : nextChunk;
      lastY = y;
      lastRight = x + width;

      if (item.hasEOL) {
        lines.push(currentLine.trim());
        currentLine = "";
        lastRight = null;
        lastY = null;
      }
    }

    if (currentLine.trim()) {
      lines.push(currentLine.trim());
    }

    return lines.join("\n");
  } finally {
    page.cleanup();
  }
}

async function renderPageImage(textDocument: PDFDocumentProxy, pageNumber: number): Promise<EncodedPageImage> {
  const page = await textDocument.getPage(pageNumber);

  try {
    const encoded = await renderPageImageAtFixedSettings(page);
    return {
      base64: encoded.toString("base64"),
      mime_type: "image/jpeg"
    };
  } finally {
    page.cleanup();
  }
}

async function renderPageImageAtFixedSettings(page: PDFPageProxy): Promise<Buffer> {
  const viewport = page.getViewport({ scale: DEFAULT_IMAGE_SCALE });
  const width = Math.max(1, Math.ceil(viewport.width));
  const height = Math.max(1, Math.ceil(viewport.height));
  const canvas = createCanvas(width, height);
  const context = canvas.getContext("2d");

  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";

  await page.render({
    canvas,
    canvasContext: context,
    viewport
  }).promise;

  return canvas.toBuffer("image/jpeg", DEFAULT_IMAGE_JPEG_QUALITY);
}

function isPdfTextItem(item: unknown): item is PdfTextItemLike {
  return (
    typeof item === "object" &&
    item !== null &&
    "str" in item &&
    typeof (item as { str?: unknown }).str === "string" &&
    "transform" in item &&
    Array.isArray((item as { transform?: unknown }).transform)
  );
}

function collectRemainingRanges(requestedRange: PageRange, returnedRange: PageRange): PageRange[] {
  if (returnedRange.end_page >= requestedRange.end_page) {
    return [];
  }

  return [
    {
      start_page: returnedRange.end_page + 1,
      end_page: requestedRange.end_page
    }
  ];
}

function buildRecommendedNextCall(filePath: string, toolName: string, mode: ReadMode, nextRange: PageRange): string {
  return `${toolName}({"file_path":"${escapeJsonString(filePath)}","mode":"${mode}","pages":"${nextRange.start_page}-${nextRange.end_page}"})`;
}

function buildSummaryText(input: {
  filePath: string;
  totalPages: number;
  requestedRange: PageRange;
  returnedRange: PageRange;
  truncated: boolean;
  truncateReason: ReadPdfResult["truncate_reason"];
  mode: ReadMode;
  recommendedNextCall: string | null;
  remainingRanges: PageRange[];
}): string {
  const lines = [
    `PDF file: ${input.filePath}`,
    `Mode: ${input.mode}`,
    `Total pages: ${input.totalPages}`,
    `Requested range: ${input.requestedRange.start_page}-${input.requestedRange.end_page}`,
    `Returned range: ${input.returnedRange.start_page}-${input.returnedRange.end_page}`
  ];

  if (input.truncated) {
    const remainingText = input.remainingRanges.map(range => `${range.start_page}-${range.end_page}`).join(", ");
    lines.push("Truncated: yes");
    lines.push(`Truncate reason: ${describeTruncateReason(input.truncateReason)}`);
    lines.push(`Remaining ranges: ${remainingText || "none"}`);
    lines.push(`Recommended next call: ${input.recommendedNextCall ?? "none"}`);
  }

  return lines.join("\n");
}

function describeTruncateReason(reason: ReadPdfResult["truncate_reason"]): string {
  switch (reason) {
    case "payload_budget":
      return "payload budget";
    default:
      return "none";
  }
}

function escapeJsonString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function getPdfJsAssetUrl(directory: "cmaps" | "standard_fonts"): string {
  return new URL(`../../node_modules/pdfjs-dist/${directory}/`, import.meta.url).href;
}

