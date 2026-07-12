import { Tiktoken } from "js-tiktoken/lite";
import o200kBase from "js-tiktoken/ranks/o200k_base";

import type { ContentUsageEstimate, ModelTokenEstimate } from "../types.js";

const tokenizer = new Tiktoken(o200kBase);

const CODEX_APPROX_BYTES_PER_TOKEN = 4;
const ANTHROPIC_NEW_TOKENIZER_MULTIPLIER = 1.3;
const OPENAI_IMAGE_PATCH_SIZE = 32;
const ANTHROPIC_IMAGE_PATCH_SIZE = 28;
const ANTHROPIC_HIGH_RES_MAX_EDGE = 2_576;
const ANTHROPIC_HIGH_RES_MAX_TOKENS = 4_784;

export const ZERO_CONTENT_USAGE: ContentUsageEstimate = {
  text: { openai: 0, anthropic: 0 },
  image: { openai: 0, anthropic: 0 },
  codex_text_approx: 0,
  text_characters: 0,
  image_count: 0,
  image_pixels: 0,
  image_encoded_bytes: 0,
  image_wire_bytes: 0
};

export function estimateTextTokens(text: string): ModelTokenEstimate {
  if (!text) {
    return { openai: 0, anthropic: 0 };
  }

  const openai = tokenizer.encode(text, [], []).length;
  const anthropic = Math.ceil(openai * ANTHROPIC_NEW_TOKENIZER_MULTIPLIER);
  return { openai, anthropic };
}

export function estimateImageTokens(width: number, height: number): ModelTokenEstimate {
  const normalizedWidth = normalizeDimension(width);
  const normalizedHeight = normalizeDimension(height);
  const openai = countPatches(normalizedWidth, normalizedHeight, OPENAI_IMAGE_PATCH_SIZE);
  const anthropicSize = resizeForAnthropicHighResolution(normalizedWidth, normalizedHeight);
  const anthropic = countPatches(
    anthropicSize.width,
    anthropicSize.height,
    ANTHROPIC_IMAGE_PATCH_SIZE
  );

  return { openai, anthropic };
}

export function estimateTextUsage(text: string): ContentUsageEstimate {
  return {
    text: estimateTextTokens(text),
    image: { openai: 0, anthropic: 0 },
    codex_text_approx: Math.ceil(
      Buffer.byteLength(text, "utf8") / CODEX_APPROX_BYTES_PER_TOKEN
    ),
    text_characters: text.length,
    image_count: 0,
    image_pixels: 0,
    image_encoded_bytes: 0,
    image_wire_bytes: 0
  };
}

export function estimateImageUsage(
  width: number,
  height: number,
  encodedBytes = 0,
  wireBytes = 0
): ContentUsageEstimate {
  const normalizedWidth = normalizeDimension(width);
  const normalizedHeight = normalizeDimension(height);

  return {
    text: { openai: 0, anthropic: 0 },
    image: estimateImageTokens(normalizedWidth, normalizedHeight),
    codex_text_approx: 0,
    text_characters: 0,
    image_count: 1,
    image_pixels: normalizedWidth * normalizedHeight,
    image_encoded_bytes: encodedBytes,
    image_wire_bytes: wireBytes
  };
}

export function addContentUsages(...usages: ContentUsageEstimate[]): ContentUsageEstimate {
  return usages.reduce<ContentUsageEstimate>(
    (sum, usage) => ({
      text: {
        openai: sum.text.openai + usage.text.openai,
        anthropic: sum.text.anthropic + usage.text.anthropic
      },
      image: {
        openai: sum.image.openai + usage.image.openai,
        anthropic: sum.image.anthropic + usage.image.anthropic
      },
      codex_text_approx: sum.codex_text_approx + usage.codex_text_approx,
      text_characters: sum.text_characters + usage.text_characters,
      image_count: sum.image_count + usage.image_count,
      image_pixels: sum.image_pixels + usage.image_pixels,
      image_encoded_bytes: sum.image_encoded_bytes + usage.image_encoded_bytes,
      image_wire_bytes: sum.image_wire_bytes + usage.image_wire_bytes
    }),
    ZERO_CONTENT_USAGE
  );
}

function countPatches(width: number, height: number, patchSize: number): number {
  return Math.ceil(width / patchSize) * Math.ceil(height / patchSize);
}

function resizeForAnthropicHighResolution(width: number, height: number): { width: number; height: number } {
  if (fitsAnthropicHighResolution(width, height)) {
    return { width, height };
  }

  if (height > width) {
    const transposed = resizeForAnthropicHighResolution(height, width);
    return {
      width: transposed.height,
      height: transposed.width
    };
  }

  const aspectRatio = width / height;
  let low = 1;
  let high = width;

  while (low + 1 < high) {
    const middle = Math.floor((low + high) / 2);
    const resizedHeight = Math.max(Math.round(middle / aspectRatio), 1);

    if (fitsAnthropicHighResolution(middle, resizedHeight)) {
      low = middle;
    } else {
      high = middle;
    }
  }

  return {
    width: low,
    height: Math.max(Math.round(low / aspectRatio), 1)
  };
}

function fitsAnthropicHighResolution(width: number, height: number): boolean {
  const paddedWidth = Math.ceil(width / ANTHROPIC_IMAGE_PATCH_SIZE) * ANTHROPIC_IMAGE_PATCH_SIZE;
  const paddedHeight = Math.ceil(height / ANTHROPIC_IMAGE_PATCH_SIZE) * ANTHROPIC_IMAGE_PATCH_SIZE;

  return (
    paddedWidth <= ANTHROPIC_HIGH_RES_MAX_EDGE &&
    paddedHeight <= ANTHROPIC_HIGH_RES_MAX_EDGE &&
    countPatches(width, height, ANTHROPIC_IMAGE_PATCH_SIZE) <= ANTHROPIC_HIGH_RES_MAX_TOKENS
  );
}

function normalizeDimension(value: number): number {
  return Number.isFinite(value) ? Math.max(1, Math.round(value)) : 1;
}
