import { defineConfig } from "tsup";

/*
  One file, no dependencies to install at runtime. `@tokenburnmarket/core` is a
  workspace package published as TypeScript source, so it has to be bundled in
  rather than resolved from node_modules when someone runs `npx tokenburnmarket`.
*/
export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node20",
  platform: "node",
  outDir: "dist",
  clean: true,
  bundle: true,
  // zod comes in with core's payload schema, and the Collector installs nothing.
  noExternal: ["@tokenburnmarket/core", "zod"],
  // Core re-exports everything from one entry, including zod. Without this the
  // schemas the CLI does not use would ship with it.
  treeshake: true,
  // The shebang comes from src/index.ts and is preserved, so no banner here.
});
