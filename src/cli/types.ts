import type { ReadMode } from "../types.js";

export interface ServerCommand {
  command: string;
  args: string[];
}

export interface CliOptions {
  filePath: string;
  mode: ReadMode;
  pages?: string;
  outDir: string;
  json: boolean;
  rawResult: boolean;
  serverCommand: string;
  serverArgs: string[];
  serverCwd: string;
}

export type ToolArguments = {
  file_path: string;
  mode: ReadMode;
  pages?: string;
};

export interface TextManifestBlock {
  index: number;
  type: "text";
  chars: number;
  path: string;
  text: string;
}

export interface ImageManifestBlock {
  index: number;
  type: "image";
  mimeType: string;
  base64Chars: number;
  bytes: number;
  path: string;
}

export interface OtherManifestBlock {
  index: number;
  type: string;
  path: string;
}

export type ManifestBlock = TextManifestBlock | ImageManifestBlock | OtherManifestBlock;

export interface Manifest {
  generated_at: string;
  command: "read-pdf";
  server: {
    command: string;
    args: string[];
    cwd: string;
  };
  tool: {
    name: "read_pdf";
    arguments: ToolArguments;
  };
  result: {
    isError: boolean;
  };
  files: {
    run_dir: string;
    manifest: string;
    raw_result?: string;
  };
  content: ManifestBlock[];
}
