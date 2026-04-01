import { z } from "zod";

export const ReadModeSchema = z.enum(["auto", "text_only", "image_only"]);

const PagesSchema = z
  .string()
  .min(1, "pages cannot be empty")
  .describe(
    "Optional PDF page selector. Examples: \"23\" for a single page, \"23-27\" for an inclusive range, \"23-\" to read from page 23 until the payload budget or document end."
  )
  .refine(value => /^(\d+|\d+-\d+|\d+-)$/.test(value.trim()), {
    message: "pages must match one of: '23', '23-27', or '23-'"
  })
  .refine(value => {
    const trimmed = value.trim();
    if (!trimmed.includes("-") || trimmed.endsWith("-")) {
      return true;
    }

    const [startText, endText] = trimmed.split("-");
    const start = Number.parseInt(startText ?? "", 10);
    const end = Number.parseInt(endText ?? "", 10);
    return Number.isInteger(start) && Number.isInteger(end) && start >= 1 && end >= start;
  }, {
    message: "pages range end must be greater than or equal to the start"
  });

export const ReadPdfInputSchema = z
  .object({
    file_path: z.string().min(1, "file_path is required").describe("Absolute or relative local path to the PDF file."),
    mode: ReadModeSchema.default("auto").describe(
      "Read mode. auto returns extracted page text plus rendered page images; text_only skips images; image_only skips text."
    ),
    pages: PagesSchema.optional()
  })
  .strict();
