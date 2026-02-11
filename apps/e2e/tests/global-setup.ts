import dotenv from "dotenv";
import path from "path";

export default function globalSetup() {
  dotenv.config({
    path: [
      ".env.test.local",
      ".env.test",
      ".env.development.local",
      ".env.local",
      ".env.development",
      ".env",
    ].map((file) => path.resolve(__dirname, "..", file)),
  });

  return () => {};
}
