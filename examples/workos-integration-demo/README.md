# WorkOS AuthKit → Hexclave example

This example signs in with WorkOS AuthKit, exchanges the provider access token
with the local Hexclave backend, and displays the resulting session metadata.

## Local setup

1. Copy `.env.local.example` to `.env.local`.
2. Fill in the WorkOS AuthKit values for your own development tenant:
   - `WORKOS_CLIENT_ID`
   - `WORKOS_API_KEY`
   - `WORKOS_AUTHKIT_DOMAIN`
   - `WORKOS_COOKIE_PASSWORD` (use a local value at least 32 characters long)
3. Set the local Hexclave client and server keys and API URL.
4. Configure `http://localhost:8110/auth/callback` as an allowed WorkOS redirect
   URI. If `NEXT_PUBLIC_HEXCLAVE_PORT_PREFIX` is set, use the matching
   `${prefix}10` port instead; `.env` files use the working default because they
   do not expand shell variables.
5. Run `pnpm dev` from this directory.

The example intentionally does not include provider credentials, access tokens,
or user credentials. The WorkOS issuer is derived from the configured client ID
by the Hexclave dashboard unless an explicit override is required.
