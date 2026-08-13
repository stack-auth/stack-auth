import hexclaveComponent from "@hexclave/next/convex.config";
import { defineApp } from "convex/server";

const app = defineApp();
app.use(hexclaveComponent);

export default app;
