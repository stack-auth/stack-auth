#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const prefix = process.env.NEXT_PUBLIC_STACK_PORT_PREFIX ?? "81";
const targetPath = path.join(__dirname, "..", "public", "env-config.js");
const fileContents = `window.NEXT_PUBLIC_STACK_PORT_PREFIX = ${JSON.stringify(prefix)};\n`;

fs.writeFileSync(targetPath, fileContents);
console.log(`[dev-launchpad] Wrote env-config.js with prefix ${prefix}`);
