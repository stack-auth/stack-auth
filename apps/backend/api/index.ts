import app from "../dist/vercel.mjs";

export const config = {
  runtime: "nodejs",
  maxDuration: 60,
};

// Vercel treats a default-exported function as the legacy Node.js `(request,
// response)` handler contract. Export the Elysia app itself so Vercel detects
// its Web-standard `fetch` handler and forwards the returned Response.
export default app;
