import { yupBoolean, yupNumber, yupObject, yupString } from "@hexclave/shared/dist/schema-fields";
import { describe, expect, it } from "vitest";
import { parseOverload, parseWebhookOpenAPI } from "./openapi";

describe("parseOverload", () => {
  it("preserves false in request body examples", () => {
    const result = parseOverload({
      metadata: {
        summary: "Complete interaction",
        description: "Record a decision",
      },
      method: "POST",
      path: "/interaction",
      requestBodyDesc: yupObject({
        denied: yupBoolean().defined().meta({ openapiField: { exampleValue: false } }),
      }).describe(),
      responseVariants: [{
        responseTypeDesc: yupString().oneOf(["json"]).describe(),
        statusCodeDesc: yupNumber().oneOf([200]).describe(),
      }],
    });

    expect(result).toMatchObject({
      requestBody: {
        content: {
          "application/json": {
            schema: {
              example: { denied: false },
            },
          },
        },
      },
    });
  });
});

describe("parseWebhookOpenAPI", () => {
  it("emits machine-readable OpenAPI 3.1 types for nullable webhook fields", () => {
    const result = parseWebhookOpenAPI({
      webhooks: [{
        type: "user.created",
        schema: yupObject({
          display_name: yupString().nullable().defined(),
          status: yupString().oneOf(["active"]).nullable().defined(),
          restricted_reason: yupObject({
            type: yupString().defined(),
          }).nullable().defined(),
          is_restricted: yupBoolean().defined(),
        }).defined(),
        metadata: {
          summary: "User Created",
          description: "A user was created.",
        },
      }],
    });

    expect(result).toMatchObject({
      openapi: "3.1.0",
      webhooks: {
        "user.created": {
          post: {
            requestBody: {
              content: {
                "application/json": {
                  schema: {
                    properties: {
                      data: {
                        properties: {
                          display_name: {
                            type: ["string", "null"],
                          },
                          status: {
                            enum: ["active", null],
                            type: ["string", "null"],
                          },
                          restricted_reason: {
                            type: ["object", "null"],
                          },
                          is_restricted: {
                            type: "boolean",
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });
  });
});
