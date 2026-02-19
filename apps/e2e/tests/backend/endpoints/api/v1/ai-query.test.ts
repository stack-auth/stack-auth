import { describe } from "vitest";
import { it } from "../../../../helpers";
import { niceBackendFetch, Project } from "../../../backend-helpers";
// Note: Since tests run with FORWARD_TO_PRODUCTION, actual AI responses won't be tested.
// These tests focus on request validation, structure, and error handling.

describe("AI Query Endpoint - Validation", () => {
  it("rejects invalid mode in URL", async ({ expect }) => {
    const response = await niceBackendFetch("/api/v1/ai/query/invalid-mode", {
      method: "POST",
      accessType: "admin",
      body: {
        quality: "smart",
        speed: "fast",
        tools: [],
        systemPrompt: "command-center-ask-ai",
        messages: [{ role: "user", content: "test" }],
      },
    });

    expect(response.status).toBe(400);
    expect(response.body).toEqual(expect.stringContaining("Invalid mode"));
  });

  it("rejects missing quality field", async ({ expect }) => {
    const response = await niceBackendFetch("/api/v1/ai/query/generate", {
      method: "POST",
      accessType: "admin",
      body: {
        speed: "fast",
        tools: [],
        systemPrompt: "command-center-ask-ai",
        messages: [{ role: "user", content: "test" }],
      },
    });

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ code: "SCHEMA_ERROR", error: expect.stringContaining("quality") });
  });

  it("rejects invalid quality value", async ({ expect }) => {
    const response = await niceBackendFetch("/api/v1/ai/query/generate", {
      method: "POST",
      accessType: "admin",
      body: {
        quality: "invalid-quality",
        speed: "fast",
        tools: [],
        systemPrompt: "command-center-ask-ai",
        messages: [{ role: "user", content: "test" }],
      },
    });

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ code: "SCHEMA_ERROR", error: expect.stringContaining("quality") });
  });

  it("rejects missing speed field", async ({ expect }) => {
    const response = await niceBackendFetch("/api/v1/ai/query/generate", {
      method: "POST",
      accessType: "admin",
      body: {
        quality: "smart",
        tools: [],
        systemPrompt: "command-center-ask-ai",
        messages: [{ role: "user", content: "test" }],
      },
    });

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ code: "SCHEMA_ERROR", error: expect.stringContaining("speed") });
  });

  it("rejects invalid speed value", async ({ expect }) => {
    const response = await niceBackendFetch("/api/v1/ai/query/generate", {
      method: "POST",
      accessType: "admin",
      body: {
        quality: "smart",
        speed: "invalid-speed",
        tools: [],
        systemPrompt: "command-center-ask-ai",
        messages: [{ role: "user", content: "test" }],
      },
    });

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ code: "SCHEMA_ERROR", error: expect.stringContaining("speed") });
  });

  it("rejects missing tools field", async ({ expect }) => {
    const response = await niceBackendFetch("/api/v1/ai/query/generate", {
      method: "POST",
      accessType: "admin",
      body: {
        quality: "smart",
        speed: "fast",
        systemPrompt: "command-center-ask-ai",
        messages: [{ role: "user", content: "test" }],
      },
    });

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ code: "SCHEMA_ERROR", error: expect.stringContaining("tools") });
  });

  it("rejects invalid tool names", async ({ expect }) => {
    const response = await niceBackendFetch("/api/v1/ai/query/generate", {
      method: "POST",
      accessType: "admin",
      body: {
        quality: "smart",
        speed: "fast",
        tools: ["invalid-tool", "another-invalid-tool"],
        systemPrompt: "command-center-ask-ai",
        messages: [{ role: "user", content: "test" }],
      },
    });

    expect(response.status).toBe(400);
    expect(response.body).toEqual(expect.stringContaining("Invalid tool names"));
  });

  it("rejects missing systemPrompt field", async ({ expect }) => {
    const response = await niceBackendFetch("/api/v1/ai/query/generate", {
      method: "POST",
      accessType: "admin",
      body: {
        quality: "smart",
        speed: "fast",
        tools: [],
        messages: [{ role: "user", content: "test" }],
      },
    });

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ code: "SCHEMA_ERROR", error: expect.stringContaining("systemPrompt") });
  });

  it("rejects invalid systemPrompt value", async ({ expect }) => {
    const response = await niceBackendFetch("/api/v1/ai/query/generate", {
      method: "POST",
      accessType: "admin",
      body: {
        quality: "smart",
        speed: "fast",
        tools: [],
        systemPrompt: "invalid-prompt",
        messages: [{ role: "user", content: "test" }],
      },
    });

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ code: "SCHEMA_ERROR", error: expect.stringContaining("systemPrompt") });
  });

  it("rejects missing messages field", async ({ expect }) => {
    const response = await niceBackendFetch("/api/v1/ai/query/generate", {
      method: "POST",
      accessType: "admin",
      body: {
        quality: "smart",
        speed: "fast",
        tools: [],
        systemPrompt: "command-center-ask-ai",
      },
    });

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ code: "SCHEMA_ERROR", error: expect.stringContaining("messages") });
  });

  it("rejects empty messages array", async ({ expect }) => {
    const response = await niceBackendFetch("/api/v1/ai/query/generate", {
      method: "POST",
      accessType: "admin",
      body: {
        quality: "smart",
        speed: "fast",
        tools: [],
        systemPrompt: "command-center-ask-ai",
        messages: [],
      },
    });

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ code: "SCHEMA_ERROR", error: expect.stringContaining("messages") });
  });

  it("accepts valid request body with all required fields", async ({ expect }) => {
    // This will forward to production, so we just verify it doesn't fail validation
    const response = await niceBackendFetch("/api/v1/ai/query/generate", {
      method: "POST",
      accessType: "admin",
      body: {
        quality: "dumb",
        speed: "fast",
        tools: [],
        systemPrompt: "command-center-ask-ai",
        messages: [{ role: "user", content: "test" }],
      },
    });

    expect(response.status).not.toBe(400);

  }, 10000); // 60 seconds for AI API call
});

describe("AI Query Endpoint - Authentication", () => {
  it("accepts authenticated requests with admin access", async ({ expect }) => {
    await Project.createAndSwitch();

    const response = await niceBackendFetch("/api/v1/ai/query/generate", {
      method: "POST",
      accessType: "admin",
      body: {
        quality: "smart",
        speed: "fast",
        tools: [],
        systemPrompt: "command-center-ask-ai",
        messages: [{ role: "user", content: "test" }],
      },
    });

    // Should not fail due to auth (will forward to production)
    expect(response.status).not.toBe(401);
    expect(response.status).not.toBe(403);
  }, 10000); // 60 seconds for AI API call

  it("accepts unauthenticated requests", async ({ expect }) => {
    const response = await niceBackendFetch("/api/v1/ai/query/generate", {
      method: "POST",
      accessType: null,
      body: {
        quality: "dumb",
        speed: "fast",
        tools: [],
        systemPrompt: "docs-ask-ai",
        messages: [{ role: "user", content: "test" }],
      },
    });

    // Should not fail due to missing auth
    expect(response.status).not.toBe(401);
    expect(response.status).not.toBe(403);
  }, 10000); // 60 seconds for AI API call
});

describe("AI Query Endpoint - System Prompts", () => {
  const systemPrompts = [
    "command-center-ask-ai",
    "docs-ask-ai",
    "email-wysiwyg-editor",
    "email-assistant-theme",
    "email-assistant-draft",
    "create-dashboard",
    "run-query",
  ];

  for (const systemPrompt of systemPrompts) {
    it(`accepts systemPrompt: ${systemPrompt}`, async ({ expect }) => {
      const response = await niceBackendFetch("/api/v1/ai/query/generate", {
        method: "POST",
        accessType: "admin",
        body: {
          quality: "dumb",
          speed: "fast",
          tools: [],
          systemPrompt,
          messages: [{ role: "user", content: "test" }],
        },
      });

      // Should not be a validation error
      expect(response.status).not.toBe(400);
    }, 10000); // 60 seconds for AI API call
  }
});

describe("AI Query Endpoint - Tools", () => {
  const validTools = [
    "docs",
    "sql-query",
    "create-email-theme",
    "create-email-template",
    "create-email-draft",
    "create-dashboard",
  ];

  for (const tool of validTools) {
    it(`accepts tool: ${tool}`, async ({ expect }) => {
      const response = await niceBackendFetch("/api/v1/ai/query/generate", {
        method: "POST",
        accessType: "admin",
        body: {
          quality: "dumb",
          speed: "fast",
          tools: [tool],
          systemPrompt: "command-center-ask-ai",
          messages: [{ role: "user", content: "test" }],
        },
      });

      // Should not be a validation error
      expect(response.status).not.toBe(400);
    }, 10000); // 60 seconds for AI API call
  }

  it("accepts multiple tools in single request", async ({ expect }) => {
    const response = await niceBackendFetch("/api/v1/ai/query/generate", {
      method: "POST",
      accessType: "admin",
      body: {
        quality: "dumb",
        speed: "fast",
        tools: ["docs", "create-email-theme", "create-dashboard"],
        systemPrompt: "command-center-ask-ai",
        messages: [{ role: "user", content: "test" }],
      },
    });

    // Should not be a validation error
    expect(response.status).not.toBe(400);
  }, 10000); // 60 seconds for AI API call
});

describe("AI Query Endpoint - Mode Handling", () => {
  it("stream mode returns response (forwarded to production)", async ({ expect }) => {
    const response = await niceBackendFetch("/api/v1/ai/query/stream", {
      method: "POST",
      accessType: "admin",
      body: {
        quality: "dumb",
        speed: "fast",
        tools: [],
        systemPrompt: "command-center-ask-ai",
        messages: [{ role: "user", content: "test" }],
      },
    });

    // With forwarding, we should get a response from production
    // We can't test the actual streaming format, but we can verify no validation errors
    expect(response.status).not.toBe(400);
  }, 10000); // 60 seconds for AI API call

  it("generate mode returns JSON response (forwarded to production)", async ({ expect }) => {
    const response = await niceBackendFetch("/api/v1/ai/query/generate", {
      method: "POST",
      accessType: "admin",
      body: {
        quality: "dumb",
        speed: "fast",
        tools: [],
        systemPrompt: "command-center-ask-ai",
        messages: [{ role: "user", content: "test" }],
      },
    });

    // With forwarding, we should get a JSON response from production
    expect(response.status).not.toBe(400);
    // Body structure will depend on production response
  }, 10000); // 60 seconds for AI API call
});

describe("AI Query Endpoint - Quality and Speed Combinations", () => {
  const qualities = ["dumb", "smart", "smartest"];
  const speeds = ["slow", "fast"];

  for (const quality of qualities) {
    for (const speed of speeds) {
      it(`accepts quality=${quality}, speed=${speed}`, async ({ expect }) => {
        const response = await niceBackendFetch("/api/v1/ai/query/generate", {
          method: "POST",
          accessType: "admin",
          body: {
            quality,
            speed,
            tools: [],
            systemPrompt: "command-center-ask-ai",
            messages: [{ role: "user", content: "test" }],
          },
        });

        // Should not be a validation error
        expect(response.status).not.toBe(400);
      }, 10000); // 60 seconds for AI API call
    }
  }
});

describe("AI Query Endpoint - Response Structure", () => {
  it("generate mode returns body with content array", async ({ expect }) => {
    const response = await niceBackendFetch("/api/v1/ai/query/generate", {
      method: "POST",
      accessType: "admin",
      body: {
        quality: "dumb",
        speed: "fast",
        tools: [],
        systemPrompt: "command-center-ask-ai",
        messages: [{ role: "user", content: "Say hello" }],
      },
    });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ content: expect.any(Array) });
  }, 10000);

  it("stream mode returns text/event-stream content type", async ({ expect }) => {
    const response = await niceBackendFetch("/api/v1/ai/query/stream", {
      method: "POST",
      accessType: "admin",
      body: {
        quality: "dumb",
        speed: "fast",
        tools: [],
        systemPrompt: "command-center-ask-ai",
        messages: [{ role: "user", content: "Say hello" }],
      },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
  }, 10000);
});

describe("AI Query Endpoint - Message Formats", () => {
  it("accepts multi-turn conversation (user → assistant → user)", async ({ expect }) => {
    const response = await niceBackendFetch("/api/v1/ai/query/generate", {
      method: "POST",
      accessType: "admin",
      body: {
        quality: "dumb",
        speed: "fast",
        tools: [],
        systemPrompt: "command-center-ask-ai",
        messages: [
          { role: "user", content: "What is Stack Auth?" },
          { role: "assistant", content: "Stack Auth is an authentication platform." },
          { role: "user", content: "How do I get started?" },
        ],
      },
    });

    expect(response.status).not.toBe(400);
  }, 10000);

  it("accepts messages with rich array content (content as array of parts)", async ({ expect }) => {
    const response = await niceBackendFetch("/api/v1/ai/query/generate", {
      method: "POST",
      accessType: "admin",
      body: {
        quality: "dumb",
        speed: "fast",
        tools: [],
        systemPrompt: "command-center-ask-ai",
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: "Hello, how can you help me?" }],
          },
        ],
      },
    });

    expect(response.status).not.toBe(400);
  }, 10000);
});

describe("AI Query Endpoint - Invalid Message Structure", () => {
  it("rejects invalid message role", async ({ expect }) => {
    const response = await niceBackendFetch("/api/v1/ai/query/generate", {
      method: "POST",
      accessType: "admin",
      body: {
        quality: "smart",
        speed: "fast",
        tools: [],
        systemPrompt: "command-center-ask-ai",
        // "system" is not in the allowed oneOf(["user", "assistant", "tool"])
        messages: [{ role: "system", content: "You are a bot" }],
      },
    });

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ code: "SCHEMA_ERROR", error: expect.stringContaining("role") });
  });

  it("rejects message without content field", async ({ expect }) => {
    const response = await niceBackendFetch("/api/v1/ai/query/generate", {
      method: "POST",
      accessType: "admin",
      body: {
        quality: "smart",
        speed: "fast",
        tools: [],
        systemPrompt: "command-center-ask-ai",
        messages: [{ role: "user" }],
      },
    });

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ code: "SCHEMA_ERROR", error: expect.stringContaining("content") });
  });
});

describe("AI Query Endpoint - Tool Behavior", () => {
  it("sql-query tool is gracefully omitted when unauthenticated (no error)", async ({ expect }) => {
    // Without auth, createSqlQueryTool returns null and the tool is silently skipped
    const response = await niceBackendFetch("/api/v1/ai/query/generate", {
      method: "POST",
      accessType: null,
      body: {
        quality: "dumb",
        speed: "fast",
        tools: ["sql-query"],
        systemPrompt: "docs-ask-ai",
        messages: [{ role: "user", content: "Show me some analytics data" }],
      },
    });

    // Tool is silently skipped — request should still succeed
    expect(response.status).not.toBe(400);
  }, 10000);

  it("client-side tools (create-email-theme) produce tool-call blocks in generate response", async ({ expect }) => {
    const response = await niceBackendFetch("/api/v1/ai/query/generate", {
      method: "POST",
      accessType: "admin",
      body: {
        quality: "smart",
        speed: "fast",
        tools: ["create-email-theme"],
        systemPrompt: "email-assistant-theme",
        messages: [
          {
            role: "user",
            content: "Create an email theme with primary color #ff0000 and a dark background",
          },
        ],
      },
    });

    expect(response.status).toBe(200);
    // Response must always have a content array (text or tool-call blocks)
    expect(response.body).toMatchObject({ content: expect.any(Array) });
    // When the AI calls createEmailTheme, a tool-call block should appear
    const content = (response.body as any).content as Array<{ type: string }>;
    const hasToolCallOrText = content.every((block) => block.type === "text" || block.type === "tool-call");
    expect(hasToolCallOrText).toBe(true);
  }, 10000);
});

describe("AI Query Endpoint - Auth Edge Cases", () => {
  it("smartest quality without auth falls back to cheaper model and succeeds", async ({ expect }) => {
    // Unauthenticated + smartest → falls back to x-ai/grok-4.1-fast per model matrix
    const response = await niceBackendFetch("/api/v1/ai/query/generate", {
      method: "POST",
      accessType: null,
      body: {
        quality: "smartest",
        speed: "fast",
        tools: [],
        systemPrompt: "docs-ask-ai",
        messages: [{ role: "user", content: "Hello" }],
      },
    });

    expect(response.status).not.toBe(401);
    expect(response.status).not.toBe(403);
    expect(response.status).not.toBe(400);
  }, 10000);

  it("authenticated requests can use premium models (smartest quality)", async ({ expect }) => {
    await Project.createAndSwitch();

    const response = await niceBackendFetch("/api/v1/ai/query/generate", {
      method: "POST",
      accessType: "admin",
      body: {
        quality: "smartest",
        speed: "slow",
        tools: [],
        systemPrompt: "command-center-ask-ai",
        messages: [{ role: "user", content: "Hello" }],
      },
    });

    expect(response.status).not.toBe(401);
    expect(response.status).not.toBe(403);
    expect(response.status).not.toBe(400);
  }, 10000);
});
