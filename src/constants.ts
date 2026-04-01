import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const packageJson = require("../package.json") as { version: string };

export const SERVER_NAME = "pagebraid-mcp-server";
export const SERVER_VERSION = packageJson.version;

export const DEFAULT_MODE = "auto";
export const DEFAULT_IMAGE_SCALE = 1;
export const DEFAULT_IMAGE_JPEG_QUALITY = 0.8;
export const DEFAULT_PAYLOAD_BUDGET_CHARS = 5_500_000;
export const LINE_MERGE_TOLERANCE = 3;
export const WORD_BREAK_GAP = 12;
