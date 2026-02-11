import { CodeExample } from '../lib/code-examples';

export const customizationExamples = {
  'sign-in': {
    'default': [
      {
        language: 'JavaScript',
        framework: 'Next.js',
        code: `'use client';
import { SignIn } from "@stackframe/stack";

export default function DefaultSignIn() {
  // optionally redirect to some other page if the user is already signed in
  // const user = useUser();
  // if (user) { redirect to some other page }
  return <SignIn fullPage />;
}`,
        highlightLanguage: 'tsx',
        filename: 'app/handler/sign-in/page.tsx',
      },
    ] as CodeExample[],

    'custom-oauth': [
      {
        language: 'JavaScript',
        framework: 'Next.js',
        code: `'use client';
import { useStackApp } from "@stackframe/stack";

export default function CustomOAuthSignIn() {
  const app = useStackApp();

  return (
    <div>
      <h1>My Custom Sign In page</h1>
      <button onClick={async () => {
        // This will redirect to the OAuth provider's login page.
        await app.signInWithOAuth('google');
      }}>
        Sign In with Google
      </button>
    </div>
  );
}`,
        highlightLanguage: 'tsx',
        filename: 'app/handler/sign-in/page.tsx',
      },
    ] as CodeExample[],

    'custom-credential': [
      {
        language: 'JavaScript',
        framework: 'Next.js',
        code: `'use client';
import { useStackApp } from "@stackframe/stack";
import { useState } from "react";

export default function CustomCredentialSignIn() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const app = useStackApp();

  const onSubmit = async () => {
    if (!password) {
      setError('Please enter your password');
      return;
    }
    // This will redirect to app.urls.afterSignIn if successful.
    // You can customize the redirect URL in the StackServerApp constructor.
    const result = await app.signInWithCredential({ email, password });
    // It's better to handle each error code separately, but for simplicity,
    // we'll just display the error message directly here.
    if (result.status === 'error') {
      setError(result.error.message);
    }
  };
  
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSubmit(); } }>
      {error}
      <input type='email' placeholder="email@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
      <input type='password' placeholder="password" value={password} onChange={(e) => setPassword(e.target.value)} />
      <button type='submit'>Sign In</button>
    </form>
  );
}`,
        highlightLanguage: 'tsx',
        filename: 'app/handler/sign-in/page.tsx',
      },
    ] as CodeExample[],

    'custom-magic-link': [
      {
        language: 'JavaScript',
        framework: 'Next.js',
        code: `'use client';

import { useStackApp } from "@stackframe/stack";
import { useState } from "react";

export default function CustomMagicLinkSignIn() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const app = useStackApp();

  const onSubmit = async () => {
    if (!email) {
      setError('Please enter your email address');
      return;
    }
    
    // This will send a magic link email to the user's email address.
    // When they click the link, they will be redirected to your application.
    const result = await app.sendMagicLinkEmail(email);
    // It's better to handle each error code separately, but for simplicity,
    // we'll just display the error message directly here.
    if (result.status === 'error') {
      setError(result.error.message);
    } else {
      setMessage('Magic link sent! Please check your email.');
    }
  };
  
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSubmit(); } }>
      {error}
      {message ? 
        <div>{message}</div> :
        <>
          <input type='email' placeholder="email@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
          <button type='submit'>Send Magic Link</button>
        </>}
    </form>
  );
}`,
        highlightLanguage: 'tsx',
        filename: 'app/handler/sign-in/page.tsx',
      },
    ] as CodeExample[],
  },
  
  'sign-up': {
    'default': [
      {
        language: 'JavaScript',
        framework: 'Next.js',
        code: `'use client';
import { SignUp } from "@stackframe/stack";

export default function DefaultSignUp() {
  // optionally redirect to some other page if the user is already signed in
  // const user = useUser();
  // if (user) { redirect to some other page }
  return <SignUp fullPage />;
}`,
        highlightLanguage: 'tsx',
        filename: 'app/handler/sign-up/page.tsx',
      },
    ] as CodeExample[],

    'custom-credential': [
      {
        language: 'JavaScript',
        framework: 'Next.js',
        code: `'use client';

import { useStackApp } from "@stackframe/stack";
import { useState } from "react";

export default function CustomCredentialSignUp() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const app = useStackApp();

  const onSubmit = async () => {
    if (!password) {
      setError('Please enter your password');
      return;
    }
    // This will redirect to app.urls.afterSignUp if successful.
    // You can customize the redirect URL in the StackServerApp constructor.
    const result = await app.signUpWithCredential({ email, password });
    // It's better to handle each error code separately, but for simplicity,
    // we'll just display the error message directly here.
    if (result.status === 'error') {
      setError(result.error.message);
    }
  };
  
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSubmit(); } }>
      {error}
      <input type='email' placeholder="email@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
      <input type='password' placeholder="password" value={password} onChange={(e) => setPassword(e.target.value)} />
      <button type='submit'>Sign Up</button>
    </form>
  );
}`,
        highlightLanguage: 'tsx',
        filename: 'app/handler/sign-up/page.tsx',
      },
    ] as CodeExample[],
  },
};
