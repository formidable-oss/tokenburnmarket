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
bound to your account. The private key it generates never leaves the machine.

## Sync

```
npx tokenburnmarket sync            # the days since the last sync
npx tokenburnmarket sync --since 7  # the last seven days
npx tokenburnmarket sync --dry-run  # what would go, without sending it
npx tokenburnmarket status          # what is stored on this machine
```

Three ways to keep it current, in order of how much you have to think about it.

**A Claude Code hook.** Syncs when a session finishes, which is the moment the
numbers are complete and you are not waiting on anything.

```
npx tokenburnmarket hook install
npx tokenburnmarket hook uninstall
```

It merges a `Stop` hook into `~/.claude/settings.json`, leaves everything else in
that file alone, and prints what it changed. Running it twice changes nothing.

**A daemon.** A foreground loop, one per machine, held by a lock file.

```
npx tokenburnmarket daemon --interval 15m
npx tokenburnmarket daemon install
```

`daemon install` prints the launchd job or the systemd user unit for this
machine, pointing at this node and this script. It prints; it never writes.

**By hand.** `sync` is fast and safe to run whenever.

## MCP server

```
claude mcp add tokenburnmarket -- npx -y tokenburnmarket mcp
```

Or in `~/.codex/config.toml`:

```toml
[mcp_servers.tokenburnmarket]
command = "npx"
args = ["-y", "tokenburnmarket", "mcp"]
```

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
| `TBM_CLAUDE_SETTINGS` | the settings file `hook install` edits |

Config lives in the platform config directory: `~/Library/Application Support/tokenburnmarket`
on macOS, `%APPDATA%\tokenburnmarket` on Windows, `$XDG_CONFIG_HOME/tokenburnmarket`
elsewhere. It holds a device token and a private key, and is written owner-only.

`npx tokenburnmarket --help` lists every command.

## Releasing

Not on npm yet, so `npx tokenburnmarket` does not resolve for anyone else. A
human with publish rights on the name does this once:

```sh
pnpm -r build
cd packages/cli
npm publish --access public
```

Bump `version` in `package.json` first, and check that `files` and `bin` in that
file cover what you mean to ship (`npm pack --dry-run` prints the tarball).
Until this happens, run the collector from a clone with `node packages/cli/dist/index.js`.

MIT licensed.
