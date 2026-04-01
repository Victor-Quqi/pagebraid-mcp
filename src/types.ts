export type ReadMode = "auto" | "text_only" | "image_only";

export interface PageRange {
  start_page: number;
  end_page: number;
}

export interface ReadPdfRequest {
  file_path: string;
  mode: ReadMode;
  pages?: string;
  continuation_tool_name?: string;
}

export interface RenderedPage {
  page_number: number;
  text?: string;
  image_base64?: string;
  image_mime_type?: "image/jpeg";
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
  truncate_reason: "none" | "payload_budget";
  pages: RenderedPage[];
  recommended_next_call: string | null;
  summary_text: string;
}
