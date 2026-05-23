import stackAuthComponent from "@hexclave/next/convex.config";
import { defineApp } from "convex/server";

const app = defineApp();
app.use(stackAuthComponent);

export default app;
