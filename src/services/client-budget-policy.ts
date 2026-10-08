import {
  CLAUDE_CODE_DEFAULT_TOKEN_BUDGET,
  CLAUDE_CODE_FAST_PATH_RATIO,
  CODEX_DEFAULT_TOKEN_BUDGET,
  GENERIC_DEFAULT_TOKEN_BUDGET,
  GROK_DEFAULT_BYTE_BUDGET
} from "../constants.js";
import type {
  ClientBudgetPolicy,
  ClientBudgetProfile,
  ContentUsageEstimate,
  TruncateReason
} from "../types.js";

const CLAUDE_CODE_IMAGE_FAST_ESTIMATE = 1_600;
// Interactive sessions append "[Image: source: <saved path>]" after each image before the size check.
const CLAUDE_CODE_IMAGE_LABEL_FAST_ESTIMATE = 64;
const CLAUDE_CODE_IMAGE_LABEL_TOKENS = 128;

interface McpClientInfo {
  name?: string;
  version?: string;
}

export function resolveClientBudgetPolicy(
  clientInfo: McpClientInfo | undefined,
  environment: NodeJS.ProcessEnv = process.env
): ClientBudgetPolicy {
  const profile = resolveClientBudgetProfile(clientInfo, environment.PAGEBRAID_CLIENT_PROFILE);
  const explicitBudget = parsePositiveInteger(environment.PAGEBRAID_TOKEN_BUDGET);

  switch (profile) {
    case "grok-build":
      return {
        profile,
        token_budget: explicitBudget,
        byte_budget:
          parsePositiveInteger(environment.PAGEBRAID_BYTE_BUDGET) ??
          parsePositiveInteger(environment.GROK_MAX_MCP_OUTPUT_BYTES) ??
          parsePositiveInteger(environment.MAX_MCP_OUTPUT_BYTES) ??
          GROK_DEFAULT_BYTE_BUDGET,
        counts_images: false
      };
    case "claude-code":
      return {
        profile,
        token_budget:
          explicitBudget ??
          parsePositiveInteger(environment.MAX_MCP_OUTPUT_TOKENS) ??
          CLAUDE_CODE_DEFAULT_TOKEN_BUDGET,
        byte_budget: null,
        counts_images: true
      };
    case "codex":
      return {
        profile,
        token_budget: explicitBudget ?? CODEX_DEFAULT_TOKEN_BUDGET,
        byte_budget: null,
        counts_images: false
      };
    default:
      return {
        profile,
        token_budget: explicitBudget ?? GENERIC_DEFAULT_TOKEN_BUDGET,
        byte_budget: null,
        counts_images: true
      };
  }
}

export function estimateClientTokens(
  usage: ContentUsageEstimate,
  policy: ClientBudgetPolicy
): { detailed: number; coarse: number | null } {
  const openaiDetailed =
    usage.text.openai + (policy.counts_images ? usage.image.openai : 0);
  const anthropicDetailed =
    usage.text.anthropic + (policy.counts_images ? usage.image.anthropic : 0);

  switch (policy.profile) {
    case "grok-build":
      return {
        detailed: Math.floor(estimateClientBytes(usage) / 4),
        coarse: null
      };
    case "codex":
      return {
        detailed: usage.codex_text_approx,
        coarse: null
      };
    case "claude-code":
      return {
        detailed: anthropicDetailed + usage.image_count * CLAUDE_CODE_IMAGE_LABEL_TOKENS,
        // Claude Code only checks results with images, so only those mirror its fast path.
        coarse: usage.image_count > 0 ? estimateClaudeCodeFastPathTokens(usage) : null
      };
    default:
      return {
        detailed: Math.max(openaiDetailed, anthropicDetailed),
        coarse: null
      };
  }
}

export function estimateClientBytes(usage: ContentUsageEstimate): number {
  return usage.text_bytes + usage.grok_image_text_bytes + Math.max(0, usage.content_blocks - 1);
}

export function findClientBudgetOverflow(
  usage: ContentUsageEstimate,
  policy: ClientBudgetPolicy
): Extract<TruncateReason, "client_token_budget" | "client_byte_budget"> | null {
  if (policy.byte_budget !== null && estimateClientBytes(usage) > policy.byte_budget) {
    return "client_byte_budget";
  }
  if (policy.token_budget === null) {
    return null;
  }
  const estimate = estimateClientTokens(usage, policy);

  if (
    policy.profile === "claude-code" &&
    estimate.coarse !== null &&
    estimate.coarse <= Math.floor(policy.token_budget * CLAUDE_CODE_FAST_PATH_RATIO)
  ) {
    return null;
  }

  return estimate.detailed <= policy.token_budget ? null : "client_token_budget";
}

function resolveClientBudgetProfile(
  clientInfo: McpClientInfo | undefined,
  override: string | undefined
): ClientBudgetProfile {
  const normalizedOverride = override?.trim().toLowerCase();
  if (
    normalizedOverride === "codex" ||
    normalizedOverride === "claude-code" ||
    normalizedOverride === "grok-build" ||
    normalizedOverride === "generic"
  ) {
    return normalizedOverride;
  }

  const clientName = clientInfo?.name?.trim().toLowerCase() ?? "";
  if (clientName.startsWith("grok-shell-")) {
    return "grok-build";
  }
  if (clientName === "claude-code" || clientName.startsWith("claude-code-")) {
    return "claude-code";
  }

  if (clientName.includes("codex")) {
    return "codex";
  }

  return "generic";
}

function estimateClaudeCodeFastPathTokens(usage: ContentUsageEstimate): number {
  return (
    usage.claude_code_text_approx +
    usage.image_count * (CLAUDE_CODE_IMAGE_FAST_ESTIMATE + CLAUDE_CODE_IMAGE_LABEL_FAST_ESTIMATE)
  );
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
