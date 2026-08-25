import { defineProject } from "vitest/config";

// The Railway integration is plain .mjs layered onto a prebuilt image rather than
// a workspace package, so it needs its own project: the shared config only picks
// up .js/.ts sources inside the pnpm workspaces.
export default defineProject({
  test: {
    name: "railway",
    watch: false,
    include: ["**/*.test.mjs"],
  },
});
