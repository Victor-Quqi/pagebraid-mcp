export type ReadMode = "auto" | "text_only" | "image_only";
export type ImageMimeType = "image/jpeg" | "image/webp";
export type ClientBudgetProfile = "codex" | "claude-code" | "generic";
export type TruncateReason =
  | "none"
  | "client_token_budget"
  | "image_context_budget"
  | "image_render_budget"
  | "image_transport_budget"
  | "image_count_limit";

export interface PageRange {
  start_page: number;
  end_page: number;
}

export interface ReadPdfRequest {
  file_path: string;
  mode: ReadMode;
  pages?: string;
  continuation_tool_name?: string;
  budget_policy?: ClientBudgetPolicy;
  image_resource_policy?: ImageResourcePolicy;
}

export interface RenderedPage {
  page_number: number;
  text?: string;
  image_base64?: string;
  image_mime_type?: ImageMimeType;
  image_width?: number;
  image_height?: number;
  image_encoded_bytes?: number;
}

export interface ModelTokenEstimate {
  openai: number;
  anthropic: number;
}

export interface ContentUsageEstimate {
  text: ModelTokenEstimate;
  image: ModelTokenEstimate;
  codex_text_approx: number;
  text_characters: number;
  image_count: number;
  image_pixels: number;
  image_encoded_bytes: number;
  image_wire_bytes: number;
}

export interface TokenEstimate extends ContentUsageEstimate {
  client: number;
  client_coarse: number | null;
}

export interface ClientBudgetPolicy {
  profile: ClientBudgetProfile;
  token_budget: number;
  counts_images: boolean;
}

export interface ImageResourcePolicy {
  context_token_budget: number;
  render_pixel_budget: number;
  wire_byte_budget: number;
  max_images: number | null;
}

export interface ReadPdfResult {
  file_path: string;
  total_pages: number;
  mode: ReadMode;
  requested_range: PageRange;
  returned_range: PageRange;
  remaining_ranges: PageRange[];
  returned_pages: number[];
  truncated: boolean;
  truncate_reason: TruncateReason;
  client_profile: ClientBudgetProfile;
  token_budget: number;
  estimated_tokens: TokenEstimate;
  pages: RenderedPage[];
  recommended_next_call: string | null;
  summary_text: string;
}
