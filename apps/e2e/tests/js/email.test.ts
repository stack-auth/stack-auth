import { KnownErrors } from "@stackframe/stack-shared";
import { it } from "../helpers";
import { createApp } from "./js-helpers";
import { DEFAULT_TEMPLATE_IDS, DEFAULT_EMAIL_THEME_ID } from "@stackframe/stack-shared/dist/helpers/emails";

async function setupEmailServer(adminApp: any) {
  const project = await adminApp.getProject();
  await project.updateConfig({
    emails: {
      server: {
        isShared: false,
        host: "localhost",
        port: 1025,
        username: "test",
        password: "password",
        senderEmail: "test@example.com",
        senderName: "Test User",
      },
    },
  });
}

it("should successfully send email with HTML content", async ({ expect }) => {
  const { adminApp, serverApp } = await createApp();
  await setupEmailServer(adminApp);

  const user = await serverApp.createUser({
    primaryEmail: "test@example.com",
    primaryEmailVerified: true,
  });

  const result = await serverApp.sendEmail({
    userIds: [user.id],
    html: "<h1>Test Email</h1><p>This is a test email with HTML content.</p>",
    subject: "Test Subject",
  });

  expect(result.status).toBe("ok");
});

it("should successfully send email with template", async ({ expect }) => {
  const { adminApp, serverApp } = await createApp();
  await setupEmailServer(adminApp);

  const user = await serverApp.createUser({
    primaryEmail: "test@example.com",
    primaryEmailVerified: true,
  });

  const result = await serverApp.sendEmail({
    userIds: [user.id],
    templateId: DEFAULT_TEMPLATE_IDS.sign_in_invitation,
    variables: {
      teamDisplayName: "Test Team",
      signInInvitationLink: "https://example.com",
    },
    subject: "Welcome!",
  });

  expect(result.status).toBe("ok");
});

it("should successfully send email to multiple users", async ({ expect }) => {
  const { adminApp, serverApp } = await createApp();
  await setupEmailServer(adminApp);

  const user1 = await serverApp.createUser({
    primaryEmail: "test1@example.com",
    primaryEmailVerified: true,
  });

  const user2 = await serverApp.createUser({
    primaryEmail: "test2@example.com",
    primaryEmailVerified: true,
  });

  const result = await serverApp.sendEmail({
    userIds: [user1.id, user2.id],
    html: "<p>Bulk email test</p>",
    subject: "Bulk Email Test",
  });

  expect(result.status).toBe("ok");
});

it("should send email with theme customization", async ({ expect }) => {
  const { adminApp, serverApp } = await createApp();
  await setupEmailServer(adminApp);

  const user = await serverApp.createUser({
    primaryEmail: "test@example.com",
    primaryEmailVerified: true,
  });

  const result = await serverApp.sendEmail({
    userIds: [user.id],
    html: "<p>Themed email test</p>",
    subject: "Themed Email",
    themeId: DEFAULT_EMAIL_THEME_ID,
  });

  expect(result.status).toBe("ok");
});

it("should send email with notification category", async ({ expect }) => {
  const { adminApp, serverApp } = await createApp();
  await setupEmailServer(adminApp);

  const user = await serverApp.createUser({
    primaryEmail: "test@example.com",
    primaryEmailVerified: true,
  });

  const result = await serverApp.sendEmail({
    userIds: [user.id],
    html: "<p>Notification email test</p>",
    subject: "Notification Email",
    notificationCategoryName: "Transactional",
  });

  expect(result.status).toBe("ok");
});

it("should return RequiresCustomEmailServer error when email server is not configured", async ({ expect }) => {
  const { serverApp } = await createApp();

  const user = await serverApp.createUser({
    primaryEmail: "test@example.com",
    primaryEmailVerified: true,
  });

  const result = await serverApp.sendEmail({
    userIds: [user.id],
    html: "<p>This should fail</p>",
    subject: "Test Email",
  });

  expect(result.status).toBe("error");
  if (result.status === "error") {
    expect(KnownErrors.RequiresCustomEmailServer.isInstance(result.error)).toBe(true);
  }
});


it("should handle non-existent user IDs", async ({ expect }) => {
  const { adminApp, serverApp } = await createApp();
  await setupEmailServer(adminApp);

  // Use a properly formatted UUID that doesn't exist
  const result = await serverApp.sendEmail({
    userIds: ["123e4567-e89b-12d3-a456-426614174000"],
    html: "<p>Non-existent user test</p>",
    subject: "Test Email",
  });

  expect(result.status).toBe("error");
  if (result.status === "error") {
    expect(KnownErrors.UserIdDoesNotExist.isInstance(result.error)).toBe(true);
    expect(result.error.message).toMatchInlineSnapshot(`"The given user with the ID <stripped UUID> does not exist."`);
  }
});

it("should handle missing required email content", async ({ expect }) => {
  const { adminApp, serverApp } = await createApp();
  await setupEmailServer(adminApp);

  const user = await serverApp.createUser({
    primaryEmail: "test@example.com",
    primaryEmailVerified: true,
  });

  const result = await serverApp.sendEmail({
    userIds: [user.id],
    subject: "Test Email",
  } as any);

  expect(result.status).toBe("error");
  if (result.status === "error") {
    expect(KnownErrors.SchemaError.isInstance(result.error)).toBe(true);
    expect(result.error.message).toMatchInlineSnapshot(`"Either html or template_id must be provided"`);
  }
});

it("should handle html and templateId at the same time", async ({ expect }) => {
  const { adminApp, serverApp } = await createApp();
  await setupEmailServer(adminApp);

  const user = await serverApp.createUser({
    primaryEmail: "test@example.com",
    primaryEmailVerified: true,
  });

  const result = await serverApp.sendEmail({
    userIds: [user.id],
    html: "<p>Test Email</p>",
    templateId: DEFAULT_TEMPLATE_IDS.sign_in_invitation,
    subject: "Test Email",
  });

  expect(result.status).toBe("error");
  if (result.status === "error") {
    expect(KnownErrors.SchemaError.isInstance(result.error)).toBe(true);
    expect(result.error.message).toMatchInlineSnapshot(`"If html is provided, cannot provide template_id or variables"`);
  }
});
