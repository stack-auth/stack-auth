import app from "../dist/vercel.mjs";

export const config = {
  runtime: "nodejs",
  maxDuration: 800,
};

export default app;
