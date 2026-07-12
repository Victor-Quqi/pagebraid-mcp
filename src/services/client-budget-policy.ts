import {
  CLAUDE_CODE_DEFAULT_TOKEN_BUDGET,
  CLAUDE_CODE_FAST_PATH_RATIO,
  CODEX_DEFAULT_TOKEN_BUDGET,
  GENERIC_DEFAULT_TOKEN_BUDGET
} from "../constants.js";
import type {
  ClientBudgetPolicy,
  ClientBudgetProfile,
  ContentUsageEstimate
} from "../types.js";

const CLAUDE_CODE_IMAGE_FAST_ESTIMATE = 1_600;

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
    case "claude-code":
      return {
        profile,
        token_budget:
          explicitBudget ??
          parsePositiveInteger(environment.MAX_MCP_OUTPUT_TOKENS) ??
          CLAUDE_CODE_DEFAULT_TOKEN_BUDGET,
        counts_images: true
      };
    case "codex":
      return {
        profile,
        token_budget: explicitBudget ?? CODEX_DEFAULT_TOKEN_BUDGET,
        counts_images: false
      };
    default:
      return {
        profile,
        token_budget: explicitBudget ?? GENERIC_DEFAULT_TOKEN_BUDGET,
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
    case "codex":
      return {
        detailed: usage.codex_text_approx,
        coarse: null
      };
    case "claude-code":
      return {
        detailed: anthropicDetailed,
        coarse: estimateClaudeCodeFastPathTokens(usage)
      };
    default:
      return {
        detailed: Math.max(openaiDetailed, anthropicDetailed),
        coarse: null
      };
  }
}

export function fitsClientBudget(
  usage: ContentUsageEstimate,
  policy: ClientBudgetPolicy
): boolean {
  const estimate = estimateClientTokens(usage, policy);

  if (
    policy.profile === "claude-code" &&
    estimate.coarse !== null &&
    estimate.coarse <= Math.floor(policy.token_budget * CLAUDE_CODE_FAST_PATH_RATIO)
  ) {
    return true;
  }

  return estimate.detailed <= policy.token_budget;
}

function resolveClientBudgetProfile(
  clientInfo: McpClientInfo | undefined,
  override: string | undefined
): ClientBudgetProfile {
  const normalizedOverride = override?.trim().toLowerCase();
  if (
    normalizedOverride === "codex" ||
    normalizedOverride === "claude-code" ||
    normalizedOverride === "generic"
  ) {
    return normalizedOverride;
  }

  const clientName = clientInfo?.name?.trim().toLowerCase() ?? "";
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
    Math.ceil(usage.text_characters / 4) +
    usage.image_count * CLAUDE_CODE_IMAGE_FAST_ESTIMATE
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
