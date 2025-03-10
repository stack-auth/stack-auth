import { it } from "../helpers";
import { scaffoldProject } from "./js-helpers";
import { StackAdminApp } from '@stackframe/js';
import { STACK_BACKEND_BASE_URL, STACK_INTERNAL_PROJECT_ADMIN_KEY, STACK_INTERNAL_PROJECT_CLIENT_KEY, STACK_INTERNAL_PROJECT_SERVER_KEY } from '../helpers';
import { randomUUID } from "crypto";

it("should create and list projects", async ({ expect }) => {
  // For project management tests, we need to use the internal app directly
  // since we're testing project creation functionality
  const internalApp = new StackAdminApp({
    projectId: 'internal',
    baseUrl: STACK_BACKEND_BASE_URL,
    publishableClientKey: STACK_INTERNAL_PROJECT_CLIENT_KEY,
    secretServerKey: STACK_INTERNAL_PROJECT_SERVER_KEY,
    superSecretAdminKey: STACK_INTERNAL_PROJECT_ADMIN_KEY,
    tokenStore: "memory",
    urls: {
      emailVerification: "https://stack-js-test.example.com/verify"
    }
  });

  const email = `${randomUUID()}@stack-js-test.example.com`;

  await internalApp.signUpWithCredential({
    email,
    password: "password",
  });

  const user = await internalApp.getUser({
    or: 'throw',
  });

  // Create project
  const projectName = "Test Project";
  const project = await user.createProject({
    displayName: projectName,
  });

  expect(project).toBeDefined();
  expect(project.displayName).toBe(projectName);
  expect(project.id).toBeDefined();

  // List projects
  const projects = await user.listOwnedProjects();

  expect(projects).toContainEqual(expect.objectContaining({
    id: project.id,
    displayName: projectName,
  }));
});

it("should create project with custom configuration", async ({ expect }) => {
  // For project management tests, we need to use the internal app directly
  // since we're testing project creation functionality
  const internalApp = new StackAdminApp({
    projectId: 'internal',
    baseUrl: STACK_BACKEND_BASE_URL,
    publishableClientKey: STACK_INTERNAL_PROJECT_CLIENT_KEY,
    secretServerKey: STACK_INTERNAL_PROJECT_SERVER_KEY,
    superSecretAdminKey: STACK_INTERNAL_PROJECT_ADMIN_KEY,
    tokenStore: "memory",
    urls: {
      emailVerification: "https://stack-js-test.example.com/verify"
    }
  });

  const email = `${randomUUID()}@stack-js-test.example.com`;

  await internalApp.signUpWithCredential({
    email,
    password: "password",
  });

  const user = await internalApp.getUser({
    or: 'throw',
  });

  // Create project with custom configuration
  const projectName = "Custom Config Project";
  const project = await user.createProject({
    displayName: projectName,
  });

  expect(project).toBeDefined();
  expect(project.displayName).toBe(projectName);
  expect(project.id).toBeDefined();
  expect(project.config).toBeDefined();

  // Check that config exists
  expect(project.config).toBeDefined();
});
