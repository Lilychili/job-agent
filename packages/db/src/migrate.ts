import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { createDb, createPool } from "./index";

export async function runMigrations(url?: string): Promise<void> {
  const pool = createPool(url);
  try {
    await migrate(createDb(pool), {
      migrationsFolder: fileURLToPath(new URL("../migrations", import.meta.url)),
    });
  } finally {
    await pool.end();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runMigrations()
    .then(() => console.log("Migrations applied."))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
