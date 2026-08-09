# Better Auth → Hexclave example

This example signs in with a local Better Auth instance, exchanges its provider
JWT with the local Hexclave backend, and displays the resulting session
metadata.

## Local setup

1. Copy `.env.local.example` to `.env.local`.
2. Set a local `BETTER_AUTH_SECRET` and the local Hexclave client and server
   keys and API URL.
3. Run `pnpm dev` from this directory.
4. Create a Better Auth user through the form, then sign in and exchange its
   token with Hexclave.

The example intentionally does not include provider credentials, access tokens,
or user credentials. The local SQLite database is created at runtime.
