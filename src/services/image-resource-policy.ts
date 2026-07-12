import {
  DEFAULT_IMAGE_CONTEXT_TOKEN_BUDGET,
  DEFAULT_IMAGE_RENDER_PIXEL_BUDGET,
  DEFAULT_IMAGE_WIRE_BUDGET_BYTES
} from "../constants.js";
import type {
  ClientBudgetProfile,
  ContentUsageEstimate,
  ImageResourcePolicy,
  TruncateReason
} from "../types.js";

export function resolveImageResourcePolicy(
  environment: NodeJS.ProcessEnv = process.env
): ImageResourcePolicy {
  return {
    context_token_budget:
      parsePositiveInteger(environment.PAGEBRAID_IMAGE_CONTEXT_TOKEN_BUDGET) ??
      DEFAULT_IMAGE_CONTEXT_TOKEN_BUDGET,
    render_pixel_budget:
      parsePositiveInteger(environment.PAGEBRAID_IMAGE_RENDER_PIXEL_BUDGET) ??
      DEFAULT_IMAGE_RENDER_PIXEL_BUDGET,
    wire_byte_budget:
      parsePositiveInteger(environment.PAGEBRAID_IMAGE_WIRE_BUDGET_BYTES) ??
      DEFAULT_IMAGE_WIRE_BUDGET_BYTES,
    max_images: parsePositiveInteger(environment.PAGEBRAID_MAX_IMAGES_PER_RESPONSE)
  };
}

export function findImageResourceOverflow(
  usage: ContentUsageEstimate,
  policy: ImageResourcePolicy,
  profile: ClientBudgetProfile,
  includeTransport: boolean
): Exclude<TruncateReason, "none" | "client_token_budget"> | null {
  if (policy.max_images !== null && usage.image_count > policy.max_images) {
    return "image_count_limit";
  }

  if (selectImageContextTokens(usage, profile) > policy.context_token_budget) {
    return "image_context_budget";
  }

  if (usage.image_pixels > policy.render_pixel_budget) {
    return "image_render_budget";
  }

  if (includeTransport && usage.image_wire_bytes > policy.wire_byte_budget) {
    return "image_transport_budget";
  }

  return null;
}

function selectImageContextTokens(
  usage: ContentUsageEstimate,
  profile: ClientBudgetProfile
): number {
  switch (profile) {
    case "codex":
      return usage.image.openai;
    case "claude-code":
      return usage.image.anthropic;
    default:
      return Math.max(usage.image.openai, usage.image.anthropic);
  }
}

function parsePositiveInteger(value: string | undefined): number | null {
  if (!value) {
    return null;
  }

  const normalized = value.trim();
  if (!/^\d+$/.test(normalized)) {
    return null;
  }

  const parsed = Number.parseInt(normalized, 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}
