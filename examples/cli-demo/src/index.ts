import { StackClientApp } from "@stackframe/js";
import { KnownErrors } from "@stackframe/stack-shared";
import dotenv from 'dotenv';
import open from "open";

dotenv.config({ path: '.env.development' });


// Get configuration from environment variables
const STACK_PROJECT_ID = process.env.STACK_PROJECT_ID;
const STACK_PUBLISHABLE_CLIENT_KEY = process.env.STACK_PUBLISHABLE_CLIENT_KEY;
const STACK_API_URL = process.env.STACK_API_URL; 
const CLI_AUTH_BASE_URL = process.env.CLI_AUTH_BASE_URL;

async function runCliLoginDemo() {
  console.log("Configuration values:");
  console.log("STACK_PROJECT_ID:", STACK_PROJECT_ID);
  console.log("STACK_PUBLISHABLE_CLIENT_KEY:", STACK_PUBLISHABLE_CLIENT_KEY);
  console.log("STACK_API_URL:", STACK_API_URL);
  console.log("CLI_AUTH_BASE_URL:", CLI_AUTH_BASE_URL);

  if (!STACK_PROJECT_ID || !STACK_PUBLISHABLE_CLIENT_KEY || !STACK_API_URL || !CLI_AUTH_BASE_URL) {
    console.error("Error: Please set STACK_PROJECT_ID, STACK_PUBLISHABLE_CLIENT_KEY, STACK_API_URL, and CLI_AUTH_BASE_URL environment variables or replace the placeholders in the script.");
    process.exit(1);
  }
  

  console.log("Attempting CLI login...");

  const stack = new StackClientApp({
    tokenStore: "memory",
    projectId: STACK_PROJECT_ID,
    publishableClientKey: STACK_PUBLISHABLE_CLIENT_KEY,
    baseUrl: STACK_API_URL,
  });

  // The promptCliLogin function handles opening the browser and polling.
  const result = await stack.promptCliLogin({
    appUrl: CLI_AUTH_BASE_URL,
    promptLink: (url) => {
      open(url);
    },
  });

  if (result.status === "ok") {
    console.log("\n✅ CLI Login Successful!");
    console.log("🔑 Refresh Token:", result.data); // Store this token securely!
    // You can now use this refresh token to obtain access tokens and make authenticated API calls.
  } else {
    console.error("\n❌ CLI Login Failed:");
    if (result.error instanceof KnownErrors.CliAuthExpiredError) {
      console.error("   Reason: The login request expired.");
    } else if (result.error instanceof KnownErrors.CliAuthUsedError) {
      console.error("   Reason: The login request has already been used.");
    } else if (result.error instanceof KnownErrors.CliAuthError) {
      console.error(`   Reason: ${result.error.message}`);
    } else {
      console.error("   Reason: An unexpected error occurred.", result.error);
    }
    process.exit(1);
  }
}

runCliLoginDemo().catch((error) => {
  console.error("An unexpected error occurred during the demo:", error);
  process.exit(1);
});
