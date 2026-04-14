#!/usr/bin/env node

/** Minimal `stack login` flow for local demos. Usage: `node cli-sim.mjs` */

const API_URL = process.env.STACK_API_URL || "http://localhost:8102";
const APP_URL = process.env.STACK_APP_URL || "http://localhost:8103";
const PROJECT_ID = "internal";
const PUBLISHABLE_KEY = "this-publishable-client-key-is-for-local-development-only";

const headers = {
  "Content-Type": "application/json",
  "x-stack-access-type": "client",
  "x-stack-project-id": PROJECT_ID,
  "x-stack-publishable-client-key": PUBLISHABLE_KEY,
};

async function main() {
  console.log("=== Stack Auth CLI Simulator ===\n");
  console.log(`API:     ${API_URL}`);
  console.log(`App:     ${APP_URL}\n`);

  console.log("Initiating CLI auth...");
  const initRes = await fetch(`${API_URL}/api/v1/auth/cli`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      expires_in_millis: 1000 * 60 * 10,
    }),
  });

  if (!initRes.ok) {
    console.error(`Failed to initiate: ${initRes.status} ${await initRes.text()}`);
    process.exit(1);
  }

  const { polling_code, login_code, expires_at } = await initRes.json();

  console.log(`\n${"=".repeat(40)}`);
  console.log(`  Verification Code:  ${login_code}`);
  console.log(`${"=".repeat(40)}\n`);
  console.log(`Open this URL in your browser:\n`);
  console.log(`  ${APP_URL}/handler/cli-auth-confirm?login_code=${encodeURIComponent(login_code)}\n`);
  console.log(`Expires: ${new Date(expires_at).toLocaleTimeString()}`);
  console.log(`\nWaiting for browser authorization...`);

  const POLL_INTERVAL = 2000;
  let attempts = 0;

  while (true) {
    attempts++;
    const pollRes = await fetch(`${API_URL}/api/v1/auth/cli/poll`, {
      method: "POST",
      headers,
      body: JSON.stringify({ polling_code }),
    });

    if (!pollRes.ok) {
      console.error(`Poll failed: ${pollRes.status} ${await pollRes.text()}`);
      process.exit(1);
    }

    const result = await pollRes.json();

    if (result.status === "success") {
      console.log(`\nLogin successful! (after ${attempts} poll attempts)`);
      console.log(`Refresh token: ${result.refresh_token.slice(0, 20)}...`);
      console.log("\nIn a real CLI, this token would be saved to ~/.config/stack-auth/credentials.json");
      break;
    }

    if (result.status === "expired") {
      console.error("\nAuth session expired. Please try again.");
      process.exit(1);
    }

    if (result.status === "used") {
      console.error("\nThis auth token was already used.");
      process.exit(1);
    }

    process.stdout.write(".");
    await new Promise((r) => setTimeout(r, POLL_INTERVAL));
  }
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
