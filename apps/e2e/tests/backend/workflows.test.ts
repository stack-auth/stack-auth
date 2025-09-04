import { wait } from "@stackframe/stack-shared/dist/utils/promises";
import { Mailbox, test } from "../helpers";
import { Auth, InternalApiKey, Project, bumpEmailAddress, createMailbox, niceBackendFetch } from "./backend-helpers";

async function configureEmailAndWorkflow(workflowId: string, tsSource: string, enabled = true) {
  await Project.updateConfig({
    emails: {
      server: {
        isShared: false,
        host: "localhost",
        port: 2500,
        username: "test",
        password: "test",
        senderEmail: "test@example.com",
        senderName: "Test Project",
      },
    },
    workflows: {
      availableWorkflows: {
        [workflowId]: {
          displayName: workflowId,
          tsSource,
          enabled,
        },
      },
    },
  });
}

const waitRetries = 25;

async function waitForMailboxSubject(mailbox: Mailbox, subject: string) {
  for (let i = 0; i < waitRetries; i++) {
    const messages = await mailbox.fetchMessages();
    const message = messages.find((m) => m.subject === subject);
    if (message) return;
    await wait(1_000);
  }
  throw new Error(`Message with subject ${subject} not found after ${waitRetries} tries`);
}

async function waitForServerMetadataNotNull(userId: string, key: string) {
  for (let i = 0; i < waitRetries; i++) {
    const user = await niceBackendFetch(`/api/v1/users/${userId}`, { accessType: "server" });
    if (user.body.server_metadata?.[key]) return;
    await wait(1_000);
  }
  throw new Error(`Server metadata for user ${userId} with key ${key} not found after ${waitRetries} tries`);
}

test("onSignUp workflow sends email for client sign-up", async ({ expect }) => {
  await Project.createAndSwitch();
  await InternalApiKey.createAndSetProjectKeys();
  const mailbox = await bumpEmailAddress({ unindexed: true });
  const subject = `WF client signup ${crypto.randomUUID()}`;

  await configureEmailAndWorkflow("wf-email", `
    onSignUp(async (user) => {
      await stackApp.sendEmail({ userIds: [user.id], subject: ${JSON.stringify(subject)}, html: "<p>hi</p>" });

      // schedule a callback as an example (we don't actually test whether it executed successfully)
      return scheduleCallback({
        scheduleAt: new Date(Date.now() + 7_000),
        data: { "example": "data" },
        callbackId: "my-callback",
      });
    });

    registerCallback("my-callback", async (data) => {
      console.log("my-callback", data);
    });
  `);

  await Auth.Password.signUpWithEmail({ password: "password" });

  await waitForMailboxSubject(mailbox, subject);

  expect(await mailbox.fetchMessages()).toMatchInlineSnapshot(`
    [
      MailboxMessage {
        "attachments": [],
        "body": {
          "html": "http://localhost:12345/some-callback-url?code=%3Cstripped+query+param%3E",
          "text": "http://localhost:12345/some-callback-url?code=%3Cstripped+query+param%3E",
        },
        "from": "Test Project <test@example.com>",
        "subject": "Verify your email at New Project",
        "to": ["<unindexed-mailbox--<stripped UUID>@stack-generated.example.com>"],
        <some fields may have been hidden>,
      },
      MailboxMessage {
        "attachments": [],
        "body": {
          "html": "<!DOCTYPE html PUBLIC \\"-//W3C//DTD XHTML 1.0 Transitional//EN\\" \\"http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd\\"><html dir=\\"ltr\\" lang=\\"en\\"><head><meta content=\\"text/html; charset=UTF-8\\" http-equiv=\\"Content-Type\\"/><meta name=\\"x-apple-disable-message-reformatting\\"/></head><body style=\\"background-color:rgb(250,251,251);font-family:ui-sans-serif, system-ui, sans-serif, &quot;Apple Color Emoji&quot;, &quot;Segoe UI Emoji&quot;, &quot;Segoe UI Symbol&quot;, &quot;Noto Color Emoji&quot;;font-size:1rem;line-height:1.5rem\\"><!--$--><table align=\\"center\\" width=\\"100%\\" border=\\"0\\" cellPadding=\\"0\\" cellSpacing=\\"0\\" role=\\"presentation\\" style=\\"background-color:rgb(255,255,255);padding:45px;border-radius:0.5rem;max-width:37.5em\\"><tbody><tr style=\\"width:100%\\"><td><div><p>hi</p></div></td></tr></tbody></table><!--7--><!--/$--></body></html>",
          "text": "hi",
        },
        "from": "Test Project <test@example.com>",
        "subject": "WF client signup <stripped UUID>",
        "to": ["<unindexed-mailbox--<stripped UUID>@stack-generated.example.com>"],
        <some fields may have been hidden>,
      },
    ]
  `);
}, {
  timeout: 60_000,
});

test("onSignUp workflow can schedule callbacks", async ({ expect }) => {
  await Project.createAndSwitch();
  await InternalApiKey.createAndSetProjectKeys();
  const mailbox = await bumpEmailAddress({ unindexed: true });
  const subject = `WF client signup ${crypto.randomUUID()}`;

  await configureEmailAndWorkflow("wf-email", `
    onSignUp(async (user) => {
      return scheduleCallback({
        scheduleAt: new Date(Date.now() + 7_000),
        data: { "userId": user.id },
        callbackId: "my-callback",
      });
    });

    registerCallback("my-callback", async (data) => {
      await stackApp.sendEmail({ userIds: [data.userId], subject: ${JSON.stringify(subject)}, html: "<p>hi</p>" });
    });
  `);

  await Auth.Password.signUpWithEmail({ password: "password" });

  // since we wait for the callback, add some extra time
  await wait(10_000);
  await waitForMailboxSubject(mailbox, subject);

  expect(await mailbox.fetchMessages()).toMatchInlineSnapshot(`
    [
      MailboxMessage {
        "attachments": [],
        "body": {
          "html": "http://localhost:12345/some-callback-url?code=%3Cstripped+query+param%3E",
          "text": "http://localhost:12345/some-callback-url?code=%3Cstripped+query+param%3E",
        },
        "from": "Test Project <test@example.com>",
        "subject": "Verify your email at New Project",
        "to": ["<unindexed-mailbox--<stripped UUID>@stack-generated.example.com>"],
        <some fields may have been hidden>,
      },
      MailboxMessage {
        "attachments": [],
        "body": {
          "html": "<!DOCTYPE html PUBLIC \\"-//W3C//DTD XHTML 1.0 Transitional//EN\\" \\"http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd\\"><html dir=\\"ltr\\" lang=\\"en\\"><head><meta content=\\"text/html; charset=UTF-8\\" http-equiv=\\"Content-Type\\"/><meta name=\\"x-apple-disable-message-reformatting\\"/></head><body style=\\"background-color:rgb(250,251,251);font-family:ui-sans-serif, system-ui, sans-serif, &quot;Apple Color Emoji&quot;, &quot;Segoe UI Emoji&quot;, &quot;Segoe UI Symbol&quot;, &quot;Noto Color Emoji&quot;;font-size:1rem;line-height:1.5rem\\"><!--$--><table align=\\"center\\" width=\\"100%\\" border=\\"0\\" cellPadding=\\"0\\" cellSpacing=\\"0\\" role=\\"presentation\\" style=\\"background-color:rgb(255,255,255);padding:45px;border-radius:0.5rem;max-width:37.5em\\"><tbody><tr style=\\"width:100%\\"><td><div><p>hi</p></div></td></tr></tbody></table><!--7--><!--/$--></body></html>",
          "text": "hi",
        },
        "from": "Test Project <test@example.com>",
        "subject": "WF client signup <stripped UUID>",
        "to": ["<unindexed-mailbox--<stripped UUID>@stack-generated.example.com>"],
        <some fields may have been hidden>,
      },
    ]
  `);
}, {
  timeout: 60_000,
});

test("onSignUp workflow sends email for server-created user", async ({ expect }) => {
  await Project.createAndSwitch();
  await InternalApiKey.createAndSetProjectKeys();

  const mailbox = createMailbox(`wf-server-${crypto.randomUUID()}@stack-generated.example.com`);
  const subject = `WF server create ${crypto.randomUUID()}`;

  await configureEmailAndWorkflow("wf-email-server", `
    onSignUp(async (user) => {
      await stackApp.sendEmail({ userIds: [user.id], subject: ${JSON.stringify(subject)}, html: "<p>server</p>" });
    });
  `);

  const createUserRes = await niceBackendFetch("/api/v1/users", {
    method: "POST",
    accessType: "server",
    body: {
      primary_email: mailbox.emailAddress,
      primary_email_verified: true,
    },
  });
  expect(createUserRes.status).toBe(201);

  await waitForMailboxSubject(mailbox, subject);
  expect(await mailbox.fetchMessages()).toMatchInlineSnapshot(`
    [
      MailboxMessage {
        "attachments": [],
        "body": {
          "html": "<!DOCTYPE html PUBLIC \\"-//W3C//DTD XHTML 1.0 Transitional//EN\\" \\"http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd\\"><html dir=\\"ltr\\" lang=\\"en\\"><head><meta content=\\"text/html; charset=UTF-8\\" http-equiv=\\"Content-Type\\"/><meta name=\\"x-apple-disable-message-reformatting\\"/></head><body style=\\"background-color:rgb(250,251,251);font-family:ui-sans-serif, system-ui, sans-serif, &quot;Apple Color Emoji&quot;, &quot;Segoe UI Emoji&quot;, &quot;Segoe UI Symbol&quot;, &quot;Noto Color Emoji&quot;;font-size:1rem;line-height:1.5rem\\"><!--$--><table align=\\"center\\" width=\\"100%\\" border=\\"0\\" cellPadding=\\"0\\" cellSpacing=\\"0\\" role=\\"presentation\\" style=\\"background-color:rgb(255,255,255);padding:45px;border-radius:0.5rem;max-width:37.5em\\"><tbody><tr style=\\"width:100%\\"><td><div><p>server</p></div></td></tr></tbody></table><!--7--><!--/$--></body></html>",
          "text": "server",
        },
        "from": "Test Project <test@example.com>",
        "subject": "WF server create <stripped UUID>",
        "to": ["<wf-server-<stripped UUID>@stack-generated.example.com>"],
        <some fields may have been hidden>,
      },
    ]
  `);
}, {
  timeout: 60_000,
});

test("disabled workflows do not trigger", async ({ expect }) => {
  await Project.createAndSwitch();
  await InternalApiKey.createAndSetProjectKeys();
  const mailbox = await bumpEmailAddress({ unindexed: true });
  const subject = `WF disabled ${crypto.randomUUID()}`;

  await configureEmailAndWorkflow("wf-disabled", `
    onSignUp(async (user) => {
      await stackApp.sendEmail({ userIds: [user.id], subject: ${JSON.stringify(subject)}, html: "<p>nope</p>" });
    });
  `, /* enabled */ false);

  await Auth.Password.signUpWithEmail({ password: "password" });

  await wait(waitRetries * 1_000 * 1.3);
  await Auth.refreshAccessToken();

  expect(await mailbox.fetchMessages()).toMatchInlineSnapshot(`
    [
      MailboxMessage {
        "attachments": [],
        "body": {
          "html": "http://localhost:12345/some-callback-url?code=%3Cstripped+query+param%3E",
          "text": "http://localhost:12345/some-callback-url?code=%3Cstripped+query+param%3E",
        },
        "from": "Test Project <test@example.com>",
        "subject": "Verify your email at New Project",
        "to": ["<unindexed-mailbox--<stripped UUID>@stack-generated.example.com>"],
        <some fields may have been hidden>,
      },
    ]
  `);
}, {
  timeout: 90_000,
});

test("compile/runtime errors in one workflow don't block others", async ({ expect }) => {
  await Project.createAndSwitch();
  await InternalApiKey.createAndSetProjectKeys();
  const mailbox = await bumpEmailAddress({ unindexed: true });
  const subject = `WF ok ${crypto.randomUUID()}`;

  // bad compile
  await configureEmailAndWorkflow("wf-bad-compile", `return return`);
  // bad runtime
  await configureEmailAndWorkflow("wf-bad-runtime", `onSignUp(() => { throw new Error('boom') });`);
  // good one
  await configureEmailAndWorkflow("wf-good", `
    onSignUp(async (user) => {
      await stackApp.sendEmail({ userIds: [user.id], subject: ${JSON.stringify(subject)}, html: "<p>ok</p>" });
    });
  `);

  await Auth.Password.signUpWithEmail({ password: "password" });

  await waitForMailboxSubject(mailbox, subject);
  expect(await mailbox.fetchMessages()).toMatchInlineSnapshot(`
    [
      MailboxMessage {
        "attachments": [],
        "body": {
          "html": "http://localhost:12345/some-callback-url?code=%3Cstripped+query+param%3E",
          "text": "http://localhost:12345/some-callback-url?code=%3Cstripped+query+param%3E",
        },
        "from": "Test Project <test@example.com>",
        "subject": "Verify your email at New Project",
        "to": ["<unindexed-mailbox--<stripped UUID>@stack-generated.example.com>"],
        <some fields may have been hidden>,
      },
      MailboxMessage {
        "attachments": [],
        "body": {
          "html": "<!DOCTYPE html PUBLIC \\"-//W3C//DTD XHTML 1.0 Transitional//EN\\" \\"http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd\\"><html dir=\\"ltr\\" lang=\\"en\\"><head><meta content=\\"text/html; charset=UTF-8\\" http-equiv=\\"Content-Type\\"/><meta name=\\"x-apple-disable-message-reformatting\\"/></head><body style=\\"background-color:rgb(250,251,251);font-family:ui-sans-serif, system-ui, sans-serif, &quot;Apple Color Emoji&quot;, &quot;Segoe UI Emoji&quot;, &quot;Segoe UI Symbol&quot;, &quot;Noto Color Emoji&quot;;font-size:1rem;line-height:1.5rem\\"><!--$--><table align=\\"center\\" width=\\"100%\\" border=\\"0\\" cellPadding=\\"0\\" cellSpacing=\\"0\\" role=\\"presentation\\" style=\\"background-color:rgb(255,255,255);padding:45px;border-radius:0.5rem;max-width:37.5em\\"><tbody><tr style=\\"width:100%\\"><td><div><p>ok</p></div></td></tr></tbody></table><!--7--><!--/$--></body></html>",
          "text": "ok",
        },
        "from": "Test Project <test@example.com>",
        "subject": "WF ok <stripped UUID>",
        "to": ["<unindexed-mailbox--<stripped UUID>@stack-generated.example.com>"],
        <some fields may have been hidden>,
      },
    ]
  `);
}, {
  timeout: 60_000,
});

test("anonymous sign-up does not trigger; upgrade triggers workflow", async ({ expect }) => {
  await Project.createAndSwitch();
  await InternalApiKey.createAndSetProjectKeys();
  const markerKey = `wfMarker-${crypto.randomUUID()}`;

  await Project.updateConfig({
    workflows: {
      availableWorkflows: {
        "wf-anon-upgrade": {
          displayName: "wf-anon-upgrade",
          enabled: true,
          tsSource: `onSignUp(async (user) => { await user.update({ serverMetadata: { ${JSON.stringify(markerKey)}: user.primaryEmail } }); });`,
        },
      },
    },
  });

  // create anonymous session/user
  const { userId: anonUserId } = await Auth.Anonymous.signUp();

  // ensure marker not present yet
  await wait(waitRetries * 1_000 * 1.3);
  await Auth.refreshAccessToken();
  const me1 = await niceBackendFetch("/api/v1/users/me", { accessType: "client" });
  expect(me1.body.server_metadata?.[markerKey]).toBeUndefined();

  // upgrade via password sign-up
  const { userId } = await Auth.Password.signUpWithEmail({ password: "password" });
  expect(userId).toEqual(anonUserId);

  await waitForServerMetadataNotNull(anonUserId, markerKey);
  const me2 = await niceBackendFetch("/api/v1/users/me", { accessType: "server" });
  expect(me2.body.is_anonymous).toBe(false);
  expect(me2.body.server_metadata?.[markerKey]).toBe(me2.body.primary_email);
}, {
  timeout: 90_000,
});

test("workflow source changes take effect for subsequent sign-ups", async ({ expect }) => {
  await Project.createAndSwitch();
  await InternalApiKey.createAndSetProjectKeys();
  const markerKey = `versionMarker-${crypto.randomUUID()}`;

  // v1
  await Project.updateConfig({
    workflows: {
      availableWorkflows: {
        "wf-versioned": {
          displayName: "wf-versioned",
          enabled: true,
          tsSource: `onSignUp(async (user) => { await user.update({ serverMetadata: { ${JSON.stringify(markerKey)}: "v1" } }); });`,
        },
      },
    },
  });
  await bumpEmailAddress({ unindexed: true });
  await Auth.Password.signUpWithEmail({ password: "password" });
  await waitForServerMetadataNotNull("me", markerKey);
  const me1 = await niceBackendFetch("/api/v1/users/me", { accessType: "server" });
  expect(me1.body.server_metadata?.[markerKey]).toBe("v1");

  // v2
  await Project.updateConfig({
    workflows: {
      availableWorkflows: {
        "wf-versioned": {
          displayName: "wf-versioned",
          enabled: true,
          tsSource: `onSignUp(async (user) => { await user.update({ serverMetadata: { ${JSON.stringify(markerKey)}: "v2" } }); });`,
        },
      },
    },
  });
  await bumpEmailAddress({ unindexed: true });
  await Auth.Password.signUpWithEmail({ password: "password" });
  await waitForServerMetadataNotNull("me", markerKey);
  const me2 = await niceBackendFetch("/api/v1/users/me", { accessType: "server" });
  expect(me2.body.server_metadata?.[markerKey]).toBe("v2");
}, {
  timeout: 90_000,
});
