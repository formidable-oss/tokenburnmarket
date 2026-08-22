# tokenburnmarket

Connect your machine to [tokenburnmarket](https://tokenburnmarket.vercel.app), sync what
your coding agents burned, and trade the markets from inside the agent you are
already talking to.

Nothing leaves your machine except token counts, cost, and hashes of message
identifiers. No prompts, no file names, no project paths.

## Connect

```
npx tokenburnmarket connect
```

It prints a short code and a URL. Approve it in the browser and this machine is
bound to your account, then it runs the first sync and prints where to see
yourself. The private key it generates never leaves the machine.

## Keep it synced

```
claude mcp add tokenburnmarket -- npx -y tokenburnmarket mcp
```

That is the whole of it for Claude Code. The MCP server syncs itself every time
the agent starts it, skipping if the last one was under ten minutes ago, and
gives the agent the trading tools below. Codex gets the same from
`~/.codex/config.toml`:

```toml
[mcp_servers.tokenburnmarket]
command = "npx"
args = ["-y", "tokenburnmarket", "mcp"]
```

On a machine that never opens an agent, run a daemon instead. It is a
foreground loop, one per machine, held by a lock file.

```
npx tokenburnmarket daemon --interval 15m
npx tokenburnmarket daemon install
```

`daemon install` prints the launchd job or the systemd user unit for this
machine, pointing at this node and this script. It prints; it never writes.

## Sync by hand

```
npx tokenburnmarket sync            # the days since the last sync
npx tokenburnmarket sync --since 7  # the last seven days
npx tokenburnmarket sync --dry-run  # what would go, without sending it
npx tokenburnmarket status          # what is stored on this machine
```

`sync` is safe to run whenever. A sync you run yourself is never skipped.

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
