FROM denoland/deno:1.46.1

# ---- app setup --------------------------------------------------------------
WORKDIR /app

# Drop the whole server inline
RUN cat <<'EOF' > server.ts
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { ensureDir } from "https://deno.land/std@0.224.0/fs/ensure_dir.ts";
import { join } from "https://deno.land/std@0.224.0/path/mod.ts";

type LogLine = { message: string; type: string };

serve(async (req) => {
  const url = new URL(req.url);
  if (!(req.method === "POST" && url.pathname === "/execute/v1/script")) {
    return new Response("Not found", { status: 404 });
  }

  const { script, config = {} } = await req.json();

  // 1. temp dir --------------------------------------------------------------
  const workDir = join("/tmp", "job-" + crypto.randomUUID());
  await ensureDir(workDir);

  // 2. write user script -----------------------------------------------------
  const scriptFile = join(workDir, "user_script.ts");
  await Deno.writeTextFile(scriptFile, script);

  // 3. (optional) pre-cache npm deps ----------------------------------------
  if (config.nodeModules && Object.keys(config.nodeModules).length) {
    const pkgs = Object.entries<string>(config.nodeModules).map(
      ([name, ver]) => `npm:${name}@${ver}`,
    );
    await new Deno.Command("deno", {
      cwd: workDir,
      args: ["cache", "--unstable", "--node-modules-dir", ...pkgs],
    }).output();
  }

  // 4. run user script & capture logs ---------------------------------------
  const logs: LogLine[] = [];
  const proxied = new Proxy(console, {
    get(t, p) {
      if (typeof p === "string" && typeof t[p as keyof Console] === "function") {
        return (...args: unknown[]) => {
          logs.push({ message: args.map(String).join(" "), type: p });
          // @ts-ignore - let it still log to container stdout
          t[p](...args);
        };
      }
      // @ts-ignore
      return t[p];
    },
  });

  let result: unknown = null;
  try {
    const original = globalThis.console;
    // @ts-ignore
    globalThis.console = proxied;

    for (const [k, v] of Object.entries(config.envVars ?? {})) Deno.env.set(k, v);

    const mod = await import(`file://${scriptFile}?t=${Date.now()}`);
    if (typeof mod.default !== "function") throw new Error("default export missing");
    result = await mod.default();

    // @ts-ignore
    globalThis.console = original;
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message, logs }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  } finally {
    try { await Deno.remove(workDir, { recursive: true }); } catch { /* ignore */ }
  }

  return new Response(JSON.stringify({ result, logs }), {
    headers: { "Content-Type": "application/json" },
  });
}, { port: 8080 });
EOF

# ---- network ----------------------------------------------------------------
EXPOSE 8080

# ---- launch -----------------------------------------------------------------
CMD ["deno", "run", "--unstable", "-A", "server.ts"]
