import { attachDatabasePool } from "@vercel/functions";
import type { Pool } from "pg";

type VercelEnvironment = Readonly<Record<string, string | undefined>>;
type PostgresPoolAttacher = (pool: Pool) => void;

/**
 * Fluid Compute can suspend an instance while an application-owned pool still
 * has idle clients. Register each pool immediately after construction so Vercel
 * keeps the invocation alive until those clients reach the pool's idle timeout.
 */
export function attachVercelPostgresPool(
  pool: Pool,
  environment: VercelEnvironment = process.env,
  attachPool: PostgresPoolAttacher = (poolToAttach) => attachDatabasePool(poolToAttach),
): void {
  if ((environment.VERCEL ?? "") === "") {
    return;
  }
  attachPool(pool);
}
