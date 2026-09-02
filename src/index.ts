#!/usr/bin/env node

import { serveStdio } from "@modelcontextprotocol/server/stdio";

import { createPagebraidServer } from "./server.js";

function main(): void {
  serveStdio(createPagebraidServer, {
    legacy: "serve",
    onerror: error => {
      console.error(error.stack ?? error.message);
    }
  });
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(message);
  process.exit(1);
}
