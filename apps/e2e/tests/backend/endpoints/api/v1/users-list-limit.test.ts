import { Client } from "pg";
import { describe } from "vitest";
import { test } from "../../../../helpers";
import { POSTGRES_HOST, POSTGRES_PASSWORD, POSTGRES_USER } from "./external-db-sync-utils";
import { InternalProjectKeys, Project, backendContext, niceBackendFetch } from "../../../backend-helpers";
import { waitUntilReplicasHaveCaughtUp } from "../../../helpers/replication";

const batchSize = 5000;

async function seedUsers(projectId: string, userCount: number, prefixes: {
  displayName: string,
  emailLocalPart: string,
}): Promise<void> {
  const client = new Client({
    connectionString: `postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@${POSTGRES_HOST}/stackframe`,
  });
  await client.connect();

  try {
    const tenancyResult = await client.query<{ id: string }>(
      `SELECT id FROM "Tenancy" WHERE "projectId" = $1 AND "branchId" = 'main' LIMIT 1`,
      [projectId],
    );
    if (tenancyResult.rows.length !== 1) {
      throw new Error(`Tenancy not found for project ${projectId}`);
    }
    const tenancyId = tenancyResult.rows[0].id;

    for (let offset = 0; offset < userCount; offset += batchSize) {
      const count = Math.min(batchSize, userCount - offset);
      await client.query(`
        WITH generated AS (
          SELECT
            $1::uuid AS tenancy_id,
            $2::uuid AS project_id,
            gen_random_uuid() AS project_user_id,
            gen_random_uuid() AS contact_id,
            (gs + $3::int - 1) AS idx,
            now() AS ts
          FROM generate_series(1, $4::int) AS gs
        ),
        insert_users AS (
          INSERT INTO "ProjectUser"
            ("tenancyId", "projectUserId", "mirroredProjectId", "mirroredBranchId",
             "displayName", "createdAt", "updatedAt", "isAnonymous",
             "signedUpAt", "signUpRiskScoreBot", "signUpRiskScoreFreeTrialAbuse")
          SELECT
            tenancy_id,
            project_user_id,
            project_id,
            'main',
            $5::text || ' User ' || idx,
            ts,
            ts,
            false,
            ts,
            0,
            0
          FROM generated
          RETURNING "tenancyId", "projectUserId"
        )
        INSERT INTO "ContactChannel"
          ("tenancyId", "projectUserId", "id", "type", "isPrimary", "usedForAuth",
           "isVerified", "value", "createdAt", "updatedAt")
        SELECT
          g.tenancy_id,
          g.project_user_id,
          g.contact_id,
          'EMAIL',
          'TRUE'::"BooleanTrue",
          'TRUE'::"BooleanTrue",
          true,
          $6::text || '-user-' || g.idx || '@test.example.com',
          g.ts,
          g.ts
        FROM generated g
      `, [tenancyId, projectId, offset + 1, count, prefixes.displayName, prefixes.emailLocalPart]);
    }

    // The users endpoint reads from a read replica, and these inserts don't go through the Prisma extension that
    // normally waits for replication, so without this the request below can see an empty tenancy.
    await waitUntilReplicasHaveCaughtUp(client);
  } finally {
    await client.end();
  }
}

async function createProject(displayName: string): Promise<string> {
  backendContext.set({ projectKeys: InternalProjectKeys, userAuth: null });
  const result = await Project.createAndSwitch({ display_name: displayName });
  return result.projectId;
}

describe.sequential("users list limit safety", () => {
  test("allows exactly 1000 unbounded users", async ({ expect }) => {
    const projectId = await createProject("Users list limit boundary");
    await seedUsers(projectId, 1000, {
      displayName: "Boundary",
      emailLocalPart: "boundary",
    });

    const response = await testRequest();

    expect(response.status).toBe(200);
    expect(response.body.items).toHaveLength(1000);
    expect(response.body.pagination.next_cursor).toBeNull();
  }, 120_000);

  test("rejects 1001 unbounded users and supports paging with an explicit limit", async ({ expect }) => {
    const projectId = await createProject("Users list limit pagination");
    await seedUsers(projectId, 1001, {
      displayName: "Pagination",
      emailLocalPart: "pagination",
    });

    const unboundedResponse = await testRequest();
    expect(unboundedResponse).toMatchInlineSnapshot(`
      NiceResponse {
        "status": 400,
        "body": "Listing more than 1000 users requires a limit. Pass limit and paginate using cursor.",
        "headers": Headers { <some fields may have been hidden> },
      }
    `);

    const firstPage = await testRequest({ limit: 1000 });
    expect(firstPage.status).toBe(200);
    expect(firstPage.body.items).toHaveLength(1000);
    const cursor = firstPage.body.pagination.next_cursor;
    expect(cursor).not.toBeNull();
    if (cursor == null) {
      throw new Error("Expected a cursor after the first page");
    }

    const secondPage = await testRequest({ limit: 1000, cursor });
    expect(secondPage.status).toBe(200);
    expect(secondPage.body.items).toHaveLength(1);
    expect(secondPage.body.pagination.next_cursor).toBeNull();

    const maximumLimitPage = await testRequest({ limit: 1000 });
    expect(maximumLimitPage.status).toBe(200);
    expect(maximumLimitPage.body.items).toHaveLength(1000);
    expect(maximumLimitPage.body.pagination.next_cursor).not.toBeNull();

    const overLimitResponse = await testRequest({ limit: 1001 });
    expect(overLimitResponse).toMatchInlineSnapshot(`
      NiceResponse {
        "status": 400,
        "body": {
          "code": "SCHEMA_ERROR",
          "details": {
            "message": deindent\`
              Request validation failed on GET /api/v1/users:
                - query.limit must be less than or equal to 1000
            \`,
          },
          "error": deindent\`
            Request validation failed on GET /api/v1/users:
              - query.limit must be less than or equal to 1000
          \`,
        },
        "headers": Headers {
          "x-stack-known-error": "SCHEMA_ERROR",
          <some fields may have been hidden>,
        },
      }
    `);
  }, 120_000);

  test("rejects the former high-volume failure case before loading the tenancy", async ({ expect }) => {
    const projectId = await createProject("Users list limit high volume");
    const seedStarted = performance.now();
    await seedUsers(projectId, 33_000, {
      displayName: "High Volume",
      emailLocalPart: "high-volume",
    });
    const seedDurationMs = performance.now() - seedStarted;

    const requestStarted = performance.now();
    const response = await testRequest();
    const requestDurationMs = performance.now() - requestStarted;

    console.log(JSON.stringify({ seedDurationMs, requestDurationMs }));
    expect(response.status).toBe(400);
    expect(requestDurationMs).toBeLessThan(30_000);
  }, 180_000);
});

async function testRequest(query?: { limit?: number, cursor?: string }) {
  const searchParams = new URLSearchParams();
  if (query?.limit != null) {
    searchParams.set("limit", String(query.limit));
  }
  if (query?.cursor != null) {
    searchParams.set("cursor", query.cursor);
  }
  const queryString = searchParams.toString();
  return await niceBackendFetch(`/api/v1/users${queryString.length > 0 ? `?${queryString}` : ""}`, {
    accessType: "admin",
  });
}
