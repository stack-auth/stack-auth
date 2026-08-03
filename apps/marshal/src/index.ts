import "./load-env.js";
import { createMarshalApp } from "./app.js";
import { getConfig } from "./config.js";

const config = getConfig();
const { app } = createMarshalApp();
app.listen(config.port);

console.log(`Marshal listening on http://localhost:${config.port} (env=${config.envId}, builder=${config.builderKind}, fly org=${config.fly.orgSlug})`);
