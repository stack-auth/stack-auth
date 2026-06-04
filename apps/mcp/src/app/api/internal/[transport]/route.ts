import { createHexclaveMcpHandler } from "@/mcp-handler";

const handler = createHexclaveMcpHandler({
  streamableHttpEndpoint: "/api/internal/mcp",
});

export { handler as DELETE, handler as GET, handler as POST };
