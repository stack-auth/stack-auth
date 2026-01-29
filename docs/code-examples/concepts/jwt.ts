import { CodeExample } from '../../lib/code-examples';

export const jwtExamples = {
  'client-side-usage': [
    {
      language: 'JavaScript',
      framework: 'Next.js',
      code: `import { useUser } from '@stackframe/stack';

export function UserProfile() {
  const user = useUser();
  
  if (!user) {
    return <div>Please sign in</div>;
  }
  
  return <div>Welcome, {user.displayName}!</div>;
}`,
      highlightLanguage: 'tsx',
      filename: 'app/components/user-profile.tsx'
    },
    {
      language: 'JavaScript',
      framework: 'React',
      code: `import { useUser } from '@stackframe/react';

export function UserProfile() {
  const user = useUser();
  
  if (!user) {
    return <div>Please sign in</div>;
  }
  
  return <div>Welcome, {user.displayName}!</div>;
}`,
      highlightLanguage: 'tsx',
      filename: 'components/UserProfile.tsx'
    },
  ] as CodeExample[],

  'server-side-usage': [
    {
      language: 'JavaScript',
      framework: 'Next.js',
      code: `import { stackServerApp } from '@/stack';

export async function GET() {
  const user = await stackServerApp.getUser();
  
  if (!user) {
    return new Response('Unauthorized', { status: 401 });
  }
  
  // Access user information from the JWT
  return Response.json({
    id: user.id,
    displayName: user.displayName,
    primaryEmail: user.primaryEmail,
    selectedTeamId: user.selectedTeamId,
    // Other user properties...
  });
}`,
      highlightLanguage: 'typescript',
      filename: 'app/api/user/route.ts'
    },
  ] as CodeExample[],

  'manual-jwt-verification': [
    {
      language: 'JavaScript',
      framework: 'Node.js',
      code: `import * as jose from 'jose';

// Get the public key set from Stack Auth
const jwks = jose.createRemoteJWKSet(
  new URL('https://api.stack-auth.com/api/v1/projects/YOUR_PROJECT_ID/.well-known/jwks.json')
);

// Verify a regular (non-anonymous) access token
try {
  const { payload } = await jose.jwtVerify(token, jwks, {
    issuer: 'https://api.stack-auth.com/api/v1/projects/YOUR_PROJECT_ID',
    audience: 'YOUR_PROJECT_ID',
  });

  console.log('JWT is valid:', payload);
} catch (error) {
  console.error('JWT verification failed:', error);
}`,
      highlightLanguage: 'typescript',
      filename: 'verify-jwt.ts'
    },
  ] as CodeExample[],

  'manual-jwt-verification-anonymous': [
    {
      language: 'JavaScript',
      framework: 'Node.js',
      code: `import * as jose from 'jose';

const jwks = jose.createRemoteJWKSet(
  new URL('https://api.stack-auth.com/api/v1/projects/YOUR_PROJECT_ID/.well-known/jwks.json?include_anonymous=true')
);

const { payload } = await jose.jwtVerify(token, jwks, {
  issuer: [
    'https://api.stack-auth.com/api/v1/projects/YOUR_PROJECT_ID',
    'https://api.stack-auth.com/api/v1/projects-anonymous-users/YOUR_PROJECT_ID',
  ],
  audience: ['YOUR_PROJECT_ID', 'YOUR_PROJECT_ID:anon'],
});`,
      highlightLanguage: 'typescript',
      filename: 'verify-jwt.ts'
    },
  ] as CodeExample[],

  'manual-jwt-verification-restricted': [
    {
      language: 'JavaScript',
      framework: 'Node.js',
      code: `import * as jose from 'jose';

const jwks = jose.createRemoteJWKSet(
  new URL('https://api.stack-auth.com/api/v1/projects/YOUR_PROJECT_ID/.well-known/jwks.json?include_anonymous=true&include_restricted=true')
);

// Restricted (non-anonymous) users use the same issuer as regular users,
// so only two issuers are needed even though there are three audiences
const { payload } = await jose.jwtVerify(token, jwks, {
  issuer: [
    'https://api.stack-auth.com/api/v1/projects/YOUR_PROJECT_ID',
    'https://api.stack-auth.com/api/v1/projects-anonymous-users/YOUR_PROJECT_ID',
  ],
  audience: ['YOUR_PROJECT_ID', 'YOUR_PROJECT_ID:anon', 'YOUR_PROJECT_ID:restricted'],
});`,
      highlightLanguage: 'typescript',
      filename: 'verify-jwt.ts'
    },
  ] as CodeExample[],
};
