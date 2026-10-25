# tokenburnmarket

Connect your machine to [tokenburnmarket](https://tokenburnmarket.vercel.app), sync what
your coding agents burned, and trade the markets from inside the agent you are
already talking to.

Nothing leaves your machine except token counts, cost, and hashes of message
identifiers. No prompts, no file names, no project paths.

## Connect

Requires Node.js 22.15 or later. On an older Node, Codex days older than about a
week sync as Reported, because Node cannot read Codex's compressed logs.

```
npm install --global tokenburnmarket@latest
tokenburnmarket connect
```

Verify `command -v tokenburnmarket` resolves before connecting. If it does not,
use a user-owned npm prefix whose bin directory is on your `PATH`.

It prints a short code and a URL. Approve it in the browser and this machine is
bound to your account, then it runs the first sync and prints where to see
yourself. The private key it generates never leaves the machine.

In a terminal, `connect` asks before it connects the machine to the account that
approved the code, because anyone signed in can approve a code they can see.

Running `connect` again on a connected machine keeps its key, so the server keeps
the same device and the machine's history counts once. A device you revoked in
Settings is not brought back: connecting with its key makes a new device, and
the revoked one keeps the usage it uploaded. A key that another account's device
still uses cannot be approved until that device is revoked. If you connected one machine more
than once with an older version, open Settings on the site and set those devices
to the same machine.

## Keep it synced

```
claude mcp add tokenburnmarket -- npx -y tokenburnmarket mcp
```

That is the whole of it for Claude Code. While the agent runs, the MCP server
syncs itself on the shared sync slots, 00:00, 06:00, 12:00 and 18:00 UTC, and
gives the agent the trading tools below. Every machine syncs in the same few
minutes so the database behind the site only wakes four times a day, which is
what keeps it cheap to run. Boards therefore move every six
hours; run `sync` or ask the agent to call `sync_usage` to count today now. Codex gets the same from
`~/.codex/config.toml`:

```toml
[mcp_servers.tokenburnmarket]
command = "npx"
args = ["-y", "tokenburnmarket", "mcp"]
```

On a machine that never opens an agent, run a daemon instead. It is a
foreground loop, one per machine, held by a lock file.

```
tokenburnmarket daemon install
tokenburnmarket daemon install --dry-run
```

The daemon syncs on the same slots. `daemon install` creates and starts the
per-user LaunchAgent, systemd service, or Windows scheduled task. The dry run previews the service definition and
changes nothing. It refuses to persist an executable from a temporary npx cache.

## Sync by hand

```
tokenburnmarket sync            # the days since the last sync
tokenburnmarket sync --since 7  # the last seven days
tokenburnmarket sync --all      # every day this machine still has
tokenburnmarket sync --dry-run  # what would go, without sending it
tokenburnmarket status          # what is stored on this machine
```

`sync` is safe to run whenever. A sync you run yourself is never skipped and is
not held to a slot. Versions before 0.3.0 only get through inside a slot, so
update if a hand-run sync answers 429. A row the server would refuse, such as a
negative count, is left out with a note, and the other rows still go up. If the
server refuses one part of a large upload, the later parts still go up, and the
command ends with an error that names the refused days.

Every sync sends the days since the last synced day, plus the two days before
it. Older days change only when you send them again with `--since N` or `--all`.
The server then adds the days it does not have. It replaces a day it has when
the new reading saw at least the same messages, or reports at least as many
tokens. That is how a corrected estimate lands. The last few days always take
the latest reading, because they are still being written. An older day never
goes down because old transcripts were deleted from this machine.

## Fix your history

After an update, or when your numbers look low, send your whole history once
from every machine you use, then let the daemon keep it current:

```sh
tokenburnmarket update                 # or, on a new machine: npm install --global tokenburnmarket@latest
tokenburnmarket sync --all --dry-run   # optional: see what will go up
tokenburnmarket sync --all
tokenburnmarket daemon install
```

If you connected one machine more than once, open Settings on the site and set
those devices to the same machine. Each day then counts once for that machine,
from the most complete copy. Different machines, such as a laptop, a VM, and a
remote server, always add up.

`--review-history` from 0.4.0 still works. It now does the same as `--all`, and
nothing is quarantined for its age.

## Usage sources

The collector uses ccusage 20.0.41 for Claude Code, Codex, Grok, Pi, OpenCode,
Antigravity, Gemini CLI, Copilot CLI, and its other supported agents. It uses an
isolated ccusage configuration so project settings cannot hide costs or filter
the sync window. Set source directories with the environment variables below.

Cursor uses its dashboard API with your saved Cursor CLI login. This includes
account usage from other machines. Receipt hashes let the server identify copies
of that account history. Credentials go only to Cursor and are never uploaded to
Token Burn Market. Sign in to the Cursor CLI to enable this source. A failed
Cursor read prints a warning and leaves its stored totals unchanged.

The collector reads Codex archives and compressed logs. It counts reasoning once
and restores OpenCode reasoning from the local database or legacy message files.
If OpenCode details are unreadable for a day or change during the scan, that
day's OpenCode rows use ccusage totals without receipts for missing rows only.
Legacy message files older than the sync window are skipped. One warning names
the affected days and sources. The server preserves existing rows. A later
complete read can replace a fallback row within the normal backfill window.
Pi receipts cover the assistant messages ccusage reports.

Compare reports over the same UTC dates. T3 Code can use another timezone, retain
deleted transcripts, and price historical requests differently. Its custom account
directories must also be supplied to this collector. Missing model prices produce
a warning. Some Gemini and Antigravity reports omit tokens from model breakdowns.
The collector recovers them when there is one model and warns when attribution is
ambiguous. Pi tool and summary usage is not exposed by the pinned ccusage version.

## MCP tools

Five tools:

| tool | what it does |
| --- | --- |
| `sync_usage` | uploads this machine's usage and reports what the server made of it |
| `my_stats` | today, this week and this month of spend and tokens, credits, trust |
| `my_communities` | the communities you belong to |
| `list_markets` | open markets you can trade, with the price of every outcome |
| `place_bet` | quotes a trade, and places it only with `confirm: true` |

`place_bet` never spends without `confirm: true`. Called without it, it prices
the trade against the live book, writes nothing, and returns the cost, the
average price and where the price would land, so the person can decide. Prices
move, so a quote is an offer, not a promise: the server re-prices under a lock
and refuses a fill that drifted too far.

A new device can only quote. To let your agent place bets, tick the box when you
approve the device, or allow bets for it in Settings on the site.

Credits are play money. A winning share pays 1 credit.

## Updates

```
tokenburnmarket update            # install the latest version
tokenburnmarket update --dry-run  # print the command, run nothing
tokenburnmarket --version
```

`update` reinstalls the package with the package manager that installed it:
npm, bun, pnpm or yarn. It then restarts the daemon, if one is installed.
Agent sessions keep the MCP server they started with, so restart them too.

On macOS and Linux, pnpm services use the global launcher so later updates
can change the package directory. After the first upgrade from 0.3.0, run
`tokenburnmarket daemon install` once to replace an older service definition.

The CLI asks the npm registry for the latest version at most once a day. When
a newer one is out, `sync`, `status` and `connect` print one line on stderr,
and the MCP server adds the line to the first tool answer of each session so
the agent tells you. The daemon installs the update after its next sync, then
exits so launchd or systemd starts it again on the new version. A Windows task
keeps running the old version until the next logon. Checks never call the
tokenburnmarket server, and they are off in CI.

## Environment

| variable | what it does |
| --- | --- |
| `TBM_SERVER` | the server to talk to, same as `--server` |
| `TBM_CCUSAGE` | a local ccusage command to run instead of the tested `ccusage@20.0.41` |
| `CLAUDE_CONFIG_DIR` | comma-separated Claude Code config directories |
| `CODEX_HOME` | comma-separated Codex homes, including archives or separate T3 accounts |
| `OPENCODE_DATA_DIR` | comma-separated OpenCode data directories |
| `ANTIGRAVITY_DATA_DIR` | comma-separated Antigravity data directories, including custom T3 profiles |
| `PI_AGENT_DIR` | comma-separated Pi session directories for ccusage |
| `PI_CODING_AGENT_SESSION_DIR` | Pi session directory, used when `PI_AGENT_DIR` is absent |
| `PI_CODING_AGENT_DIR` | Pi agent home, with usage under `sessions/` |
| `GROK_HOME` | Grok config directory containing `sessions/`; defaults to `~/.grok` |
| `AGENT_CLI_CREDENTIAL_STORE` | Cursor credential mode; `file` uses its saved auth file, `memory` disables account collection |
| `TBM_NO_UPDATE_CHECK` | set to anything to stop checking npm for a newer version |
| `TBM_NO_AUTO_UPDATE` | set to anything to keep the daemon to a log line instead of updating itself |

Receipt streams are supported for Claude Code, Codex, Grok, Pi, OpenCode, and Cursor. Grok receipts
come from completed turns in `sessions/**/updates.jsonl`. Usage with a matching
stream can be verified when it passes the server's checks.

On macOS and Linux, `daemon install` preserves source directories from the current
environment. Run it again after you change those directories. It does not copy API
keys into the service definition.

Config lives in the platform config directory: `~/Library/Application Support/tokenburnmarket`
on macOS, `%APPDATA%\tokenburnmarket` on Windows, `$XDG_CONFIG_HOME/tokenburnmarket`
elsewhere. It holds a device token and a private key, and is written owner-only.

`npx tokenburnmarket --help` lists every command.

## Releasing

```sh
cd packages/cli
npm publish
```

`prepublishOnly` runs check, test and build first. Bump `version` in
`package.json` before, and `npm pack --dry-run` prints what would ship.

MIT licensed.

### Process lifecycle

MCP servers stop when the client closes stdin or their parent exits, cancelling
active collection. Each ccusage command has a five-minute limit; shutdown and
timeout terminate its process tree. Sync uploads time out after one minute.
MCP startup, manual sync, and the daemon share a per-config lock, so only one
usage scan runs at a time. Locks left by exited processes recover automatically.
