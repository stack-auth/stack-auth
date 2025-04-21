
//===========================================
// THIS FILE IS AUTO-GENERATED FROM TEMPLATE. DO NOT EDIT IT DIRECTLY
//===========================================
import { AuthPage } from "./auth-page";

export function SignIn(props: {
  fullPage?: boolean,
  automaticRedirect?: boolean,
  extraInfo?: React.ReactNode,
  firstTab?: 'magic-link' | 'password',
}) {
  return (
    <AuthPage
      fullPage={!!props.fullPage}
      type="sign-in"
      automaticRedirect={!!props.automaticRedirect}
      extraInfo={props.extraInfo}
      firstTab={props.firstTab}
    />
  );
}
