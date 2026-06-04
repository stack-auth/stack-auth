require("server-only");

const { StackServerApp } = require("@hexclave/next");

export const hexclaveServerApp = new StackServerApp({
  tokenStore: "nextjs-cookie",
});
