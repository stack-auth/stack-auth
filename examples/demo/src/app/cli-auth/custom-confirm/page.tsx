'use client';

import { CliAuthConfirmation } from "@stackframe/stack";

// This page simply renders the built-in component that handles the
// confirmation step after the user clicks the link provided by the CLI (or simulation).
export default function CustomCliAuthConfirmPage() {
  // The CliAuthConfirmation component reads the login_code from the URL query parameters
  // and handles the interaction with the backend to complete the process.
  return (
    <CliAuthConfirmation fullPage={true} />
  );
}
