import { SmartRouteHandler } from '@/route-handlers/smart-route-handler';
import { CrudlOperation, EndpointDocumentation } from '@stackframe/stack-shared/dist/crud';
import { WebhookEvent } from '@stackframe/stack-shared/dist/interface/webhooks';
import { yupNumber, yupObject, yupString } from '@stackframe/stack-shared/dist/schema-fields';
import { StackAssertionError, throwErr } from '@stackframe/stack-shared/dist/utils/errors';
import { HttpMethod } from '@stackframe/stack-shared/dist/utils/http';
import { typedEntries, typedFromEntries } from '@stackframe/stack-shared/dist/utils/objects';
import { deindent, stringCompare } from '@stackframe/stack-shared/dist/utils/strings';
import * as yup from 'yup';

export function parseOpenAPI(options: {
  endpoints: Map<string, Map<HttpMethod, SmartRouteHandler>>,
  audience: 'client' | 'server' | 'admin',
}) {
  return {
    openapi: '3.1.0',
    info: {
      title: 'Stack REST API',
      version: '1.0.0',
    },
    servers: [{
      url: 'https://api.stack-auth.com/api/v1',
      description: 'Stack REST API',
    }],
    paths: Object.fromEntries(
      [...options.endpoints]
        .map(([path, handlersByMethod]) => (
          [path, Object.fromEntries(
            [...handlersByMethod]
              .map(([method, handler]) => (
                [method.toLowerCase(), parseRouteHandler({ handler, method, path, audience: options.audience })]
              ))
              .filter(([_, handler]) => handler !== undefined)
          )]
        ))
        .filter(([_, handlersByMethod]) => Object.keys(handlersByMethod).length > 0)
        .sort(([_a, handlersByMethodA], [_b, handlersByMethodB]) => stringCompare((Object.values(handlersByMethodA)[0] as any).tags[0] ?? "", (Object.values(handlersByMethodB)[0] as any).tags[0] ?? "")),
    ),
  };
}

export function parseWebhookOpenAPI(options: {
  webhooks: readonly WebhookEvent<any>[],
}) {
  return {
    openapi: '3.1.0',
    info: {
      title: 'Stack Webhooks API',
      version: '1.0.0',
    },
    webhooks: options.webhooks.reduce((acc, webhook) => {
      return {
        ...acc,
        [webhook.type]: {
          post: {
            ...parseOverload({
              metadata: webhook.metadata,
              method: 'POST',
              path: webhook.type,
              requestBodyDesc: undefinedIfMixed(yupObject({
                type: yupString().defined().meta({ openapiField: { description: webhook.type, exampleValue: webhook.type } }),
                data: webhook.schema.defined(),
              }).describe()) || yupObject().describe(),
              responseTypeDesc: yupString().oneOf(['json']).describe(),
              statusCodeDesc: yupNumber().oneOf([200]).describe(),
            }),
            operationId: webhook.type,
            summary: webhook.type,
          }
        },
      };
    }, {}),
  };
}

function undefinedIfMixed(value: yup.SchemaFieldDescription | undefined): yup.SchemaFieldDescription | undefined {
  if (!value) return undefined;
  return value.type === 'mixed' ? undefined : value;
}

function isSchemaObjectDescription(value: yup.SchemaFieldDescription): value is yup.SchemaObjectDescription & { type: 'object' } {
  return value.type === 'object';
}

function isSchemaMixedDescription(value: yup.SchemaFieldDescription): value is yup.SchemaDescription & { type: 'mixed' } {
  return value.type === 'mixed';
}

function isSchemaArrayDescription(value: yup.SchemaFieldDescription): value is yup.SchemaInnerTypeDescription & { type: 'array', innerType: yup.SchemaInnerTypeDescription } {
  return value.type === 'array';
}

function isSchemaTupleDescription(value: yup.SchemaFieldDescription): value is yup.SchemaInnerTypeDescription & { type: 'tuple', innerType: yup.SchemaInnerTypeDescription[] } {
  return value.type === 'tuple';
}

function isSchemaStringDescription(value: yup.SchemaFieldDescription): value is yup.SchemaDescription & { type: 'string' } {
  return value.type === 'string';
}

function isSchemaNumberDescription(value: yup.SchemaFieldDescription): value is yup.SchemaDescription & { type: 'number' } {
  return value.type === 'number';
}

function isMaybeRequestSchemaForAudience(requestDescribe: yup.SchemaObjectDescription, audience: 'client' | 'server' | 'admin') {
  const schemaAuth = requestDescribe.fields.auth;
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- yup types are wrong and claim that fields always exist
  if (!schemaAuth) return true;
  if (isSchemaMixedDescription(schemaAuth)) return true;
  if (!isSchemaObjectDescription(schemaAuth)) return true;
  const schemaAudience = schemaAuth.fields.type;
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- same as above
  if (!schemaAudience) return true;
  if ("oneOf" in schemaAudience && schemaAudience.oneOf.length > 0) {
    return schemaAudience.oneOf.includes(audience);
  }
  return true;
}


function parseRouteHandler(options: {
  handler: SmartRouteHandler,
  path: string,
  method: HttpMethod,
  audience: 'client' | 'server' | 'admin',
}) {
  let result: any = undefined;

  for (const overload of options.handler.overloads.values()) {
    if (overload.metadata?.hidden) continue;

    const requestDescribe = overload.request.describe();
    const responseDescribe = overload.response.describe();
    if (!isSchemaObjectDescription(requestDescribe)) throw new Error('Request schema must be a yup.ObjectSchema');
    if (!isSchemaObjectDescription(responseDescribe)) throw new Error('Response schema must be a yup.ObjectSchema');

    // estimate whether this overload is the right one based on a heuristic
    if (!isMaybeRequestSchemaForAudience(requestDescribe, options.audience)) {
      // This overload is definitely not for the audience
      continue;
    }

    if (result) {
      throw new StackAssertionError(deindent`
        OpenAPI generator matched multiple overloads for audience ${options.audience} on endpoint ${options.method} ${options.path}.
        
        This does not necessarily mean there is a bug in the endpoint; the OpenAPI generator uses a heuristic to pick the allowed overloads, and may pick too many. Currently, this heuristic checks whether the request.auth.type property in the schema is a yup.string.oneOf(...) and matches it to the expected audience of the schema. If there are multiple overloads matching a single audience, for example because none of the overloads specify request.auth.type, the OpenAPI generator will not know which overload to generate specs for, and hence fails.
        
        Either specify request.auth.type on the schema of the specified endpoint or update the OpenAPI generator to support your use case. 
      `);
    }

    result = parseOverload({
      metadata: overload.metadata,
      method: options.method,
      path: options.path,
      pathDesc: undefinedIfMixed(requestDescribe.fields.params),
      parameterDesc: undefinedIfMixed(requestDescribe.fields.query),
      headerDesc: undefinedIfMixed(requestDescribe.fields.headers),
      requestBodyDesc: undefinedIfMixed(requestDescribe.fields.body),
      responseDesc: undefinedIfMixed(responseDescribe.fields.body),
      responseTypeDesc: undefinedIfMixed(responseDescribe.fields.bodyType) ?? throwErr('Response type must be defined and not mixed', { options, bodyTypeField: responseDescribe.fields.bodyType }),
      statusCodeDesc: undefinedIfMixed(responseDescribe.fields.statusCode) ?? throwErr('Status code must be defined and not mixed', { options, statusCodeField: responseDescribe.fields.statusCode }),
    });
  }

  return result;
}

function getFieldSchema(field: yup.SchemaFieldDescription, crudOperation?: Capitalize<CrudlOperation>): { type: string, items?: any, properties?: any, required?: any, default?: any } | undefined {
  const meta = "meta" in field ? field.meta : {};
  if (meta?.openapiField?.hidden) {
    return undefined;
  }

  if (meta?.openapiField?.onlyShowInOperations && !meta.openapiField.onlyShowInOperations.includes(crudOperation as any)) {
    return undefined;
  }

  const openapiFieldExtra = {
    example: meta?.openapiField?.exampleValue,
    description: meta?.openapiField?.description,
    default: (field as any).default,
  };

  switch (field.type) {
    case 'string':
    case 'number':
    case 'boolean': {
      return { type: field.type, ...openapiFieldExtra };
    }
    case 'mixed': {
      return { type: 'object', ...openapiFieldExtra };
    }
    case 'object': {
      return {
        type: 'object',
        properties: typedFromEntries(typedEntries((field as any).fields)
          .map(([key, field]) => [key, getFieldSchema(field, crudOperation)])),
        required: typedEntries((field as any).fields)
          .filter(([_, field]) => !(field as any).optional && !(field as any).nullable && getFieldSchema(field as any, crudOperation))
          .map(([key]) => key),
        ...openapiFieldExtra
      };
    }
    case 'array': {
      return { type: 'array', items: getFieldSchema((field as any).innerType, crudOperation), ...openapiFieldExtra };
    }
    default: {
      throw new Error(`Unsupported field type: ${field.type}`);
    }
  }
}

function toParameters(description: yup.SchemaFieldDescription, crudOperation?: Capitalize<CrudlOperation>, path?: string) {
  const pathParams: string[] = path ? path.match(/{[^}]+}/g) || [] : [];
  if (!isSchemaObjectDescription(description)) {
    throw new StackAssertionError('Parameters field must be an object schema', { actual: description });
  }

  return Object.entries(description.fields).map(([key, field]) => {
    if (path && !pathParams.includes(`{${key}}`)) {
      return { schema: undefined };
    }

    const meta = "meta" in field ? field.meta : {};
    const schema = getFieldSchema(field, crudOperation);
    return {
      name: key,
      in: path ? 'path' : 'query',
      schema,
      description: meta?.openapiField?.description,
      required: !(field as any).optional && !!schema,
    };
  }).filter((x) => x.schema !== undefined);
}

function toHeaderParameters(description: yup.SchemaFieldDescription, crudOperation?: Capitalize<CrudlOperation>) {
  if (!isSchemaObjectDescription(description)) {
    throw new StackAssertionError('Parameters field must be an object schema', { actual: description });
  }

  return Object.entries(description.fields).map(([key, tupleField]) => {
    if (!isSchemaTupleDescription(tupleField)) {
      throw new StackAssertionError('Header field must be a tuple schema', { actual: tupleField, key });
    }
    if (tupleField.innerType.length !== 1) {
      throw new StackAssertionError('Header fields of length !== 1 not currently supported', { actual: tupleField, key });
    }
    const field = tupleField.innerType[0];
    const meta = "meta" in field ? field.meta : {};
    const schema = getFieldSchema(field, crudOperation);
    return {
      name: key,
      in: 'header',
      type: 'string',
      schema,
      description: meta?.openapiField?.description,
      example: meta?.openapiField?.exampleValue,
      required: !(field as any).optional && !(field as any).nullable && !!schema,
    };
  }).filter((x) => x.schema !== undefined);
}

function toSchema(description: yup.SchemaFieldDescription, crudOperation?: Capitalize<CrudlOperation>): any {
  if (isSchemaObjectDescription(description)) {
    return {
      type: 'object',
      properties: Object.fromEntries(Object.entries(description.fields).map(([key, field]) => {
        return [key, getFieldSchema(field, crudOperation)];
      }, {}))
    };
  } else if (isSchemaArrayDescription(description)) {
    return {
      type: 'array',
      items: toSchema(description.innerType, crudOperation),
    };
  } else {
    throw new StackAssertionError(`Unsupported schema type in toSchema: ${description.type}`, { actual: description });
  }
}

function toRequired(description: yup.SchemaFieldDescription, crudOperation?: Capitalize<CrudlOperation>) {
  let res: string[] = [];
  if (isSchemaObjectDescription(description)) {
    res = Object.entries(description.fields)
      .filter(([_, field]) => !(field as any).optional && !(field as any).nullable && getFieldSchema(field, crudOperation))
      .map(([key]) => key);
  } else if (isSchemaArrayDescription(description)) {
    res = [];
  } else {
    throw new StackAssertionError(`Unsupported schema type in toRequired: ${description.type}`, { actual: description });
  }
  if (res.length === 0) return undefined;
  return res;
}

function toExamples(description: yup.SchemaFieldDescription, crudOperation?: Capitalize<CrudlOperation>) {
  if (!isSchemaObjectDescription(description)) {
    throw new StackAssertionError('Examples field must be an object schema', { actual: description });
  }

  return Object.entries(description.fields).reduce((acc, [key, field]) => {
    const schema = getFieldSchema(field, crudOperation);
    if (!schema) return acc;
    const example = "meta" in field ? field.meta?.openapiField?.exampleValue : undefined;
    return { ...acc, [key]: example };
  }, {});
}

export function parseOverload(options: {
  metadata: EndpointDocumentation | undefined,
  method: string,
  path: string,
  pathDesc?: yup.SchemaFieldDescription,
  parameterDesc?: yup.SchemaFieldDescription,
  headerDesc?: yup.SchemaFieldDescription,
  requestBodyDesc?: yup.SchemaFieldDescription,
  responseDesc?: yup.SchemaFieldDescription,
  responseTypeDesc: yup.SchemaFieldDescription,
  statusCodeDesc: yup.SchemaFieldDescription,
}) {
  const endpointDocumentation = options.metadata ?? {
    summary: `${options.method} ${options.path}`,
    description: `No documentation available for this endpoint.`,
  };
  if (endpointDocumentation.hidden) {
    return undefined;
  }

  const pathParameters = options.pathDesc ? toParameters(options.pathDesc, endpointDocumentation.crudOperation, options.path) : [];
  const queryParameters = options.parameterDesc ? toParameters(options.parameterDesc, endpointDocumentation.crudOperation) : [];
  const headerParameters = options.headerDesc ? toHeaderParameters(options.headerDesc, endpointDocumentation.crudOperation) : [];

  let requestBody;
  if (options.requestBodyDesc) {
    requestBody = {
      required: true,
      content: {
        'application/json': {
          schema: {
            ...toSchema(options.requestBodyDesc, endpointDocumentation.crudOperation),
            required: toRequired(options.requestBodyDesc, endpointDocumentation.crudOperation),
            example: toExamples(options.requestBodyDesc, endpointDocumentation.crudOperation),
          },
        },
      },
    };
  }

  const exRes = {
    summary: endpointDocumentation.summary,
    description: endpointDocumentation.description,
    parameters: [...queryParameters, ...pathParameters, ...headerParameters],
    requestBody,
    tags: endpointDocumentation.tags ?? ["Others"],
  } as const;

  if (!isSchemaStringDescription(options.responseTypeDesc)) {
    throw new StackAssertionError(`Expected response type to be a string`, { actual: options.responseTypeDesc, options });
  }
  if (options.responseTypeDesc.oneOf.length !== 1) {
    throw new StackAssertionError(`Expected response type to have exactly one value`, { actual: options.responseTypeDesc, options });
  }
  const bodyType = options.responseTypeDesc.oneOf[0];

  if (!isSchemaNumberDescription(options.statusCodeDesc)) {
    throw new StackAssertionError('Expected status code to be a number', { actual: options.statusCodeDesc, options });
  }

  // Get all status codes or use 200 as default if none specified
  const statusCodes: number[] = options.statusCodeDesc.oneOf.length > 0
    ? options.statusCodeDesc.oneOf as number[]
    : [200]; // TODO HACK hardcoded, used in case all status codes may be returned, should be configurable per endpoint

  switch (bodyType) {
    case 'json': {
      const responses = statusCodes.reduce((acc, status) => {
        return {
          ...acc,
          [status]: {
            description: 'Successful response',
            content: {
              'application/json': {
                schema: {
                  ...options.responseDesc ? toSchema(options.responseDesc, endpointDocumentation.crudOperation) : {},
                  required: options.responseDesc ? toRequired(options.responseDesc, endpointDocumentation.crudOperation) : undefined,
                },
              },
            },
          },
        };
      }, {});

      return {
        ...exRes,
        responses,
      };
    }
    case 'text': {
      if (!options.responseDesc || !isSchemaStringDescription(options.responseDesc)) {
        throw new StackAssertionError('Expected response body of bodyType=="text" to be a string schema', { actual: options.responseDesc });
      }
      const responses = statusCodes.reduce((acc, status) => {
        return {
          ...acc,
          [status]: {
            description: 'Successful response',
            content: {
              'text/plain': {
                schema: {
                  type: 'string',
                  example: options.responseDesc && isSchemaStringDescription(options.responseDesc) ? options.responseDesc.meta?.openapiField?.exampleValue : undefined,
                },
              },
            },
          },
        };
      }, {});

      return {
        ...exRes,
        responses,
      };
    }
    case 'success': {
      const responses = statusCodes.reduce((acc, status) => {
        return {
          ...acc,
          [status]: {
            description: 'Successful response',
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    success: {
                      type: "boolean",
                      description: "Always equal to true.",
                      example: true,
                    },
                  },
                  required: ["success"],
                },
              },
            },
          },
        };
      }, {});

      return {
        ...exRes,
        responses,
      };
    }
    case 'empty': {
      const responses = statusCodes.reduce((acc, status) => {
        return {
          ...acc,
          [status]: {
            description: 'No content',
          },
        };
      }, {});

      return {
        ...exRes,
        responses,
      };
    }
    default: {
      throw new StackAssertionError(`Unsupported body type: ${bodyType}`);
    }
  }
}
