import app from "../dist/vercel.mjs";

export const config = {
  runtime: "nodejs",
  maxDuration: 120,
};

export default app;
