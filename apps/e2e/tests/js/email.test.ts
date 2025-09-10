import { KnownErrors } from "@stackframe/stack-shared";
import { DEFAULT_EMAIL_THEME_ID, DEFAULT_TEMPLATE_IDS } from "@stackframe/stack-shared/dist/helpers/emails";
import { it } from "../helpers";
import { createApp } from "./js-helpers";

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

  await expect(serverApp.sendEmail({
    userIds: [user.id],
    html: "<h1>Test Email</h1><p>This is a test email with HTML content.</p>",
    subject: "Test Subject",
  })).resolves.not.toThrow();
});

it("should successfully send email with template", async ({ expect }) => {
  const { adminApp, serverApp } = await createApp();
  await setupEmailServer(adminApp);

  const user = await serverApp.createUser({
    primaryEmail: "test@example.com",
    primaryEmailVerified: true,
  });

  await expect(serverApp.sendEmail({
    userIds: [user.id],
    templateId: DEFAULT_TEMPLATE_IDS.sign_in_invitation,
    variables: {
      teamDisplayName: "Test Team",
      signInInvitationLink: "https://example.com",
    },
    subject: "Welcome!",
  })).resolves.not.toThrow();
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

  await expect(serverApp.sendEmail({
    userIds: [user1.id, user2.id],
    html: "<p>Bulk email test</p>",
    subject: "Bulk Email Test",
  })).resolves.not.toThrow();
});

it("should send email with theme customization", async ({ expect }) => {
  const { adminApp, serverApp } = await createApp();
  await setupEmailServer(adminApp);

  const user = await serverApp.createUser({
    primaryEmail: "test@example.com",
    primaryEmailVerified: true,
  });

  await expect(serverApp.sendEmail({
    userIds: [user.id],
    html: "<p>Themed email test</p>",
    subject: "Themed Email",
    themeId: DEFAULT_EMAIL_THEME_ID,
  })).resolves.not.toThrow();
});

it("should send email with notification category", async ({ expect }) => {
  const { adminApp, serverApp } = await createApp();
  await setupEmailServer(adminApp);

  const user = await serverApp.createUser({
    primaryEmail: "test@example.com",
    primaryEmailVerified: true,
  });

  await expect(serverApp.sendEmail({
    userIds: [user.id],
    html: "<p>Notification email test</p>",
    subject: "Notification Email",
    notificationCategoryName: "Transactional",
  })).resolves.not.toThrow();
});

it("should throw RequiresCustomEmailServer error when email server is not configured", async ({ expect }) => {
  const { serverApp } = await createApp();

  const user = await serverApp.createUser({
    primaryEmail: "test@example.com",
    primaryEmailVerified: true,
  });

  await expect(serverApp.sendEmail({
    userIds: [user.id],
    html: "<p>This should fail</p>",
    subject: "Test Email",
  })).rejects.toThrow(KnownErrors.RequiresCustomEmailServer);
});

it("should handle non-existent user IDs", async ({ expect }) => {
  const { adminApp, serverApp } = await createApp();
  await setupEmailServer(adminApp);

  // Use a properly formatted UUID that doesn't exist
  await expect(serverApp.sendEmail({
    userIds: ["123e4567-e89b-12d3-a456-426614174000"],
    html: "<p>Non-existent user test</p>",
    subject: "Test Email",
  })).rejects.toThrow(KnownErrors.UserIdDoesNotExist);
});

it("should handle missing required email content", async ({ expect }) => {
  const { adminApp, serverApp } = await createApp();
  await setupEmailServer(adminApp);

  const user = await serverApp.createUser({
    primaryEmail: "test@example.com",
    primaryEmailVerified: true,
  });

  await expect(serverApp.sendEmail({
    userIds: [user.id],
    subject: "Test Email",
  } as any)).rejects.toThrow(KnownErrors.SchemaError);
});

it("should handle html and templateId at the same time", async ({ expect }) => {
  const { adminApp, serverApp } = await createApp();
  await setupEmailServer(adminApp);

  const user = await serverApp.createUser({
    primaryEmail: "test@example.com",
    primaryEmailVerified: true,
  });

  await expect(serverApp.sendEmail({
    userIds: [user.id],
    html: "<p>Test Email</p>",
    templateId: DEFAULT_TEMPLATE_IDS.sign_in_invitation,
    subject: "Test Email",
  } as any)).rejects.toThrow(KnownErrors.SchemaError);
});
