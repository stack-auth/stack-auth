# Stack Auth Convex Component

This component is the official way to integrate Stack Auth with your Convex project.

## Installation

To get started, first install Stack Auth using the setup wizard:

```bash
npx @stackframe/stack-cli@latest init
```

## Get Started

[Create a new Stack Auth project](https://app.stack-auth.com) and set the environment variables in Convex to the project ID & API key environment variables from the Stack Auth dashboard. Also, add the same values to the `.env.local` file.

Next, update or create a file in `convex/auth.config.ts`:

```ts
import { getConvexProvidersConfig } from "@stackframe/js/convex-auth.config";  // Vanilla JS
// or: import { getConvexProvidersConfig } from "@stackframe/react/convex-auth.config";  // React
// or: import { getConvexProvidersConfig } from "@stackframe/stack/convex-auth.config";  // Next.js

export default {
  providers: getConvexProvidersConfig({
    projectId: process.env.STACK_PROJECT_ID!,
  }),
}
```

Set `STACK_PROJECT_ID` in your Convex dashboard environment variables. Convex runs outside your Next.js process, so it reads the variables configured for the Convex deployment.

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

Then, update your Convex client to use Stack Auth:

```ts
convexClient.setAuth(stackClientApp.getConvexClientAuth({}));  // browser JS
convexReactClient.setAuth(stackClientApp.getConvexClientAuth({}));  // React
convexHttpClient.setAuth(stackClientApp.getConvexHttpClientAuth({ tokenStore: requestObject }));  // HTTP, see Stack Auth docs for more information on tokenStore
```

Now, you'll be able to access Stack Auth's functionality from your frontend & backend:

```ts
// MyPage.tsx
export function MyPage() {
  // see https://docs.stack-auth.com for more information on how to use Stack Auth
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

## Partial and full users

`getPartialUser({ from: "convex", ctx })` returns the user identity Convex verified from the Stack Auth JWT. It includes fields such as `id`, `displayName`, `primaryEmail`, `primaryEmailVerified`, `isAnonymous`, `isMultiFactorRequired`, `isRestricted`, and `restrictedReason`.

It does not include `teamId`, `selectedTeam`, or a teams list. If you need Stack Auth team data, use the full Stack user from a Next.js route handler or a Convex action. Full users have APIs such as `user.selectedTeam` and `await user.listTeams()`.

## Next.js route handlers

In Next.js route handlers, pass the Stack Auth token as the third argument to Convex's `fetchQuery`, `fetchMutation`, or `fetchAction` helpers:

```ts
const token = await stackServerApp.getConvexHttpClientAuth({
  tokenStore: request,
});

const userInfo = await fetchQuery(api.myFunctions.getUserInfo, {}, { token });
const noteId = await fetchMutation(api.myFunctions.createNote, { text }, { token });
```

In `fetchQuery(api.myFunctions.getUserInfo, {}, { token })`, the second argument is the query args object, and the third argument is where the auth token goes.

For more information on how to use Stack Auth, see the [Stack Auth docs](https://docs.stack-auth.com).
