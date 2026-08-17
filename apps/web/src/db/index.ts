/*
  Two Drizzle clients over the same Neon database, because the two drivers buy
  different things.

  `db` is the HTTP driver: one fetch per query, no pooling, which is what a
  serverless request handler wants for reads and for writes that stand alone.

  `dbTx` is the websocket driver, and the only one that can hold an interactive
  transaction. Trading needs one: a trade reads the book, prices it, and writes
  the shares, the position, the ledger and the trade row, and every other trade
  on that Market has to wait behind it (see lib/trade-store.ts). Use `dbTx` only
  where a transaction is actually required; it keeps a socket open.

  Both clients are created on first use, not on import, so builds and unit tests
  that never touch the database do not need DATABASE_URL.
*/
import { Pool, neon, neonConfig } from "@neondatabase/serverless";
import { drizzle, type NeonHttpDatabase } from "drizzle-orm/neon-http";
import { drizzle as drizzlePool, type NeonDatabase } from "drizzle-orm/neon-serverless";
import ws from "ws";
import * as schema from "./schema";

// Node has no global WebSocket before 22, and the pool driver speaks websockets.
neonConfig.webSocketConstructor = ws;

type Database = NeonHttpDatabase<typeof schema>;
type TransactionalDatabase = NeonDatabase<typeof schema>;

function databaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is not set. Copy .env.example to .env.local and fill it in.");
  }
  return url;
}

/*
  Both clients are cached on globalThis rather than in module scope. Hot reload
  re-evaluates this module on every edit, and a fresh Pool per reload leaks its
  websockets: after enough edits the dev server stops answering. In production
  the module is evaluated once and this is an ordinary singleton.
*/
const clients = globalThis as typeof globalThis & {
  tbmHttpDb?: Database;
  tbmPoolDb?: TransactionalDatabase;
};

function connectHttp(): Database {
  clients.tbmHttpDb ??= drizzle({ client: neon(databaseUrl()), schema });
  return clients.tbmHttpDb;
}

function connectPool(): TransactionalDatabase {
  clients.tbmPoolDb ??= drizzlePool({
    client: new Pool({ connectionString: databaseUrl() }),
    schema,
  });
  return clients.tbmPoolDb;
}

/** Defers connecting until the first property access, so importing is free. */
function lazy<T extends object>(connect: () => T): T {
  return new Proxy({} as T, {
    get(_target, property, receiver) {
      const client = connect();
      const value = Reflect.get(client, property, receiver);
      return typeof value === "function" ? value.bind(client) : value;
    },
  });
}

export const db = lazy(connectHttp);
export const dbTx = lazy(connectPool);

export { schema };
