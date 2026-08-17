/*
  A parser the size of the surface it parses. The CLI takes one command and a
  handful of long flags, so a dependency would cost more than it saves.

  Grammar: `tokenburnmarket <command> [--flag value] [--flag=value] [--switch]`.
*/

export interface ParsedArgs {
  command: string;
  /** The word after the command, where there is one: `daemon install`, `hook uninstall`. */
  subcommand: string;
  flags: Record<string, string>;
  switches: Set<string>;
}

/** Flags that take a value. Anything else spelled `--x` is a switch. */
const VALUE_FLAGS = new Set(["server", "name", "since", "interval"]);

export function parseArgs(argv: readonly string[]): ParsedArgs {
  const flags: Record<string, string> = {};
  const switches = new Set<string>();
  let command = "";
  let subcommand = "";

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]!;
    if (!token.startsWith("-")) {
      if (!command) command = token;
      else if (!subcommand) subcommand = token;
      continue;
    }

    const bare = token.replace(/^--?/, "");
    const equals = bare.indexOf("=");
    if (equals !== -1) {
      flags[bare.slice(0, equals)] = bare.slice(equals + 1);
      continue;
    }
    if (VALUE_FLAGS.has(bare)) {
      const value = argv[i + 1];
      if (value !== undefined && !value.startsWith("-")) {
        flags[bare] = value;
        i += 1;
        continue;
      }
    }
    switches.add(bare);
  }

  return { command, subcommand, flags, switches };
}
