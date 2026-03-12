import { describe } from "vitest";
import { it } from "../../../../../helpers";
import { Auth, niceBackendFetch, Project } from "../../../../backend-helpers";

describe("rewrite-template-source", () => {
  it("rewrites a regular template with variables", async ({ expect }) => {
    await Auth.Otp.signIn();
    await Project.createAndSwitch({ display_name: "Rewrite Happy Path Project" }, true);

    const response = await niceBackendFetch("/api/v1/internal/rewrite-template-source", {
      method: "POST",
      accessType: "admin",
      body: {
        template_tsx_source: `
          import { type } from "arktype";
          export const variablesSchema = type({ greeting: "string", count: "number" });
          export function EmailTemplate({ variables, user }: any) {
            return <div>{variables.greeting} {variables.count} {user.displayName}</div>;
          }
          EmailTemplate.PreviewVariables = { greeting: "Hello!", count: 42 } satisfies typeof variablesSchema.infer;
        `,
      },
    });

    expect(response.status).toBe(200);
    expect(response.body.tsx_source).toContain("export function EmailTemplate");
    expect(response.body.tsx_source).toContain("const variables =");
    expect(response.body.tsx_source).not.toContain("PreviewVariables");
  });

  it("rewrites templates even when schema symbol is renamed", async ({ expect }) => {
    await Auth.Otp.signIn();
    await Project.createAndSwitch({ display_name: "Rewrite Renamed Schema Project" }, true);

    const response = await niceBackendFetch("/api/v1/internal/rewrite-template-source", {
      method: "POST",
      accessType: "admin",
      body: {
        template_tsx_source: `
          import { type } from "arktype";
          export const profileSchema = type({ link: "string", isActive: "boolean" });
          export function EmailTemplate({ user, variables }: any) {
            return <div>{user.displayName} {variables.link}</div>;
          }
          EmailTemplate.PreviewVariables = { link: "https://example.com", isActive: true } satisfies typeof profileSchema.infer;
        `,
      },
    });

    expect(response.status).toBe(200);
    expect(response.body.tsx_source).toContain("const variables =");
    expect(response.body.tsx_source).not.toContain("PreviewVariables");
    expect(response.body.tsx_source).not.toContain("profileSchema");
  });

  it("passes through templates without variables schema", async ({ expect }) => {
    await Auth.Otp.signIn();
    await Project.createAndSwitch({ display_name: "Rewrite Pass Through Project" }, true);

    const source = `
      export function EmailTemplate({ user }: any) {
        return <div>Hello {user.displayName}</div>;
      }
    `;
    const response = await niceBackendFetch("/api/v1/internal/rewrite-template-source", {
      method: "POST",
      accessType: "admin",
      body: {
        template_tsx_source: source,
      },
    });

    expect(response.status).toBe(200);
    expect(response.body.tsx_source).not.toContain("PreviewVariables");
    expect(response.body.tsx_source).toContain("export function EmailTemplate");
    expect(response.body.tsx_source).not.toContain("variablesSchema");
  });
});
