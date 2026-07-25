import { wait } from "@hexclave/shared/dist/utils/promises";
import { it } from "../../../../../helpers";
import { Auth, Project, backendContext, niceBackendFetch } from "../../../../backend-helpers";

it("exports failed password sign-in events", async ({ expect }) => {
  await Project.createAndSwitch();
  const user = await Auth.Password.signUpWithEmail({ noWaitForEmail: true });
  const email = backendContext.value.mailbox.emailAddress;

  const signInResponse = await niceBackendFetch("/api/v1/auth/password/sign-in", {
    method: "POST",
    accessType: "client",
    body: {
      email,
      password: `${user.password}-wrong`,
    },
  });
  expect(signInResponse.status).toBe(400);

  let response;
  const today = new Date().toISOString().slice(0, 10);
  for (let attempt = 0; attempt < 20; attempt++) {
    response = await niceBackendFetch(`/api/v1/internal/compliance/access-denied?from=${today}&to=${today}`, {
      accessType: "admin",
    });
    if (response.status === 200 && response.body.events.some((event: { category: string, reason: string, email: string }) =>
      event.category === "access_denied" && event.reason === "failed_password" && event.email === email
    )) {
      break;
    }
    await wait(250);
  }

  expect(response?.status).toBe(200);
  expect(response?.body.events).toContainEqual(expect.objectContaining({
    category: "access_denied",
    reason: "failed_password",
    email,
    auth_method: "password",
  }));
  expect(response?.body.summary.failed_password).toBeGreaterThanOrEqual(1);
});
