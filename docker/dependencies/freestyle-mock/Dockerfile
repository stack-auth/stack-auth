FROM node:22-slim

# ---- app setup --------------------------------------------------------------
WORKDIR /app

# Create package.json for global dependencies
RUN cat <<'EOF' > package.json
{
  "name": "freestyle-mock",
  "type": "module",
  "dependencies": {
    "arktype": "2.1.20",
    "react": "19.1.1",
    "react-dom": "19.1.1",
    "@react-email/components": "1.0.6"
  }
}
EOF

# Install global dependencies
RUN npm install

# Drop the whole server inline
RUN cat <<'EOF' > server.mjs
import { createServer } from "http";
import { mkdir, writeFile, rm } from "fs/promises";
import { join } from "path";
import { spawn } from "child_process";
import { randomUUID } from "crypto";

const preinstalledNodeModules = new Map([
  ["arktype", "2.1.20"],
  ["react-dom", "19.1.1"],
  ["react", "19.1.1"],
  ["@react-email/components", "1.0.6"],
]);
const baseWorkDir = "/app/tmp";


const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const isValidEndpoint = req.method === "POST" && (url.pathname === "/execute/v1/script" || url.pathname === "/execute/v2/script");
  
  if (!isValidEndpoint) {
    res.writeHead(404);
    res.end("Not found");
    return;
  }

  // Read body
  let body = "";
  for await (const chunk of req) {
    body += chunk;
  }
  const { script, config = {} } = JSON.parse(body);

  // 1. temp dir --------------------------------------------------------------
  await mkdir(baseWorkDir, { recursive: true });
  const workDir = join(baseWorkDir, "job-" + randomUUID());
  await mkdir(workDir, { recursive: true });

  // 2. write user script ----------------------------------------------------
  const scriptFile = join(workDir, "script.mjs");
  await writeFile(scriptFile, script);

  // 2.1. create package.json for dependencies -------------------------------
  const packageJson = {
    type: "module",
    dependencies: config.nodeModules || {}
  };
  const packageJsonFile = join(workDir, "package.json");
  await writeFile(packageJsonFile, JSON.stringify(packageJson, null, 2));

  // 3. install dependencies -------------------------------------------------
  const requestedNodeModules = config.nodeModules || {};
  const needsInstall = Object.entries(requestedNodeModules).some(([name, version]) => {
    return preinstalledNodeModules.get(name) !== version;
  });

  if (needsInstall && Object.keys(requestedNodeModules).length) {
    const installProcess = spawn("npm", ["install"], {
      cwd: workDir,
      stdio: "pipe"
    });
    
    await new Promise((resolve, reject) => {
      installProcess.on("close", (code) => {
        if (code === 0) resolve();
        else reject(new Error(`npm install failed with code ${code}`));
      });
    });
  }

  // 4. run user script & capture logs ---------------------------------------
  const logs = [];
  let result = null;
  const logMethods = ['log', 'info', 'warn', 'error', 'debug'];

  const originalConsole = Object.fromEntries(logMethods.map((method) => [method, console[method]]));
  logMethods.forEach(method => {
    console[method] = (...args) => {
      logs.push({ message: args.map(String).join(' '), type: method });
      originalConsole[method](...args);
    };
  });

  const envVars = config.envVars || {};
  const previousEnv = new Map();
  Object.entries(envVars).forEach(([key, value]) => {
    previousEnv.set(key, process.env[key]);
    process.env[key] = value;
  });

  try {
    const userModule = await import(`file://${scriptFile}`);
    const userFunction = userModule.default ?? userModule;
    result = await (typeof userFunction === 'function' ? userFunction() : userFunction);
  } catch (err) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: err?.message || String(err), logs }));
    return;
  } finally {
    previousEnv.forEach((value, key) => {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    });
    logMethods.forEach(method => {
      console[method] = originalConsole[method];
    });
    try { await rm(workDir, { recursive: true }); } catch { /* ignore */ }
  }

  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ result, logs }));
});

server.listen(8080);
EOF

# ---- network ----------------------------------------------------------------
EXPOSE 8080

# ---- launch -----------------------------------------------------------------
CMD ["node", "server.mjs"]
