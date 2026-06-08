type SetupTab = {
  id: string,
  label: string,
  content: string,
};

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

function codeBlock(language: string, value: string): string {
  return `<div class="code-block">
    <div class="code-title">${escapeHtml(language)}</div>
    <pre><code>${escapeHtml(value)}</code></pre>
  </div>`;
}

function getCursorInstallUrl(mcpUrl: string): string {
  const url = new URL("cursor://anysphere.cursor-deeplink/mcp/install");
  url.searchParams.set("name", "stack-auth");
  url.searchParams.set("config", Buffer.from(JSON.stringify({ url: mcpUrl })).toString("base64url"));
  return url.toString();
}

function getVsCodeInstallUrl(mcpUrl: string): string {
  const url = new URL("https://insiders.vscode.dev/redirect");
  const installPayload = JSON.stringify({
    type: "http",
    name: "stack-auth",
    url: mcpUrl,
  });
  url.searchParams.set("url", `vscode:mcp/install?${encodeURIComponent(installPayload)}`);
  return url.toString();
}

function getTabs(mcpUrl: string, cursorInstallUrl: string, vsCodeInstallUrl: string): SetupTab[] {
  return [
    {
      id: "cursor",
      label: "Cursor",
      content: `<p>Configure Hexclave MCP in Cursor IDE for enhanced code assistance.</p>
        <p><a class="button" href="${escapeHtml(cursorInstallUrl)}"><span class="button-icon">C</span>Add to Cursor</a></p>
        <h2>Manual Installation</h2>
        <p>Add the following to your <code>mcp.json</code> file:</p>
        ${codeBlock("mcp.json", `{
  "mcpServers": {
    "stack-auth": {
      "url": "${mcpUrl}"
    }
  }
}`)}`,
    },
    {
      id: "vscode",
      label: "VS Code",
      content: `<p>Configure Hexclave MCP in VS Code for enhanced code assistance.</p>
        <p><a class="button" href="${escapeHtml(vsCodeInstallUrl)}"><span class="button-icon">VS</span>Add to VS Code</a></p>
        <h2>Manual Installation</h2>
        <p>Open a terminal and run the following command:</p>
        ${codeBlock("Terminal", `code --add-mcp '{"type":"http","name":"stack-auth","url":"${mcpUrl}"}'`)}
        <p>Then, from inside VS Code, open the <code>.vscode/mcp.json</code> file and click "Start server".</p>`,
    },
    {
      id: "codex",
      label: "Codex",
      content: `<p>Configure Hexclave MCP in Codex CLI and the Codex IDE extension. The configuration is shared between both.</p>
        <p>Open a terminal and run the following command:</p>
        ${codeBlock("Terminal", `codex mcp add stack-auth --url ${mcpUrl}`)}
        <p>Verify it is configured:</p>
        ${codeBlock("Terminal", "codex mcp list")}
        <h2>Manual Installation</h2>
        <p>Alternatively, add the following to <code>~/.codex/config.toml</code>:</p>
        ${codeBlock("config.toml", `[mcp_servers.stack-auth]
url = "${mcpUrl}"`)}`,
    },
    {
      id: "claudecode",
      label: "Claude Code",
      content: `<p>Open a terminal and run the following command:</p>
        ${codeBlock("Terminal", `claude mcp add --transport http stack-auth ${mcpUrl}`)}
        <p>From within Claude Code, you can use the <code>/mcp</code> command to get more information about the server.</p>`,
    },
    {
      id: "claudedesktop",
      label: "Claude Desktop",
      content: `<p>Open Claude Desktop and navigate to Settings &gt; Connectors &gt; Add Custom Connector.</p>
        <p>Enter the name as <code>stack-auth</code> and the remote MCP server URL as <code>${escapeHtml(mcpUrl)}</code>.</p>`,
    },
    {
      id: "windsurf",
      label: "Windsurf",
      content: `<p>Copy the following JSON to your Windsurf MCP config file:</p>
        ${codeBlock("mcp.json", `{
  "mcpServers": {
    "stack-auth": {
      "serverUrl": "${mcpUrl}"
    }
  }
}`)}`,
    },
    {
      id: "chatgpt",
      label: "ChatGPT",
      content: `<div class="info">In Team, Enterprise, and Edu workspaces, only workspace owners and admins have permission to set this.</div>
        <p>Navigate to <strong>Settings &gt; Connectors</strong>.</p>
        <p>Add a custom connector with the server URL: <code>${escapeHtml(mcpUrl)}</code></p>
        <p>After this, it should be visible in Composer &gt; Deep Research Tool.</p>
        <div class="info">Connectors can only be used with <strong>Deep Research</strong>.</div>`,
    },
    {
      id: "gemini",
      label: "Gemini CLI",
      content: `<p>Add the following JSON to your Gemini CLI configuration file (<code>~/.gemini/settings.json</code>):</p>
        ${codeBlock("settings.json", `{
  "mcpServers": {
    "stack-auth": {
      "httpUrl": "${mcpUrl}",
      "headers": {
        "Accept": "application/json, text/event-stream"
      }
    }
  }
}`)}`,
    },
  ];
}

function getMarkdownInstructions(mcpUrl: string, cursorInstallUrl: string, vsCodeInstallUrl: string): string {
  return `<details name="mcp-install-instructions">
<summary>Cursor</summary>

#### Installation Link
[![Add to Cursor](https://cursor.com/deeplink/mcp-install-dark.svg)](${cursorInstallUrl})

#### Manual Installation
Add the following to your \`mcp.json\` file:

\`\`\`json
{
  "mcpServers": {
    "stack-auth": {
      "url": "${mcpUrl}"
    }
  }
}
\`\`\`
</details>

<details name="mcp-install-instructions">
<summary>VSCode</summary>

#### Installation Link
[![Install in VS Code](https://img.shields.io/badge/VS_Code-Install_Server-0098FF?style=for-the-badge&logo=visual-studio-code&logoColor=white)](${vsCodeInstallUrl})

#### Manual Installation
Open a terminal and run the following command:

\`\`\`
code --add-mcp '{"type":"http","name":"stack-auth","url":"${mcpUrl}"}'
\`\`\`

Then, from inside VS Code, open the .vscode/mcp.json file and click "Start server".
</details>

<details name="mcp-install-instructions">
<summary>Codex</summary>

Open a terminal and run the following command:
\`\`\`
codex mcp add stack-auth --url ${mcpUrl}
\`\`\`

Verify it is configured:
\`\`\`
codex mcp list
\`\`\`

Alternatively, add the following to \`~/.codex/config.toml\`:
\`\`\`toml
[mcp_servers.stack-auth]
url = "${mcpUrl}"
\`\`\`
</details>

<details name="mcp-install-instructions">
<summary>Claude Code</summary>

Open a terminal and run the following command:
\`\`\`
claude mcp add --transport http stack-auth ${mcpUrl}
\`\`\`
From within Claude Code, you can use the \`/mcp\` command to get more information about the server.
</details>

<details name="mcp-install-instructions">
<summary>Claude Desktop</summary>

Open Claude Desktop and navigate to Settings > Connectors > Add Custom Connector.

Enter the name as \`stack-auth\` and the remote MCP server URL as \`${mcpUrl}\`.
</details>

<details name="mcp-install-instructions">
<summary>Windsurf</summary>

Copy the following JSON to your Windsurf MCP config file:
\`\`\`json
{
  "mcpServers": {
    "stack-auth": {
      "serverUrl": "${mcpUrl}"
    }
  }
}
\`\`\`
</details>

<details name="mcp-install-instructions">
<summary>ChatGPT</summary>

*Note: In Team, Enterprise, and Edu workspaces, only workspace owners and admins have permission*

- Navigate to **Settings > Connectors**
- Add a custom connector with the server URL: \`${mcpUrl}\`
- It should then be visible in the Composer > Deep Research tool
- You may need to add the server as a source

*Connectors can only be used with **Deep Research***
</details>

<details name="mcp-install-instructions">
<summary>Gemini CLI</summary>

Add the following JSON to your Gemini CLI configuration file (\`~/.gemini/settings.json\`):
\`\`\`json
{
  "mcpServers": {
    "stack-auth": {
      "httpUrl": "${mcpUrl}",
      "headers": {
        "Accept": "application/json, text/event-stream"
      }
    }
  }
}
\`\`\`
</details>`;
}

function renderTabs(tabs: SetupTab[]): string {
  const tabButtons = tabs.map((tab, index) => `<button class="tab-trigger${index === 0 ? " active" : ""}" type="button" role="tab" aria-selected="${index === 0 ? "true" : "false"}" aria-controls="panel-${escapeHtml(tab.id)}" id="tab-${escapeHtml(tab.id)}" data-tab="${escapeHtml(tab.id)}">${escapeHtml(tab.label)}</button>`).join("");
  const tabPanels = tabs.map((tab, index) => `<section class="tab-panel${index === 0 ? " active" : ""}" role="tabpanel" id="panel-${escapeHtml(tab.id)}" aria-labelledby="tab-${escapeHtml(tab.id)}" data-panel="${escapeHtml(tab.id)}">${tab.content}</section>`).join("");
  return `<div class="tabs">
    <div class="tabs-list" role="tablist" aria-label="MCP clients">${tabButtons}</div>
    ${tabPanels}
  </div>`;
}

export function renderSetupPageHtml(mcpUrl: string): string {
  const cursorInstallUrl = getCursorInstallUrl(mcpUrl);
  const vsCodeInstallUrl = getVsCodeInstallUrl(mcpUrl);
  const tabs = getTabs(mcpUrl, cursorInstallUrl, vsCodeInstallUrl);
  const markdownInstructions = getMarkdownInstructions(mcpUrl, cursorInstallUrl, vsCodeInstallUrl);

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Hexclave MCP Setup</title>
    <meta name="description" content="Set up the Hexclave MCP server in Cursor, VS Code, Codex, Claude Code, Claude Desktop, Windsurf, ChatGPT, and Gemini CLI." />
    <style>
      :root {
        color-scheme: light dark;
        --background: #ffffff;
        --foreground: #0a0a0a;
        --muted: #737373;
        --muted-background: #f5f5f5;
        --border: #e5e5e5;
        --panel: #ffffff;
        --tab-active: #ffffff;
        --code-background: #fafafa;
        --button: #171717;
        --button-foreground: #ffffff;
        --info-background: #f8fafc;
      }

      @media (prefers-color-scheme: dark) {
        :root {
          --background: #09090b;
          --foreground: #fafafa;
          --muted: #a1a1aa;
          --muted-background: #18181b;
          --border: #27272a;
          --panel: #09090b;
          --tab-active: #09090b;
          --code-background: #18181b;
          --button: #fafafa;
          --button-foreground: #09090b;
          --info-background: #111827;
        }
      }

      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        background: var(--background);
        color: var(--foreground);
        font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        font-size: 16px;
        line-height: 1.65;
      }

      main {
        width: min(100% - 32px, 900px);
        margin: 0 auto;
        padding: 56px 0 80px;
      }

      .icon-row {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 32px;
        margin-bottom: 32px;
      }

      @keyframes card-in-left {
        from {
          opacity: 0;
          transform: translateX(-80px);
        }
        to {
          opacity: 1;
          transform: translateX(0);
        }
      }

      @keyframes card-in-right {
        from {
          opacity: 0;
          transform: translateX(80px);
        }
        to {
          opacity: 1;
          transform: translateX(0);
        }
      }

      @keyframes plus-in {
        from {
          opacity: 0;
          transform: scale(0.6);
        }
        to {
          opacity: 1;
          transform: scale(1);
        }
      }

      .hexclave-icon,
      .mcp-icon {
        width: 128px;
        height: 128px;
        display: grid;
        place-items: center;
        border: 1px solid var(--border);
        border-radius: 18px;
        background: var(--panel);
        font-weight: 700;
        opacity: 0;
      }

      .hexclave-icon {
        animation: card-in-left 700ms cubic-bezier(0.22, 1, 0.36, 1) forwards;
      }

      .mcp-icon {
        animation: card-in-right 700ms cubic-bezier(0.22, 1, 0.36, 1) forwards;
      }

      .plus {
        opacity: 0;
        animation: plus-in 400ms cubic-bezier(0.22, 1, 0.36, 1) 500ms forwards;
      }

      @media (prefers-reduced-motion: reduce) {
        .hexclave-icon,
        .mcp-icon,
        .plus {
          animation: none;
          opacity: 1;
        }
      }

      .hexclave-icon {
        font-size: 28px;
      }

      .mcp-icon {
        font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        font-size: 30px;
      }

      .plus {
        color: var(--muted);
        font-size: 30px;
        font-weight: 300;
      }

      h1 {
        margin: 0 0 20px;
        font-size: 32px;
        line-height: 1.2;
        letter-spacing: 0;
      }

      h2 {
        margin: 28px 0 8px;
        font-size: 20px;
        letter-spacing: 0;
      }

      p {
        margin: 0 0 16px;
      }

      a {
        color: inherit;
      }

      code {
        border: 1px solid var(--border);
        border-radius: 5px;
        background: var(--muted-background);
        padding: 1px 5px;
        font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        font-size: 0.9em;
      }

      .intro {
        max-width: 760px;
        margin: 0 auto 32px;
        text-align: center;
      }

      .tabs {
        margin-top: 28px;
      }

      .tabs-list {
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
        width: fit-content;
        max-width: 100%;
        border-radius: 8px;
        background: var(--muted-background);
        padding: 4px;
      }

      .tab-trigger {
        appearance: none;
        border: 0;
        border-radius: 6px;
        background: transparent;
        color: var(--muted);
        cursor: pointer;
        font: inherit;
        font-size: 14px;
        line-height: 1.2;
        padding: 8px 12px;
        transition: color 120ms ease-out, background 120ms ease-out;
      }

      .tab-trigger.active {
        background: var(--tab-active);
        color: var(--foreground);
        box-shadow: 0 1px 2px rgba(0, 0, 0, 0.06);
      }

      .tab-panel {
        display: none;
        border-bottom: 1px solid var(--border);
        padding: 28px 0 34px;
      }

      .tab-panel.active {
        display: block;
      }

      .button {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        min-height: 38px;
        border-radius: 6px;
        background: var(--button);
        color: var(--button-foreground);
        font-size: 14px;
        font-weight: 600;
        line-height: 1;
        padding: 10px 14px;
        text-decoration: none;
      }

      .button-icon {
        display: grid;
        place-items: center;
        width: 18px;
        height: 18px;
        border-radius: 4px;
        background: color-mix(in srgb, var(--button-foreground) 14%, transparent);
        font-size: 10px;
        font-weight: 700;
      }

      .info {
        border: 1px solid var(--border);
        border-radius: 8px;
        background: var(--info-background);
        color: var(--muted);
        margin: 0 0 16px;
        padding: 12px 14px;
      }

      .code-block {
        overflow: hidden;
        border: 1px solid var(--border);
        border-radius: 8px;
        background: var(--code-background);
        margin: 14px 0 18px;
      }

      .code-title {
        border-bottom: 1px solid var(--border);
        color: var(--muted);
        font-size: 12px;
        padding: 7px 12px;
      }

      pre {
        margin: 0;
        overflow-x: auto;
        padding: 16px;
      }

      pre code {
        border: 0;
        border-radius: 0;
        background: transparent;
        color: inherit;
        padding: 0;
        font-size: 13px;
        line-height: 1.55;
      }

      .markdown-section,
      .features-section {
        margin-top: 36px;
      }

      .markdown-section {
        border-top: 1px solid var(--border);
        border-bottom: 1px solid var(--border);
        padding: 18px 0;
      }

      .markdown-section summary {
        cursor: pointer;
        list-style-position: outside;
        padding-left: 4px;
      }

      .markdown-section summary::marker {
        color: var(--muted);
      }

      .markdown-summary-title {
        display: inline-block;
        font-size: 20px;
        font-weight: 700;
        line-height: 1.3;
      }

      .markdown-summary-description {
        color: var(--muted);
        display: block;
        margin: 6px 0 0 22px;
      }

      .markdown-copy {
        border: 1px solid var(--border);
        border-radius: 8px;
        background: color-mix(in srgb, var(--muted-background) 45%, transparent);
        margin-top: 18px;
      }

      .features-section ul {
        margin: 0;
        padding-left: 24px;
      }

      .features-section li + li {
        margin-top: 6px;
      }

      @media (max-width: 700px) {
        main {
          width: min(100% - 24px, 900px);
          padding-top: 36px;
        }

        .icon-row {
          gap: 18px;
        }

        .hexclave-icon,
        .mcp-icon {
          width: 88px;
          height: 88px;
          border-radius: 14px;
          font-size: 20px;
        }

        .mcp-icon {
          font-size: 22px;
        }

        h1 {
          font-size: 28px;
        }

        .tabs-list {
          width: 100%;
        }

        .tab-trigger {
          flex: 1 1 auto;
        }
      }
    </style>
  </head>
  <body>
    <main>
      <div class="icon-row" aria-hidden="true">
        <div class="hexclave-icon">Hexclave</div>
        <div class="plus">+</div>
        <div class="mcp-icon">MCP</div>
      </div>

      ${renderTabs(tabs)}

      <details class="markdown-section">
        <summary>
          <span class="markdown-summary-title">Markdown Instructions</span>
          <span class="markdown-summary-description">If you want to include instructions for all clients in your project's README.md file, feel free to copy the following markdown:</span>
        </summary>
        <div class="markdown-copy">
          <pre><code>${escapeHtml(markdownInstructions)}</code></pre>
        </div>
      </details>

      <section class="features-section">
        <h2>Features</h2>
        <p>The Hexclave MCP server exposes <strong><code>ask_hexclave</code></strong>, which answers questions using live documentation retrieval and the docs-site AI assistant. It can help with:</p>
        <ul>
          <li><strong>Authentication flows</strong>: Sign-in, sign-up, and user management</li>
          <li><strong>APIs and SDKs</strong>: Endpoints, examples, and framework integration</li>
          <li><strong>Best practices</strong>: Security and configuration guidance</li>
        </ul>
      </section>
    </main>
    <script>
      const triggers = Array.from(document.querySelectorAll("[data-tab]"));
      const panels = Array.from(document.querySelectorAll("[data-panel]"));
      for (const trigger of triggers) {
        trigger.addEventListener("click", () => {
          const tab = trigger.getAttribute("data-tab");
          for (const currentTrigger of triggers) {
            const isActive = currentTrigger.getAttribute("data-tab") === tab;
            currentTrigger.classList.toggle("active", isActive);
            currentTrigger.setAttribute("aria-selected", isActive ? "true" : "false");
          }
          for (const panel of panels) {
            panel.classList.toggle("active", panel.getAttribute("data-panel") === tab);
          }
        });
      }
    </script>
  </body>
</html>`;
}
