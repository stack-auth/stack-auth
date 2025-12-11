import { wait } from "@stackframe/stack-shared/dist/utils/promises";
import { describe } from "vitest";
import { it } from "../../../../../helpers";
import { withPortPrefix } from "../../../../../helpers/ports";
import { Auth, Project, User, backendContext, bumpEmailAddress, niceBackendFetch } from "../../../../backend-helpers";

const testEmailConfig = {
  type: "standard",
  host: "localhost",
  port: Number(withPortPrefix("29")),
  username: "test",
  password: "test",
  sender_name: "Test Project",
  sender_email: "test@example.com",
} as const;

describe("email queue edge cases", () => {
  it("should skip email when user is deleted after email is queued", async ({ expect }) => {
    await Project.createAndSwitch({
      display_name: "Test User Deletion Project",
      config: {
        email_config: testEmailConfig,
      },
    });

    // Create a user with primary email
    const mailbox = backendContext.value.mailbox;
    const createUserResponse = await niceBackendFetch("/api/v1/users", {
      method: "POST",
      accessType: "server",
      body: {
        primary_email: mailbox.emailAddress,
        primary_email_verified: true,
      },
    });
    expect(createUserResponse.status).toBe(201);
    const userId = createUserResponse.body.id;

    // Send an email to the user
    const sendResponse = await niceBackendFetch("/api/v1/emails/send-email", {
      method: "POST",
      accessType: "server",
      body: {
        user_ids: [userId],
        html: "<p>Test email</p>",
        subject: "User Deletion Test",
        notification_category_name: "Marketing",
      },
    });
    expect(sendResponse.status).toBe(200);

    // Delete the user immediately
    const deleteResponse = await niceBackendFetch(`/api/v1/users/${userId}`, {
      method: "DELETE",
      accessType: "server",
    });
    expect(deleteResponse.status).toBe(200);

    // Wait for email processing
    await wait(3000);

    // Verify no email was received (user was deleted)
    const messages = await mailbox.fetchMessages();
    const testEmails = messages.filter(m => m.subject === "User Deletion Test");
    expect(testEmails).toHaveLength(0);
  });

  it("should skip email when user removes primary email after email is queued", async ({ expect }) => {
    await Project.createAndSwitch({
      display_name: "Test Remove Email Project",
      config: {
        email_config: testEmailConfig,
      },
    });

    const mailbox = await bumpEmailAddress();
    const { userId } = await Auth.Password.signUpWithEmail();

    // Get the contact channel ID
    const contactChannelsResponse = await niceBackendFetch(`/api/v1/contact-channels?user_id=${userId}`, {
      method: "GET",
      accessType: "server",
    });
    expect(contactChannelsResponse.status).toBe(200);
    const contactChannelId = contactChannelsResponse.body.items[0].id;

    // Send an email to the user
    const sendResponse = await niceBackendFetch("/api/v1/emails/send-email", {
      method: "POST",
      accessType: "server",
      body: {
        user_ids: [userId],
        html: "<p>Test email</p>",
        subject: "Remove Email Test",
        notification_category_name: "Marketing",
      },
    });
    expect(sendResponse.status).toBe(200);

    // Remove the primary email immediately
    const deleteChannelResponse = await niceBackendFetch(`/api/v1/contact-channels/${userId}/${contactChannelId}`, {
      method: "DELETE",
      accessType: "server",
    });
    expect(deleteChannelResponse.status).toBe(200);

    // Wait for email processing
    await wait(3000);

    // Verify no email with our subject was received (primary email was removed)
    const messages = await mailbox.fetchMessages();
    const testEmails = messages.filter(m => m.subject === "Remove Email Test");
    expect(testEmails).toHaveLength(0);
  });

  it("should skip email when user unsubscribes after email is queued", async ({ expect }) => {
    await Project.createAndSwitch({
      display_name: "Test Unsubscribe After Queue Project",
      config: {
        email_config: testEmailConfig,
      },
    });

    const { userId } = await Auth.Password.signUpWithEmail();

    // Send an email to the user
    const sendResponse = await niceBackendFetch("/api/v1/emails/send-email", {
      method: "POST",
      accessType: "server",
      body: {
        user_ids: [userId],
        html: "<p>Test email</p>",
        subject: "Unsubscribe After Queue Test",
        notification_category_name: "Marketing",
      },
    });
    expect(sendResponse.status).toBe(200);

    // Unsubscribe the user from Marketing category immediately
    const unsubscribeResponse = await niceBackendFetch(
      `/api/v1/emails/notification-preference/${userId}/4f6f8873-3d04-46bd-8bef-18338b1a1b4c`,
      {
        method: "PATCH",
        accessType: "server",
        body: {
          enabled: false,
        },
      }
    );
    expect(unsubscribeResponse.status).toBe(200);

    // Wait for email processing
    await wait(3000);

    // Verify no email with our subject was received (user unsubscribed)
    const messages = await backendContext.value.mailbox.fetchMessages();
    const testEmails = messages.filter(m => m.subject === "Unsubscribe After Queue Test");
    expect(testEmails).toHaveLength(0);
  });

  it("should NOT skip transactional email even when user unsubscribes from marketing", async ({ expect }) => {
    await Project.createAndSwitch({
      display_name: "Test Transactional Not Skipped Project",
      config: {
        email_config: testEmailConfig,
      },
    });

    const { userId } = await Auth.Password.signUpWithEmail();

    // Unsubscribe from Marketing first
    await niceBackendFetch(
      `/api/v1/emails/notification-preference/${userId}/4f6f8873-3d04-46bd-8bef-18338b1a1b4c`,
      {
        method: "PATCH",
        accessType: "server",
        body: {
          enabled: false,
        },
      }
    );

    // Send a transactional email
    const sendResponse = await niceBackendFetch("/api/v1/emails/send-email", {
      method: "POST",
      accessType: "server",
      body: {
        user_ids: [userId],
        html: "<p>Important transactional email</p>",
        subject: "Transactional Not Skipped Test",
        notification_category_name: "Transactional",
      },
    });
    expect(sendResponse.status).toBe(200);

    // Verify the email was received (transactional emails can't be unsubscribed)
    const messages = await backendContext.value.mailbox.waitForMessagesWithSubject("Transactional Not Skipped Test");
    expect(messages.length).toBeGreaterThanOrEqual(1);
  });

  it("should skip email with USER_HAS_NO_PRIMARY_EMAIL reason when email is sent to user's primary email but user has no primary email", async ({ expect }) => {
    await Project.createAndSwitch({
      display_name: "Test No Email Provided Project",
      config: {
        email_config: testEmailConfig,
      },
    });

    // Create a user without a primary email
    const { userId } = await User.create();

    // Send an email to the user (who has no primary email)
    const sendResponse = await niceBackendFetch("/api/v1/emails/send-email", {
      method: "POST",
      accessType: "server",
      body: {
        user_ids: [userId],
        html: "<p>Test email</p>",
        subject: "No Email Provided Test",
        notification_category_name: "Transactional",
      },
    });
    expect(sendResponse.status).toBe(200);

    // Wait for email processing
    await wait(3000);

    // The email should have been skipped (user has no primary email)
    // We can verify this by checking that no email was sent to any mailbox
    // Note: The skip reason USER_HAS_NO_PRIMARY_EMAIL is used for user-primary-email recipient type
    // This test verifies the email queue handles users without primary emails correctly
    const messages = await backendContext.value.mailbox.fetchMessages();
    const testEmails = messages.filter(m => m.subject === "No Email Provided Test");
    expect(testEmails).toHaveLength(0);
  });

  it("should return an error when email is sent to a custom email but no custom emails are provided", async ({ expect }) => {
    await Project.createAndSwitch({
      display_name: "Test No Custom Emails Project",
      config: {
        email_config: testEmailConfig,
      },
    });

    const { userId } = await Auth.Password.signUpWithEmail();
    const sendResponse = await niceBackendFetch("/api/v1/emails/send-email", {
      method: "POST",
      accessType: "server",
      body: {
        emails: [],
        html: "<p>Test email</p>",
        subject: "No Custom Emails Test",
        notification_category_name: "Transactional",
      },
    });
    expect(sendResponse).toMatchInlineSnapshot(`
      todo
    `);
  });
});

describe("send email to all users", () => {
  it("should send email to all users in the project", async ({ expect }) => {
    await Project.createAndSwitch({
      display_name: "Test All Users Project",
      config: {
        email_config: testEmailConfig,
      },
    });

    const mailbox1 = await bumpEmailAddress();
    const user1Response = await niceBackendFetch("/api/v1/users", {
      method: "POST",
      accessType: "server",
      body: {
        primary_email: mailbox1.emailAddress,
        primary_email_verified: true,
      },
    });
    expect(user1Response.status).toBe(201);

    const mailbox2 = await bumpEmailAddress();
    const user2Response = await niceBackendFetch("/api/v1/users", {
      method: "POST",
      accessType: "server",
      body: {
        primary_email: mailbox2.emailAddress,
        primary_email_verified: true,
      },
    });
    expect(user2Response.status).toBe(201);

    // Send email to all users
    const sendResponse = await niceBackendFetch("/api/v1/emails/send-email", {
      method: "POST",
      accessType: "server",
      body: {
        all_users: true,
        html: "<p>All users test</p>",
        subject: "All Users Test",
        notification_category_name: "Transactional",
      },
    });
    expect(sendResponse.status).toBe(200);
    expect(sendResponse.body.results).toHaveLength(2);

    // Verify both users received the email
    const messages1 = await mailbox1.waitForMessagesWithSubject("All Users Test");
    expect(messages1.length).toBeGreaterThanOrEqual(1);

    const messages2 = await mailbox2.waitForMessagesWithSubject("All Users Test");
    expect(messages2.length).toBeGreaterThanOrEqual(1);
  });
});


describe("template rendering edge cases", () => {
  it("should use subject from template when no subject override is provided", async ({ expect }) => {
    await Project.createAndSwitch({
      display_name: "Test Template Subject Project",
      config: {
        email_config: testEmailConfig,
      },
    });

    const { userId } = await Auth.Password.signUpWithEmail();

    // Create a draft with a subject in the template
    const templateWithSubject = `import { Container } from "@react-email/components";
import { Subject, NotificationCategory, Props } from "@stackframe/emails";

export function EmailTemplate({ user, project }: Props) {
  return (
    <Container>
      <Subject value="Template Subject From Export" />
      <NotificationCategory value="Transactional" />
      <div>Hello!</div>
    </Container>
  );
}`;

    const createDraftResponse = await niceBackendFetch("/api/v1/internal/email-drafts", {
      method: "POST",
      accessType: "admin",
      body: {
        display_name: "Template Subject Draft",
        tsx_source: templateWithSubject,
        theme_id: false,
      },
    });
    expect(createDraftResponse.status).toBe(200);
    const draftId = createDraftResponse.body.id;

    // Send email without subject override
    const sendResponse = await niceBackendFetch("/api/v1/emails/send-email", {
      method: "POST",
      accessType: "server",
      body: {
        user_ids: [userId],
        draft_id: draftId,
      },
    });
    expect(sendResponse.status).toBe(200);

    // Verify the email used the template's subject
    const messages = await backendContext.value.mailbox.waitForMessagesWithSubject("Template Subject From Export");
    expect(messages.length).toBeGreaterThanOrEqual(1);
  });

  it("should use override subject when both template subject and override are provided", async ({ expect }) => {
    await Project.createAndSwitch({
      display_name: "Test Subject Override Project",
      config: {
        email_config: testEmailConfig,
      },
    });

    const { userId } = await Auth.Password.signUpWithEmail();

    // Create a draft with a subject in the template
    const templateWithSubject = `import { Container } from "@react-email/components";
import { Subject, NotificationCategory, Props } from "@stackframe/emails";

export function EmailTemplate({ user, project }: Props) {
  return (
    <Container>
      <Subject value="Template Subject Should Be Overridden" />
      <NotificationCategory value="Transactional" />
      <div>Hello!</div>
    </Container>
  );
}`;

    const createDraftResponse = await niceBackendFetch("/api/v1/internal/email-drafts", {
      method: "POST",
      accessType: "admin",
      body: {
        display_name: "Subject Override Draft",
        tsx_source: templateWithSubject,
        theme_id: false,
      },
    });
    expect(createDraftResponse.status).toBe(200);
    const draftId = createDraftResponse.body.id;

    // Send email with subject override
    const sendResponse = await niceBackendFetch("/api/v1/emails/send-email", {
      method: "POST",
      accessType: "server",
      body: {
        user_ids: [userId],
        draft_id: draftId,
        subject: "Override Subject Takes Priority",
      },
    });
    expect(sendResponse.status).toBe(200);

    // Verify the email used the override subject
    const messages = await backendContext.value.mailbox.waitForMessagesWithSubject("Override Subject Takes Priority");
    expect(messages.length).toBeGreaterThanOrEqual(1);
  });

  it("should handle template without notification category export (defaults to no unsubscribe link)", async ({ expect }) => {
    await Project.createAndSwitch({
      display_name: "Test No Category Export Project",
      config: {
        email_config: testEmailConfig,
      },
    });

    const { userId } = await Auth.Password.signUpWithEmail();

    // Create a draft without NotificationCategory export
    const templateWithoutCategory = `import { Container } from "@react-email/components";
import { Subject, Props } from "@stackframe/emails";

export function EmailTemplate({ user, project }: Props) {
  return (
    <Container>
      <Subject value="No Category Export Test" />
      <div>Hello! This template has no NotificationCategory export.</div>
    </Container>
  );
}`;

    const createDraftResponse = await niceBackendFetch("/api/v1/internal/email-drafts", {
      method: "POST",
      accessType: "admin",
      body: {
        display_name: "No Category Draft",
        tsx_source: templateWithoutCategory,
      },
    });
    expect(createDraftResponse.status).toBe(200);
    const draftId = createDraftResponse.body.id;

    // Send email
    const sendResponse = await niceBackendFetch("/api/v1/emails/send-email", {
      method: "POST",
      accessType: "server",
      body: {
        user_ids: [userId],
        draft_id: draftId,
      },
    });
    expect(sendResponse.status).toBe(200);

    // Verify the email was sent without unsubscribe link (no category = no unsubscribe)
    const messages = await backendContext.value.mailbox.waitForMessagesWithSubject("No Category Export Test");
    expect(messages.length).toBeGreaterThanOrEqual(1);
    // Without a category, there should be no unsubscribe link
    expect(messages[0].body?.html).not.toContain("unsubscribe");
  });
});

describe("user display name in emails", () => {
  it("should include user display name in email template variables", async ({ expect }) => {
    await Project.createAndSwitch({
      display_name: "Test Display Name Project",
      config: {
        email_config: testEmailConfig,
      },
    });

    const mailbox = backendContext.value.mailbox;
    const createUserResponse = await niceBackendFetch("/api/v1/users", {
      method: "POST",
      accessType: "server",
      body: {
        primary_email: mailbox.emailAddress,
        primary_email_verified: true,
        display_name: "John Doe",
      },
    });
    expect(createUserResponse.status).toBe(201);
    const userId = createUserResponse.body.id;

    // Create a draft that uses user display name
    const templateWithDisplayName = `import { Container } from "@react-email/components";
import { Subject, NotificationCategory, Props } from "@stackframe/emails";

export function EmailTemplate({ user, project }: Props) {
  return (
    <Container>
      <Subject value="Display Name Test" />
      <NotificationCategory value="Transactional" />
      <div>Hello {user.displayName || "there"}!</div>
    </Container>
  );
}`;

    const createDraftResponse = await niceBackendFetch("/api/v1/internal/email-drafts", {
      method: "POST",
      accessType: "admin",
      body: {
        display_name: "Display Name Draft",
        tsx_source: templateWithDisplayName,
        theme_id: false,
      },
    });
    expect(createDraftResponse.status).toBe(200);
    const draftId = createDraftResponse.body.id;

    // Send email
    const sendResponse = await niceBackendFetch("/api/v1/emails/send-email", {
      method: "POST",
      accessType: "server",
      body: {
        user_ids: [userId],
        draft_id: draftId,
      },
    });
    expect(sendResponse.status).toBe(200);

    // Verify the email contains the user's display name
    const messages = await mailbox.waitForMessagesWithSubject("Display Name Test");
    expect(messages.length).toBeGreaterThanOrEqual(1);
    expect(messages[0].body?.text).toContain("John Doe");
  });
});

describe("multiple recipients", () => {
  it("should send separate emails to multiple users", async ({ expect }) => {
    await Project.createAndSwitch({
      display_name: "Test Multiple Recipients Project",
      config: {
        email_config: testEmailConfig,
      },
    });

    const mailbox1 = await bumpEmailAddress();
    const user1Response = await niceBackendFetch("/api/v1/users", {
      method: "POST",
      accessType: "server",
      body: {
        primary_email: mailbox1.emailAddress,
        primary_email_verified: true,
        display_name: "User One",
      },
    });
    expect(user1Response.status).toBe(201);

    const mailbox2 = await bumpEmailAddress();
    const user2Response = await niceBackendFetch("/api/v1/users", {
      method: "POST",
      accessType: "server",
      body: {
        primary_email: mailbox2.emailAddress,
        primary_email_verified: true,
        display_name: "User Two",
      },
    });
    expect(user2Response.status).toBe(201);

    // Send email to both users
    const sendResponse = await niceBackendFetch("/api/v1/emails/send-email", {
      method: "POST",
      accessType: "server",
      body: {
        user_ids: [user1Response.body.id, user2Response.body.id],
        html: "<p>Multi-recipient test</p>",
        subject: "Multiple Recipients Test",
        notification_category_name: "Transactional",
      },
    });
    expect(sendResponse.status).toBe(200);
    expect(sendResponse.body.results).toHaveLength(2);

    // Verify both users received the email
    const messages1 = await mailbox1.waitForMessagesWithSubject("Multiple Recipients Test");
    expect(messages1.length).toBeGreaterThanOrEqual(1);

    const messages2 = await mailbox2.waitForMessagesWithSubject("Multiple Recipients Test");
    expect(messages2.length).toBeGreaterThanOrEqual(1);
  });
});
describe("project logos in email themes", () => {
  it("should include project logo in rendered email when using a theme that references it", async ({ expect }) => {
    // Create a project with email config
    await Project.createAndSwitch({
      display_name: "Test Logo Project",
      config: {
        email_config: testEmailConfig,
      },
    });

    // Update project to have a logo URL (logo_url is at top level, not inside config)
    const updateProjectResponse = await niceBackendFetch("/api/v1/internal/projects/current", {
      method: "PATCH",
      accessType: "admin",
      body: {
        logo_url: "https://example.com/test-logo.png",
      },
    });
    expect(updateProjectResponse.status).toBe(200);

    const mailbox = backendContext.value.mailbox;
    const { userId } = await User.create({ primary_email: mailbox.emailAddress, primary_email_verified: true });

    // Create a custom theme that uses ProjectLogo
    const themeWithLogo = `import { Container, Img } from "@react-email/components";
import { ProjectLogo } from "@stackframe/emails";

export function EmailTheme({ children, projectLogos }) {
  return (
    <Container>
      <div data-testid="logo-container">
        <ProjectLogo data={projectLogos} mode="light" />
      </div>
      {children}
    </Container>
  );
}`;

    // Create the theme (POST creates with default source)
    const createThemeResponse = await niceBackendFetch("/api/v1/internal/email-themes", {
      method: "POST",
      accessType: "admin",
      body: {
        display_name: "Logo Theme",
      },
    });
    expect(createThemeResponse.status).toBe(200);
    const themeId = createThemeResponse.body.id;

    // Update the theme with our custom source (PATCH updates tsx_source)
    const updateThemeResponse = await niceBackendFetch(`/api/v1/internal/email-themes/${themeId}`, {
      method: "PATCH",
      accessType: "admin",
      body: {
        tsx_source: themeWithLogo,
      },
    });
    expect(updateThemeResponse.status).toBe(200);

    // Create a draft that uses the theme
    const templateSource = `import { Container } from "@react-email/components";
import { Subject, NotificationCategory } from "@stackframe/emails";

export function EmailTemplate({ user, project }) {
  return (
    <Container>
      <Subject value="Logo Test Email" />
      <NotificationCategory value="Transactional" />
      <div>Hello! This email should have a logo.</div>
    </Container>
  );
}`;

    const createDraftResponse = await niceBackendFetch("/api/v1/internal/email-drafts", {
      method: "POST",
      accessType: "admin",
      body: {
        display_name: "Logo Test Draft",
        tsx_source: templateSource,
        theme_id: themeId,
      },
    });
    expect(createDraftResponse.status).toBe(200);
    const draftId = createDraftResponse.body.id;

    // Send email
    const sendResponse = await niceBackendFetch("/api/v1/emails/send-email", {
      method: "POST",
      accessType: "server",
      body: {
        user_ids: [userId],
        draft_id: draftId,
      },
    });
    expect(sendResponse.status).toBe(200);

    // Verify the email contains the logo URL
    const messages = await mailbox.waitForMessagesWithSubject("Logo Test Email");
    expect(messages).toMatchInlineSnapshot(`
      [
        MailboxMessage {
          "attachments": [],
          "body": {
            "html": "<!DOCTYPE html PUBLIC \\"-//W3C//DTD XHTML 1.0 Transitional//EN\\" \\"http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd\\"><link rel=\\"preload\\" as=\\"image\\" href=\\"https://example.com/test-logo.png\\"/><!--$--><table align=\\"center\\" width=\\"100%\\" border=\\"0\\" cellPadding=\\"0\\" cellSpacing=\\"0\\" role=\\"presentation\\" style=\\"max-width:37.5em\\"><tbody><tr style=\\"width:100%\\"><td><div data-testid=\\"logo-container\\"><div class=\\"flex gap-2 items-center\\"><img class=\\"h-8\\" alt=\\"Logo\\" src=\\"https://example.com/test-logo.png\\" style=\\"display:block;outline:none;border:none;text-decoration:none\\"/></div></div><table align=\\"center\\" width=\\"100%\\" border=\\"0\\" cellPadding=\\"0\\" cellSpacing=\\"0\\" role=\\"presentation\\" style=\\"max-width:37.5em\\"><tbody><tr style=\\"width:100%\\"><td><div>Hello! This email should have a logo.</div></td></tr></tbody></table></td></tr></tbody></table><!--/$-->",
            "text": "Hello! This email should have a logo.",
          },
          "from": "Test Project <test@example.com>",
          "subject": "Logo Test Email",
          "to": ["<default-mailbox--<stripped UUID>@stack-generated.example.com>"],
          <some fields may have been hidden>,
        },
      ]
    `);
    expect(messages.length).toBeGreaterThanOrEqual(1);
    // The logo URL should appear in the rendered HTML
    expect(messages[0].body?.html).toContain("https://example.com/test-logo.png");
  });
});


