import { it } from "../../../../helpers";
import { Auth, Project, backendContext, niceBackendFetch } from "../../../backend-helpers";

it("accepts a standard empty OTLP/HTTP JSON trace export with server auth", async ({ expect }) => {
  await Project.createAndSwitch({ config: { magic_link_enabled: true } });
  await Project.updateConfig({ apps: { installed: { observability: { enabled: true } } } });

  const response = await niceBackendFetch("/api/v1/analytics/otlp/v1/traces", {
    method: "POST",
    accessType: "server",
    body: { resourceSpans: [] },
  });

  expect(response).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": {},
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});

it("accepts OTLP/HTTP protobuf and returns an empty protobuf success message", async ({ expect }) => {
  await Project.createAndSwitch({ config: { magic_link_enabled: true } });
  await Project.updateConfig({ apps: { installed: { observability: { enabled: true } } } });

  // An empty byte sequence is the canonical encoding of an empty
  // ExportTraceServiceRequest.
  const response = await niceBackendFetch("/api/v1/analytics/otlp/v1/traces", {
    method: "POST",
    accessType: "server",
    rawBody: new Uint8Array(),
    rawContentType: "application/x-protobuf",
  });

  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toBe("application/x-protobuf");
  expect(response.body).toEqual(new ArrayBuffer(0));
});

it("accepts browser OTLP with an authenticated client session", async ({ expect }) => {
  await Project.createAndSwitch({ config: { magic_link_enabled: true } });
  await Project.updateConfig({ apps: { installed: { observability: { enabled: true } } } });
  // Client access alone is not enough: browser OTLP requires a user session
  // (the sibling test below asserts the 401 without one).
  await Auth.Otp.signIn();

  const response = await niceBackendFetch("/api/v1/analytics/otlp/v1/traces", {
    method: "POST",
    accessType: "client",
    body: { resourceSpans: [] },
  });

  expect(response.status).toBe(200);
});

it("requires a user session for browser OTLP", async ({ expect }) => {
  await Project.createAndSwitch({ config: { magic_link_enabled: true } });
  await Project.updateConfig({ apps: { installed: { observability: { enabled: true } } } });
  backendContext.set({ userAuth: null });

  const response = await niceBackendFetch("/api/v1/analytics/otlp/v1/traces", {
    method: "POST",
    accessType: "client",
    body: { resourceSpans: [] },
  });

  expect(response.status).toBe(401);
});
