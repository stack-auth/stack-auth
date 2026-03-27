'use client';

import { useStackApp, useUser } from "@stackframe/stack";
import { runAsynchronouslyWithAlert } from "@stackframe/stack-shared/dist/utils/promises";
import { Button, Card, CardContent, CardHeader, Typography } from "@stackframe/stack-ui";
import Link from "next/link";

export default function CrossDomainHandoffPage() {
  const app = useStackApp();
  const user = useUser();

  const currentUrl = typeof window === "undefined" ? "unknown" : window.location.href;
  const extraRedirectActions: Array<{ label: string, run: () => Promise<void> }> = [
    { label: "redirectToAccountSettings()", run: async () => await app.redirectToAccountSettings() },
    { label: "redirectToHome()", run: async () => await app.redirectToHome() },
    { label: "redirectToAfterSignIn()", run: async () => await app.redirectToAfterSignIn() },
    { label: "redirectToAfterSignUp()", run: async () => await app.redirectToAfterSignUp() },
    { label: "redirectToAfterSignOut()", run: async () => await app.redirectToAfterSignOut() },
    { label: "redirectToForgotPassword()", run: async () => await app.redirectToForgotPassword() },
    { label: "redirectToPasswordReset()", run: async () => await app.redirectToPasswordReset() },
    { label: "redirectToEmailVerification()", run: async () => await app.redirectToEmailVerification() },
    { label: "redirectToTeamInvitation()", run: async () => await app.redirectToTeamInvitation() },
    { label: "redirectToMfa()", run: async () => await app.redirectToMfa() },
    { label: "redirectToOnboarding()", run: async () => await app.redirectToOnboarding() },
    { label: "redirectToError()", run: async () => await app.redirectToError() },
  ];
  const rawUrlActions: Array<{ label: string, href: string }> = [
    { label: "Account Settings URL", href: "/handler/account-settings" },
    { label: "OAuth Callback URL", href: "/handler/oauth-callback" },
    { label: "Team Invitation URL", href: "/handler/team-invitation" },
    { label: "MFA URL", href: "/handler/mfa" },
    { label: "Error URL", href: "/handler/error" },
  ];

  return (
    <div className="container mx-auto p-6 max-w-4xl">
      <Typography type="h1" className="mb-2">Cross-Domain Auth Handoff Demo</Typography>
      <Typography className="mb-6 text-gray-600">
        Use this page to manually validate redirect + callback behavior when sign-in is hosted on another domain.
      </Typography>

      <div className="grid gap-6">
        <Card>
          <CardHeader>
            <Typography type="h3">Current Runtime State</Typography>
          </CardHeader>
          <CardContent>
            <div className="space-y-2 text-sm">
              <div><span className="font-semibold">Signed in:</span> {user ? "yes" : "no"}</div>
              <div><span className="font-semibold">Current URL:</span> <code>{currentUrl}</code></div>
              <div><span className="font-semibold">Sign-in route:</span> <code>/handler/sign-in</code></div>
              <div><span className="font-semibold">OAuth callback route:</span> <code>/handler/oauth-callback</code></div>
              <div>
                <span className="font-semibold">Cross-domain mode:</span> driven by redirect methods and current URL state
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <Typography type="h3">Main Flow Triggers</Typography>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                onClick={() => runAsynchronouslyWithAlert(async () => {
                  await user?.signOut({ redirectUrl: "/cross-domain-handoff" });
                })}
              >
                Sign Out (Reset)
              </Button>

              <Button
                onClick={() => runAsynchronouslyWithAlert(async () => {
                  await app.redirectToSignIn();
                })}
              >
                Trigger Client `redirectToSignIn()`
              </Button>

              <Button
                onClick={() => runAsynchronouslyWithAlert(async () => {
                  await app.redirectToSignUp();
                })}
              >
                Trigger Client `redirectToSignUp()`
              </Button>

              <Link href="/protected" className="inline-flex">
                <Button variant="outline">
                  Open `/protected` (server redirect flow)
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <Typography type="h3">OAuth Provider Flow Trigger</Typography>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2 items-center">
              <Button
                onClick={() => runAsynchronouslyWithAlert(async () => {
                  await app.signInWithOAuth("github");
                })}
              >
                Trigger OAuth Sign-In (GitHub)
              </Button>
              <Button
                variant="outline"
                onClick={() => runAsynchronouslyWithAlert(async () => {
                  await app.signInWithOAuth("google");
                })}
              >
                Trigger OAuth Sign-In (Google)
              </Button>
              <Button
                variant="outline"
                onClick={() => runAsynchronouslyWithAlert(async () => {
                  await app.signInWithOAuth("spotify");
                })}
              >
                Trigger OAuth Sign-In (Spotify)
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <Typography type="h3">Additional Redirect Method Triggers</Typography>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {extraRedirectActions.map((action) => (
                <Button
                  key={action.label}
                  variant="outline"
                  onClick={() => runAsynchronouslyWithAlert(action.run)}
                >
                  {action.label}
                </Button>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <Typography type="h3">Raw URL Targets</Typography>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {rawUrlActions.map((action) => (
                <Link key={action.label} href={action.href} className="inline-flex">
                  <Button variant="secondary">{action.label}</Button>
                </Link>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <Typography type="h3">Quick Checklist</Typography>
          </CardHeader>
          <CardContent>
            <ol className="list-decimal list-inside text-sm space-y-1">
              <li>Sign out first.</li>
              <li>Run one trigger, complete auth, verify you land back at the original page.</li>
              <li>Repeat with OAuth sign-in.</li>
              <li>Confirm you stay signed in after browser refresh.</li>
            </ol>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
