# Hexclave Convex Component

This component is the official way to integrate Hexclave with your Convex project.

## Installation

To get started, first install Hexclave using the setup wizard:

```bash
npx @hexclave/cli@latest init
```

## Get Started

[Create a new Hexclave project](https://app.hexclave.com) and set the environment variables in Convex to the project ID & API key environment variables from the Hexclave dashboard. Also, add the same values to the `.env.local` file.

Next, update or create a file in `convex/auth.config.ts`:

```ts
import { getConvexProvidersConfig } from "@stackframe/js/convex-auth.config";  // Vanilla JS
// or: import { getConvexProvidersConfig } from "@stackframe/react/convex-auth.config";  // React
// or: import { getConvexProvidersConfig } from "@stackframe/stack/convex-auth.config";  // Next.js

export default {
  providers: getConvexProvidersConfig({
    projectId: process.env.STACK_PROJECT_ID,  // or: process.env.NEXT_PUBLIC_STACK_PROJECT_ID
  }),
}
```

Next, update or create a file in `convex/convex.config.ts`:

```ts
import { defineApp } from "convex/server";
import stackAuthComponent from "@stackframe/js/convex.config";  // Vanilla JS
// or: import stackAuthComponent from "@stackframe/react/convex.config";  // React
// or: import stackAuthComponent from "@stackframe/stack/convex.config";  // Next.js


const app = defineApp();
app.use(stackAuthComponent);

export default app;
```

Then, update your Convex client to use Hexclave:

```ts
convexClient.setAuth(stackClientApp.getConvexClientAuth({}));  // browser JS
convexReactClient.setAuth(stackClientApp.getConvexClientAuth({}));  // React
convexHttpClient.setAuth(stackClientApp.getConvexHttpClientAuth({ tokenStore: requestObject }));  // HTTP, see Hexclave docs for more information on tokenStore
```

Now, you'll be able to access Hexclave's functionality from your frontend & backend:

```ts
// MyPage.tsx
export function MyPage() {
  // see https://docs.hexclave.com for more information on how to use Hexclave
  const user = useUser();
  return <div>Your email is {user.email}</div>;
}

// myFunctions.ts
export const myQuery = query({
  handler: async (ctx, args) => {
    // In queries & mutations, use the special `getPartialUser` function to get user info
    const obj = await stackServerApp.getPartialUser({ from: "convex", ctx });
    return JSON.stringify(obj);
  },
});
```

For more information on how to use Hexclave, see the [Hexclave docs](https://docs.hexclave.com).
