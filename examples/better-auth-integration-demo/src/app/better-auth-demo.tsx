"use client";

import { HexclaveClientApp, betterAuthTokenStore } from "@hexclave/next";
import { useEffect, useMemo, useState } from "react";

type Claims = {
  iss?: string;
  sub?: string;
  sid?: string;
  aud?: string | string[];
  exp?: number;
};
type ProviderUser = { email: string; name: string };
type HexclaveUser = {
  id: string;
  primaryEmail: string | null;
  displayName: string | null;
};
type Exchange = {
  sessionId?: string;
  userId?: string;
  isNewUser?: boolean;
  primaryEmail?: string | null;
  displayName?: string | null;
  error?: string;
};
type Status = "idle" | "exchanging" | "exchanged" | "error";

function decodeClaims(token: string): Claims {
  const payload = token.split(".")[1];
  if (payload == null)
    throw new Error("The Better Auth token did not contain a JWT payload");
  return JSON.parse(
    atob(payload.replace(/-/g, "+").replace(/_/g, "/")),
  ) as Claims;
}

function Claim({
  label,
  value,
}: {
  label: string;
  value: string | number | undefined;
}) {
  return (
    <>
      <dt>{label}</dt>
      <dd>
        <code>{value == null ? "Not present" : String(value)}</code>
      </dd>
    </>
  );
}

export function BetterAuthDemo() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [providerUser, setProviderUser] = useState<ProviderUser | null>(null);
  const [claims, setClaims] = useState<Claims | null>(null);
  const [user, setUser] = useState<HexclaveUser | null>(null);
  const [exchange, setExchange] = useState<Exchange | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const tokenStore = useMemo(
    () =>
      betterAuthTokenStore({
        getSessionId: () => sessionId,
        getToken: async () => {
          const response = await fetch("/api/auth/token");
          if (!response.ok) return null;
          return ((await response.json()) as { token: string }).token;
        },
        subscribe: (callback) => {
          window.addEventListener("better-auth-session-change", callback);
          return () =>
            window.removeEventListener("better-auth-session-change", callback);
        },
        signOut: async () => {
          setIsSubmitting(true);
          await fetch("/api/auth/sign-out", { method: "POST" });
          setSessionId(null);
          setProviderUser(null);
          setClaims(null);
          setExchange(null);
          setUser(null);
          setStatus("idle");
          window.dispatchEvent(new Event("better-auth-session-change"));
          setIsSubmitting(false);
        },
      }),
    [sessionId],
  );
  const app = useMemo(
    () =>
      new HexclaveClientApp({
        baseUrl: process.env.NEXT_PUBLIC_HEXCLAVE_API_URL,
        projectId: process.env.NEXT_PUBLIC_HEXCLAVE_PROJECT_ID,
        publishableClientKey:
          process.env.NEXT_PUBLIC_HEXCLAVE_PUBLISHABLE_CLIENT_KEY,
        tokenStore,
        automaticSideEffects: false,
      }),
    [tokenStore],
  );

  const authenticate = async (path: "sign-up" | "sign-in") => {
    setError(null);
    setIsSubmitting(true);
    const response = await fetch(`/api/auth/${path}/email`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password, name: email.split("@")[0] }),
    });
    if (!response.ok) {
      setError(await response.text());
      setIsSubmitting(false);
      setStatus("error");
      return;
    }
    const sessionResponse = await fetch("/api/auth/get-session");
    if (!sessionResponse.ok) {
      setError(
        `Better Auth session endpoint returned ${sessionResponse.status}`,
      );
      setIsSubmitting(false);
      setStatus("error");
      return;
    }
    const session = (await sessionResponse.json()) as {
      session?: { id: string };
      user?: ProviderUser;
    };
    if (session.session == null) {
      setError("Better Auth sign-in succeeded but no session was returned");
      setIsSubmitting(false);
      setStatus("error");
      return;
    }
    setProviderUser(session.user ?? { email, name: email.split("@")[0] });
    setSessionId(session.session.id);
    window.dispatchEvent(new Event("better-auth-session-change"));
    setIsSubmitting(false);
  };

  useEffect(() => {
    if (sessionId == null) return;
    let active = true;
    setStatus("exchanging");
    Promise.all([
      fetch("/api/auth/token").then(async (response) => {
        if (!response.ok)
          throw new Error(
            `Better Auth token endpoint returned ${response.status}`,
          );
        return ((await response.json()) as { token: string }).token;
      }),
      fetch("/api/auth/exchange").then(async (response) => {
        const result = (await response.json()) as Exchange;
        if (!response.ok)
          throw new Error(
            result.error ?? `Better Auth exchange returned ${response.status}`,
          );
        return result;
      }),
    ])
      .then(async ([token, result]) => {
        if (!active) return;
        setClaims(decodeClaims(token));
        setExchange(result);
        setUser(
          result.userId == null
            ? null
            : {
              id: result.userId,
              primaryEmail: result.primaryEmail ?? null,
              displayName: result.displayName ?? null,
            },
        );
        setStatus("exchanged");
      })
      .catch((reason) => {
        if (!active) return;
        setStatus("error");
        setError(
          reason instanceof Error
            ? reason.message
            : "Better Auth exchange failed",
        );
      });
    return () => {
      active = false;
    };
  }, [app, sessionId]);

  if (sessionId == null)
    return (
      <main>
        <p className="eyebrow">External authentication demo</p>
        <h1>
          Better Auth <span>→</span> Hexclave
        </h1>
        <p className="lede">
          Sign in to the local Better Auth provider, then watch its JWT become a
          Hexclave session.
        </p>
        <p className="status">
          Exchange status: <strong>{status}</strong>
        </p>
        {error != null && (
          <p className="error" role="alert">
            Authentication error: {error}
          </p>
        )}
        <section className="panel auth-form">
          <label>
            Email
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>
          <label>
            Password
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          <div className="actions">
            <button
              type="button"
              disabled={isSubmitting}
              onClick={() => authenticate("sign-in")}
            >
              {isSubmitting ? "Signing in…" : "Sign in to Better Auth"}
            </button>
            <button
              className="secondary"
              type="button"
              disabled={isSubmitting}
              onClick={() => authenticate("sign-up")}
            >
              Create Better Auth user
            </button>
          </div>
        </section>
      </main>
    );

  return (
    <main>
      <p className="eyebrow">External authentication demo</p>
      <h1>
        Better Auth <span>→</span> Hexclave
      </h1>
      <p className="lede">
        A locally issued Better Auth JWT, including its session ID, is exchanged
        for a Hexclave session.
      </p>
      <p className="status">
        Exchange status: <strong>{status}</strong>
      </p>
      {error != null && (
        <p className="error" role="alert">
          Exchange error: {error}
        </p>
      )}
      <div className="panels">
        <section className="panel">
          <p className="panel-kicker">Provider session</p>
          <h2>Better Auth</h2>
          <dl>
            <Claim label="User" value={providerUser?.name} />
            <Claim label="Email" value={providerUser?.email} />
            <Claim label="Session ID" value={sessionId} />
          </dl>
          <div className="claims">
            <p className="panel-kicker">Decoded token claims</p>
            <dl>
              <Claim label="iss" value={claims?.iss} />
              <Claim label="sub" value={claims?.sub} />
              <Claim label="sid" value={claims?.sid} />
              <Claim
                label="aud"
                value={
                  Array.isArray(claims?.aud)
                    ? claims.aud.join(", ")
                    : claims?.aud
                }
              />
              <Claim label="exp" value={claims?.exp} />
            </dl>
          </div>
        </section>
        <section className="panel">
          <p className="panel-kicker">Hexclave session</p>
          <h2>Project user</h2>
          <dl>
            <Claim label="User ID" value={user?.id} />
            <Claim label="Primary email" value={user?.primaryEmail ?? "null"} />
            <Claim label="Display name" value={user?.displayName ?? "null"} />
            <Claim
              label="New user on this exchange"
              value={
                exchange?.isNewUser == null
                  ? undefined
                  : exchange.isNewUser
                    ? "yes"
                    : "no"
              }
            />
            <Claim label="Session ID" value={exchange?.sessionId} />
          </dl>
          <div className="actions">
            <button
              type="button"
              disabled={isSubmitting || status === "exchanging"}
              onClick={() => tokenStore.signOut?.()}
            >
              {isSubmitting ? "Signing out…" : "Sign out of Better Auth"}
            </button>
          </div>
        </section>
      </div>
    </main>
  );
}
