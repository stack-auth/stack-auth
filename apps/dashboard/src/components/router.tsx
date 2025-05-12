'use client';

import { throwErr } from '@stackframe/stack-shared/dist/utils/errors';
// eslint-disable-next-line
import { useRouter as useNextRouter } from 'next/navigation';
import React from 'react';

const routerContext = React.createContext<null | {
  setNeedConfirm: (needConfirm: boolean) => void,
  readonly needConfirm: boolean,
}>(null);

export const confirmAlertMessage = "Are you sure you want to leave this page? Changes you made may not be saved.";

export function useRouter() {
  const router = useNextRouter();
  const context = useRouterConfirm();

  return {
    push: (url: string) => {
      if (context.needConfirm && !window.confirm(confirmAlertMessage)) return;
      router.push(url);
    },
    replace: (url: string) => {
      if (context.needConfirm && !window.confirm(confirmAlertMessage)) return;
      router.replace(url);
    },
    back: () => {
      if (context.needConfirm && !window.confirm(confirmAlertMessage)) return;
      router.back();
    },
  };
}

export function useRouterConfirm() {
  return React.useContext(routerContext) ?? throwErr("RouterProvider not found, please wrap your app in it.");
}

export function RouterProvider(props: {  children: React.ReactNode }) {
  const [needConfirm, setNeedConfirm] = React.useState(false);

  return <routerContext.Provider value={{ needConfirm, setNeedConfirm }}>
    {props.children}
  </routerContext.Provider>;
}
