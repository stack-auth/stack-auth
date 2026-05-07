function redirectToMcp() {
  return new Response(null, {
    status: 307,
    headers: {
      Location: "/mcp",
    },
  });
}

export const DELETE = redirectToMcp;
export const GET = redirectToMcp;
export const HEAD = redirectToMcp;
export const OPTIONS = redirectToMcp;
export const PATCH = redirectToMcp;
export const POST = redirectToMcp;
export const PUT = redirectToMcp;
