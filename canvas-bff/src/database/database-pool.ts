import { Pool, type PoolConfig } from "pg";

export function createDatabasePool(environment: NodeJS.ProcessEnv = process.env): Pool {
    const connectionString = environment.DATABASE_URL;
    if (!connectionString) throw new Error("DATABASE_URL is required");
    const config: PoolConfig = { connectionString, max: Number(environment.DATABASE_POOL_MAX ?? 10), idleTimeoutMillis: 30_000 };
    if (environment.DATABASE_SSL === "true") config.ssl = { rejectUnauthorized: environment.DATABASE_SSL_REJECT_UNAUTHORIZED !== "false" };
    return new Pool(config);
}

export async function assertDatabaseReady(pool: Pool): Promise<void> {
    await pool.query("SELECT 1");
}
