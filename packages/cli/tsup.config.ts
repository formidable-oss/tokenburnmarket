import { defineConfig } from "tsup";

/*
  One file plus two installed dependencies.

  `@tokenburnmarket/core` is a workspace package published as TypeScript source,
  so it has to be bundled in rather than resolved from node_modules when someone
  runs `npx tokenburnmarket`.

  The MCP SDK and zod stay external: they are declared dependencies, npm installs
  them, and the SDK and this CLI have to agree on one copy of zod for the tool
  schemas to validate.
*/
export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node20",
  platform: "node",
  outDir: "dist",
  clean: true,
  bundle: true,
  noExternal: ["@tokenburnmarket/core"],
  // Core re-exports everything from one entry. Without this the schemas and
  // formulas the CLI does not use would ship with it.
  treeshake: true,
  // The shebang comes from src/index.ts and is preserved, so no banner here.
});
