import { join } from "node:path";

// Only source locations belong in service definitions. Never persist credentials.
export const USAGE_ENVIRONMENT_KEYS = [
  "CLAUDE_CONFIG_DIR", "CODEX_HOME", "OPENCODE_DATA_DIR", "AMP_DATA_DIR",
  "DROID_SESSIONS_DIR", "CODEBUFF_DATA_DIR", "HERMES_HOME", "PI_AGENT_DIR",
  "PI_CODING_AGENT_DIR", "PI_CODING_AGENT_SESSION_DIR", "GOOSE_PATH_ROOT",
  "OPENCLAW_DIR", "KILO_DATA_DIR", "KIMI_DATA_DIR", "QWEN_DATA_DIR", "COPILOT_HOME",
  "COPILOT_OTEL_FILE_EXPORTER_PATH", "GEMINI_DATA_DIR", "ANTIGRAVITY_DATA_DIR",
  "GROK_HOME", "ZCODE_HOME", "XDG_DATA_HOME", "XDG_CONFIG_HOME",
  "AGENT_CLI_CREDENTIAL_STORE",
] as const;

export function expandUsagePath(path: string, home: string): string {
  if (path === "~") return home;
  return path.startsWith("~/") || path.startsWith("~\\") ? join(home, path.slice(2)) : path;
}

export function usageRoots(value: string | undefined, home: string, defaults: string[]): string[] {
  const paths = value?.trim() ? value.split(",").map((part) => part.trim()).filter(Boolean) : defaults;
  return [...new Set(paths.map((path) => expandUsagePath(path, home)))];
}

export function usageEnvironment(env: NodeJS.ProcessEnv, home: string): NodeJS.ProcessEnv {
  const resolved = { ...env };
  // Pi and ccusage use different names and disagree on whether the root includes sessions.
  if (!resolved.PI_AGENT_DIR?.trim()) {
    const sessions = env.PI_CODING_AGENT_SESSION_DIR?.trim();
    const agent = env.PI_CODING_AGENT_DIR?.trim();
    if (sessions) resolved.PI_AGENT_DIR = expandUsagePath(sessions, home);
    else if (agent) resolved.PI_AGENT_DIR = join(expandUsagePath(agent, home), "sessions");
  }
  for (const key of USAGE_ENVIRONMENT_KEYS) {
    if (resolved[key]?.trim() && key !== "AGENT_CLI_CREDENTIAL_STORE") {
      resolved[key] = usageRoots(resolved[key], home, []).join(",");
    }
  }
  return resolved;
}
