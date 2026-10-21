# tokenburnmarket

Connect your machine to [tokenburnmarket](https://tokenburnmarket.vercel.app), sync what
your coding agents burned, and trade the markets from inside the agent you are
already talking to.

Nothing leaves your machine except token counts, cost, and hashes of message
identifiers. No prompts, no file names, no project paths.

## Connect

```
npm install --global tokenburnmarket@latest
tokenburnmarket connect
```

Verify `command -v tokenburnmarket` resolves before connecting. If it does not,
use a user-owned npm prefix whose bin directory is on your `PATH`.

It prints a short code and a URL. Approve it in the browser and this machine is
bound to your account, then it runs the first sync and prints where to see
yourself. The private key it generates never leaves the machine.

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
tokenburnmarket sync --dry-run  # what would go, without sending it
tokenburnmarket status          # what is stored on this machine
```

`sync` is safe to run whenever. A sync you run yourself is never skipped and is
not held to a slot. Versions before 0.3.0 only get through inside a slot, so
update if a hand-run sync answers 429.

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

Credits are play money. A winning share pays 1 credit.

## Environment

| variable | what it does |
| --- | --- |
| `TBM_SERVER` | the server to talk to, same as `--server` |
| `TBM_CCUSAGE` | a local ccusage command to run instead of `npx -y ccusage@latest` |
| `GROK_HOME` | Grok config directory containing `sessions/`; defaults to `~/.grok` |

Receipt streams are supported for Claude Code, Codex, and Grok. Grok receipts
come from completed turns in `sessions/**/updates.jsonl`. Usage with a matching
stream can be verified when it passes the server's checks.

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
