'use client';


// import { SignIn } from "@stackframe/stack";

// export default function DefaultSignIn() {
//   return <SignIn fullPage />;
// }

// --------------------------------------------


// import { useStackApp } from "@stackframe/stack";

// export default function CustomOAuthSignIn() {
//   const app = useStackApp();

//   return <div>
//     <h1>My Custom Sign In page</h1>
//     <button onClick={async () => {
//       // this will redirect to the OAuth provider's login page
//       await app.signInWithOAuth('google');
//     }}>
//       Sign In with Google
//     </button>
//   </div>;
// }

// --------------------------------------------

// import { useStackApp } from "@stackframe/stack";
// import { useState } from "react";

// export default function CustomCredentialSignIn() {
//   const [email, setEmail] = useState('');
//   const [password, setPassword] = useState('');
//   const [error, setError] = useState('');
//   const app = useStackApp();

//   const onSubmit = async () => {
//     if (!password) {
//       setError('Please enter your password');
//       return;
//     }
//     // this redirects to your configured post-sign-in destination on success
//     const result = await app.signInWithCredential({ email, password });
//     // It is better to handle each error code separately, but we will just show the error code directly for simplicity here
//     if (result.status === 'error') {
//       setError(result.error.message);
//     }
//   };

//   return (
//     <form onSubmit={(e) => { e.preventDefault(); onSubmit(); } }>
//       {error}
//       <input type='email' placeholder="email@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
//       <input type='password' placeholder="password" value={password} onChange={(e) => setPassword(e.target.value)} />
//       <button type='submit'>Sign In</button>
//     </form>
//   );
// }

// --------------------------------------------


import { useStackApp } from "@stackframe/stack";
import { useState } from "react";

export default function CustomCredentialSignIn() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const app = useStackApp();

  const onSubmit = async () => {
    // this redirects to your configured post-sign-in destination on success
    const result = await app.sendMagicLinkEmail(email);
    // It is better to handle each error code separately, but we will just show the error code directly for simplicity here
    if (result.status === 'error') {
      setError(result.error.message);
    } else {
      setMessage('Magic link sent! Please check your email.');
    }
  };

  return (
    <form onSubmit={(e) => {
      e.preventDefault();
      onSubmit();
    }}>
      {error}
      {message ?
        <div>{message}</div> :
        <>
          <input type='email' placeholder="email@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
          <button type='submit'>Send Magic Link</button>
        </>}
    </form>
  );
}
