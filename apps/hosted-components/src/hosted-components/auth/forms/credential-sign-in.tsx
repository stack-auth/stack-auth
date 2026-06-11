import { useStackApp } from "@hexclave/react";
import { runAsynchronously, runAsynchronouslyWithAlert } from "@hexclave/shared/dist/utils/promises";
import { useState } from "react";

import { Button, Input, Label, PasswordInput } from "~/components/ui";

import { FormWarningText } from "../supporting/form-elements";
import { isValidEmail } from "../supporting/utils";

export function CredentialSignIn() {
  const app = useStackApp();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [emailError, setEmailError] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit() {
    setEmailError(null);
    setPasswordError(null);
    if (!isValidEmail(email)) {
      setEmailError("Please enter a valid email");
      return;
    }
    if (password.length === 0) {
      setPasswordError("Please enter your password");
      return;
    }

    setLoading(true);
    try {
      const result = await app.signInWithCredential({ email, password });
      if (result.status === "error") {
        setEmailError(result.error.message);
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <form
      className="stack-scope flex flex-col items-stretch"
      onSubmit={(event) => {
        event.preventDefault();
        runAsynchronouslyWithAlert(submit());
      }}
      noValidate
    >
      <Label htmlFor="email" className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Email</Label>
      <Input
        id="email"
        type="email"
        autoComplete="email"
        className="h-10 rounded-xl border-border bg-background"
        value={email}
        onChange={(event) => {
          setEmail(event.target.value);
          setEmailError(null);
        }}
      />
      <FormWarningText text={emailError} />

      <div className="mb-1.5 mt-4 flex items-center justify-between">
        <Label htmlFor="password" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Password</Label>
        <a
          href={app.urls.forgotPassword}
          className="text-xs text-muted-foreground hover:text-foreground"
          onClick={(event) => {
            event.preventDefault();
            runAsynchronously(app.redirectToForgotPassword());
          }}
        >
          Forgot password?
        </a>
      </div>
      <PasswordInput
        id="password"
        autoComplete="current-password"
        className="h-10 rounded-xl border-border bg-background"
        value={password}
        onChange={(event) => {
          setPassword(event.target.value);
          setPasswordError(null);
        }}
      />
      <FormWarningText text={passwordError} />

      <Button type="submit" className="mt-6 h-10 rounded-xl font-semibold shadow-sm hover:shadow" loading={loading}>
        Sign In
      </Button>
    </form>
  );
}
