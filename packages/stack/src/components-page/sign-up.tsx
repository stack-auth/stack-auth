'use client';
import { AuthPage } from './auth-page';

export function SignUp(props: {
  fullPage?: boolean,
  automaticRedirect?: boolean,
  noPasswordRepeat?: boolean,
  extraInfo?: React.ReactNode,
  swapOrder?: boolean,
}) {
  return <AuthPage
    fullPage={!!props.fullPage}
    type='sign-up'
    automaticRedirect={!!props.automaticRedirect}
    noPasswordRepeat={props.noPasswordRepeat}
    extraInfo={props.extraInfo}
    swapOrder={props.swapOrder}
  />;
}
