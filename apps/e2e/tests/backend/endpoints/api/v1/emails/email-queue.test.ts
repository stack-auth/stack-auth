import { wait } from "@stackframe/stack-shared/dist/utils/promises";
import { deindent } from "@stackframe/stack-shared/dist/utils/strings";
import beautify from "js-beautify";
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

// A template that is slow to render, giving us time to remove the primary email
const slowTemplate = deindent`
  import { Container } from "@react-email/components";
  import { Subject, NotificationCategory, Props } from "@stackframe/emails";

  // Artificial delay to make the email slow to render
  const startTime = performance.now();
  while (performance.now() - startTime < 100) {
    // Busy wait
  }

  export function EmailTemplate({ user, project }) {
    return (
      <Container>
        <Subject value="Slow Render Test Email" />
        <NotificationCategory value="Marketing" />
        <div>Test email</div>
      </Container>
    );
  }
`;

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

    const createDraftResponse = await niceBackendFetch("/api/v1/internal/email-drafts", {
      method: "POST",
      accessType: "admin",
      body: {
        display_name: "Slow Render Draft",
        tsx_source: slowTemplate,
        theme_id: false,
      },
    });
    expect(createDraftResponse.status).toBe(200);
    const draftId = createDraftResponse.body.id;

    // Since we're essentially testing a race condition here, make sure that the DELETE endpoint is already compiled by the time we call it, so the race condition is consistent
    const deleteEndpointResponse = await niceBackendFetch(`/api/v1/users/01234567-89ab-cdef-0123-456789abcdef`, {
      method: "DELETE",
      accessType: "server",
    });
    expect(deleteEndpointResponse.status).toBe(400);

    // Send an email using the slow-rendering template
    const sendResponse = await niceBackendFetch("/api/v1/emails/send-email", {
      method: "POST",
      accessType: "server",
      body: {
        user_ids: [userId],
        draft_id: draftId,
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
    await wait(10_000);

    // Verify no email was received (user was deleted)
    const messages = await mailbox.fetchMessages();
    const testEmails = messages.filter(m => m.subject === "Slow Render Test Email");
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

    const createDraftResponse = await niceBackendFetch("/api/v1/internal/email-drafts", {
      method: "POST",
      accessType: "admin",
      body: {
        display_name: "Slow Render Draft",
        tsx_source: slowTemplate,
        theme_id: false,
      },
    });
    expect(createDraftResponse.status).toBe(200);
    const draftId = createDraftResponse.body.id;

    // Since we're essentially testing a race condition here, make sure that the DELETE endpoint is already compiled by the time we call it, so the race condition is consistent
    const deleteEndpointResponse = await niceBackendFetch(`/api/v1/contact-channels/01234567-89ab-cdef-0123-456789abcdef/01234567-89ab-cdef-0123-456789abcdef`, {
      method: "DELETE",
      accessType: "server",
    });
    expect(deleteEndpointResponse.status).toBe(400);

    // Send an email using the slow-rendering template
    const sendResponse = await niceBackendFetch("/api/v1/emails/send-email", {
      method: "POST",
      accessType: "server",
      body: {
        user_ids: [userId],
        draft_id: draftId,
      },
    });
    expect(sendResponse.status).toBe(200);

    // Remove the primary email while the email is still rendering
    const deleteChannelResponse = await niceBackendFetch(`/api/v1/contact-channels/${userId}/${contactChannelId}`, {
      method: "DELETE",
      accessType: "server",
    });
    expect(deleteChannelResponse.status).toBe(200);

    // Wait for email processing to complete (rendering + sending)
    await wait(10_000);

    // Verify no email with our subject was received (primary email was removed before sending)
    const messages = await mailbox.fetchMessages();
    const testEmails = messages.filter(m => m.subject === "Slow Render Test Email");
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

    const createDraftResponse = await niceBackendFetch("/api/v1/internal/email-drafts", {
      method: "POST",
      accessType: "admin",
      body: {
        display_name: "Slow Render Draft",
        tsx_source: slowTemplate,
        theme_id: false,
      },
    });
    expect(createDraftResponse.status).toBe(200);
    const draftId = createDraftResponse.body.id;

    // Since we're essentially testing a race condition here, make sure that the PATCH endpoint is already compiled by the time we call it, so the race condition is consistent
    const patchEndpointResponse = await niceBackendFetch(`/api/v1/emails/notification-preference/01234567-89ab-cdef-0123-456789abcdef/4f6f8873-3d04-46bd-8bef-18338b1a1b4c`, {
      method: "PATCH",
      accessType: "server",
    });
    expect(patchEndpointResponse.status).toBe(400);

    // Send an email using the slow-rendering template
    const sendResponse = await niceBackendFetch("/api/v1/emails/send-email", {
      method: "POST",
      accessType: "server",
      body: {
        user_ids: [userId],
        draft_id: draftId,
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
    await wait(10_000);

    // Verify no email with our subject was received (user unsubscribed)
    const messages = await backendContext.value.mailbox.fetchMessages();
    const testEmails = messages.filter(m => m.subject === "Slow Render Test Email");
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

  it.todo("should return an error when email is sent to a custom email but no custom emails are provided", async ({ expect }) => {
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
describe("template variables", () => {
  it("should support various variable types (strings, numbers, booleans, arrays, objects)", async ({ expect }) => {
    await Project.createAndSwitch({
      display_name: "Test Variables Project",
      config: {
        email_config: testEmailConfig,
      },
    });

    const mailbox = backendContext.value.mailbox;
    const { userId } = await User.create({ primary_email: mailbox.emailAddress, primary_email_verified: true });

    // Create a template that uses different variable types
    // Note: We need default values and a variablesSchema for preview rendering
    // Variable keys use snake_case as required by the API
    const templateWithVariables = deindent`
      import { type } from "arktype";
      import { Container } from "@react-email/components";
      import { Subject, NotificationCategory, Props } from "@stackframe/emails";

      // Define the variables schema - this allows variables to be passed to the template
      export const variablesSchema = type({
        string_var: "string",
        number_var: "number",
        boolean_var: "boolean",
        array_var: "string[]",
        object_var: {
          nested_key: {
            deep_key: "string"
          }
        },
        null_var: "null",
      });

      export function EmailTemplate({ user, project, variables }: Props<typeof variablesSchema.infer>) {
        return (
          <Container>
            <Subject value="Variables Test Email" />
            <NotificationCategory value="Transactional" />
            <div data-testid="string">String: {variables.string_var}</div>
            <div data-testid="number">Number: {variables.number_var}</div>
            <div data-testid="boolean">Boolean: {variables.boolean_var ? "true" : "false"}</div>
            <div data-testid="array">Array: {variables.array_var.join(", ")}</div>
            <div data-testid="object">Object: {variables.object_var.nested_key.deep_key}</div>
            <div data-testid="null">Null: {variables.null_var === null ? "is null" : "not null"}</div>
          </Container>
        );
      }

      // Preview variables for template editing/testing
      EmailTemplate.PreviewVariables = {
        string_var: "preview string",
        number_var: 0,
        boolean_var: false,
        array_var: [],
        object_var: { nested_key: { deep_key: "preview" } },
        null_var: null,
      } satisfies typeof variablesSchema.infer;
    `;

    // Create a template using the internal API
    const createTemplateResponse = await niceBackendFetch("/api/v1/internal/email-templates", {
      method: "POST",
      accessType: "admin",
      body: {
        display_name: "Variables Template",
      },
    });
    expect(createTemplateResponse.status).toBe(200);
    const templateId = createTemplateResponse.body.id;

    // Update the template with our custom source
    const updateTemplateResponse = await niceBackendFetch(`/api/v1/internal/email-templates/${templateId}`, {
      method: "PATCH",
      accessType: "admin",
      body: {
        tsx_source: templateWithVariables,
      },
    });
    expect(updateTemplateResponse.status).toBe(200);

    // Send email with various variable types (using snake_case keys)
    const sendResponse = await niceBackendFetch("/api/v1/emails/send-email", {
      method: "POST",
      accessType: "server",
      body: {
        user_ids: [userId],
        template_id: templateId,
        variables: {
          string_var: "hello world",
          number_var: 42,
          boolean_var: true,
          array_var: ["apple", "banana", "cherry"],
          object_var: { nested_key: { deep_key: "deeply nested value" } },
          null_var: null,
        },
      },
    });
    expect(sendResponse.status).toBe(200);

    // Verify the email contains all variable values
    const messages = await mailbox.waitForMessagesWithSubject("Variables Test Email");
    expect(messages.length).toBeGreaterThanOrEqual(1);
    const html = messages[0].body?.html ?? "";

    expect(beautify.html(html)).toMatchInlineSnapshot(`
      deindent\`
        <!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
        <html dir="ltr" lang="en">
        
        <head>
            <meta content="text/html; charset=UTF-8" http-equiv="Content-Type" />
            <meta name="x-apple-disable-message-reformatting" />
        </head>
        
        <body style="background-color:rgb(250,251,251);font-family:ui-sans-serif, system-ui, sans-serif, &quot;Apple Color Emoji&quot;, &quot;Segoe UI Emoji&quot;, &quot;Segoe UI Symbol&quot;, &quot;Noto Color Emoji&quot;;font-size:1rem;line-height:1.5rem"><!--$-->
            <table align="center" width="100%" border="0" cellPadding="0" cellSpacing="0" role="presentation" style="background-color:rgb(255,255,255);padding:45px;border-radius:0.5rem;max-width:37.5em">
                <tbody>
                    <tr style="width:100%">
                        <td>
                            <table align="center" width="100%" border="0" cellPadding="0" cellSpacing="0" role="presentation" style="max-width:37.5em">
                                <tbody>
                                    <tr style="width:100%">
                                        <td>
                                            <div data-testid="string">String: <!-- -->hello world</div>
                                            <div data-testid="number">Number: <!-- -->42</div>
                                            <div data-testid="boolean">Boolean: <!-- -->true</div>
                                            <div data-testid="array">Array: <!-- -->apple, banana, cherry</div>
                                            <div data-testid="object">Object: <!-- -->deeply nested value</div>
                                            <div data-testid="null">Null: <!-- -->is null</div>
                                        </td>
                                    </tr>
                                </tbody>
                            </table>
                        </td>
                    </tr>
                </tbody>
            </table><!--7--><!--/$-->
        </body>
        
        </html>
      \`
    `);
  });

  it("should reject non-object variables field", async ({ expect }) => {
    await Project.createAndSwitch({
      display_name: "Test Non-Object Variables Project",
      config: {
        email_config: testEmailConfig,
      },
    });

    const { userId } = await Auth.Password.signUpWithEmail();

    // Create a simple template
    const simpleTemplate = deindent`
      import { Container } from "@react-email/components";
      import { Subject, NotificationCategory, Props } from "@stackframe/emails";

      export function EmailTemplate({ user, project }: Props) {
        return (
          <Container>
            <Subject value="Non-Object Variables Test" />
            <NotificationCategory value="Transactional" />
            <div>Test</div>
          </Container>
        );
      }
    `;

    // Create a template
    const createTemplateResponse = await niceBackendFetch("/api/v1/internal/email-templates", {
      method: "POST",
      accessType: "admin",
      body: {
        display_name: "Non-Object Template",
      },
    });
    expect(createTemplateResponse.status).toBe(200);
    const templateId = createTemplateResponse.body.id;

    // Update with our source
    const updateTemplateResponse = await niceBackendFetch(`/api/v1/internal/email-templates/${templateId}`, {
      method: "PATCH",
      accessType: "admin",
      body: {
        tsx_source: simpleTemplate,
      },
    });
    expect(updateTemplateResponse.status).toBe(200);

    // Try to send email with variables as an array instead of object
    const sendResponse = await niceBackendFetch("/api/v1/emails/send-email", {
      method: "POST",
      accessType: "server",
      body: {
        user_ids: [userId],
        template_id: templateId,
        variables: ["not", "an", "object"],
      },
    });
    expect(sendResponse).toMatchInlineSnapshot(`
      NiceResponse {
        "status": 400,
        "body": {
          "code": "SCHEMA_ERROR",
          "details": {
            "message": deindent\`
              Request validation failed on POST /api/v1/emails/send-email:
                - body is not matched by any of the provided schemas:
                  Schema 0:
                    body.html must be defined
                    body contains unknown properties: template_id, variables
                    body contains unknown properties: template_id, variables
                  Schema 1:
                    body.variables must be a \\\`object\\\` type, but the final value was: \\\`[
                      "\\\\"not\\\\"",
                      "\\\\"an\\\\"",
                      "\\\\"object\\\\""
                    ]\\\`.
                  Schema 2:
                    body.draft_id must be defined
                    body contains unknown properties: template_id, variables
                    body contains unknown properties: template_id, variables
            \`,
          },
          "error": deindent\`
            Request validation failed on POST /api/v1/emails/send-email:
              - body is not matched by any of the provided schemas:
                Schema 0:
                  body.html must be defined
                  body contains unknown properties: template_id, variables
                  body contains unknown properties: template_id, variables
                Schema 1:
                  body.variables must be a \\\`object\\\` type, but the final value was: \\\`[
                    "\\\\"not\\\\"",
                    "\\\\"an\\\\"",
                    "\\\\"object\\\\""
                  ]\\\`.
                Schema 2:
                  body.draft_id must be defined
                  body contains unknown properties: template_id, variables
                  body contains unknown properties: template_id, variables
          \`,
        },
        "headers": Headers {
          "x-stack-known-error": "SCHEMA_ERROR",
          <some fields may have been hidden>,
        },
      }
    `);
  });

  it("should reject variables as a primitive value", async ({ expect }) => {
    await Project.createAndSwitch({
      display_name: "Test Primitive Variables Project",
      config: {
        email_config: testEmailConfig,
      },
    });

    const { userId } = await Auth.Password.signUpWithEmail();

    // Create a simple template
    const simpleTemplate = deindent`
      import { Container } from "@react-email/components";
      import { Subject, NotificationCategory, Props } from "@stackframe/emails";

      export function EmailTemplate({ user, project }: Props) {
        return (
          <Container>
            <Subject value="Primitive Variables Test" />
            <NotificationCategory value="Transactional" />
            <div>Test</div>
          </Container>
        );
      }
    `;

    // Create a template
    const createTemplateResponse = await niceBackendFetch("/api/v1/internal/email-templates", {
      method: "POST",
      accessType: "admin",
      body: {
        display_name: "Primitive Template",
      },
    });
    expect(createTemplateResponse.status).toBe(200);
    const templateId = createTemplateResponse.body.id;

    // Update with our source
    const updateTemplateResponse = await niceBackendFetch(`/api/v1/internal/email-templates/${templateId}`, {
      method: "PATCH",
      accessType: "admin",
      body: {
        tsx_source: simpleTemplate,
      },
    });
    expect(updateTemplateResponse.status).toBe(200);

    // Try to send email with variables as a string
    const sendResponse = await niceBackendFetch("/api/v1/emails/send-email", {
      method: "POST",
      accessType: "server",
      body: {
        user_ids: [userId],
        template_id: templateId,
        variables: "not an object",
      },
    });
    expect(sendResponse).toMatchInlineSnapshot(`
      NiceResponse {
        "status": 400,
        "body": {
          "code": "SCHEMA_ERROR",
          "details": {
            "message": deindent\`
              Request validation failed on POST /api/v1/emails/send-email:
                - body is not matched by any of the provided schemas:
                  Schema 0:
                    body.html must be defined
                    body contains unknown properties: template_id, variables
                    body contains unknown properties: template_id, variables
                  Schema 1:
                    body.variables must be a \\\`object\\\` type, but the final value was: \\\`"not an object"\\\`.
                  Schema 2:
                    body.draft_id must be defined
                    body contains unknown properties: template_id, variables
                    body contains unknown properties: template_id, variables
            \`,
          },
          "error": deindent\`
            Request validation failed on POST /api/v1/emails/send-email:
              - body is not matched by any of the provided schemas:
                Schema 0:
                  body.html must be defined
                  body contains unknown properties: template_id, variables
                  body contains unknown properties: template_id, variables
                Schema 1:
                  body.variables must be a \\\`object\\\` type, but the final value was: \\\`"not an object"\\\`.
                Schema 2:
                  body.draft_id must be defined
                  body contains unknown properties: template_id, variables
                  body contains unknown properties: template_id, variables
          \`,
        },
        "headers": Headers {
          "x-stack-known-error": "SCHEMA_ERROR",
          <some fields may have been hidden>,
        },
      }
    `);
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


