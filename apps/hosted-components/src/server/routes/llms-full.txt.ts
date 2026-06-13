import { createLlmsTextResponse, llmsFullTxt } from "@hexclave/shared/dist/ai/llms/llms";

export default {
  fetch(request: Request) {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method Not Allowed", {
        status: 405,
        headers: {
          Allow: "GET, HEAD",
        },
      });
    }
    return createLlmsTextResponse(llmsFullTxt);
  },
};
