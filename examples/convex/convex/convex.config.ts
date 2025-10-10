import stackAuthComponent from "@stackframe/stack/convex.config";
import { defineApp } from "convex/server";

const app = defineApp();
app.use(stackAuthComponent);

export default app;
