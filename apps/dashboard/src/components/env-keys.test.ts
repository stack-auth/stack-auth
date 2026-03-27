import { describe, expect, it } from "vitest";
import { getEnvFileContent } from "./env-keys";

const sharedProps = {
  projectId: "proj_test",
  publishableClientKey: "pck_test",
  secretServerKey: "ssk_test",
  superSecretAdminKey: undefined,
} as const;

describe("getEnvFileContent", () => {
  it("renders framework-specific public env prefixes", () => {
    expect(getEnvFileContent({ ...sharedProps, preset: "nextjs" })).toContain("NEXT_PUBLIC_STACK_PROJECT_ID=proj_test");
    expect(getEnvFileContent({ ...sharedProps, preset: "nextjs" })).toContain("STACK_SECRET_SERVER_KEY=ssk_test");
    expect(getEnvFileContent({ ...sharedProps, preset: "vite" })).toContain("VITE_STACK_PROJECT_ID=proj_test");
    expect(getEnvFileContent({ ...sharedProps, preset: "nuxt" })).toContain("NUXT_PUBLIC_STACK_PROJECT_ID=proj_test");
    expect(getEnvFileContent({ ...sharedProps, preset: "sveltekit" })).toContain("PUBLIC_STACK_PROJECT_ID=proj_test");
  });
});
