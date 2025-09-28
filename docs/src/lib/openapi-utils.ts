import type { OpenAPISchema, OpenAPISpec } from './openapi-types';

/**
 * Resolves $ref references in OpenAPI schemas recursively
 * @param schema - The schema to resolve
 * @param spec - The OpenAPI specification containing the schema definitions
 * @param visited - Set of visited $ref paths to prevent infinite recursion
 * @returns The resolved schema
 */
export const resolveSchema = (schema: OpenAPISchema, spec: OpenAPISpec, visited = new Set<string>()): OpenAPISchema => {
  if (schema.$ref) {
    // Prevent infinite recursion
    if (visited.has(schema.$ref)) {
      console.warn(`Circular $ref reference detected: ${schema.$ref}`);
      return schema;
    }

    visited.add(schema.$ref);
    const refPath = schema.$ref.replace('#/', '').split('/');
    let refSchema: Record<string, unknown> = spec as Record<string, unknown>;
    for (const part of refPath) {
      const nextSchema = refSchema[part];
      if (!nextSchema || typeof nextSchema !== 'object') {
        console.error(`Failed to resolve $ref: ${schema.$ref}`);
        return schema;
      }
      refSchema = nextSchema as Record<string, unknown>;
    }

    // Recursively resolve the resolved schema in case it contains more $refs
    const resolvedSchema = resolveSchema(refSchema as OpenAPISchema, spec, visited);
    visited.delete(schema.$ref);
    return resolvedSchema;
  }
  return schema;
};
