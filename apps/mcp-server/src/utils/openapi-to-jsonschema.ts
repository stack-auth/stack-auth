/**
 * Type definitions for OpenAPI Parameter Object
 */
import type { OpenAPIV3_1 } from 'openapi-types';

/**
 * Type definition for JSON Schema
 */
type JSONSchema = {
  type: 'object',
  properties: Record<string, any>,
  required?: string[],
}

/**
 * Type guard to check if an object is a ReferenceObject
 * @param obj - Object to check
 * @returns True if object is a ReferenceObject, false otherwise
 */
function isReferenceObject(obj: any): obj is OpenAPIV3_1.ReferenceObject {
  return obj !== null && typeof obj === 'object' && '$ref' in obj;
}


/**
 * Converts an OpenAPI Parameter Object Array to a JSON Schema
 * @param parameterObjectArray - Array of OpenAPI Parameter Objects
 * @returns JSON Schema representation of the parameters
 */
function convertParameterArrayToJsonSchema(parameterObjectArray: (OpenAPIV3_1.ParameterObject | OpenAPIV3_1.ReferenceObject)[], requestBody?: OpenAPIV3_1.RequestBodyObject | OpenAPIV3_1.ReferenceObject): {
  type: "object",
  properties: Record<string, any>,
  required: string[],
} {
  if (!Array.isArray(parameterObjectArray)) {
    throw new Error('Input must be an array of parameter objects');
  }


  const properties = new Map<string, any>();
  const requiredParams: string[] = [];

  parameterObjectArray.forEach(param => {

    if (isReferenceObject(param)) {
      throw new Error('Reference objects are not supported');
    }
    if (!param.name) {
      throw new Error('Parameter object must have a name');
    }

    const newParamName = param.name + "###" + param.in;

    // Extract the schema from the parameter
    let schema: Record<string, any> = param.schema ?
      (typeof param.schema === 'object' ? { ...param.schema } : {}) :
      {};

    // If the parameter has its own type/format, use those instead
    if ('type' in param && param.type) {
      schema.type = param.type;
    }
    if ('format' in param && param.format) {
      schema.format = param.format;
    }

    // Copy description if available
    if (param.description) {
      schema.description = param.description;
    }

    // Copy example if available
    if ('example' in param && param.example !== undefined) {
      schema.example = param.example;
    }

    // Handle enum values
    if ('enum' in param && param.enum) {
      schema.enum = param.enum;
    }

    // Add default value if specified
    if ('default' in param && param.default !== undefined) {
      schema.default = param.default;
    }

    // Add parameter to properties
    properties.set(newParamName, schema);

    // Add to required array if necessary
    if (param.required === true) {
      requiredParams.push(newParamName);
    }
  });

  if (requestBody) {
    const body = handleRequestBody(requestBody);
    if (body) {
      properties.set("###body###", body.properties);
      requiredParams.push("###body###");
    }
  }

  // Convert Map back to Record for return type
  const propertiesRecord: Record<string, any> = {};
  properties.forEach((value, key) => {
    propertiesRecord[key] = value;
  });

  const jsonSchema = {
    type: 'object' as const,
    properties: propertiesRecord,
    required: requiredParams
  };


  return jsonSchema;
}

export { convertParameterArrayToJsonSchema };
export type { JSONSchema };


function handleRequestBody(requestBody: OpenAPIV3_1.RequestBodyObject | OpenAPIV3_1.ReferenceObject) {

  if (isReferenceObject(requestBody)) {
    throw new Error('Reference objects are not supported');
  }


  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  if (!requestBody.content["application/json"]) {
    throw new Error('Request body must be of type application/json');
  }
  const body_schema = requestBody.content["application/json"].schema;
  if (!body_schema || isReferenceObject(body_schema)) {
    throw new Error('Reference objects are not supported');
  }

  if (!body_schema.properties) {
    return;
  }

  // We simplify the body into one property, called "body"

  return {
    type: "string",
    properties: {
      body: JSON.stringify(body_schema)
    },
    required: ["body"]
  };


}
