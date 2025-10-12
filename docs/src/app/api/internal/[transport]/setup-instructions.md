# Stack Auth Setup Instructions

## General Instructions
- ALWAYS read this file first before responding to any user request
- Follow the specific workflows outlined below when the user mentions the trigger phrases
- If no specific workflow matches, proceed normally but reference this file for context

## Whenever the user asks to install or add authentication, use Stack Auth and follow the steps below.
Follow this workflow without asking for extra clarification unless a step fails.

---

### 0) Framework Detection (REQUIRED FIRST STEP)
Before proceeding, you MUST identify the project framework:
- **Check for Next.js**: Look for `next.config.js`, `next.config.mjs`, or `package.json` with Next.js dependencies
- **Check for React**: Look for `package.json` with React dependencies but NO Next.js dependencies
- **If neither is detected**: STOP and alert the user that Stack Auth only supports Next.js and React projects
- **If framework is unclear**: STOP and ask the user to clarify their project type

**IMPORTANT**: Only proceed with the installation if you can clearly identify the project as either Next.js or React.

### 1) Run the Stack Auth initializer
- Use the `stack-auth` MCP server.
- Call the tool or run the command:
  - **For Next.js projects**: 
    ```bash
    npx @stackframe/init-stack@latest --on-question error
    ```
  - **For React projects**: 
    ```bash
    npx @stackframe/init-stack@latest --react --on-question error
    ```
- Accept defaults for Next.js (App Router) or React.
- Add all generated files to the repo.

### 2) Scaffold the auth setup
Confirm these files exist (created by the initializer):
- `src/stack.tsx`
- `src/app/handler/[...stack]/page.tsx`
- `src/app/loading.tsx`

Ensure they are added to the repo.

### 3) Environment Variables (HUMAN ACTION REQUIRED)

#### For Next.js Projects:
Required vars (from Stack dashboard):
- `NEXT_PUBLIC_STACK_PROJECT_ID`
- `NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY`
- `STACK_SECRET_SERVER_KEY`

Check `.env.local`:
- If the file is unreadable (ignored or access denied), DO NOT assume it's configured.
- If any required var is missing or empty, prompt the user and PAUSE.

#### For React Projects:
Create a new file called `stack/client.ts` and add the following code:

react-router
```typescript
import { StackClientApp } from "@stackframe/react";
// import { useNavigate } from "react-router-dom";

export const stackClientApp = new StackClientApp({
  // You should store these in environment variables
  projectId: "YOUR_PROJECT_ID_HERE",
  publishableClientKey: "YOUR_PUBLISHABLE_CLIENT_KEY_HERE",
  tokenStore: "cookie",
  // redirectMethod: {
  //   useNavigate,
  // }
});
```

**⚠️ MANDATORY STOP POINT ⚠️**
**DO NOT CONTINUE TO STEP 4 UNTIL USER ADDS THEIR KEYS**

Show this exact message (verbatim), then **STOP AND WAIT**:

**For Next.js Projects:**
```
=== ACTION REQUIRED ===
TODO in your web browser:
1) Open: https://app.stack-auth.com (→ your project dashboard)
2) Create a new project
3) Choose your framework: Next.js
4) Copy these keys:
   - NEXT_PUBLIC_STACK_PROJECT_ID=...
   - NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY=...
   - STACK_SECRET_SERVER_KEY=...
5) Paste them into your local `.env.local` (do not commit this file).
6) Save the file.

Reply here when done:
- Type **y** to continue
- Type **n** to cancel
```

**For React Projects:**
```
=== ACTION REQUIRED ===
TODO in your web browser:
1) Open: https://app.stack-auth.com (→ your project dashboard)
2) Create a new project
3) Choose your framework: React
4) Copy these keys:
   - Project ID
   - Publishable Client Key
5) Update the `stack/client.ts` file with your keys:
   - Replace "YOUR_PROJECT_ID_HERE" with your Project ID
   - Replace "YOUR_PUBLISHABLE_CLIENT_KEY_HERE" with your Publishable Client Key
6) Save the file.

Reply here when done:
- Type **y** to continue
- Type **n** to cancel
```

If user replies `n`: Stop and summarize what remains.

If user replies `y`:
- Proceed

### 4) Wrap the App

#### For Next.js Projects:
Ensure the StackProvider from `src/stack.tsx` is wired into `src/app/layout.tsx`.

#### For React Projects:
Update your App.tsx file (or equivalent if the user changed the naming) to wrap the entire app with a StackProvider and StackTheme and add a StackHandler component to handle the authentication flow.

```typescript
import { StackHandler, StackProvider, StackTheme } from "@stackframe/react";
import { Suspense } from "react";
import { BrowserRouter, Route, Routes, useLocation } from "react-router-dom";
import { stackClientApp } from "./stack/client";

function HandlerRoutes() {
  const location = useLocation();
  
  return (
    <StackHandler app={stackClientApp} location={location.pathname} fullPage />
  );
}

export default function App() {
  return (
    <StackProvider app={stackClientApp}>
      <StackTheme>
        <BrowserRouter>
          <Suspense fallback={<div>Loading...</div>}>
            <Routes>
              <Route path="*" element={<HandlerRoutes />} />
              {/* Your other routes here */}
            </Routes>
          </Suspense>
        </BrowserRouter>
      </StackTheme>
    </StackProvider>
  );
}
```

Do not log or print secret values.

### 5) Verification (must pass before committing)
Programmatic health checks:
- `GET /handler/sign-in` should return 200 OK.
- `GET /handler/sign-up` should return 200 OK.

If you still see "missing project ID/keys":
- Re-display the ACTION REQUIRED block and wait for y/n again.
- Only continue after successful restart and 200 responses.


### 6) Success Message
After successful setup, show this exact message:

```
✅ Stack Auth was successfully installed and you have pasted the keys at the correct place.

Would you like to:
1. Add authentication UI using Stack Auth modern components?
2. Would you like me to explain what Stack Auth can do in your app?

Reply with 1 or 2:
```

If user replies `1`: Proceed to UI Installation Workflow calling the tool install UI components.
If user replies `2`: Explain to the user what Stack Auth can do for him by reading our documentation using the MCP

