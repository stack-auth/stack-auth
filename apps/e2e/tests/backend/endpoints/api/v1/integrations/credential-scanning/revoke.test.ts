import { generateSecureRandomString } from "@stackframe/stack-shared/dist/utils/crypto";
import type { MailboxMessage } from "../../../../../../helpers";
import { it } from "../../../../../../helpers";
import { Auth, InternalApiKey, Project, ProjectApiKey, Team, backendContext, bumpEmailAddress, niceBackendFetch } from "../../../../../backend-helpers";

// TODO re-enable these tests when we re-enable credential scanning email notifications

it("should send email notification to user when revoking an API key through credential scanning", async ({ expect }: { expect: any }) => {
  await Project.createAndSwitch({ config: { magic_link_enabled: true, allow_team_api_keys: true, allow_user_api_keys: true } });

  const mailbox2 = await bumpEmailAddress();
  await Auth.Password.signUpWithEmail();
  await Auth.signOut();
  const mailbox1 = await bumpEmailAddress();
  const user1 = await Auth.fastSignUp({ primary_email: mailbox1.emailAddress, primary_email_verified: true });

  // Create a user API key
  const { createUserApiKeyResponse } = await ProjectApiKey.User.create({
    user_id: user1.userId,
    description: "Test API Key to Revoke <HTML Test &>",
    expires_at_millis: null,
  });

  // Verify the API key works initially
  const checkResponseBeforeRevoke = await ProjectApiKey.User.check(createUserApiKeyResponse.body.value);
  expect(checkResponseBeforeRevoke).toMatchInlineSnapshot(`
    {
      "created_at_millis": <stripped field 'created_at_millis'>,
      "description": "Test API Key to Revoke <HTML Test &>",
      "id": "<stripped UUID>",
      "is_public": false,
      "type": "user",
      "user_id": "<stripped UUID>",
      "value": { "last_four": <stripped field 'last_four'> },
    }
  `);

  // Revoke the API key through credential scanning
  const revokeResponse = await niceBackendFetch("/api/v1/integrations/credential-scanning/revoke", {
    method: "POST",
    accessType: "server",
    body: {
      api_key: createUserApiKeyResponse.body.value,
    },
  });

  if (process.env.STACK_TEST_SOURCE_OF_TRUTH === "true") {
    expect(revokeResponse).toMatchInlineSnapshot(`
      NiceResponse {
        "status": 404,
        "body": {
          "code": "API_KEY_NOT_FOUND",
          "error": "API key not found.",
        },
        "headers": Headers {
          "x-stack-known-error": "API_KEY_NOT_FOUND",
          <some fields may have been hidden>,
        },
      }
    `);
  } else {
    expect(revokeResponse).toMatchInlineSnapshot(`
      NiceResponse {
        "status": 200,
        "body": { "success": true },
        "headers": Headers { <some fields may have been hidden> },
      }
    `);

    // Verify the API key is no longer valid
    const checkResponseAfterRevoke = await ProjectApiKey.User.check(createUserApiKeyResponse.body.value);
    expect(checkResponseAfterRevoke).toMatchInlineSnapshot(`
      {
        "code": "API_KEY_REVOKED",
        "error": "API key has been revoked.",
      }
    `);

    // Verify that an email notification was sent
    const messages = await mailbox1.waitForMessagesWithSubject("API Key Revoked");
    expect(messages).toMatchInlineSnapshot(`
      [
        MailboxMessage {
          "attachments": [],
          "body": {
            "html": deindent\`
              <!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd"><html dir="ltr" lang="en"><head></head><body><!--$--><div>
                    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
                      <h2 style="color: #333;">API Key Revoked</h2>
                      <p style="color: #555; font-size: 16px; line-height: 1.5;">
                        Your API key "Test API Key to Revoke &lt;HTML Test &amp;&gt;" for New Project has been automatically revoked because it was found in a public repository.
                      </p>
                      <p style="color: #555; font-size: 16px; line-height: 1.5;">
                        This is an automated security measure to protect your api keys from being leaked. If you believe this was a mistake, please contact support.
                      </p>
                      <p style="color: #555; font-size: 16px; line-height: 1.5;">
                        Please create a new API key if needed.
                      </p>
                    </div>
                  </div><!--3--><!--/$--></body></html>
            \`,
            "text": deindent\`
              API KEY REVOKED
              
              Your API key "Test API Key to Revoke <HTML Test &>" for New Project has been
              automatically revoked because it was found in a public repository.
              
              This is an automated security measure to protect your api keys from being
              leaked. If you believe this was a mistake, please contact support.
              
              Please create a new API key if needed.
            \`,
          },
          "from": "New Project <noreply@example.com>",
          "subject": "API Key Revoked: Test API Key to Revoke <HTML Test &>",
          "to": ["<mailbox-2--<stripped UUID>@stack-generated.example.com>"],
          <some fields may have been hidden>,
        },
      ]
    `);


    // Verify second user did not receive the email
    const messages2 = (await mailbox2.fetchMessages({ noBody: true })).filter((m: MailboxMessage) => m.subject.includes("API Key Revoked"));
    expect(messages2).toMatchInlineSnapshot(`[]`);
  }
});

it("should send email notification to team members when revoking a team API key through credential scanning", async ({ expect }: { expect: any }) => {
  await Project.createAndSwitch({ config: { magic_link_enabled: true, allow_team_api_keys: true, allow_user_api_keys: true } });

  // this test may run longer than the admin access token is valid for, so let's create API keys
  await InternalApiKey.createAndSetProjectKeys();

  const mailbox2 = await bumpEmailAddress();
  const user2 = await Auth.Password.signUpWithEmail();
  await Auth.signOut();
  const mailbox3 = await bumpEmailAddress();
  const user3 = await Auth.Password.signUpWithEmail();
  await Auth.signOut();
  const mailbox1 = await bumpEmailAddress();
  const user1 = await Auth.Password.signUpWithEmail();

  // Create a team and add all users
  const { teamId } = await Team.create();

  await Team.addMember(teamId, user1.userId);
  await Team.addMember(teamId, user2.userId);
  await Team.addMember(teamId, user3.userId);

  await Team.addPermission(teamId, user1.userId, "$manage_api_keys");
  await Team.addPermission(teamId, user2.userId, "$manage_api_keys");
  // we do not give user3 the permission to manage api keys


  const { createTeamApiKeyResponse } = await ProjectApiKey.Team.create({
    team_id: teamId,
    description: "Test Team API Key to Revoke",
    expires_at_millis: null,
  });

  // Verify the API key works initially
  const checkResponseBeforeRevoke = await ProjectApiKey.Team.check(createTeamApiKeyResponse.body.value);
    expect(checkResponseBeforeRevoke).toMatchInlineSnapshot(`
    {
      "created_at_millis": <stripped field 'created_at_millis'>,
      "description": "Test Team API Key to Revoke",
      "id": "<stripped UUID>",
      "is_public": false,
      "team_id": "<stripped UUID>",
      "type": "team",
      "value": { "last_four": <stripped field 'last_four'> },
    }
  `);

    // Revoke the API key through credential scanning
    const revokeResponse = await niceBackendFetch("/api/v1/integrations/credential-scanning/revoke", {
      method: "POST",
      accessType: "server",
      body: {
        api_key: createTeamApiKeyResponse.body.value,
      },
    });

    if (process.env.STACK_TEST_SOURCE_OF_TRUTH === "true") {
      expect(revokeResponse).toMatchInlineSnapshot(`
        NiceResponse {
          "status": 404,
          "body": {
            "code": "API_KEY_NOT_FOUND",
            "error": "API key not found.",
          },
          "headers": Headers {
            "x-stack-known-error": "API_KEY_NOT_FOUND",
            <some fields may have been hidden>,
          },
        }
      `);
    } else {
      expect(revokeResponse).toMatchInlineSnapshot(`
        NiceResponse {
          "status": 200,
          "body": { "success": true },
          "headers": Headers { <some fields may have been hidden> },
        }
      `);

      // Verify the API key is no longer valid
      const checkResponseAfterRevoke = await ProjectApiKey.Team.check(createTeamApiKeyResponse.body.value);
      expect(checkResponseAfterRevoke).toMatchInlineSnapshot(`
        {
          "code": "API_KEY_REVOKED",
          "error": "API key has been revoked.",
        }
      `);

      // Verify that email notifications were sent to user1 and user2 (who have the permission)
      // user3 should NOT receive the email since they don't have the $manage_api_keys permission

      const user1_messages = await mailbox1.waitForMessagesWithSubject("API Key Revoked: Test Team API Key to Revoke");
      const user2_messages = await mailbox2.waitForMessagesWithSubject("API Key Revoked: Test Team API Key to Revoke");
      // user3 should NOT receive the email - use fetchMessages instead of waitForMessagesWithSubject
      const user3_messages = await mailbox3.fetchMessages();
      const user1_revocation_email = user1_messages.filter((m: MailboxMessage) => m.subject === "API Key Revoked: Test Team API Key to Revoke");
      const user2_revocation_email = user2_messages.filter((m: MailboxMessage) => m.subject === "API Key Revoked: Test Team API Key to Revoke");
      const user3_revocation_email = user3_messages.filter((m: MailboxMessage) => m.subject === "API Key Revoked: Test Team API Key to Revoke");

      expect(user1_revocation_email).toMatchInlineSnapshot(`
        [
          MailboxMessage {
            "attachments": [],
            "body": {
              "html": deindent\`
                <!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd"><html dir="ltr" lang="en"><head></head><body><!--$--><div>
                      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
                        <h2 style="color: #333;">API Key Revoked</h2>
                        <p style="color: #555; font-size: 16px; line-height: 1.5;">
                          Your API key "Test Team API Key to Revoke" for New Project has been automatically revoked because it was found in a public repository.
                        </p>
                        <p style="color: #555; font-size: 16px; line-height: 1.5;">
                          This is an automated security measure to protect your api keys from being leaked. If you believe this was a mistake, please contact support.
                        </p>
                        <p style="color: #555; font-size: 16px; line-height: 1.5;">
                          Please create a new API key if needed.
                        </p>
                      </div>
                    </div><!--3--><!--/$--></body></html>
              \`,
              "text": deindent\`
                API KEY REVOKED
                
                Your API key "Test Team API Key to Revoke" for New Project has been
                automatically revoked because it was found in a public repository.
                
                This is an automated security measure to protect your api keys from being
                leaked. If you believe this was a mistake, please contact support.
                
                Please create a new API key if needed.
              \`,
            },
            "from": "New Project <noreply@example.com>",
            "subject": "API Key Revoked: Test Team API Key to Revoke",
            "to": ["<mailbox-3--<stripped UUID>@stack-generated.example.com>"],
            <some fields may have been hidden>,
          },
        ]
      `);
      expect(user2_revocation_email).toMatchInlineSnapshot(`
        [
          MailboxMessage {
            "attachments": [],
            "body": {
              "html": deindent\`
                <!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd"><html dir="ltr" lang="en"><head></head><body><!--$--><div>
                      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
                        <h2 style="color: #333;">API Key Revoked</h2>
                        <p style="color: #555; font-size: 16px; line-height: 1.5;">
                          Your API key "Test Team API Key to Revoke" for New Project has been automatically revoked because it was found in a public repository.
                        </p>
                        <p style="color: #555; font-size: 16px; line-height: 1.5;">
                          This is an automated security measure to protect your api keys from being leaked. If you believe this was a mistake, please contact support.
                        </p>
                        <p style="color: #555; font-size: 16px; line-height: 1.5;">
                          Please create a new API key if needed.
                        </p>
                      </div>
                    </div><!--3--><!--/$--></body></html>
              \`,
              "text": deindent\`
                API KEY REVOKED
                
                Your API key "Test Team API Key to Revoke" for New Project has been
                automatically revoked because it was found in a public repository.
                
                This is an automated security measure to protect your api keys from being
                leaked. If you believe this was a mistake, please contact support.
                
                Please create a new API key if needed.
              \`,
            },
            "from": "New Project <noreply@example.com>",
            "subject": "API Key Revoked: Test Team API Key to Revoke",
            "to": ["<mailbox-1--<stripped UUID>@stack-generated.example.com>"],
            <some fields may have been hidden>,
          },
        ]
      `);

      expect(user3_revocation_email).toMatchInlineSnapshot(`[]`);
    }
}, { timeout: 120_000 });

it("should handle already revoked API keys gracefully", async ({ expect }: { expect: any }) => {
  await Project.createAndSwitch({ config: { magic_link_enabled: true, allow_team_api_keys: true, allow_user_api_keys: true } });

  const user1 = await Auth.fastSignUp();

  // Create a user API key
  const { createUserApiKeyResponse } = await ProjectApiKey.User.create({
    user_id: user1.userId,
    description: "Test API Key Already Revoked",
    expires_at_millis: null,
  });

  // Manually revoke the API key first
  const userRevokeResponse = await ProjectApiKey.User.revoke(createUserApiKeyResponse.body.id);
  expect(userRevokeResponse).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": {
        "created_at_millis": <stripped field 'created_at_millis'>,
        "description": "Test API Key Already Revoked",
        "id": "<stripped UUID>",
        "is_public": false,
        "manually_revoked_at_millis": <stripped field 'manually_revoked_at_millis'>,
        "type": "user",
        "user_id": "<stripped UUID>",
        "value": { "last_four": <stripped field 'last_four'> },
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);

  // Verify the API key is already revoked
  const checkResponseBeforeRevoke = await ProjectApiKey.User.check(createUserApiKeyResponse.body.value);
  expect(checkResponseBeforeRevoke).toMatchInlineSnapshot(`
    {
      "code": "API_KEY_REVOKED",
      "error": "API key has been revoked.",
    }
  `);

  // Try to revoke the API key through credential scanning
  const revokeResponse = await niceBackendFetch("/api/v1/integrations/credential-scanning/revoke", {
    method: "POST",
    accessType: "server",
    body: {
      api_key: createUserApiKeyResponse.body.value,
    },
  });

  if (process.env.STACK_TEST_SOURCE_OF_TRUTH === "true") {
    expect(revokeResponse).toMatchInlineSnapshot(`
      NiceResponse {
        "status": 404,
        "body": {
          "code": "API_KEY_NOT_FOUND",
          "error": "API key not found.",
        },
        "headers": Headers {
          "x-stack-known-error": "API_KEY_NOT_FOUND",
          <some fields may have been hidden>,
        },
      }
    `);
  } else {
    // Should still return success but not send another email
    expect(revokeResponse).toMatchInlineSnapshot(`
      NiceResponse {
        "status": 200,
        "body": { "success": true },
        "headers": Headers { <some fields may have been hidden> },
      }
    `);

    // Verify no additional email was sent
    const messages = await backendContext.value.mailbox.fetchMessages({ noBody: true });
    const revocationEmails = messages.filter((m: MailboxMessage) =>
      m.subject === "API Key Revoked: Test API Key Already Revoked"
    );

    expect(revocationEmails.length).toBe(0);
  }
});

it("should error when api key is not found", async ({ expect }: { expect: any }) => {
  await Project.createAndSwitch({ config: { magic_link_enabled: true } });

  const fakeApiKey = `stack_test_nonexistent_${generateSecureRandomString()}`;

  // Try to revoke the non-existent API key
  const revokeResponse = await niceBackendFetch("/api/v1/integrations/credential-scanning/revoke", {
    method: "POST",
    accessType: "server",
    body: {
      api_key: fakeApiKey,
    },
  });

  // Expect an error response (e.g., 404 Not Found)
  expect(revokeResponse.status).toBe(404);
  expect(revokeResponse.body).toMatchInlineSnapshot(`
    {
      "code": "API_KEY_NOT_FOUND",
      "error": "API key not found.",
    }
  `);
});
