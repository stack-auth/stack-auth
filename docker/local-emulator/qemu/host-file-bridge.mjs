#!/usr/bin/env node

import http from "node:http";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const port = Number.parseInt(process.env.STACK_QEMU_FILE_BRIDGE_PORT ?? "", 10) || 8116;
const host = process.env.STACK_QEMU_FILE_BRIDGE_HOST ?? "0.0.0.0";
const token = process.env.STACK_QEMU_FILE_BRIDGE_TOKEN ?? "";

if (token === "") {
  console.error("STACK_QEMU_FILE_BRIDGE_TOKEN is required");
  process.exit(1);
}

const allowedRoots = [os.homedir(), "/tmp"].map((root) => path.resolve(root));

function isWithinRoot(filePath, rootPath) {
  return filePath === rootPath || filePath.startsWith(`${rootPath}${path.sep}`);
}

function isAllowedPath(filePath) {
  return allowedRoots.some((rootPath) => isWithinRoot(filePath, rootPath));
}

function sendJson(res, statusCode, body) {
  res.writeHead(statusCode, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

function sendText(res, statusCode, message) {
  res.writeHead(statusCode, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(message);
}

async function readBody(req) {
  let body = "";
  for await (const chunk of req) {
    body += chunk.toString();
  }
  return body;
}

function parseRequestBody(bodyText) {
  try {
    const body = JSON.parse(bodyText);
    return typeof body === "object" && body !== null ? body : null;
  } catch {
    return null;
  }
}

async function handleRead(res, body) {
  const requestedPath = body.path;
  if (typeof requestedPath !== "string") {
    sendText(res, 400, "Body must include a string 'path'.");
    return;
  }

  const filePath = path.resolve(requestedPath);
  if (!isAllowedPath(filePath)) {
    sendText(res, 403, `Path is not allowed: ${filePath}`);
    return;
  }

  try {
    const content = await fs.readFile(filePath, "utf-8");
    sendJson(res, 200, { exists: true, content });
  } catch (error) {
    if (error?.code === "ENOENT") {
      sendJson(res, 200, { exists: false });
      return;
    }
    throw error;
  }
}

async function handleWrite(res, body) {
  const requestedPath = body.path;
  const content = body.content;
  if (typeof requestedPath !== "string" || typeof content !== "string") {
    sendText(res, 400, "Body must include string 'path' and 'content' fields.");
    return;
  }

  const filePath = path.resolve(requestedPath);
  if (!isAllowedPath(filePath)) {
    sendText(res, 403, `Path is not allowed: ${filePath}`);
    return;
  }

  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, "utf-8");
  sendJson(res, 200, { ok: true });
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.url === "/health") {
      sendText(res, 200, "ok");
      return;
    }

    if (req.method !== "POST") {
      sendText(res, 405, "Method not allowed");
      return;
    }

    if (req.headers["x-stack-emulator-token"] !== token) {
      sendText(res, 401, "Unauthorized");
      return;
    }

    const requestBody = parseRequestBody(await readBody(req));
    if (requestBody === null) {
      sendText(res, 400, "Invalid JSON body.");
      return;
    }

    if (req.url === "/read") {
      await handleRead(res, requestBody);
      return;
    }

    if (req.url === "/write") {
      await handleWrite(res, requestBody);
      return;
    }

    sendText(res, 404, "Not found");
  } catch (error) {
    sendText(res, 500, error instanceof Error ? error.message : String(error));
  }
});

server.listen(port, host, () => {
  console.log(`stack-qemu-file-bridge listening on ${host}:${port}`);
});
