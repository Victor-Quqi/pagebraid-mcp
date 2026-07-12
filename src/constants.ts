import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const packageJson = require("../package.json") as { version: string };

export const SERVER_NAME = "pagebraid-mcp-server";
export const SERVER_VERSION = packageJson.version;

export const DEFAULT_MODE = "auto";
export const DEFAULT_IMAGE_MIME_TYPE = "image/webp";
export const AUTO_IMAGE_RENDER_SCALE = 2;
export const IMAGE_ONLY_IMAGE_RENDER_SCALE = 2.25;
export const IMAGE_RENDER_SCALE_MULTIPLIERS = [1, 0.875, 0.75, 0.625, 0.5] as const;
export const IMAGE_RENDER_QUALITY = 80;
export const IMAGE_RENDER_FALLBACK_QUALITY = 70;
export const IMAGE_MAX_EDGE = 2_000;
export const IMAGE_MAX_PIXELS = 4_000_000;
export const IMAGE_MAX_ENCODED_BYTES = 512 * 1_024;
export const DEFAULT_IMAGE_CONTEXT_TOKEN_BUDGET = 40_000;
export const DEFAULT_IMAGE_RENDER_PIXEL_BUDGET = 60_000_000;
export const DEFAULT_IMAGE_WIRE_BUDGET_BYTES = 6 * 1_024 * 1_024;
export const DEFAULT_IMAGE_CACHE_WIRE_BYTES = 64 * 1_024 * 1_024;
export const CODEX_DEFAULT_TOKEN_BUDGET = 11_900;
export const CLAUDE_CODE_DEFAULT_TOKEN_BUDGET = 25_000;
export const GENERIC_DEFAULT_TOKEN_BUDGET = 10_000;
export const CLAUDE_CODE_FAST_PATH_RATIO = 0.5;
export const LINE_MERGE_TOLERANCE = 3;
export const WORD_BREAK_GAP = 12;
