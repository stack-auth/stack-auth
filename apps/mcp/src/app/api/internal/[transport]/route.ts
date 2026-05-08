import { createStackMcpHandler } from "@/mcp-handler";

const handler = createStackMcpHandler({
  streamableHttpEndpoint: "/api/internal/mcp",
});

export { handler as DELETE, handler as GET, handler as POST };
