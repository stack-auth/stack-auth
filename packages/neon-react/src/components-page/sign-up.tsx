'use client';


//===========================================
// THIS FILE IS AUTO-GENERATED FROM TEMPLATE. DO NOT EDIT IT DIRECTLY
//===========================================
import { AuthPage } from './auth-page';

export function SignUp(props: {
  fullPage?: boolean,
  automaticRedirect?: boolean,
  noPasswordRepeat?: boolean,
  extraInfo?: React.ReactNode,
  firstTab?: 'magic-link' | 'password',
}) {
  return <AuthPage
    fullPage={!!props.fullPage}
    type='sign-up'
    automaticRedirect={!!props.automaticRedirect}
    noPasswordRepeat={props.noPasswordRepeat}
    extraInfo={props.extraInfo}
    firstTab={props.firstTab}
  />;
}
