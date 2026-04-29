import "./otel-init";
import "./polyfills";

import { getEnvVariable } from "@stackframe/stack-shared/dist/utils/env";
import { app } from "./elysia-app";

const port = Number.parseInt(getEnvVariable("BACKEND_PORT", `${getEnvVariable("NEXT_PUBLIC_STACK_PORT_PREFIX", "81")}02`), 10);

app.listen(port, ({ hostname, port }) => {
  console.log(`Stack Auth backend listening at http://${hostname}:${port}`);
});
