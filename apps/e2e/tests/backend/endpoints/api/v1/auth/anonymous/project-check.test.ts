import { it } from "../../../../../../helpers";
import { Auth, Project, backendContext, niceBackendFetch } from "../../../../../backend-helpers";

// Define the allowed project IDs for anonymous sign-up - must match the ones in the route handler
const ALLOWED_PROJECT_IDS = [
  "9bee8100-8d83-4ad7-aaad-d6607e386a28",
  "71bd203a-14d9-4ccc-b704-32bfac0e2542",
];

it("should not allow anonymous sign-up for projects with IDs not in the allowed list", async ({ expect }) => {
  // Create a project and get its ID - this will have a random ID not in the allowed list
  await Project.createAndSwitch();

  // Test anonymous sign-up with a non-allowed project ID
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

it("should allow anonymous sign-up for allowed project IDs", async ({ expect }) => {
  // Save the current context
  const originalContext = { ...backendContext.value };
  
  try {
    // Set the project ID to one of the allowed values
    backendContext.set({
      projectKeys: {
        projectId: ALLOWED_PROJECT_IDS[0],
      },
    });
    
    // Test anonymous sign-up with an allowed project ID
    const { signUpResponse: response } = await Auth.Anonymous.signUp();
    
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      access_token: expect.any(String),
      refresh_token: expect.any(String),
      user_id: expect.any(String),
    });
  } finally {
    // Restore the original context
    backendContext.set(originalContext);
  }
});
