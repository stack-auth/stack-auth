import { SignIn } from '@stackframe/stack';
import { StackContainer } from '../mdx';

export function SignInStackAuth() {
  return (
    <StackContainer color="amber">
      <SignIn />
    </StackContainer>
  );
}

export function SignInPasswordFirstTab() {
  return (
    <StackContainer  color="green">
      <SignIn firstTab="password" />
    </StackContainer>
  );
}

export function SignInExtraInfo() {
  return (
    <StackContainer color="blue">
      <SignIn extraInfo={<>By signing in, you agree to our <a href="#" className="text-fd-primary hover:underline">Terms of Service</a></>} />
    </StackContainer>
  );
}
