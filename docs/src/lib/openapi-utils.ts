import type { OpenAPISchema, OpenAPISpec } from '../components/api/enhanced-api-page';

/**
 * Resolves $ref references in OpenAPI schemas
 * @param schema - The schema to resolve
 * @param spec - The OpenAPI specification containing the schema definitions
 * @returns The resolved schema
 */
export const resolveSchema = (schema: OpenAPISchema, spec: OpenAPISpec): OpenAPISchema => {
  if (schema.$ref) {
    const refPath = schema.$ref.replace('#/', '').split('/');
    let refSchema: any = spec;
    for (const part of refPath) {
      refSchema = refSchema?.[part];
      if (!refSchema) {
        console.error(`Failed to resolve $ref: ${schema.$ref}`);
        return schema;
      }
    }
    return refSchema as OpenAPISchema;
  }
  return schema;
};
