import { strict as assert } from 'assert';
import express from 'express';
import handlebars from 'handlebars';
import Provider, { errors } from 'oidc-provider';

const stackPortPrefix = process.env.NEXT_PUBLIC_STACK_PORT_PREFIX ?? "81";
const defaultMockOAuthPort = Number(`${stackPortPrefix}14`);
const port = Number(process.env.PORT ?? defaultMockOAuthPort);
const backendPortForRedirects = `${stackPortPrefix}02`;
const emulatorBackendPort = process.env.STACK_EMULATOR_BACKEND_PORT ?? "32102";
const providerIds = [
  'github',
  'facebook',
  'google',
  'microsoft',
  'spotify',
  'discord',
  'gitlab',
  'bitbucket',
  'x',
];
const clients = providerIds.map((id) => ({
  client_id: id,
  client_secret: 'MOCK-SERVER-SECRET',
  redirect_uris: [
    `http://localhost:${backendPortForRedirects}/api/v1/auth/oauth/callback/${id}`,
    ...(process.env.STACK_MOCK_OAUTH_REDIRECT_URIS ? [process.env.STACK_MOCK_OAUTH_REDIRECT_URIS.replace("{id}", id)] : [])
  ],
  grant_types: ['authorization_code', 'refresh_token'],
}));

const configuration = {
  clients,
  ttl: { Session: 60 },
  findAccount: async (ctx: any, sub: string) => ({
    accountId: sub,
    async claims() {
      return { sub, email: sub };
    },
  })
};

const oidc = new Provider(`http://localhost:${port}`, configuration);
const app = express();

// Simple in-memory storage for revoked tokens
const revokedTokens = new Set<string>();

// Storage for simulating specific error responses on token refresh
// Maps refresh token -> error type to return on next refresh attempt
const simulatedRefreshErrors = new Map<string, { error: string, error_description: string }>();

// Storage for simulating errors by grant ID (since we can't easily get refresh tokens)
const simulatedRefreshErrorsByGrant = new Map<string, { error: string, error_description: string }>();

app.use(express.urlencoded({ extended: false }));
app.use(express.json()); // Add JSON parsing middleware

// Middleware to intercept token refresh requests and return simulated errors
app.post('/token', async (req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (req.body.grant_type === 'refresh_token' && req.body.refresh_token) {
    const refreshTokenValue = req.body.refresh_token;

    // Check by refresh token directly
    const simulatedError = simulatedRefreshErrors.get(refreshTokenValue);
    if (simulatedError) {
      simulatedRefreshErrors.delete(refreshTokenValue);
      res.status(400).json(simulatedError);
      return;
    }

    // Check by grant ID
    try {
      const refreshToken = await oidc.RefreshToken.find(refreshTokenValue);
      if (refreshToken?.grantId) {
        const errorByGrant = simulatedRefreshErrorsByGrant.get(refreshToken.grantId);
        if (errorByGrant) {
          simulatedRefreshErrorsByGrant.delete(refreshToken.grantId);
          res.status(400).json(errorByGrant);
          return;
        }
      }
    } catch {
      // Token might not be found, continue to oidc-provider
    }
  }
  next();
});

const loginTemplateSource = `
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Sign-in</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <style>
      body {
        background-color: #f8f9fa;
      }
      .card {
        background-color: #fff;
        border-radius: 0.5rem;
        box-shadow: 0 2px 10px rgba(0, 0, 0, 0.05);
      }
    </style>
  </head>
  <body class="min-h-screen flex items-center justify-center p-4">
    <div class="card w-full max-w-md p-8">
      <h1 class="text-2xl font-bold mb-6 text-center">Mock OAuth Sign-in</h1>
      <p class="text-gray-500 mb-4 text-center">This is a mock OAuth server for testing. It accepts any email without a password.</p>
      <form method="post" action="/interaction/{{uid}}/login" class="space-y-4">
        <div>
          <label for="login" class="block text-gray-700">Email</label>
          <input id="login" type="email" name="login" required placeholder="eg.: email@example.com"
            class="mt-1 block w-full border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring focus:border-blue-300" />
        </div>
        <button type="submit"
          class="w-full bg-black hover:bg-gray-800 text-white font-semibold py-2 px-4 rounded">
          Sign in
        </button>
      </form>
      <!-- Container for displaying stored account emails -->
      <div id="stored-accounts" class="mt-4"></div>
      <details class="mt-6 bg-gray-50 rounded p-2">
        <summary class="cursor-pointer text-sm text-gray-600">Debug</summary>
        <pre class="mt-1 text-xs text-gray-500 overflow-x-auto">{{debugInfo}}</pre>
      </details>
      <script>
        document.addEventListener("DOMContentLoaded", () => {
          const storedAccountsContainer = document.getElementById('stored-accounts');
          const emailInput = document.getElementById('login');
          if (!storedAccountsContainer || !emailInput) return;
          
          // Retrieve stored accounts from localStorage or initialize as an empty array
          let storedAccounts = JSON.parse(localStorage.getItem('previousAccounts') || '[]');
        
          // Get the form element to submit later
          const form = document.querySelector('form');
          if (!form) return;
        
          // Render the list of stored accounts and add direct submission on click.
          const renderStoredAccounts = () => {
            if (storedAccounts.length > 0) {
              let listHtml = '<h2 class="text-lg font-medium text-gray-700 mb-2">Previously Used Accounts</h2>';
              listHtml += '<div class="grid gap-2">';
              storedAccounts.forEach((account) => {
                listHtml += \`
                  <div class="p-3 bg-white border border-gray-200 rounded-lg shadow-sm hover:bg-gray-50 transition-shadow cursor-pointer" data-email="\${account}">
                    <div class="flex items-center">
                      <div class="h-8 w-8 rounded-full bg-gray-100 flex items-center justify-center mr-3">
                        <span class="text-gray-600 font-medium">\${account.charAt(0).toUpperCase()}</span>
                      </div>
                      <span class="text-gray-700">\${account}</span>
                    </div>
                  </div>
                \`;
              });
              listHtml += '</div>';
              storedAccountsContainer.innerHTML = listHtml;
        
              // Add click event listeners that set the email and submit the form directly.
              storedAccountsContainer.querySelectorAll('[data-email]').forEach(card => {
                card.addEventListener('click', () => {
                  const selectedEmail = card.getAttribute('data-email') || '';
                  emailInput.value = selectedEmail;
                  form.submit();
                });
              });
            } else {
              storedAccountsContainer.innerHTML = '';
            }
          };
        
          renderStoredAccounts();
        
          // On form submission, store the email if it's not already stored.
          form.addEventListener('submit', () => {
            const email = emailInput.value.trim();
            if (email && !storedAccounts.includes(email)) {
              storedAccounts.push(email);
              localStorage.setItem('previousAccounts', JSON.stringify(storedAccounts));
            }
          });
        });
      </script>
    </div>
  </body>
</html>
`;

const loginTemplate = handlebars.compile(loginTemplateSource);

const renderLoginView = ({ uid, debugInfo }: { uid: string, debugInfo: string }): string => {
  return loginTemplate({ uid, debugInfo });
};

const setNoCache = (req: express.Request, res: express.Response, next: express.NextFunction): void => {
  res.set('cache-control', 'no-store');
  next();
};

app.get('/interaction/:uid', setNoCache, async (req: express.Request, res: express.Response, next: express.NextFunction) => {
  try {
    const { uid, prompt, params, session, grantId } = await oidc.interactionDetails(req, res);
    const debugInfo = JSON.stringify({ params, prompt, session }, null, 2);

    if (prompt.name === 'login') {
      res.send(renderLoginView({
        uid,
        debugInfo,
      }));
    } else if (prompt.name === 'consent') {
      // Automatically approve consent without showing an approval page.
      if (!session) throw new Error('No session found');
      const accountId = session.accountId;
      const { details } = prompt;

      let grant = grantId
        ? await oidc.Grant.find(grantId)
        : new oidc.Grant({ accountId, clientId: params.client_id as string });
      if (!grant) {
        throw new Error('Failed to create or find grant');
      }
      if (Array.isArray(details.missingOIDCScope)) {
        grant.addOIDCScope(details.missingOIDCScope.join(' '));
      }
      if (Array.isArray(details.missingOIDCClaims)) {
        grant.addOIDCClaims(details.missingOIDCClaims);
      }
      if (details.missingResourceScopes && typeof details.missingResourceScopes === 'object') {
        for (const [indicator, scopes] of Object.entries(details.missingResourceScopes)) {
          if (Array.isArray(scopes)) {
            grant.addResourceScope(indicator, scopes.join(' '));
          }
        }
      }
      const newGrantId = await grant.save();
      const consent: { grantId?: string } = {};
      if (!grantId) consent.grantId = newGrantId;
      const result = { consent };
      await oidc.interactionFinished(req, res, result, { mergeWithLastSubmission: true });
    } else {
      res.send('Unknown prompt');
    }
  } catch (err) {
    next(err);
  }
});

app.post('/interaction/:uid/login', setNoCache, async (req: express.Request, res: express.Response, next: express.NextFunction) => {
  try {
    const { prompt } = await oidc.interactionDetails(req, res);
    assert.strictEqual(prompt.name, 'login', 'Expected login prompt');
    const result = { login: { accountId: req.body.login, remember: false } };
    await oidc.interactionFinished(req, res, result, { mergeWithLastSubmission: false });
  } catch (err) {
    next(err);
  }
});

// Endpoint to simulate specific OAuth errors on next refresh attempt
// This is useful for testing how the backend handles various OAuth error scenarios
app.post('/simulate-refresh-error', async (req: express.Request, res: express.Response, next: express.NextFunction) => {
  try {
    const { token, error_type } = req.body;

    if (!token) {
      res.status(400).json({
        error: 'invalid_request',
        error_description: 'Missing token parameter'
      });
      return;
    }

    // Find the access token to get the associated refresh token
    const accessToken = await oidc.AccessToken.find(token);
    if (!accessToken) {
      res.status(400).json({
        error: 'invalid_token',
        error_description: 'Access token not found'
      });
      return;
    }

    // Get the refresh token associated with this grant
    const grantId = accessToken.grantId;
    if (!grantId) {
      res.status(400).json({
        error: 'invalid_token',
        error_description: 'No grant associated with this token'
      });
      return;
    }

    // Find refresh tokens for this grant
    // Note: oidc-provider stores refresh tokens with the grantId, but we need to find them
    // For simplicity, we'll store the error by grantId and check it in the middleware
    const errorResponses: Record<string, { error: string, error_description: string }> = {
      'invalid_grant': { error: 'invalid_grant', error_description: 'The refresh token is invalid or expired' },
      'access_denied': { error: 'access_denied', error_description: 'The resource owner denied the request' },
      'consent_required': { error: 'consent_required', error_description: 'User consent is required' },
      'invalid_token': { error: 'invalid_token', error_description: 'The token is invalid' },
      'unauthorized_client': { error: 'unauthorized_client', error_description: 'The client is not authorized' },
    };

    const errorResponse = errorResponses[error_type];
    if (!errorResponse) {
      res.status(400).json({
        error: 'invalid_request',
        error_description: `Invalid error_type. Valid types: ${Object.keys(errorResponses).join(', ')}`
      });
      return;
    }

    // We need to find the refresh token. Since oidc-provider doesn't expose a simple way to do this,
    // we'll store by grantId and update the middleware to check grantIds
    // For now, let's use a workaround: store by grantId
    simulatedRefreshErrorsByGrant.set(grantId, errorResponse);

    res.json({
      success: true,
      message: `Next refresh attempt for this token will return ${error_type} error`
    });
  } catch (err) {
    res.status(500).json({
      error: 'server_error',
      error_description: 'Failed to set up simulated error'
    });
  }
});

// Token revocation endpoints
app.post('/revoke-refresh-token', async (req: express.Request, res: express.Response, next: express.NextFunction) => {
  try {
    const { token } = req.body;

    if (!token) {
      res.status(400).json({
        error: 'invalid_request',
        error_description: 'Missing token parameter'
      });
      return;
    }

    // Find the access token first
    try {
      const accessToken = await oidc.AccessToken.find(token);
      if (!accessToken) {
        res.status(400).json({
          error: 'invalid_token',
          error_description: 'Access token not found'
        });
        return;
      }

      // Get the grant associated with this access token
      const grantId = accessToken.grantId;
      if (grantId) {
        try {
          const grant = await oidc.Grant.find(grantId);
          if (grant) {
            // Add access token to revoked list
            revokedTokens.add(token);

            // Destroy the grant which should invalidate all associated tokens including refresh tokens
            await grant.destroy();

            res.json({
              success: true,
              message: 'Grant and associated refresh tokens have been revoked'
            });
            return;
          }
        } catch (grantErr) {
          // Fall through to alternative approach if grant destruction fails
        }
      }

      // Fallback: Add access token to revoked list
      revokedTokens.add(token);

      res.json({
        success: true,
        message: 'Access token marked as revoked (refresh token association not found)'
      });
    } catch (err) {
      // Alternative approach - just mark the access token as revoked
      revokedTokens.add(token);

      res.json({
        success: true,
        message: 'Token marked as revoked'
      });
    }
  } catch (err) {
    res.status(500).json({
      error: 'server_error',
      error_description: 'Failed to revoke refresh token'
    });
  }
});

app.post('/revoke-access-token', async (req: express.Request, res: express.Response, next: express.NextFunction) => {
  try {
    const { token } = req.body;

    if (!token) {
      res.status(400).json({
        error: 'invalid_request',
        error_description: 'Missing token parameter'
      });
      return;
    }

    // Add token to revoked list
    revokedTokens.add(token);

    // Try to find and revoke the token using oidc-provider's built-in functionality
    try {
      const accessToken = await oidc.AccessToken.find(token);
      if (accessToken) {
        await accessToken.destroy();
      }
    } catch (err) {
      // Token might not exist or already be expired, but we still add it to our blacklist
    }

    res.json({
      success: true,
      message: 'Access token has been revoked'
    });
  } catch (err) {
    res.status(500).json({
      error: 'server_error',
      error_description: 'Failed to revoke access token'
    });
  }
});

// The POST consent route has been removed as consent is now auto-approved.
app.get('/interaction/:uid/abort', setNoCache, async (req: express.Request, res: express.Response, next: express.NextFunction) => {
  try {
    const result = {
      error: 'access_denied',
      error_description: 'End-User aborted interaction',
    };
    await oidc.interactionFinished(req, res, result, { mergeWithLastSubmission: false });
  } catch (err) {
    next(err);
  }
});

app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction): void => {
  if (err instanceof errors.SessionNotFound) {
    res.status(410).send('Session not found or expired');
  } else {
    next(err);
  }
});

app.use(oidc.callback());

app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});
