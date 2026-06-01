require("server-only");

const { StackServerApp } = require("@hexclave/next");

export const stackServerApp = new StackServerApp({
  tokenStore: "nextjs-cookie",
});
