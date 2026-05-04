import { describe, expect, it } from "vitest";
import { createBetterAuthStackPersistence } from "./better-auth-persistence";

describe("createBetterAuthStackPersistence", () => {
  it("captures Better Auth adapter writes and turns them into a Stack import plan", async () => {
    const persistence = createBetterAuthStackPersistence();

    await persistence.adapter.create({
      model: "user",
      data: {
        id: "user-1",
        email: "ada@example.com",
        emailVerified: true,
        name: "Ada Lovelace",
      },
    });
    await persistence.adapter.create({
      model: "account",
      data: {
        id: "account-1",
        userId: "user-1",
        providerId: "credential",
        accountId: "ada@example.com",
        password: "$2b$12$aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      },
    });
    await persistence.adapter.create({
      model: "organization",
      data: {
        id: "org-1",
        name: "Analytical Engines",
        slug: "engines",
      },
    });
    await persistence.adapter.create({
      model: "member",
      data: {
        id: "member-1",
        userId: "user-1",
        organizationId: "org-1",
        role: "owner",
      },
    });

    expect(persistence.snapshot()).toMatchInlineSnapshot(`
      {
        "memberships": [
          {
            "externalId": "member-1",
            "externalOrganizationId": "org-1",
            "externalUserId": "user-1",
            "metadata": {
              "better_auth": {
                "created_at": null,
                "id": "member-1",
                "updated_at": null,
              },
            },
            "role": "owner",
          },
        ],
        "organizations": [
          {
            "displayName": "Analytical Engines",
            "externalId": "org-1",
            "metadata": {
              "better_auth": {
                "created_at": null,
                "id": "org-1",
                "metadata": null,
                "slug": "engines",
                "updated_at": null,
              },
            },
            "profileImageUrl": null,
          },
        ],
        "source": "better_auth",
        "users": [
          {
            "displayName": "Ada Lovelace",
            "externalId": "user-1",
            "metadata": {
              "better_auth": {
                "created_at": null,
                "id": "user-1",
                "updated_at": null,
              },
            },
            "oauthAccounts": [],
            "passwordHash": "$2b$12$aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            "primaryEmail": "ada@example.com",
            "primaryEmailVerified": true,
            "profileImageUrl": null,
            "restricted": null,
          },
        ],
      }
    `);

    expect(persistence.buildPlan()).toMatchInlineSnapshot(`
      {
        "memberships": [
          {
            "externalMembershipId": "member-1",
            "externalOrganizationId": "org-1",
            "externalUserId": "user-1",
            "metadata": {
              "better_auth": {
                "created_at": null,
                "id": "member-1",
                "updated_at": null,
              },
            },
            "role": "owner",
          },
        ],
        "teams": [
          {
            "body": {
              "display_name": "Analytical Engines",
              "server_metadata": {
                "better_auth": {
                  "created_at": null,
                  "id": "org-1",
                  "metadata": null,
                  "slug": "engines",
                  "updated_at": null,
                },
                "migration": {
                  "organization_id": "org-1",
                  "source": "better_auth",
                },
              },
            },
            "externalOrganizationId": "org-1",
          },
        ],
        "users": [
          {
            "body": {
              "display_name": "Ada Lovelace",
              "password_hash": "$2b$12$aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
              "primary_email": "ada@example.com",
              "primary_email_auth_enabled": true,
              "primary_email_verified": true,
              "server_metadata": {
                "better_auth": {
                  "created_at": null,
                  "id": "user-1",
                  "updated_at": null,
                },
                "migration": {
                  "source": "better_auth",
                  "user_id": "user-1",
                },
              },
            },
            "externalUserId": "user-1",
          },
        ],
      }
    `);
  });
});
