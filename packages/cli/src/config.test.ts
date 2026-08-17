import { mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseArgs } from "./args.js";
import {
  DEFAULT_SERVER_URL,
  configDirFor,
  configPathFor,
  readConfig,
  resolveServerUrl,
  writeConfig,
  type DeviceConfig,
} from "./config.js";

describe("configDirFor", () => {
  it("uses Application Support on macOS", () => {
    expect(configDirFor({ platform: "darwin", env: {}, home: "/Users/ada" })).toBe(
      "/Users/ada/Library/Application Support/tokenburnmarket",
    );
  });

  it("uses APPDATA on Windows, and a sane default when it is missing", () => {
    expect(
      configDirFor({
        platform: "win32",
        env: { APPDATA: "C:\\Users\\ada\\AppData\\Roaming" },
        home: "C:\\Users\\ada",
      }),
    ).toContain("tokenburnmarket");
    expect(configDirFor({ platform: "win32", env: {}, home: "/home/ada" })).toBe(
      join("/home/ada", "AppData", "Roaming", "tokenburnmarket"),
    );
  });

  it("honours XDG_CONFIG_HOME on Linux and falls back to ~/.config", () => {
    expect(
      configDirFor({ platform: "linux", env: { XDG_CONFIG_HOME: "/data/cfg" }, home: "/home/ada" }),
    ).toBe("/data/cfg/tokenburnmarket");
    expect(configDirFor({ platform: "linux", env: {}, home: "/home/ada" })).toBe(
      "/home/ada/.config/tokenburnmarket",
    );
  });

  it("ignores a relative XDG_CONFIG_HOME, which the spec calls invalid", () => {
    expect(
      configDirFor({ platform: "linux", env: { XDG_CONFIG_HOME: "cfg" }, home: "/home/ada" }),
    ).toBe("/home/ada/.config/tokenburnmarket");
  });

  it("never resolves inside the working directory", () => {
    for (const platform of ["darwin", "linux", "win32"] as const) {
      const dir = configDirFor({ platform, env: {}, home: "/home/ada" });
      expect(dir.startsWith("/home/ada") || dir.startsWith("C:")).toBe(true);
      expect(dir).not.toContain(process.cwd());
    }
  });

  it("puts config.json inside the config dir", () => {
    const environment = { platform: "linux" as const, env: {}, home: "/home/ada" };
    expect(configPathFor(environment)).toBe("/home/ada/.config/tokenburnmarket/config.json");
  });
});

describe("resolveServerUrl", () => {
  it("prefers the flag, then TBM_SERVER, then the default", () => {
    expect(resolveServerUrl("https://flag.test", { TBM_SERVER: "https://env.test" })).toBe(
      "https://flag.test",
    );
    expect(resolveServerUrl(undefined, { TBM_SERVER: "https://env.test" })).toBe(
      "https://env.test",
    );
    expect(resolveServerUrl(undefined, {})).toBe(DEFAULT_SERVER_URL);
  });

  it("drops trailing slashes so paths concatenate cleanly", () => {
    expect(resolveServerUrl("http://localhost:3000/", {})).toBe("http://localhost:3000");
  });
});

describe("config file", () => {
  const sample: DeviceConfig = {
    serverUrl: "http://localhost:3000",
    deviceId: "5b0d0f4a-4a6c-4a5e-9f2e-0f0e6b7a1c2d",
    deviceName: "workbench",
    handle: "ada",
    deviceToken: "header.payload.signature",
    publicKey: "cHVibGlj",
    privateKey: "cHJpdmF0ZQ==",
    connectedAt: "2026-08-17T10:00:00.000Z",
  };

  it("round trips and stays owner readable only", () => {
    const path = join(mkdtempSync(join(tmpdir(), "tbm-")), "nested", "config.json");
    writeConfig(sample, path);
    expect(readConfig(path)).toEqual(sample);
    // 0o600: the file holds a private key and a bearer token.
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  it("reads as not connected when the file is absent or unusable", () => {
    const dir = mkdtempSync(join(tmpdir(), "tbm-"));
    expect(readConfig(join(dir, "config.json"))).toBeNull();
    writeConfig({ ...sample, deviceToken: "" }, join(dir, "partial.json"));
    expect(readConfig(join(dir, "partial.json"))).toBeNull();
  });
});

describe("parseArgs", () => {
  it("reads a command with spaced and equals flags", () => {
    expect(parseArgs(["connect", "--server", "http://localhost:3000"])).toMatchObject({
      command: "connect",
      flags: { server: "http://localhost:3000" },
    });
    expect(parseArgs(["connect", "--name=workbench"]).flags).toEqual({ name: "workbench" });
  });

  it("treats a value flag with no value as a switch rather than eating the next flag", () => {
    const parsed = parseArgs(["connect", "--server", "--help"]);
    expect(parsed.flags.server).toBeUndefined();
    expect(parsed.switches.has("help")).toBe(true);
  });

  it("returns an empty command when nothing was asked for", () => {
    expect(parseArgs([]).command).toBe("");
  });
});
