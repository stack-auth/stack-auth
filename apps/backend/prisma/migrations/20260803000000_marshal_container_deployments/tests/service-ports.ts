import { randomUUID } from "node:crypto";
import type { Sql } from "postgres";
import { expect } from "vitest";

export const preMigration = async (sql: Sql) => {
  const projectId = `test-${randomUUID()}`;
  const tenancyId = randomUUID();
  await sql`
    INSERT INTO "Project" ("id", "createdAt", "updatedAt", "displayName", "description", "isProductionMode")
    VALUES (${projectId}, NOW(), NOW(), 'Service ports migration test', '', false)
  `;
  await sql`
    INSERT INTO "Tenancy" ("id", "createdAt", "updatedAt", "projectId", "branchId", "hasNoOrganization")
    VALUES (${tenancyId}::uuid, NOW(), NOW(), ${projectId}, 'main', 'TRUE'::"BooleanTrue")
  `;
  const existingServiceId = randomUUID();
  await sql`
    INSERT INTO "DeploymentService" ("tenancyId", "id", "updatedAt", "serviceId")
    VALUES (${tenancyId}::uuid, ${existingServiceId}::uuid, NOW(), 'pre-existing-service')
  `;
  return { tenancyId, existingServiceId };
};

export const postMigration = async (sql: Sql, context: Awaited<ReturnType<typeof preMigration>>) => {
  // A row that predates a synced definition declares no ports at all, rather
  // than being given an invented one.
  const [existing] = await sql<{ ports: unknown }[]>`
    SELECT "ports" FROM "DeploymentService" WHERE "id" = ${context.existingServiceId}::uuid
  `;
  expect(existing.ports).toEqual([]);

  // ::text::jsonb, not ::jsonb — the driver sends a JS string as jsonb already,
  // so a bare cast would store the literal STRING "[...]" (jsonb_typeof
  // 'string') instead of parsing it into an array.
  const insertPorts = (ports: string) => sql`
    INSERT INTO "DeploymentService" ("tenancyId", "id", "updatedAt", "serviceId", "ports")
    VALUES (${context.tenancyId}::uuid, ${randomUUID()}::uuid, NOW(), ${`svc-${randomUUID().slice(0, 8)}`}, ${ports}::text::jsonb)
  `;

  // The shapes that must work: a single public HTTP port, several PRIVATE ports
  // of mixed protocols, and the empty list.
  await expect(insertPorts('[{"port": 3000, "public": true, "transport": "http"}]')).resolves.toBeDefined();
  await expect(insertPorts('[{"port": 8080, "public": false, "transport": "http"}, {"port": 5432, "public": false, "transport": "tcp"}, {"port": 9090, "public": false, "transport": "http"}]'))
    .resolves.toBeDefined();
  await expect(insertPorts('[]')).resolves.toBeDefined();

  // A public port may not have siblings: the runtime would serve them on the
  // public address too.
  await expect(insertPorts('[{"port": 3000, "public": true, "transport": "http"}, {"port": 9090, "public": false, "transport": "http"}]'))
    .rejects.toThrow(/DeploymentService_public_port_is_alone_check/);

  // Inputs that must produce a NAMED constraint violation rather than a raw
  // Postgres error. A 20-digit port overflows a bigint, and a non-boolean
  // `public` cannot be cast — both used to escape as unhandled 500s.
  await expect(insertPorts('[{"port": 99999999999999999999, "public": false, "transport": "http"}]'))
    .rejects.toThrow(/DeploymentService_ports_entries_check/);
  await expect(insertPorts('[{"port": 3000, "public": "maybe", "transport": "http"}]'))
    .rejects.toThrow(/DeploymentService_ports_entries_check/);
  // The string "true" is not a boolean, so it must be reported as a bad ENTRY
  // rather than silently counted as a public port.
  await expect(insertPorts('[{"port": 3000, "public": "true", "transport": "http"}]'))
    .rejects.toThrow(/DeploymentService_ports_entries_check/);

  // Several public ports are several ports, so the alone-check catches them too
  // — there is deliberately no separate one-public-port constraint.
  await expect(insertPorts('[{"port": 3000, "public": true, "transport": "http"}, {"port": 4000, "public": true, "transport": "http"}]'))
    .rejects.toThrow(/DeploymentService_public_port_is_alone_check/);
  // Raw TCP has no TLS termination or HTTP routing to be public with.
  await expect(insertPorts('[{"port": 5432, "public": true, "transport": "tcp"}]'))
    .rejects.toThrow(/DeploymentService_public_port_is_http_check/);
  await expect(insertPorts('[{"port": 3000, "public": false, "transport": "http"}, {"port": 3000, "public": false, "transport": "tcp"}]'))
    .rejects.toThrow(/DeploymentService_ports_distinct_check/);
  await expect(insertPorts('{"port": 3000}')).rejects.toThrow(/DeploymentService_ports_is_array_check/);

  // Entry shape. The absent-key cases are the ones a `<>` comparison would let
  // through, since jsonb_typeof of a missing key is NULL.
  for (const invalidPorts of [
    '[{"port": 0, "public": false, "transport": "http"}]',
    '[{"port": 70000, "public": false, "transport": "http"}]',
    '[{"port": 3000.5, "public": false, "transport": "http"}]',
    '[{"port": "3000", "public": false, "transport": "http"}]',
    '[{"port": 3000, "public": false, "transport": "smtp"}]',
    '[{"port": 3000, "transport": "http"}]',
    '[{"port": 3000, "public": false}]',
    '[{"public": false, "transport": "http"}]',
    '["3000"]',
  ]) {
    await expect(insertPorts(invalidPorts), invalidPorts).rejects.toThrow(/DeploymentService_ports_entries_check/);
  }
};
