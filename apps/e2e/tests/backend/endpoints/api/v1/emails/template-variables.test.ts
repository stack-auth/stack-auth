import { describe } from "vitest";
import { it } from "../../../../../helpers";
import { Auth, niceBackendFetch, Project } from "../../../../backend-helpers";

describe("template-variables", () => {
  it("should extract string and number variables with defaults", async ({ expect }) => {
    await Auth.Otp.signIn();
    await Project.createAndSwitch({ display_name: "Test Vars Project" }, true);

    const response = await niceBackendFetch("/api/v1/emails/template-variables", {
      method: "POST",
      accessType: "admin",
      body: {
        template_tsx_source: `
          import { type } from "arktype";
          export const variablesSchema = type({ greeting: "string", count: "number" });
          export function EmailTemplate({ variables }: any) {
            return <div>{variables.greeting} {variables.count}</div>;
          }
          EmailTemplate.PreviewVariables = { greeting: "Hello!", count: 42 } satisfies typeof variablesSchema.infer;
        `,
      },
    });

    expect(response.status).toBe(200);
    expect(response.body.variables).toHaveLength(2);

    const greeting = response.body.variables.find((v: { name: string }) => v.name === "greeting");
    expect(greeting).toEqual({ name: "greeting", type: "string", default_value: "Hello!" });

    const count = response.body.variables.find((v: { name: string }) => v.name === "count");
    expect(count).toEqual({ name: "count", type: "number", default_value: 42 });
  });

  it("should return empty array for templates without variablesSchema", async ({ expect }) => {
    await Auth.Otp.signIn();
    await Project.createAndSwitch({ display_name: "Test No Schema Project" }, true);

    const response = await niceBackendFetch("/api/v1/emails/template-variables", {
      method: "POST",
      accessType: "admin",
      body: {
        template_tsx_source: `
          export function EmailTemplate() {
            return <div>No variables here</div>;
          }
        `,
      },
    });

    expect(response.status).toBe(200);
    expect(response.body.variables).toEqual([]);
  });

  it("should return TEMPLATE_VARIABLE_EXTRACTION_ERROR for invalid TSX source", async ({ expect }) => {
    await Auth.Otp.signIn();
    await Project.createAndSwitch({ display_name: "Test Invalid Source Project" }, true);

    const response = await niceBackendFetch("/api/v1/emails/template-variables", {
      method: "POST",
      accessType: "admin",
      body: {
        template_tsx_source: "this is not valid typescript {{{",
      },
    });

    expect(response.status).toBe(400);
    expect(response.body.code).toBe("TEMPLATE_VARIABLE_EXTRACTION_ERROR");
  });

  it("should require admin access type", async ({ expect }) => {
    await Auth.Otp.signIn();
    await Project.createAndSwitch({ display_name: "Test Auth Project" }, true);

    const response = await niceBackendFetch("/api/v1/emails/template-variables", {
      method: "POST",
      accessType: "client",
      body: {
        template_tsx_source: `export function EmailTemplate() { return <div/>; }`,
      },
    });

    expect(response.status).toBe(401);
  });

  it("should return null default_value when PreviewVariables is not defined", async ({ expect }) => {
    await Auth.Otp.signIn();
    await Project.createAndSwitch({ display_name: "Test No Defaults Project" }, true);

    const response = await niceBackendFetch("/api/v1/emails/template-variables", {
      method: "POST",
      accessType: "admin",
      body: {
        template_tsx_source: `
          import { type } from "arktype";
          export const variablesSchema = type({ link: "string" });
          export function EmailTemplate({ variables }: any) {
            return <div>{variables.link}</div>;
          }
        `,
      },
    });

    expect(response.status).toBe(200);
    expect(response.body.variables).toEqual([
      { name: "link", type: "string", default_value: null },
    ]);
  });
});
