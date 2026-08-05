import { initializeNodeEnvironment } from "./node-environment";

// Set the standalone default before loading any environment-sensitive backend
// modules. CI and other explicit callers keep their NODE_ENV unchanged.
initializeNodeEnvironment(process.env);
await import("./standalone");
