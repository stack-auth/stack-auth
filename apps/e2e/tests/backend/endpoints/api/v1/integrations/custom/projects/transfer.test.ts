import { urlString } from "@stackframe/stack-shared/dist/utils/urls";
import { expect } from "vitest";
import { it } from "../../../../../../../helpers";
import { Auth, Project, niceBackendFetch } from "../../../../../../backend-helpers";
import { provisionProject } from "./provision.test";

async function initiateTransfer(projectId: string) {
  const response = await niceBackendFetch("/api/v1/integrations/custom/projects/transfer/initiate", {
    method: "POST",
    body: {
      project_id: projectId,
    },
    headers: {
      "Authorization": "Basic bmVvbi1sb2NhbDpuZW9uLWxvY2FsLXNlY3JldA==",
    },
  });
  expect(response).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": { "confirmation_url": "http://localhost:8101/integrations/custom/projects/transfer/confirm?code=%3Cstripped+query+param%3E" },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
  const confirmationUrl = new URL(response.body.confirmation_url);
  const code = confirmationUrl.searchParams.get("code")!;
  return { code };
}

async function provisionAndTransferProject() {
  const provisioned = await provisionProject();
  const projectId = provisioned.body.project_id;
  const { code } = await initiateTransfer(projectId);
  await Auth.Otp.signIn();
  const response = await niceBackendFetch(`/api/v1/integrations/custom/projects/transfer/confirm`, {
    method: "POST",
    accessType: "client",
    body: {
      code,
    },
  });
  expect(response).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": { "project_id": "<stripped UUID>" },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
  expect(response.body.project_id).toBe(projectId);
  return { provisioned, projectId };
}

it("should return that the project is transferrable if it is provisioned", async ({ expect }) => {
  const provisioned = await provisionProject();
  const projectId = provisioned.body.project_id;
  const response = await niceBackendFetch(urlString`/api/v1/integrations/custom/projects/transfer?project_id=${projectId}`, {
    method: "GET",
    headers: {
      "Authorization": "Basic bmVvbi1sb2NhbDpuZW9uLWxvY2FsLXNlY3JldA==",
    },
  });
  expect(response).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": { "message": "Ready to transfer project; please use the POST method to initiate it." },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});

it("should return that the project is not transferrable if it is not provisioned", async ({ expect }) => {
  await Auth.Otp.signIn();
  const createdProject = await Project.create();
  const response = await niceBackendFetch(urlString`/api/v1/integrations/custom/projects/transfer?project_id=${createdProject.createProjectResponse.body.id}`, {
    method: "GET",
    headers: {
      "Authorization": "Basic bmVvbi1sb2NhbDpuZW9uLWxvY2FsLXNlY3JldA==",
    },
  });
  expect(response).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 400,
      "body": "This project either doesn't exist or the current external project is not authorized to transfer it. Note that projects can only be transferred once.",
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});

it("should return that the project is not transferrable if it has already been transferred", async ({ expect }) => {
  const { provisioned, projectId } = await provisionAndTransferProject();
  const getResponse = await niceBackendFetch(urlString`/api/v1/integrations/custom/projects/transfer?project_id=${projectId}`, {
    method: "GET",
    headers: {
      "Authorization": "Basic bmVvbi1sb2NhbDpuZW9uLWxvY2FsLXNlY3JldA==",
    },
  });
  expect(getResponse).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 400,
      "body": "This project either doesn't exist or the current external project is not authorized to transfer it. Note that projects can only be transferred once.",
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});

it("should transfer a project exactly once", async ({ expect }) => {
  const { provisioned, projectId } = await provisionAndTransferProject();

  const response2 = await niceBackendFetch("/api/v1/integrations/custom/projects/transfer/initiate", {
    method: "POST",
    body: {
      project_id: projectId,
    },
    headers: {
      "Authorization": "Basic bmVvbi1sb2NhbDpuZW9uLWxvY2FsLXNlY3JldA==",
    },
  });
  expect(response2).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 400,
      "body": "This project either doesn't exist or the current external project is not authorized to transfer it. Note that projects can only be transferred once.",
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});

it("should initiate multiple transfers for the same project, but only one can be confirmed", async ({ expect }) => {
  const provisioned = await provisionProject();
  const projectId = provisioned.body.project_id;
  const { code: code1 } = await initiateTransfer(projectId);
  const { code: code2 } = await initiateTransfer(projectId);
  await Auth.Otp.signIn();
  const response1 = await niceBackendFetch(`/api/v1/integrations/custom/projects/transfer/confirm`, {
    method: "POST",
    accessType: "client",
    body: {
      code: code1,
    },
  });
  expect(response1).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": { "project_id": "<stripped UUID>" },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
  expect(response1.body.project_id).toBe(projectId);

  // but only one confirmation!
  const response2 = await niceBackendFetch(`/api/v1/integrations/custom/projects/transfer/confirm`, {
    method: "POST",
    accessType: "client",
    body: {
      code: code2,
    },
  });
  expect(response2).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 400,
      "body": "The project to transfer was not provisioned or has already been transferred.",
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});

it("should fail if the project to transfer was not provisioned by Neon", async ({ expect }) => {
  await Auth.Otp.signIn();
  const createdProject = await Project.create();
  const response = await niceBackendFetch("/api/v1/integrations/custom/projects/transfer/initiate", {
    method: "POST",
    body: {
      project_id: createdProject.createProjectResponse.body.id,
    },
    headers: {
      "Authorization": "Basic bmVvbi1sb2NhbDpuZW9uLWxvY2FsLXNlY3JldA==",
    },
  });
  expect(response).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 400,
      "body": "This project either doesn't exist or the current external project is not authorized to transfer it. Note that projects can only be transferred once.",
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});

it("should fail if the neon client details are missing", async ({ expect }) => {
  const provisioned = await provisionProject();
  const response = await niceBackendFetch("/api/v1/integrations/custom/projects/transfer/initiate", {
    method: "POST",
    body: {
      project_id: provisioned.body.project_id,
    },
  });
  expect(response).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 400,
      "body": {
        "code": "SCHEMA_ERROR",
        "details": {
          "message": deindent\`
            Request validation failed on POST /api/v1/integrations/custom/projects/transfer/initiate:
              - headers.authorization must be defined
          \`,
        },
        "error": deindent\`
          Request validation failed on POST /api/v1/integrations/custom/projects/transfer/initiate:
            - headers.authorization must be defined
        \`,
      },
      "headers": Headers {
        "x-stack-known-error": "SCHEMA_ERROR",
        <some fields may have been hidden>,
      },
    }
  `);
});

it("should fail to transfer project if the user is not signed in", async ({ expect }) => {
  const provisioned = await provisionProject();
  const projectId = provisioned.body.project_id;
  const { code } = await initiateTransfer(projectId);
  const response = await niceBackendFetch(`/api/v1/integrations/custom/projects/transfer/confirm`, {
    method: "POST",
    body: {
      code,
    },
  });
  expect(response).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 400,
      "body": {
        "code": "ACCESS_TYPE_REQUIRED",
        "error": deindent\`
          You must specify an access level for this Stack project. Make sure project API keys are provided (eg. x-stack-publishable-client-key) and you set the x-stack-access-type header to 'client', 'server', or 'admin'.
          
          For more information, see the docs on REST API authentication: https://docs.stack-auth.com/rest-api/overview#authentication
        \`,
      },
      "headers": Headers {
        "x-stack-known-error": "ACCESS_TYPE_REQUIRED",
        <some fields may have been hidden>,
      },
    }
  `);
});

it("should check if the project exists before initiating transfer", async ({ expect }) => {
  const provisioned = await provisionProject();
  const projectId = provisioned.body.project_id;
  const { code } = await initiateTransfer(projectId);
  await Auth.Otp.signIn();
  const response = await niceBackendFetch(`/api/v1/integrations/custom/projects/transfer/confirm/check`, {
    method: "POST",
    accessType: "client",
    body: {
      code,
    },
  });
  expect(response).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": { "is_code_valid": true },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});

it("should fail the check if project was already transferred", async ({ expect }) => {
  const provisioned = await provisionProject();
  const projectId = provisioned.body.project_id;
  const { code } = await initiateTransfer(projectId);
  await Auth.Otp.signIn();
  const response = await niceBackendFetch(`/api/v1/integrations/custom/projects/transfer/confirm`, {
    method: "POST",
    accessType: "client",
    body: {
      code,
    },
  });
  expect(response).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": { "project_id": "<stripped UUID>" },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
  const response2 = await niceBackendFetch(`/api/v1/integrations/custom/projects/transfer/confirm/check`, {
    method: "POST",
    accessType: "client",
    body: {
      code,
    },
  });
  expect(response2).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 409,
      "body": {
        "code": "VERIFICATION_CODE_ALREADY_USED",
        "error": "The verification link has already been used.",
      },
      "headers": Headers {
        "x-stack-known-error": "VERIFICATION_CODE_ALREADY_USED",
        <some fields may have been hidden>,
      },
    }
  `);
});

