import { randomUUID } from "crypto";
import type { Sql } from "postgres";
import { expect } from "vitest";

export const preMigration = async (sql: Sql) => {
  const projectId = `test-${randomUUID()}`;
  await sql`
    INSERT INTO "Project" ("id", "createdAt", "updatedAt", "displayName", "description", "isProductionMode")
    VALUES (${projectId}, NOW(), NOW(), 'Onboarding State Project', '', false)
  `;
  return { projectId };
};

export const postMigration = async (sql: Sql, ctx: Awaited<ReturnType<typeof preMigration>>) => {
  const rows = await sql`
    SELECT "onboardingState"
    FROM "Project"
    WHERE "id" = ${ctx.projectId}
  `;
  expect(rows).toHaveLength(1);
  expect(rows[0].onboardingState).toBeNull();

  const onboardingState = {
    selected_config_choice: "create-new",
    selected_apps: ["authentication", "emails"],
    selected_sign_in_methods: ["credential", "magicLink"],
    selected_email_theme_id: null,
    selected_payments_country: "US",
  };
  await sql`
    UPDATE "Project"
    SET "onboardingState" = ${JSON.stringify(onboardingState)}::jsonb
    WHERE "id" = ${ctx.projectId}
  `;

  const updatedRows = await sql`
    SELECT "onboardingState"
    FROM "Project"
    WHERE "id" = ${ctx.projectId}
  `;
  expect(updatedRows).toHaveLength(1);
  expect(updatedRows[0].onboardingState).toMatchInlineSnapshot(`
    {
      "selected_apps": [
        "authentication",
        "emails",
      ],
      "selected_config_choice": "create-new",
      "selected_email_theme_id": null,
      "selected_payments_country": "US",
      "selected_sign_in_methods": [
        "credential",
        "magicLink",
      ],
    }
  `);
};
