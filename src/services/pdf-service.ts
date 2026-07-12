import { promises as fs } from "node:fs";
import path from "node:path";

import { createCanvas, type Canvas } from "@napi-rs/canvas";
import { getDocument, VerbosityLevel, type PDFDocumentProxy, type PDFPageProxy } from "pdfjs-dist/legacy/build/pdf.mjs";

import {
  AUTO_IMAGE_RENDER_SCALE,
  DEFAULT_IMAGE_CACHE_WIRE_BYTES,
  DEFAULT_IMAGE_MIME_TYPE,
  IMAGE_MAX_EDGE,
  IMAGE_MAX_ENCODED_BYTES,
  IMAGE_MAX_PIXELS,
  IMAGE_ONLY_IMAGE_RENDER_SCALE,
  IMAGE_RENDER_FALLBACK_QUALITY,
  IMAGE_RENDER_QUALITY,
  IMAGE_RENDER_SCALE_MULTIPLIERS,
  LINE_MERGE_TOLERANCE,
  WORD_BREAK_GAP
} from "../constants.js";
import type {
  ContentUsageEstimate,
  ImageResourcePolicy,
  ImageMimeType,
  PageRange,
  ReadMode,
  ReadPdfRequest,
  ReadPdfResult,
  RenderedPage,
  TokenEstimate,
  TruncateReason
} from "../types.js";
import {
  estimateClientTokens,
  fitsClientBudget,
  resolveClientBudgetPolicy
} from "./client-budget-policy.js";
import {
  findImageResourceOverflow,
  resolveImageResourcePolicy
} from "./image-resource-policy.js";
import { buildPdfImageMarker, buildPdfTextBlock } from "./read-pdf-content.js";
import {
  ZERO_CONTENT_USAGE,
  addContentUsages,
  estimateImageUsage,
  estimateTextUsage
} from "./token-budget.js";

interface PdfTextItemLike {
  str: string;
  transform: number[];
  width: number;
  hasEOL?: boolean;
}

interface EncodedPageImage {
  base64: string;
  mime_type: ImageMimeType;
  width: number;
  height: number;
  encoded_bytes: number;
}

interface EncodedImageCandidate {
  buffer: Buffer;
  width: number;
  height: number;
}

interface ImageRenderPolicy {
  mime_type: ImageMimeType;
  preferred_scale: number;
  quality: number;
  fallback_quality: number;
  max_edge: number;
  max_pixels: number;
  max_encoded_bytes: number;
}

interface ImageRenderPlan {
  scale: number;
  width: number;
  height: number;
}

interface CachedPdfDocument {
  cache_key: string;
  file_path: string;
  total_pages: number;
  text_document: PDFDocumentProxy;
  text_pages: Map<number, Promise<string>>;
  image_plans: Map<string, Promise<ImageRenderPlan>>;
  image_pages: Map<string, Promise<EncodedPageImage>>;
  image_cache_sizes: Map<string, number>;
  image_cache_wire_bytes: number;
}

interface SummaryInput {
  filePath: string;
  totalPages: number;
  requestedRange: PageRange;
  returnedRange: PageRange;
  truncated: boolean;
  truncateReason: ReadPdfResult["truncate_reason"];
  mode: ReadMode;
  recommendedNextCall: string | null;
  remainingRanges: PageRange[];
}

const documentCache = new Map<string, CachedPdfDocument>();
const documentPathIndex = new Map<string, string>();

export async function readPdf(request: ReadPdfRequest): Promise<ReadPdfResult> {
  const filePath = await resolvePdfPath(request.file_path);
  const cachedDocument = await getCachedDocument(filePath);
  const mode = request.mode;
  const continuationToolName = request.continuation_tool_name ?? "read_pdf";
  const requestedRange = resolveRequestedRange(request.pages, cachedDocument.total_pages);
  const imageRenderPolicy = resolveImageRenderPolicy(mode);
  const budgetPolicy = request.budget_policy ?? resolveClientBudgetPolicy(undefined);
  const imageResourcePolicy =
    request.image_resource_policy ?? resolveImageResourcePolicy();

  const pages: ReadPdfResult["pages"] = [];
  let accumulatedUsage = ZERO_CONTENT_USAGE;
  let stoppedBy: TruncateReason = "none";

  for (let pageNumber = requestedRange.start_page; pageNumber <= requestedRange.end_page; pageNumber += 1) {
    const text = mode === "image_only" ? undefined : await getPageText(cachedDocument, pageNumber);
    const imagePlan = imageRenderPolicy
      ? await getPageImagePlan(cachedDocument, pageNumber, imageRenderPolicy)
      : undefined;
    const plannedPage: RenderedPage = {
      page_number: pageNumber,
      text,
      image_width: imagePlan?.width,
      image_height: imagePlan?.height
    };
    const plannedContentUsage = addContentUsages(
      accumulatedUsage,
      estimateRenderedPageUsage(plannedPage, imagePlan !== undefined)
    );
    const candidateReturnedRange = {
      start_page: pages[0]?.page_number ?? pageNumber,
      end_page: pageNumber
    };
    const candidateRemainingRanges = collectRemainingRanges(requestedRange, candidateReturnedRange);
    const candidateTruncated = candidateRemainingRanges.length > 0;
    const candidateNextCall = candidateTruncated
      ? buildRecommendedNextCall(filePath, continuationToolName, mode, candidateRemainingRanges[0])
      : null;
    const candidateSummaryInput: SummaryInput = {
      filePath,
      totalPages: cachedDocument.total_pages,
      requestedRange,
      returnedRange: candidateReturnedRange,
      truncated: candidateTruncated,
      truncateReason: candidateTruncated ? "client_token_budget" : "none",
      mode,
      recommendedNextCall: candidateNextCall,
      remainingRanges: candidateRemainingRanges
    };
    const plannedEstimatedUsage = addContentUsages(
      plannedContentUsage,
      estimateTextUsage(buildSummaryText(candidateSummaryInput))
    );

    if (pages.length > 0 && !fitsClientBudget(plannedEstimatedUsage, budgetPolicy)) {
      stoppedBy = "client_token_budget";
      break;
    }

    const plannedImageOverflow = imageRenderPolicy
      ? findImageResourceOverflow(
          plannedEstimatedUsage,
          imageResourcePolicy,
          budgetPolicy.profile,
          false
        )
      : null;
    if (pages.length > 0 && plannedImageOverflow) {
      stoppedBy = plannedImageOverflow;
      break;
    }

    const image = imageRenderPolicy && imagePlan
      ? await getPageImage(cachedDocument, pageNumber, imageRenderPolicy, imagePlan)
      : undefined;
    const renderedPage: RenderedPage = {
      page_number: pageNumber,
      text,
      image_base64: image?.base64,
      image_mime_type: image?.mime_type,
      image_width: image?.width,
      image_height: image?.height,
      image_encoded_bytes: image?.encoded_bytes
    };
    const candidateContentUsage = addContentUsages(
      accumulatedUsage,
      estimateRenderedPageUsage(renderedPage)
    );
    const candidateEstimatedUsage = addContentUsages(
      candidateContentUsage,
      estimateTextUsage(buildSummaryText(candidateSummaryInput))
    );
    const imageOverflow = imageRenderPolicy
      ? findImageResourceOverflow(
          candidateEstimatedUsage,
          imageResourcePolicy,
          budgetPolicy.profile,
          true
        )
      : null;
    if (pages.length > 0 && imageOverflow) {
      stoppedBy = imageOverflow;
      break;
    }

    pages.push(renderedPage);
    accumulatedUsage = candidateContentUsage;
  }

  const returnedRange = {
    start_page: pages[0].page_number,
    end_page: pages[pages.length - 1].page_number
  };

  const remainingRanges = collectRemainingRanges(requestedRange, returnedRange);
  const truncated = remainingRanges.length > 0;
  const truncateReason: ReadPdfResult["truncate_reason"] = truncated ? stoppedBy : "none";
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
  const finalUsage = addContentUsages(accumulatedUsage, estimateTextUsage(summaryText));
  const clientEstimate = estimateClientTokens(finalUsage, budgetPolicy);
  const estimatedTokens: TokenEstimate = {
    ...finalUsage,
    client: clientEstimate.detailed,
    client_coarse: clientEstimate.coarse
  };

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
    client_profile: budgetPolicy.profile,
    token_budget: budgetPolicy.token_budget,
    estimated_tokens: estimatedTokens,
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
    image_plans: new Map(),
    image_pages: new Map(),
    image_cache_sizes: new Map(),
    image_cache_wire_bytes: 0
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

function estimateRenderedPageUsage(
  page: RenderedPage,
  hasImage = Boolean(page.image_base64)
): ContentUsageEstimate {
  const estimates: ContentUsageEstimate[] = [];

  if (page.text !== undefined) {
    estimates.push(estimateTextUsage(buildPdfTextBlock(page, hasImage)));
  }

  if (hasImage) {
    if (page.text === undefined) {
      estimates.push(estimateTextUsage(buildPdfImageMarker(page.page_number)));
    }

    estimates.push(
      estimateImageUsage(
        page.image_width ?? 1,
        page.image_height ?? 1,
        page.image_encoded_bytes ?? 0,
        page.image_base64?.length ?? 0
      )
    );
  }

  return addContentUsages(...estimates);
}

async function getPageText(cachedDocument: CachedPdfDocument, pageNumber: number): Promise<string> {
  let existing = cachedDocument.text_pages.get(pageNumber);
  if (!existing) {
    existing = extractPageText(cachedDocument.text_document, pageNumber);
    cachedDocument.text_pages.set(pageNumber, existing);
  }

  return existing;
}

async function getPageImagePlan(
  cachedDocument: CachedPdfDocument,
  pageNumber: number,
  policy: ImageRenderPolicy
): Promise<ImageRenderPlan> {
  const cacheKey = `${pageNumber}:${formatImageRenderPolicy(policy)}`;
  let existing = cachedDocument.image_plans.get(cacheKey);
  if (!existing) {
    existing = planPageImage(cachedDocument.text_document, pageNumber, policy);
    cachedDocument.image_plans.set(cacheKey, existing);
    existing.catch(() => {
      if (cachedDocument.image_plans.get(cacheKey) === existing) {
        cachedDocument.image_plans.delete(cacheKey);
      }
    });
  }

  return existing;
}

async function getPageImage(
  cachedDocument: CachedPdfDocument,
  pageNumber: number,
  policy: ImageRenderPolicy,
  plan: ImageRenderPlan
): Promise<EncodedPageImage> {
  const cacheKey = `${pageNumber}:${formatImageRenderPolicy(policy)}`;
  let existing = cachedDocument.image_pages.get(cacheKey);
  if (!existing) {
    existing = renderPageImage(cachedDocument.text_document, pageNumber, policy, plan);
    cachedDocument.image_pages.set(cacheKey, existing);
    existing.then(
      image => {
        if (cachedDocument.image_pages.get(cacheKey) !== existing) {
          return;
        }

        const wireBytes = image.base64.length;
        cachedDocument.image_cache_sizes.set(cacheKey, wireBytes);
        cachedDocument.image_cache_wire_bytes += wireBytes;
        evictImageCache(cachedDocument, cacheKey);
      },
      () => {
        if (cachedDocument.image_pages.get(cacheKey) === existing) {
          cachedDocument.image_pages.delete(cacheKey);
          cachedDocument.image_cache_sizes.delete(cacheKey);
        }
      }
    );
  } else {
    touchImageCacheEntry(cachedDocument, cacheKey, existing);
  }

  return existing;
}

async function planPageImage(
  textDocument: PDFDocumentProxy,
  pageNumber: number,
  policy: ImageRenderPolicy
): Promise<ImageRenderPlan> {
  const page = await textDocument.getPage(pageNumber);

  try {
    const baseViewport = page.getViewport({ scale: 1 });
    const baseWidth = Math.max(baseViewport.width, 1);
    const baseHeight = Math.max(baseViewport.height, 1);
    const edgeScale = policy.max_edge / Math.max(baseWidth, baseHeight);
    const pixelScale = Math.sqrt(policy.max_pixels / (baseWidth * baseHeight));
    const scale = Math.max(
      Math.min(policy.preferred_scale, edgeScale, pixelScale),
      Number.EPSILON
    );
    const viewport = page.getViewport({ scale });

    return {
      scale,
      width: Math.max(1, Math.ceil(viewport.width)),
      height: Math.max(1, Math.ceil(viewport.height))
    };
  } finally {
    page.cleanup();
  }
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

async function renderPageImage(
  textDocument: PDFDocumentProxy,
  pageNumber: number,
  policy: ImageRenderPolicy,
  plan: ImageRenderPlan
): Promise<EncodedPageImage> {
  const page = await textDocument.getPage(pageNumber);

  try {
    const encoded = await renderPageImageWithinBudget(page, policy, plan);
    const base64 = encoded.buffer.toString("base64");
    return {
      base64,
      mime_type: policy.mime_type,
      width: encoded.width,
      height: encoded.height,
      encoded_bytes: encoded.buffer.length
    };
  } finally {
    page.cleanup();
  }
}

async function renderPageImageWithinBudget(
  page: PDFPageProxy,
  policy: ImageRenderPolicy,
  plan: ImageRenderPlan
): Promise<EncodedImageCandidate> {
  let smallestCandidate: EncodedImageCandidate | null = null;
  let finalCanvas: Canvas | null = null;

  for (const multiplier of IMAGE_RENDER_SCALE_MULTIPLIERS) {
    const scale = plan.scale * multiplier;
    const canvas = await renderPageToCanvas(page, scale);
    finalCanvas = canvas;
    const encoded = canvas.toBuffer(policy.mime_type, policy.quality);
    const candidate = {
      buffer: encoded,
      width: canvas.width,
      height: canvas.height
    };

    if (!smallestCandidate || encoded.length < smallestCandidate.buffer.length) {
      smallestCandidate = candidate;
    }

    if (encoded.length <= policy.max_encoded_bytes) {
      return candidate;
    }
  }

  if (finalCanvas) {
    const encoded = finalCanvas.toBuffer(policy.mime_type, policy.fallback_quality);
    const candidate = {
      buffer: encoded,
      width: finalCanvas.width,
      height: finalCanvas.height
    };

    if (!smallestCandidate || encoded.length < smallestCandidate.buffer.length) {
      smallestCandidate = candidate;
    }
  }

  return smallestCandidate ?? { buffer: Buffer.alloc(0), width: 1, height: 1 };
}

async function renderPageToCanvas(page: PDFPageProxy, scale: number): Promise<Canvas> {
  const viewport = page.getViewport({ scale });
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

  return canvas;
}

function resolveImageRenderPolicy(mode: ReadMode): ImageRenderPolicy | null {
  if (mode === "text_only") {
    return null;
  }

  return {
    mime_type: DEFAULT_IMAGE_MIME_TYPE,
    preferred_scale:
      mode === "image_only" ? IMAGE_ONLY_IMAGE_RENDER_SCALE : AUTO_IMAGE_RENDER_SCALE,
    quality: IMAGE_RENDER_QUALITY,
    fallback_quality: IMAGE_RENDER_FALLBACK_QUALITY,
    max_edge: IMAGE_MAX_EDGE,
    max_pixels: IMAGE_MAX_PIXELS,
    max_encoded_bytes: IMAGE_MAX_ENCODED_BYTES
  };
}

function formatImageRenderPolicy(policy: ImageRenderPolicy): string {
  return [
    policy.mime_type,
    policy.preferred_scale,
    policy.quality,
    policy.fallback_quality,
    policy.max_edge,
    policy.max_pixels,
    policy.max_encoded_bytes
  ].join(":");
}

function touchImageCacheEntry(
  cachedDocument: CachedPdfDocument,
  cacheKey: string,
  promise: Promise<EncodedPageImage>
): void {
  cachedDocument.image_pages.delete(cacheKey);
  cachedDocument.image_pages.set(cacheKey, promise);

  const size = cachedDocument.image_cache_sizes.get(cacheKey);
  if (size !== undefined) {
    cachedDocument.image_cache_sizes.delete(cacheKey);
    cachedDocument.image_cache_sizes.set(cacheKey, size);
  }
}

function evictImageCache(cachedDocument: CachedPdfDocument, protectedKey: string): void {
  for (const cacheKey of cachedDocument.image_pages.keys()) {
    if (cachedDocument.image_cache_wire_bytes <= DEFAULT_IMAGE_CACHE_WIRE_BYTES) {
      return;
    }

    if (cacheKey === protectedKey) {
      continue;
    }

    const size = cachedDocument.image_cache_sizes.get(cacheKey);
    if (size === undefined) {
      continue;
    }

    cachedDocument.image_pages.delete(cacheKey);
    cachedDocument.image_cache_sizes.delete(cacheKey);
    cachedDocument.image_cache_wire_bytes -= size;
  }
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

function buildSummaryText(input: SummaryInput): string {
  const parts = [
    "@@PB_META",
    `file=${input.filePath}`,
    `mode=${input.mode}`,
    `total=${input.totalPages}`,
    `req=${formatPageRange(input.requestedRange)}`,
    `ret=${formatPageRange(input.returnedRange)}`,
    `trunc=${input.truncated ? 1 : 0}`
  ];

  if (input.truncated) {
    parts.push(`reason=${input.truncateReason}`);
    parts.push(`rem=${formatPageRanges(input.remainingRanges)}`);
    parts.push(`next=${input.recommendedNextCall ?? "-"}`);
  }

  return parts.join(" ");
}

function formatPageRange(range: PageRange): string {
  return `${range.start_page}-${range.end_page}`;
}

function formatPageRanges(ranges: PageRange[]): string {
  return ranges.length > 0 ? ranges.map(formatPageRange).join(",") : "-";
}

function escapeJsonString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function getPdfJsAssetUrl(directory: "cmaps" | "standard_fonts"): string {
  return new URL(`../../node_modules/pdfjs-dist/${directory}/`, import.meta.url).href;
}

