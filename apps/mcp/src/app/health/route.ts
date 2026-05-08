export function GET() {
  return Response.json({
    status: "ok",
  }, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "*",
      "Access-Control-Allow-Headers": "*",
      "Access-Control-Expose-Headers": "*",
    },
  });
}
