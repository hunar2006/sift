#!/usr/bin/env node
import { Command } from "commander";
import { BINARY_NAME, PRODUCT_NAME, SIFT_VERSION } from "@sift-review/core";

const program = new Command();

program
  .name(BINARY_NAME)
  .description(`${PRODUCT_NAME}: local-first review cockpit for AI-generated diffs`)
  .version(SIFT_VERSION)
  .action(() => {
    console.log(`${PRODUCT_NAME} ${SIFT_VERSION}`);
  });

program.parseAsync(process.argv).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unexpected error";
  console.error(message);
  process.exit(1);
});
