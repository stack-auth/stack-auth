import { strict as assert } from 'assert';
import express from 'express';
import handlebars from 'handlebars';
import Provider, { errors } from 'oidc-provider';

const port = process.env.PORT || 8114;
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
    ...([8102, 32102].map(port =>
      `http://localhost:${port}/api/v1/auth/oauth/callback/${id}`
    )),
    ...(process.env.STACK_MOCK_OAUTH_REDIRECT_URIS ? [process.env.STACK_MOCK_OAUTH_REDIRECT_URIS.replace("{id}", id)] : [])
  ]
}));

const configuration = {
  clients,
  ttl: { Session: 60 },
  findAccount: async (ctx: any, sub: string) => ({
    accountId: sub,
    async claims() {
      return { sub, email: sub };
    },
  }),
};

const oidc = new Provider(`http://localhost:${port}`, configuration);
const app = express();

app.use(express.urlencoded({ extended: false }));

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
      <form method="post" action="/interaction/{{uid}}/login" class="space-y-4">
        <div>
          <label for="login" class="block text-gray-700">Email</label>
          <input id="login" type="email" name="login" required
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
