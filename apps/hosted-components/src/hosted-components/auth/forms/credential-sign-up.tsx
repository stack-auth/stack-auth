import { getPasswordError } from "@hexclave/shared/dist/helpers/password";
import { useStackApp } from "@hexclave/react";
import { runAsynchronouslyWithAlert } from "@hexclave/shared/dist/utils/promises";
import { useState } from "react";

import { Button, Input, Label, PasswordInput } from "~/components/ui";

import { FormWarningText } from "../supporting/form-elements";
import { isValidEmail } from "../supporting/utils";

export function CredentialSignUp(props: {
  noPasswordRepeat?: boolean,
}) {
  const app = useStackApp();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordRepeat, setPasswordRepeat] = useState("");
  const [emailError, setEmailError] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordRepeatError, setPasswordRepeatError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit() {
    setEmailError(null);
    setPasswordError(null);
    setPasswordRepeatError(null);
    if (!isValidEmail(email)) {
      setEmailError("Please enter a valid email");
      return;
    }
    const passwordValidationError = getPasswordError(password);
    if (password.length === 0) {
      setPasswordError("Please enter your password");
      return;
    }
    if (passwordValidationError != null) {
      setPasswordError(passwordValidationError.message);
      return;
    }
    if (!props.noPasswordRepeat && passwordRepeat !== password) {
      setPasswordRepeatError("Passwords do not match");
      return;
    }

    setLoading(true);
    try {
      const result = await app.signUpWithCredential({ email, password });
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

      <Label htmlFor="password" className="mb-1.5 mt-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Password</Label>
      <PasswordInput
        id="password"
        autoComplete="new-password"
        className="h-10 rounded-xl border-border bg-background"
        value={password}
        onChange={(event) => {
          setPassword(event.target.value);
          setPasswordError(null);
          setPasswordRepeatError(null);
        }}
      />
      <FormWarningText text={passwordError} />

      {!props.noPasswordRepeat && (
        <>
          <Label htmlFor="repeat-password" className="mb-1.5 mt-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Repeat Password</Label>
          <PasswordInput
            id="repeat-password"
            autoComplete="new-password"
            className="h-10 rounded-xl border-border bg-background"
            value={passwordRepeat}
            onChange={(event) => {
              setPasswordRepeat(event.target.value);
              setPasswordError(null);
              setPasswordRepeatError(null);
            }}
          />
          <FormWarningText text={passwordRepeatError} />
        </>
      )}

      <Button type="submit" className="mt-6 h-10 rounded-xl font-semibold shadow-sm hover:shadow" loading={loading}>
        Sign Up
      </Button>
    </form>
  );
}
