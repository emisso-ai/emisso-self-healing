import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    "edge-function": "src/edge-function.ts",
  },
  format: ["cjs", "esm"],
  dts: true,
  sourcemap: true,
  clean: true,
  splitting: false,
  treeshake: true,
  external: [
    "@anthropic-ai/claude-agent-sdk",
    "@vercel/sandbox",
    "octokit",
    "@slack/web-api",
  ],
});
