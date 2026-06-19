import "@/polyfills";
import "./env-expand";
import "@/instrument";
import { getEnvVariable } from "@hexclave/shared/dist/utils/env";
import { app } from "./app";

const portPrefix = getEnvVariable("NEXT_PUBLIC_HEXCLAVE_PORT_PREFIX", "81");
const port = Number(getEnvVariable("PORT", getEnvVariable("BACKEND_PORT", `${portPrefix}02`)));
const hostname = getEnvVariable("HOSTNAME", "0.0.0.0");

app.listen({
  hostname,
  port,
});

console.log(`Hexclave backend listening on http://${hostname}:${port}`);

process.once("SIGTERM", () => {
  app.stop().then(() => undefined, (error: unknown) => {
    setTimeout(() => {
      throw error;
    }, 0);
  });
});
