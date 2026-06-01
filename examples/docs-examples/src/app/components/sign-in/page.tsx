import { SignIn } from '@hexclave/next';

export default function Page() {
  return (
    <div>
      <h1>Sign In</h1>
      <SignIn
        fullPage={true}
      />
    </div>
  );
}
