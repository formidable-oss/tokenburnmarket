import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import * as core from "./index.js";

const SRC = dirname(fileURLToPath(import.meta.url));

function sourceFiles(): string[] {
  return readdirSync(SRC)
    .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))
    .map((name) => join(SRC, name));
}

describe("@tokenburnmarket/core", () => {
  it("exports the whole domain surface from one entry point", () => {
    for (const name of [
      "mintCurve",
      "mintForDay",
      "MINT_CURVE_VERSION",
      "lmsrPrices",
      "lmsrCostToBuy",
      "lmsrProceedsOfSell",
      "lmsrMaxHouseLoss",
      "checkPlausibility",
      "DEFAULT_PLAUSIBILITY_LIMITS",
      "canonicalJson",
      "generateDeviceKeyPair",
      "signPayload",
      "verifyPayload",
      "SyncPayloadSchema",
      "SignedSyncSchema",
      "verifySyncBody",
      "weakestTrustLevel",
    ]) {
      expect(core, `missing export ${name}`).toHaveProperty(name);
    }
  });

  // The Collector, the browser bundle, and the route handlers all import this
  // package, so it must stay runtime-agnostic.
  it("imports nothing but zod and stays free of Node-only globals", () => {
    for (const file of sourceFiles()) {
      const source = readFileSync(file, "utf8");
      const imports = [...source.matchAll(/from "([^"]+)"/g)].map((m) => m[1]);
      for (const specifier of imports) {
        if (specifier.startsWith("./")) continue;
        expect(specifier, `${file} imports ${specifier}`).toBe("zod");
      }
      expect(source, `${file} uses a Node-only global`).not.toMatch(
        /\b(Buffer|process\.env|__dirname|require\()/,
      );
    }
  });
});
