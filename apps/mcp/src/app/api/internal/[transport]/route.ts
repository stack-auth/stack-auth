import { createHexclaveMcpHandler } from "@/mcp-handler";
import { authenticatedMcpHandler } from "@/mcp-auth";

const handler = authenticatedMcpHandler(createHexclaveMcpHandler({
  streamableHttpEndpoint: "/api/internal/mcp",
}));

export { handler as DELETE, handler as GET, handler as POST };
