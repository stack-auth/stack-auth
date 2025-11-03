# Stack Auth Chrome Extension Example

This example shows how to use Stack Auth inside a Manifest V3 Chrome extension. The popup renders a credential sign-in form using `@stackframe/js` and keeps the session alive with cookies, so it works with the same Stack project that powers your web apps.

## Getting Started

1. Duplicate `.env.development` to `.env.local` and update the Stack credentials, or leave the defaults if you are running the Stack development environment locally.
2. Install monorepo dependencies from the repository root: `pnpm install`.
3. Build in watch mode so the extension assets stay up to date:
   - `pnpm --filter @stackframe/example-chrome-extension dev`

The compiled extension lives in `examples/chrome-extension/dist`.

## Load the Extension in Chrome

1. Open `chrome://extensions`, enable **Developer mode**, and choose **Load unpacked**.
2. Select the `dist` directory that the `dev` script keeps updated.
3. Chrome now shows the Stack Auth badge in the extensions toolbar. Open the popup to sign in, sign out, or inspect the current session.

## Notes

- The default `manifest.json` allows requests to `http://localhost/*` so it works with the local Stack dev environment. Update the `host_permissions` field under `examples/chrome-extension/public/manifest.json` when pointing at another domain.
- Run `pnpm --filter @stackframe/example-chrome-extension build` to create a production build.
