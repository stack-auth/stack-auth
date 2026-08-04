import { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";
import { attachVercelPostgresPool } from "./vercel-postgres-pool";

describe("attachVercelPostgresPool", () => {
  it("attaches application pools only on Vercel", async () => {
    const pool = new Pool();
    const attachPool = vi.fn();

    try {
      attachVercelPostgresPool(pool, {}, attachPool);
      expect(attachPool).not.toHaveBeenCalled();

      attachVercelPostgresPool(pool, { VERCEL: "1" }, attachPool);
      expect(attachPool).toHaveBeenCalledOnce();
      expect(attachPool).toHaveBeenCalledWith(pool);
    } finally {
      await pool.end();
    }
  });
});
