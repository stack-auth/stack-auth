import { describe, expect, it } from "vitest";
import { createBetterAuthStackPersistence } from "./better-auth";

describe("createBetterAuthStackPersistence", () => {
  it("captures Better Auth model writes and builds a Stack Auth import plan", async () => {
    const persistence = createBetterAuthStackPersistence();

    await persistence.adapter.create({
      model: "user",
      data: {
        id: "workos-user-1",
        email: "Ada@Example.COM",
        emailVerified: true,
        name: "Ada Lovelace",
        image: "https://example.com/ada.png",
        createdAt: "2024-01-02T03:04:05.000Z",
        updatedAt: "2024-01-03T03:04:05.000Z",
      },
    });
    await persistence.adapter.create({
      model: "account",
      data: {
        id: "credential-account-1",
        userId: "workos-user-1",
        accountId: "workos-user-1",
        providerId: "credential",
        password: "$2a$10$TVyY/gpw9Db/w1fBeJkCgeNg2Rae2JfNqrPnSAKtj.ufAO5cVF13.",
      },
    });
    await persistence.adapter.create({
      model: "account",
      data: {
        id: "oauth-account-1",
        userId: "workos-user-1",
        accountId: "github-ada",
        providerId: "github",
      },
    });
    await persistence.adapter.create({
      model: "organization",
      data: {
        id: "workos-org-1",
        name: "Analytical Engines",
        slug: "analytical-engines",
        logo: null,
        metadata: { plan: "pro" },
      },
    });
    await persistence.adapter.create({
      model: "member",
      data: {
        id: "workos-member-1",
        userId: "workos-user-1",
        organizationId: "workos-org-1",
        role: "admin",
      },
    });

    expect(persistence.buildPlan()).toMatchInlineSnapshot(`
      {
        "memberships": [
          {
            "externalMembershipId": "workos-member-1",
            "externalOrganizationId": "workos-org-1",
            "externalUserId": "workos-user-1",
            "metadata": {
              "better_auth": {
                "created_at": null,
                "id": "workos-member-1",
                "updated_at": null,
              },
            },
            "role": "admin",
          },
        ],
        "teams": [
          {
            "body": {
              "display_name": "Analytical Engines",
              "server_metadata": {
                "better_auth": {
                  "created_at": null,
                  "id": "workos-org-1",
                  "metadata": {
                    "plan": "pro",
                  },
                  "slug": "analytical-engines",
                  "updated_at": null,
                },
                "migration": {
                  "organization_id": "workos-org-1",
                  "source": "better_auth",
                },
              },
            },
            "externalOrganizationId": "workos-org-1",
          },
        ],
        "users": [
          {
            "body": {
              "display_name": "Ada Lovelace",
              "oauth_providers": [
                {
                  "account_id": "github-ada",
                  "email": "Ada@Example.COM",
                  "id": "github",
                },
              ],
              "password_hash": "$2a$10$TVyY/gpw9Db/w1fBeJkCgeNg2Rae2JfNqrPnSAKtj.ufAO5cVF13.",
              "primary_email": "Ada@Example.COM",
              "primary_email_auth_enabled": true,
              "primary_email_verified": true,
              "profile_image_url": "https://example.com/ada.png",
              "server_metadata": {
                "better_auth": {
                  "created_at": "2024-01-02T03:04:05.000Z",
                  "id": "workos-user-1",
                  "updated_at": "2024-01-03T03:04:05.000Z",
                },
                "migration": {
                  "source": "better_auth",
                  "user_id": "workos-user-1",
                },
              },
            },
            "externalUserId": "workos-user-1",
          },
        ],
      }
    `);
  });

  it("can omit unsupported hashes when Better Auth normalized a provider that Stack cannot verify", async () => {
    const persistence = createBetterAuthStackPersistence();
    await persistence.adapter.create({
      model: "user",
      data: {
        id: "user-1",
        email: "user@example.com",
      },
    });
    await persistence.adapter.create({
      model: "account",
      data: {
        id: "account-1",
        userId: "user-1",
        accountId: "user-1",
        providerId: "credential",
        password: "scrypt:hash",
      },
    });

    expect(() => persistence.buildPlan()).toThrow("unsupported password hash");
    expect(persistence.buildPlan({ unsupportedPasswordHashAction: "omit" }).users[0].body.password_hash).toBeUndefined();
  });

  it("supports find/update/delete operations migration scripts commonly use", async () => {
    const persistence = createBetterAuthStackPersistence();
    await persistence.adapter.create({ model: "user", data: { id: "user-1", email: "first@example.com" } });
    await persistence.adapter.update({
      model: "user",
      where: [{ field: "email", value: "first@example.com" }],
      update: { email: "second@example.com" },
    });

    expect(await persistence.adapter.findOne({ model: "user", where: [{ field: "email", value: "second@example.com" }] })).toMatchObject({
      id: "user-1",
      email: "second@example.com",
    });
    expect(await persistence.adapter.count({ model: "user", where: [{ field: "email", value: "second", operator: "contains" }] })).toBe(1);

    await persistence.adapter.delete({ model: "user", where: [{ field: "id", value: "user-1" }] });
    expect(await persistence.adapter.count({ model: "user" })).toBe(0);
  });
});
