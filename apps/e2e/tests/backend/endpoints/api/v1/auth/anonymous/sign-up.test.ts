import { it } from "../../../../../../helpers";
import { Auth, Project, backendContext, niceBackendFetch } from "../../../../../backend-helpers";

// Define the allowed project IDs for anonymous sign-up
const ALLOWED_PROJECT_IDS = [
  "9bee8100-8d83-4ad7-aaad-d6607e386a28",
  "71bd203a-14d9-4ccc-b704-32bfac0e2542",
];

it("should create anonymous users", async ({ expect }) => {
  // Use the Auth.Anonymous.signUp helper function
  const { signUpResponse: response } = await Auth.Anonymous.signUp();

  // Verify the user was created successfully
  expect(response.status).toBe(200);
  expect(response.body).toMatchObject({
    access_token: expect.any(String),
    refresh_token: expect.any(String),
    user_id: expect.any(String),
  });

  // Verify the user has the correct properties
  const meResponse = await niceBackendFetch("/api/v1/users/me", { accessType: "client" });
  expect(meResponse.status).toBe(200);
  expect(meResponse.body.display_name).toBe("Anonymous user");
  expect(meResponse.body.primary_email).toBeNull();
});

it("should not allow anonymous sign-up for projects other than the allowed ones", async ({ expect }) => {
  // Create a new project with a different ID
  await Project.createAndSwitch();

  // Add the special header to trigger the project ID check in test environment
  const response = await niceBackendFetch("/api/v1/auth/anonymous", {
    method: "POST",
    accessType: "client",
    body: {},
    headers: {
      "x-test-check-project-id": "true",
      "x-client-auth": "true"
    }
  });

  expect(response.status).toBe(400);
  expect(response.body.code).toBe("ANONYMOUS_SIGN_UP_NOT_ENABLED");
});

it("should allow sign-in with the anonymous user", async ({ expect }) => {
  // Save the current context
  const originalContext = { ...backendContext.value };
  
  try {
    // Create an anonymous user
    const { signUpResponse: response } = await Auth.Anonymous.signUp();
    
    expect(response.status).toBe(200);
    const userId = response.body.user_id;
    const refreshToken = response.body.refresh_token;

    // Sign out
    await Auth.signOut();

    // Refresh the token
    const refreshResponse = await niceBackendFetch("/api/v1/auth/sessions/current/refresh", {
      method: "POST",
      accessType: "client",
      body: {
        refresh_token: refreshToken,
      },
    });

    expect(refreshResponse.status).toBe(200);
    expect(refreshResponse.body).toMatchObject({
      access_token: expect.any(String),
      refresh_token: expect.any(String),
    });

    // Set the new tokens
    backendContext.set({
      userAuth: {
        accessToken: refreshResponse.body.access_token,
        refreshToken: refreshResponse.body.refresh_token,
      },
      projectKeys: {
        projectId: ALLOWED_PROJECT_IDS[0],
      }
    });

    // Verify we're signed in as the same user
    const meResponse = await niceBackendFetch("/api/v1/users/me", { accessType: "client" });
    expect(meResponse.status).toBe(200);
    expect(meResponse.body.id).toBe(userId);
    expect(meResponse.body.display_name).toBe("Anonymous user");
  } finally {
    // Restore the original context
    backendContext.set(originalContext);
  }
});
