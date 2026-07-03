import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const packageJson = require("../package.json") as { version: string };

export const SERVER_NAME = "pagebraid-mcp-server";
export const SERVER_VERSION = packageJson.version;

export const DEFAULT_MODE = "auto";
export const DEFAULT_IMAGE_MIME_TYPE = "image/webp";
export const IMAGE_RENDER_SCALES = [3, 2.75, 2.5, 2.3, 2.1, 1.9, 1.8, 1.6, 1.4, 1.2, 1] as const;
export const IMAGE_RENDER_QUALITIES = [80, 60, 40, 25, 15, 8, 4, 1, 0] as const;
export const AUTO_SINGLE_PAGE_IMAGE_BUDGET_BYTES = 120_000;
export const AUTO_SMALL_RANGE_IMAGE_BUDGET_BYTES = 70_000;
export const AUTO_BATCH_IMAGE_BUDGET_BYTES = 35_000;
export const IMAGE_ONLY_SINGLE_PAGE_IMAGE_BUDGET_BYTES = 220_000;
export const IMAGE_ONLY_SMALL_RANGE_IMAGE_BUDGET_BYTES = 120_000;
export const IMAGE_ONLY_BATCH_IMAGE_BUDGET_BYTES = 60_000;
export const DEFAULT_PAYLOAD_BUDGET_CHARS = 5_500_000;
export const LINE_MERGE_TOLERANCE = 3;
export const WORD_BREAK_GAP = 12;
