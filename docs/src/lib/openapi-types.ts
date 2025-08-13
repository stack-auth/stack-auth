// Types for OpenAPI specification
export type OpenAPISchema = {
  type?: 'string' | 'number' | 'integer' | 'boolean' | 'array' | 'object' | 'null',
  properties?: Record<string, OpenAPISchema>,
  items?: OpenAPISchema,
  required?: string[],
  enum?: (string | number)[],
  example?: unknown,
  description?: string,
  format?: string,
  pattern?: string,
  minLength?: number,
  maxLength?: number,
  minimum?: number,
  maximum?: number,
  $ref?: string,
  allOf?: OpenAPISchema[],
  oneOf?: OpenAPISchema[],
  anyOf?: OpenAPISchema[],
  not?: OpenAPISchema,
  additionalProperties?: boolean | OpenAPISchema,
}

export type OpenAPISpec = {
  openapi: string,
  info: {
    title: string,
    version: string,
    description?: string,
  },
  servers?: Array<{
    url: string,
    description?: string,
  }>,
  paths: Record<string, Record<string, OpenAPIOperation>>,
  components?: {
    schemas?: Record<string, OpenAPISchema>,
    securitySchemes?: Record<string, unknown>,
  },
}

export type OpenAPIParameter = {
  name: string,
  in: 'query' | 'path' | 'header' | 'cookie',
  required?: boolean,
  description?: string,
  schema: OpenAPISchema,
  example?: unknown,
}

export type OpenAPIOperation = {
  summary?: string,
  description?: string,
  operationId?: string,
  tags?: string[],
  parameters?: OpenAPIParameter[],
  requestBody?: {
    required?: boolean,
    content: {
      'application/json'?: {
        schema: OpenAPISchema,
      },
    },
  },
  responses: Record<string, {
    description: string,
    content?: {
      'application/json'?: {
        schema: OpenAPISchema,
      },
    },
  }>,
  security?: Array<Record<string, string[]>>,
}
