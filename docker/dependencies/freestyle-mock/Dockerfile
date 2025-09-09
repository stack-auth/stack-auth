FROM oven/bun:1.2.20

# ---- app setup --------------------------------------------------------------
WORKDIR /app

# Create package.json for global dependencies
RUN cat <<'EOF' > package.json
{
  "name": "freestyle-mock",
  "dependencies": {
    "arktype": "2.1.2",
    "react": "19.1.1",
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

serve({
  port: 8080,
  async fetch(req) {
    const url = new URL(req.url);
    if (!(req.method === "POST" && url.pathname === "/execute/v1/script")) {
      return new Response("Not found", { status: 404 });
    }

    const { script, config = {} } = await req.json();

    // 1. temp dir --------------------------------------------------------------
    const workDir = join("/tmp", "job-" + crypto.randomUUID());
    await mkdir(workDir, { recursive: true });

    // 2. write user script and runner files -----------------------------------
    // Write the user script as-is
    const scriptFile = join(workDir, "script.ts");
    await writeFile(scriptFile, script);
    
    // Write a runner that imports from the user script
    const runnerScript = `
const logs: Array<{ message: string; type: string }> = [];

// Capture console output
const originalConsole = { ...console };
const logMethods = ['log', 'info', 'warn', 'error', 'debug'];
logMethods.forEach(method => {
  (console as any)[method] = (...args: any[]) => {
    logs.push({ message: args.map(String).join(' '), type: method });
    (originalConsole as any)[method](...args);
  };
});

// Import the user function
import userFunction from './script.ts';

try {
  const result = await (typeof userFunction === 'function' ? userFunction() : userFunction);
  console.log(JSON.stringify({ result, logs }));
} catch (error) {
  console.error(JSON.stringify({ error: error.message, logs }));
  process.exit(1);
}
`;
    const runnerFile = join(workDir, "runner.ts");
    await writeFile(runnerFile, runnerScript);

    // 2.1. create package.json for dependencies -------------------------------
    const packageJson = {
      type: "module",
      dependencies: config.nodeModules || {}
    };
    const packageJsonFile = join(workDir, "package.json");
    await writeFile(packageJsonFile, JSON.stringify(packageJson, null, 2));

    // 3. install dependencies -------------------------------------------------
    if (config.nodeModules && Object.keys(config.nodeModules).length) {
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
    try {
      // Set environment variables
      const env = { ...process.env, ...(config.envVars ?? {}) };

      // ── spawn a new Bun process ──
      const bunProcess = spawn("bun", ["run", runnerFile], {
        cwd: workDir,
        env,
        stdio: "pipe"
      });

      let stdout = "";
      let stderr = "";

      bunProcess.stdout?.on("data", (data) => {
        stdout += data.toString();
      });

      bunProcess.stderr?.on("data", (data) => {
        stderr += data.toString();
      });

      await new Promise((resolve, reject) => {
        bunProcess.on("close", (code) => {
          if (code === 0) resolve(void 0);
          else reject(new Error(stderr || `Process exited with code ${code}`));
        });
      });

      if (stderr) {
        throw new Error(stderr);
      }

      // Parse the wrapped script output
      try {
        const lines = stdout.trim().split('\n');
        const lastLine = lines[lines.length - 1];
        const parsed = JSON.parse(lastLine);
        
        if (parsed && typeof parsed === "object") {
          if ("error" in parsed) {
            throw new Error(parsed.error);
          }
          result = parsed.result;
          logs.push(...(parsed.logs || []));
        } else {
          result = parsed;
        }
      } catch (parseError) {
        // If JSON parsing fails, treat stdout as the result
        result = stdout.trim();
      }

    } catch (err: any) {
      return new Response(JSON.stringify({ error: err.message, logs }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    } finally {
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
