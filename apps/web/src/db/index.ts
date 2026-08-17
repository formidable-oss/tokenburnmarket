/*
  Drizzle client over the Neon HTTP driver: one fetch per query, no pooling,
  which is what serverless request handlers want. Interactive transactions need
  the websocket driver; add it the day a ticket needs one.

  The client is created on first use, not on import, so builds and unit tests
  that never touch the database do not need DATABASE_URL.
*/
import { neon } from "@neondatabase/serverless";
import { drizzle, type NeonHttpDatabase } from "drizzle-orm/neon-http";
import * as schema from "./schema";

type Database = NeonHttpDatabase<typeof schema>;

let instance: Database | undefined;

function connect(): Database {
  if (!instance) {
    const url = process.env.DATABASE_URL;
    if (!url) {
      throw new Error("DATABASE_URL is not set. Copy .env.example to .env.local and fill it in.");
    }
    instance = drizzle({ client: neon(url), schema });
  }
  return instance;
}

export const db = new Proxy({} as Database, {
  get(_target, property, receiver) {
    const client = connect();
    const value = Reflect.get(client, property, receiver);
    return typeof value === "function" ? value.bind(client) : value;
  },
});

export { schema };
