// Vercel detects native Elysia entrypoints by a direct framework import.
import "elysia";
import app from "../dist/vercel.mjs";

export default app;
