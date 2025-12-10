FROM oven/bun:1.2.20

# ---- app setup --------------------------------------------------------------
WORKDIR /app

# Create package.json for global dependencies
RUN cat <<'EOF' > package.json
{
  "name": "freestyle-mock",
  "dependencies": {
    "arktype": "2.1.20",
    "react": "19.1.1",
    "react-dom": "19.1.1",
    "@react-email/components": "0.1.1"
  }
}
EOF

# Install global dependencies
RUN bun install

# Drop the whole server inline
RUN cat <<'EOF' > server.ts
import { serve } from "bun";
import { mkdir, writeFile, rm } from "fs/promises";
import { join } from "path";
import { spawn } from "child_process";

type LogLine = { message: string; type: string };
const preinstalledNodeModules = new Map<string, string>([
  ["arktype", "2.1.20"],
  ["react-dom", "19.1.1"],
  ["react", "19.1.1"],
  ["@react-email/components", "0.1.1"],
]);
const baseWorkDir = "/app/tmp";

serve({
  port: 8080,
  async fetch(req) {
    const url = new URL(req.url);
    if (!(req.method === "POST" && url.pathname === "/execute/v1/script")) {
      return new Response("Not found", { status: 404 });
    }

    const { script, config = {} } = await req.json();

    // 1. temp dir --------------------------------------------------------------
    await mkdir(baseWorkDir, { recursive: true });
    const workDir = join(baseWorkDir, "job-" + crypto.randomUUID());
    await mkdir(workDir, { recursive: true });

    // 2. write user script ----------------------------------------------------
    const scriptFile = join(workDir, "script.ts");
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
      const installProcess = spawn("bun", ["install"], {
        cwd: workDir,
        stdio: "pipe"
      });
      
      await new Promise((resolve, reject) => {
        installProcess.on("close", (code) => {
          if (code === 0) resolve(void 0);
          else reject(new Error(`bun install failed with code ${code}`));
        });
      });
    }

    // 4. run user script & capture logs ---------------------------------------
    const logs: LogLine[] = [];
    let result: unknown = null;
    const logMethods = ['log', 'info', 'warn', 'error', 'debug'] as const;

    const originalConsole = Object.fromEntries(logMethods.map((method) => [method, console[method]]));
    logMethods.forEach(method => {
      (console as any)[method] = (...args: any[]) => {
        logs.push({ message: args.map(String).join(' '), type: method });
        (originalConsole as any)[method](...args);
      };
    });

    const envVars = config.envVars || {};
    const previousEnv = new Map<string, string | undefined>();
    Object.entries(envVars).forEach(([key, value]) => {
      previousEnv.set(key, process.env[key]);
      process.env[key] = value;
    });

    try {
      const userModule = await import(`file://${scriptFile}`);
      const userFunction = (userModule as any).default ?? userModule;
      result = await (typeof userFunction === 'function' ? userFunction() : userFunction);
    } catch (err: any) {
      return new Response(JSON.stringify({ error: err.message || String(err), logs }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    } finally {
      previousEnv.forEach((value, key) => {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      });
      logMethods.forEach(method => {
        (console as any)[method] = originalConsole[method];
      });
      try { await rm(workDir, { recursive: true }); } catch { /* ignore */ }
    }

    return new Response(JSON.stringify({ result, logs }), {
      headers: { "Content-Type": "application/json" },
    });
  },
});
EOF

# ---- network ----------------------------------------------------------------
EXPOSE 8080

# ---- launch -----------------------------------------------------------------
CMD ["bun", "run", "server.ts"]
