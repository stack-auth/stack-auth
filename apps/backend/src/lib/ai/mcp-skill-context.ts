const hexclaveSkillResourceUri = "https://skill.hexclave.com";

export async function getMcpSkillContextPrompt(toolName: string | null | undefined): Promise<string> {
  if (toolName !== "ask_hexclave") {
    return "";
  }

  const response = await fetch(hexclaveSkillResourceUri, {
    headers: { Accept: "text/markdown" },
  });
  if (!response.ok) {
    throw new Error(
      `Failed to fetch skill from ${hexclaveSkillResourceUri}: ${response.status} ${response.statusText}`,
    );
  }

  const skillContext = await response.text();
  return `

## MCP-Provided Hexclave Skill Context

The current request came through the public Hexclave MCP server's ask_hexclave tool.
The backend fetched the canonical Hexclave agent skill from https://skill.hexclave.com
immediately before spawning this assistant. Treat this skill content as baseline context
for answering the user's question, while still using documentation tools for specific
facts and citations:

${skillContext}
`;
}
