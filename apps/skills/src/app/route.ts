import { skillSitePrompt } from "../../../../packages/stack-shared/src/ai/unified-prompts/skill-site-prompt";

const SKILL_MD = skillSitePrompt;

const COMMON_HEADERS = {
  "Cache-Control": "public, max-age=3600, s-maxage=3600",
  // CDN must cache markdown (curl/agents) and HTML (browser navigate) separately.
  "Vary": "Accept",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  "Access-Control-Allow-Headers": "*",
} as const;

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const INSTALL_CMD = "npx @hexclave/cli@latest init";

function renderHtml(): string {
  const skillEscaped = escapeHtml(SKILL_MD);
  const installEscaped = escapeHtml(INSTALL_CMD);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="theme-color" content="#0a0a0a" media="(prefers-color-scheme: dark)" />
<meta name="theme-color" content="#fafafa" media="(prefers-color-scheme: light)" />
<title>Hexclave Skill</title>
<meta name="description" content="The Hexclave agent skill — user management, auth, payments, emails, analytics, and the Hexclave CLI." />
<style>
  :root {
    color-scheme: light dark;
    --bg: #fafafa;
    --fg: #0a0a0a;
    --muted: #6b6b6b;
    --border: #e5e5e5;
    --surface: #ffffff;
    --accent: #0a0a0a;
    --accent-fg: #ffffff;
    --ring: #2563eb;
    --code-bg: #f4f4f5;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #0a0a0a;
      --fg: #fafafa;
      --muted: #a1a1aa;
      --border: #27272a;
      --surface: #111113;
      --accent: #fafafa;
      --accent-fg: #0a0a0a;
      --ring: #60a5fa;
      --code-bg: #161618;
    }
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: var(--bg); color: var(--fg); }
  body {
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Inter, Roboto, sans-serif;
    font-size: 16px;
    line-height: 1.55;
    -webkit-font-smoothing: antialiased;
    text-rendering: optimizeLegibility;
  }
  a { color: inherit; text-underline-offset: 3px; }
  a:hover { text-decoration-thickness: 2px; }
  :focus-visible { outline: 2px solid var(--ring); outline-offset: 2px; border-radius: 4px; }
  .skip { position: absolute; left: -9999px; }
  .skip:focus { left: 16px; top: 16px; background: var(--surface); padding: 8px 12px; border: 1px solid var(--border); border-radius: 6px; z-index: 10; }
  main { max-width: 880px; margin: 0 auto; padding: 64px 24px 96px; }
  header { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 48px; }
  .brand { display: flex; align-items: center; gap: 10px; font-weight: 600; letter-spacing: -0.01em; }
  .brand-dot { width: 10px; height: 10px; border-radius: 2px; background: var(--accent); }
  .ghost {
    display: inline-flex; align-items: center; gap: 6px;
    padding: 6px 10px; border: 1px solid var(--border); border-radius: 6px;
    color: var(--muted); text-decoration: none; font-size: 13px;
    transition: color 120ms ease, border-color 120ms ease, background-color 120ms ease;
  }
  .ghost:hover { color: var(--fg); border-color: var(--fg); }
  h1 { font-size: clamp(32px, 4vw, 44px); line-height: 1.1; letter-spacing: -0.025em; margin: 0 0 16px; text-wrap: balance; font-weight: 600; }
  .lede { font-size: 18px; color: var(--muted); margin: 0 0 40px; text-wrap: pretty; max-width: 64ch; }
  h2 { font-size: 20px; letter-spacing: -0.01em; margin: 48px 0 12px; font-weight: 600; }
  p { margin: 0 0 12px; }
  .install {
    display: flex; align-items: stretch; gap: 0;
    border: 1px solid var(--border); border-radius: 8px; overflow: hidden;
    background: var(--surface);
  }
  .install code {
    flex: 1; min-width: 0;
    padding: 12px 14px;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 14px;
    overflow-x: auto;
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
  }
  .copy-btn {
    appearance: none; border: 0; border-left: 1px solid var(--border);
    background: var(--surface); color: var(--fg);
    padding: 0 16px; font-size: 13px; font-weight: 500;
    cursor: pointer; min-width: 88px;
    transition: background-color 120ms ease, color 120ms ease;
    font-family: inherit;
  }
  .copy-btn:hover { background: var(--accent); color: var(--accent-fg); }
  .copy-btn[data-state="copied"] { background: var(--accent); color: var(--accent-fg); }
  details {
    margin-top: 16px;
    border: 1px solid var(--border); border-radius: 8px;
    background: var(--surface);
    overflow: hidden;
  }
  summary {
    list-style: none; cursor: pointer;
    padding: 12px 16px;
    font-weight: 500; font-size: 14px;
    display: flex; align-items: center; justify-content: space-between; gap: 12px;
  }
  summary::-webkit-details-marker { display: none; }
  summary::after { content: "Show"; color: var(--muted); font-size: 13px; font-weight: 400; }
  details[open] summary::after { content: "Hide"; }
  summary:hover { background: var(--code-bg); }
  pre {
    margin: 0; padding: 16px;
    background: var(--code-bg);
    border-top: 1px solid var(--border);
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 13px; line-height: 1.6;
    overflow-x: auto;
    max-height: 60vh;
    overflow-y: auto;
  }
  .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px; margin-top: 8px; }
  .card {
    display: block; padding: 16px;
    border: 1px solid var(--border); border-radius: 8px;
    background: var(--surface); color: inherit; text-decoration: none;
    transition: border-color 120ms ease, transform 120ms ease;
  }
  .card:hover { border-color: var(--fg); }
  .card-title { font-weight: 500; margin-bottom: 4px; }
  .card-desc { color: var(--muted); font-size: 14px; }
  footer { margin-top: 64px; padding-top: 24px; border-top: 1px solid var(--border); color: var(--muted); font-size: 13px; display: flex; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
  @media (prefers-reduced-motion: reduce) {
    * { transition: none !important; animation: none !important; }
  }
</style>
</head>
<body>
<a class="skip" href="#main">Skip to Content</a>
<main id="main">
  <header>
    <div class="brand"><span class="brand-dot" aria-hidden="true"></span><span translate="no">Hexclave</span></div>
    <a class="ghost" href="https://docs.hexclave.com" rel="noreferrer">Docs&nbsp;↗</a>
  </header>

  <h1>The Hexclave Agent Skill</h1>
  <p class="lede">This endpoint serves the canonical <span translate="no">SKILL.md</span> that teaches coding agents how to wire Hexclave into a project — auth, orgs, payments, emails, analytics, and the <span translate="no">hexclave-cli</span>.</p>

  <h2>Install in One Command</h2>
  <p>Run this in any project root. It detects your agent, installs the skill, registers the MCP server, and writes credentials.</p>
  <div class="install" role="group" aria-label="Install command">
    <code id="install-cmd" translate="no">${installEscaped}</code>
    <button class="copy-btn" type="button" aria-label="Copy install command" data-copy="${installEscaped}">Copy</button>
  </div>

  <h2>Fetch the Skill Directly</h2>
  <p>Agents and tools fetch the markdown from this same URL — content negotiation serves <span translate="no">text/markdown</span> to non-browser clients.</p>
  <div class="cards">
    <a class="card" href="https://docs.hexclave.com/guides/getting-started/ai-integration" rel="noreferrer">
      <div class="card-title">AI Integration Guide</div>
      <div class="card-desc">How to point an agent at this skill.</div>
    </a>
    <a class="card" href="https://mcp.hexclave.com" rel="noreferrer">
      <div class="card-title">MCP Server</div>
      <div class="card-desc">Ask questions over the docs with citations.</div>
    </a>
    <a class="card" href="https://docs.hexclave.com/guides/going-further/cli" rel="noreferrer">
      <div class="card-title">CLI Reference</div>
      <div class="card-desc">Every <span translate="no">hexclave-cli</span> command and flag.</div>
    </a>
  </div>

  <h2>Skill Source</h2>
  <details>
    <summary>View the full <span translate="no">SKILL.md</span></summary>
    <pre><code>${skillEscaped}</code></pre>
  </details>

  <footer>
    <span>© Hexclave</span>
    <a href="https://github.com/hexclave/hexclave" rel="noreferrer">GitHub&nbsp;↗</a>
  </footer>
</main>
<script>
  (function () {
    var btn = document.querySelector(".copy-btn");
    if (!btn) return;
    btn.addEventListener("click", async function () {
      var text = btn.getAttribute("data-copy") || "";
      try {
        await navigator.clipboard.writeText(text);
      } catch (_e) {
        var range = document.createRange();
        range.selectNode(document.getElementById("install-cmd"));
        var sel = window.getSelection();
        if (sel) { sel.removeAllRanges(); sel.addRange(range); document.execCommand("copy"); sel.removeAllRanges(); }
      }
      btn.textContent = "Copied";
      btn.setAttribute("data-state", "copied");
      setTimeout(function () { btn.textContent = "Copy"; btn.removeAttribute("data-state"); }, 1500);
    });
  })();
</script>
</body>
</html>`;
}

const MARKDOWN_PREFERRING_TYPES = new Set(["*/*", "text/plain", "text/markdown", "text/x-markdown"]);

function wantsHtml(req: Request): boolean {
  // Browsers send `Accept: text/html,...` before `*/*`; curl/fetch/agents send
  // `*/*` (or omit Accept). Serve HTML only when text/html appears AND is
  // listed before any markdown-preferring type that would otherwise win.
  const accept = req.headers.get("accept") ?? "";
  const types = accept.split(",").map((part) => part.trim().split(";")[0].trim().toLowerCase());
  const htmlIndex = types.indexOf("text/html");
  if (htmlIndex === -1) return false;
  const competitorIndex = types.findIndex((t) => MARKDOWN_PREFERRING_TYPES.has(t));
  return competitorIndex === -1 || htmlIndex < competitorIndex;
}

export function GET(req: Request) {
  if (wantsHtml(req)) {
    return new Response(renderHtml(), {
      headers: {
        ...COMMON_HEADERS,
        "Content-Type": "text/html; charset=utf-8",
      },
    });
  }
  return new Response(SKILL_MD, {
    headers: {
      ...COMMON_HEADERS,
      "Content-Type": "text/markdown; charset=utf-8",
    },
  });
}

export function HEAD(req: Request) {
  return GET(req);
}
