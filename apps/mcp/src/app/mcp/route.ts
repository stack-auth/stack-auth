import { createHexclaveMcpHandler } from "@/mcp-handler";
import { renderSetupPageHtml } from "@/setup-page";

const handler = createHexclaveMcpHandler({
  streamableHttpEndpoint: "/mcp",
});

export function GET(req: Request) {
  const accept = req.headers.get("accept") ?? "";
  if (accept.includes("text/event-stream") && !accept.includes("text/html")) {
    return handler(req);
  }

  return new Response(renderSetupPageHtml(new URL("/mcp", req.url).toString()), {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
    },
  });
}

export { handler as DELETE, handler as POST };
