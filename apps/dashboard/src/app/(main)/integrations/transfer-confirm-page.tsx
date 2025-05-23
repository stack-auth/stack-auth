"use client";

import { Logo } from "@/components/logo";
import { useRouter } from "@/components/router";
import { useStackApp, useUser } from "@stackframe/stack";
import { runAsynchronously, wait } from "@stackframe/stack-shared/dist/utils/promises";
import { Button, Card, CardContent, CardFooter, CardHeader, Input, Typography } from "@stackframe/stack-ui";
import Image from "next/image";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import NeonLogo from "../../../../public/neon.png";

export const stackAppInternalsSymbol = Symbol.for("StackAuth--DO-NOT-USE-OR-YOU-WILL-BE-FIRED--StackAppInternals");

export default function IntegrationProjectTransferConfirmPageClient(props: { type: "neon" | "custom" }) {
  const app = useStackApp();
  const user = useUser({ projectIdMustMatch: "internal" });
  const router = useRouter();
  const searchParams = useSearchParams();

  const [state, setState] = useState<'loading'|'success'|{type: 'error', message: string}>('loading');

  useEffect(() => {
    runAsynchronously(async () => {
      try {
        await (app as any)[stackAppInternalsSymbol].sendRequest(`/integrations/${props.type}/projects/transfer/confirm/check`, {
          method: "POST",
          body: JSON.stringify({
            code: searchParams.get("code"),
          }),
          headers: {
            "Content-Type": "application/json",
          },
        });
        setState('success');
      } catch (err: any) {
        setState({ type: 'error', message: err.message });
      }
    });

  }, [app, searchParams, props.type]);

  const currentUrl = new URL(window.location.href);
  const signUpSearchParams = new URLSearchParams();
  signUpSearchParams.set("after_auth_return_to", currentUrl.pathname + currentUrl.search + currentUrl.hash);
  const signUpUrl = `/handler/signup?${signUpSearchParams.toString()}`;

  return (
    <Card className="max-w-lg text-center">
      <CardHeader className="flex-row items-end justify-center gap-4">
        {props.type === "neon" && (<>
          <Image src={NeonLogo} alt="Neon" width={55} />
          <div className="relative self-center w-10 hidden dark:block">
            <div style={{
              position: "absolute",
              width: 40,
              height: 6,
              backgroundImage: "repeating-linear-gradient(135deg, #ccc, #ccc)",
              transform: "rotate(-45deg)",
            }} />
            <div style={{
              position: "absolute",
              width: 40,
              height: 6,
              backgroundImage: "repeating-linear-gradient(45deg, #ccc, #ccc)",
              transform: "rotate(45deg)",
            }} />
          </div>
          <div className="relative self-center w-10 block dark:hidden">
            <div style={{
              position: "absolute",
              width: 40,
              height: 6,
              backgroundImage: "repeating-linear-gradient(135deg, #52525B, #52525B)",
              transform: "rotate(-45deg)",
            }} />
            <div style={{
              position: "absolute",
              width: 40,
              height: 6,
              backgroundImage: "repeating-linear-gradient(45deg, #52525B, #52525B)",
              transform: "rotate(45deg)",
            }} />
          </div>
        </>)}
        <Logo noLink alt="Stack" width={50} />
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <h1 className="text-3xl font-semibold">
          Project transfer
        </h1>
        {state === 'success' && <>
          <Typography className="text-sm">
            {props.type === "neon" ? "Neon" : "A third party"} would like to transfer a Stack Auth project and link it to your own account. This will let you access the project from Stack Auth&apos;s dashboard.
          </Typography>
          {user ? (
            <>
              <Typography className="mb-3 text-sm">
                Which Stack Auth account would you like to transfer the project to? (You&apos;ll still be able to access your project from {props.type === "neon" ? "Neon" : "the third party"}&apos;s dashboard.)
              </Typography>
              <Input type="text" disabled prefixItem={<Logo noLink width={15} height={15} />} value={`Signed in as ${user.primaryEmail || user.displayName || "Unnamed user"}`} />
              <Button variant="secondary" onClick={async () => await user.signOut({ redirectUrl: signUpUrl })}>
                Switch account
              </Button>
            </>
          ) : (
            <Typography className="text-sm">
              To continue, please sign in or create a Stack Auth account.
            </Typography>
          )}
        </>}

        {typeof state !== 'string' && <>
          <Typography className="text-sm">
            {state.message}
          </Typography>
        </>}

      </CardContent>
      {state === 'success' && <CardFooter className="flex justify-end mt-4">
        <div className="flex gap-2 justify-center">
          <Button variant="secondary" onClick={() => { window.close(); }}>
            Cancel
          </Button>
          <Button onClick={async () => {
            if (user) {
              const confirmRes = await (app as any)[stackAppInternalsSymbol].sendRequest(`/integrations/${props.type}/projects/transfer/confirm`, {
                method: "POST",
                body: JSON.stringify({
                  code: searchParams.get("code"),
                }),
                headers: {
                  "Content-Type": "application/json",
                },
              });
              const confirmResJson = await confirmRes.json();
              router.push(`/projects/${confirmResJson.project_id}`);
              await wait(3000);
            } else {
              router.push(signUpUrl);
              await wait(3000);
            }
          }}>
            {user ? "Transfer" : "Sign in"}
          </Button>
        </div>
      </CardFooter>}
    </Card>
  );
}
