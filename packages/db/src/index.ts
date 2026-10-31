import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

export * from "./schema";
export { schema };
export { notify, APP_EVENTS_CHANNEL, type AppEvent } from "./notify";

export type Db = NodePgDatabase<typeof schema>;

export function databaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set (copy .env.example to .env)");
  return url;
}

export function createPool(url = databaseUrl()): pg.Pool {
  return new pg.Pool({ connectionString: url, max: 10 });
}

export function createDb(pool: pg.Pool | pg.PoolClient): Db {
  return drizzle(pool, { schema, casing: "snake_case" });
}

/**
 * Run `fn` in one transaction on a dedicated client.
 * `client` is exposed so other libraries (pg-boss) can write in the same transaction.
 */
export async function withTx<T>(
  pool: pg.Pool,
  fn: (tx: Db, client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(createDb(client), client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
