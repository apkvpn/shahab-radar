import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

const databaseUrl = process.env.RADAR_DATABASE_URL ?? process.env.DATABASE_URL;

const globalForDb = globalThis as typeof globalThis & {
  __arenaNextJsPostgresqlPool?: Pool;
};

// A single shared pool for the whole process (API routes + background scanner).
export const pool =
  globalForDb.__arenaNextJsPostgresqlPool ??
  new Pool({
    connectionString: databaseUrl ?? "postgresql://localhost:5432/placeholder",
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });

if (!globalForDb.__arenaNextJsPostgresqlPool) {
  pool.on("error", (err) => {
    console.error("[db] idle client error:", err.message);
  });
  globalForDb.__arenaNextJsPostgresqlPool = pool;
}

export const db = drizzle(pool);
