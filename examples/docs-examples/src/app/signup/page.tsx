'use client';


// import { SignUp } from "@stackframe/stack";

// export default function DefaultSignUp() {
//   return <SignUp fullPage />;
// }

// --------------------------------------------


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
    // this redirects to your configured post-sign-up destination on success
    const result = await app.signUpWithCredential({ email, password });
    // It is better to handle each error code separately, but we will just show the error code directly for simplicity here
    if (result.status === 'error') {
      setError(result.error.message);
    }
  };

  return (
    <form onSubmit={(e) => {
      e.preventDefault();
      onSubmit();
    }}>
      {error}
      <input type='email' placeholder="email@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
      <input type='password' placeholder="password" value={password} onChange={(e) => setPassword(e.target.value)} />
      <button type='submit'>Sign Up</button>
    </form>
  );
}
