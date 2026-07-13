import app from "../dist/vercel.mjs";

export const config = {
  runtime: "nodejs",
  maxDuration: 60,
};

export default function handler(request: Request): Response | Promise<Response> {
  return app.handle(request);
}
