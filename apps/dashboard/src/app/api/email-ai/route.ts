import { getPublicEnvVar } from "@/lib/env";
import { stackServerApp } from "@/stack";
import { throwErr } from "@stackframe/stack-shared/dist/utils/errors";

/**
 * Sanitizes AI-generated JSX/TSX code before it is applied to the email renderer.
 *
 * Handles four common model output issues:
 * 1. Markdown code fences (```tsx ... ```) wrapping the output despite instructions
 * 2. HTML-encoded angle brackets (&lt;Component&gt; instead of <Component>)
 * 3. Bare & in JSX text content (invalid JSX; must be &amp; or {"&"})
 * 4. Semicolons used as property separators in JS object literals instead of commas
 *    (the AI confuses TypeScript interface syntax with JS object syntax).
 *    TypeScript also accepts commas in interfaces/types, so replacing ; → , is always safe.
 */
function sanitizeGeneratedCode(code: string): string {
  let result = code.trim();

  // Strip markdown code fences if the model added them despite instructions.
  // Handles ```tsx ... ``` and also plain ``` ... ```.
  if (result.startsWith("```")) {
    const lines = result.split("\n");
    lines.shift(); // remove opening ```tsx or similar
    if (lines[lines.length - 1]?.trim() === "```") {
      lines.pop(); // remove closing ```
    }
    result = lines.join("\n").trim();
  }

  // Decode common HTML entities that models sometimes emit inside code.
  // This fixes things like `&amp;&amp;` (should be `&&`) and `&lt;Container&gt;`.
  // Only decodes the entities we expect in generated TSX.
  result = result
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");

  // Fix the common model mistake of using `;` as a property separator in object literals.
  // Replace `;` with `,` only when it looks like `key: value;` followed by another `key:`.
  // This avoids touching for-loops and other valid `;` usage.
  result = result.replace(/;(\s*\n\s*[A-Za-z_$][\w$]*\s*:)/g, ",$1");

  return result;
}


export async function POST(req: Request) {
  const rawPayload: unknown = await req.json();

  if (
    typeof rawPayload !== "object" || rawPayload == null ||
    typeof (rawPayload as Record<string, unknown>).projectId !== "string" ||
    typeof (rawPayload as Record<string, unknown>).systemPrompt !== "string" ||
    !Array.isArray((rawPayload as Record<string, unknown>).tools) ||
    !Array.isArray((rawPayload as Record<string, unknown>).messages)
  ) {
    return new Response(JSON.stringify({ error: "Invalid request payload: projectId, systemPrompt, tools, and messages are required" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  // Safe to destructure after runtime validation above
  const { projectId, systemPrompt, tools, messages, quality = "smartest", speed = "fast" } = rawPayload as {
    projectId: string,
    systemPrompt: string,
    tools: string[],
    messages: unknown[],
    quality?: string,
    speed?: string,
  };

  const user = await stackServerApp.getUser({ or: "redirect" });
  const accessToken = await user.getAccessToken();

  const projects = await user.listOwnedProjects();
  const hasProjectAccess = projects.some((p) => p.id === projectId);

  if (!hasProjectAccess || accessToken == null) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 403,
      headers: { "content-type": "application/json" },
    });
  }

  const backendBaseUrl =
    getPublicEnvVar("NEXT_PUBLIC_SERVER_STACK_API_URL") ??
    getPublicEnvVar("NEXT_PUBLIC_STACK_API_URL") ??
    throwErr("Backend API URL is not configured (NEXT_PUBLIC_STACK_API_URL)");

  const backendResponse = await fetch(
    `${backendBaseUrl}/api/latest/ai/query/generate`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-stack-access-type": "admin",
        "x-stack-project-id": projectId,
        "x-stack-admin-access-token": accessToken,
      },
      body: JSON.stringify({ quality, speed, systemPrompt, tools, messages }),
    }
  );

  if (!backendResponse.ok) {
    const error = await backendResponse.json().catch(() => ({ error: "Unknown error" }));
    return new Response(JSON.stringify(error), {
      status: backendResponse.status,
      headers: { "content-type": "application/json" },
    });
  }

  const result: unknown = await backendResponse.json();
  const contentArr: Array<{ type: string, args?: { content?: string, [key: string]: unknown }, [key: string]: unknown }> =
    Array.isArray((result as Record<string, unknown> | null)?.content) ? (result as Record<string, unknown>).content as typeof contentArr : [];
  const sanitized = {
    content: contentArr.map((item) => {
      if (item.type === "tool-call" && typeof item.args?.content === "string") {
        return { ...item, args: { ...item.args, content: sanitizeGeneratedCode(item.args.content) } };
      }
      return item;
    }),
  };

  return new Response(JSON.stringify(sanitized), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
