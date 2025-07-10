'use client';

import { ArrowRight, Check, Code, Copy, Sparkles, Webhook } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { codeToHtml } from 'shiki';
import { Button } from './button';

// Types for OpenAPI specification (focused on webhooks)
type OpenAPISchema = {
  type?: 'string' | 'number' | 'integer' | 'boolean' | 'array' | 'object' | 'null',
  properties?: Record<string, OpenAPISchema>,
  items?: OpenAPISchema,
  required?: string[],
  example?: unknown,
  description?: string,
  $ref?: string,
  allOf?: OpenAPISchema[],
  oneOf?: OpenAPISchema[],
  anyOf?: OpenAPISchema[],
  enum?: unknown[],
  format?: string,
  minimum?: number,
  maximum?: number,
  minLength?: number,
  maxLength?: number,
  pattern?: string,
  additionalProperties?: boolean | OpenAPISchema,
}

type ShikiNode = {
  properties: {
    style?: string,
  },
}

type ShikiTransformer = {
  pre?: (node: ShikiNode) => void,
  code?: (node: ShikiNode) => void,
}

type OpenAPISpec = {
  openapi: string,
  info: {
    title: string,
    version: string,
    description?: string,
  },
  webhooks?: Record<string, Record<string, OpenAPIWebhookOperation>>,
  components?: {
    schemas?: Record<string, OpenAPISchema>,
    securitySchemes?: Record<string, unknown>,
  },
}

type OpenAPIWebhookOperation = {
  summary?: string,
  description?: string,
  operationId?: string,
  tags?: string[],
  requestBody?: {
    required?: boolean,
    content: Record<string, {
      schema: OpenAPISchema,
    }>,
  },
  responses?: Record<string, {
    description: string,
    content?: Record<string, {
      schema: OpenAPISchema,
    }>,
  }>,
}

type WebhooksAPIPageProps = {
  document: string,
  webhooks: Array<{
    name: string,
    method: string,
  }>,
  description?: string,
}

export function WebhooksAPIPage({ document, webhooks, description }: WebhooksAPIPageProps) {
  const [spec, setSpec] = useState<OpenAPISpec | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Load OpenAPI specification
  useEffect(() => {
    const loadSpec = async () => {
      try {
        setLoading(true);
        // Remove "public/" prefix since Next.js serves public files from root
        const documentPath = document.startsWith('public/') ? document.slice(7) : document;
        const response = await fetch(`/${documentPath}`);
        if (!response.ok) {
          throw new Error(`Failed to load OpenAPI spec: ${response.statusText}`);
        }
        const specData = await response.json();
        setSpec(specData);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load API specification');
      } finally {
        setLoading(false);
      }
    };

    loadSpec().catch(err => {
      setError(err instanceof Error ? err.message : 'Failed to load API specification');
    });
  }, [document]);

  const copyToClipboard = useCallback(async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch (err) {
      console.error('Failed to copy to clipboard:', err);
    }
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="flex flex-col items-center gap-4">
          <div className="relative">
            <div className="animate-spin rounded-full h-12 w-12 border-4 border-fd-muted"></div>
            <div className="animate-spin rounded-full h-12 w-12 border-4 border-t-fd-primary absolute top-0"></div>
          </div>
          <p className="text-fd-muted-foreground text-sm text-center leading-relaxed m-0">Loading webhook specification...</p>
        </div>
      </div>
    );
  }

  if (error || !spec) {
    return (
      <div className="max-w-2xl mx-auto mt-12">
        <div className="border border-red-200 dark:border-red-800 rounded-xl p-8 bg-gradient-to-br from-red-50 to-red-100/50 dark:from-red-900/20 dark:to-red-800/20">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
              <span className="text-red-600 dark:text-red-400 text-xl leading-none">⚠️</span>
            </div>
            <h3 className="text-lg font-semibold text-red-800 dark:text-red-300 leading-tight m-0">
              Failed to load webhook specification
            </h3>
          </div>
          <p className="text-red-600 dark:text-red-400 leading-relaxed m-0">{error || 'Unknown error occurred'}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-fd-background">
      {/* Webhooks */}
      {webhooks.map(({ name, method }) => {
        const webhook = spec.webhooks?.[name]?.[method.toLowerCase()];
        if (!webhook) {
          console.warn(`Webhook not found: ${name} ${method}`);
          return null;
        }
        return (
          <ModernWebhookDisplay
            key={`${method}-${name}`}
            webhook={webhook}
            name={name}
            method={method.toUpperCase()}
            spec={spec}
            onCopy={(text: string) => {
              copyToClipboard(text)
                .catch(error => console.error('Failed to copy to clipboard:', error));
            }}
            description={description || webhook.description}
          />
        );
      })}
    </div>
  );
}

// Modern Webhook Display Component
function ModernWebhookDisplay({
  webhook,
  name,
  method,
  spec,
  onCopy,
  description,
}: {
  webhook: OpenAPIWebhookOperation,
  name: string,
  method: string,
  spec: OpenAPISpec,
  onCopy: (text: string) => void,
  description?: string,
}) {
  const [copied, setCopied] = useState(false);
  const [activeCodeTab, setActiveCodeTab] = useState<'javascript' | 'python' | 'payload'>('payload');
  const [highlightedCode, setHighlightedCode] = useState<string>("");

  const handleCopy = async (text: string) => {
    onCopy(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Helper function to generate example data from OpenAPI schema
  const generateExampleFromSchema = useCallback((schema: OpenAPISchema, spec?: OpenAPISpec, visited = new Set()): unknown => {
    // Prevent infinite recursion with circular references
    const schemaKey = JSON.stringify(schema);
    if (visited.has(schemaKey)) {
      return {};
    }
    visited.add(schemaKey);

    // Handle $ref references
    if (schema.$ref) {
      const refPath = schema.$ref.replace('#/', '').split('/');
      let refSchema: OpenAPISchema | undefined = spec as unknown as OpenAPISchema;
      for (const part of refPath) {
        refSchema = (refSchema as Record<string, unknown>)[part] as OpenAPISchema;
      }
      return generateExampleFromSchema(refSchema!, spec, visited);
    }

    // Handle allOf (merge all schemas)
    if (schema.allOf?.length) {
      let merged: Record<string, unknown> = {};
      for (const subSchema of schema.allOf) {
        const subExample = generateExampleFromSchema(subSchema, spec, visited);
        if (typeof subExample === 'object' && subExample !== null) {
          merged = { ...merged, ...subExample };
        }
      }
      return merged;
    }

    // Handle oneOf/anyOf (use first schema)
    if (schema.oneOf?.length || schema.anyOf?.length) {
      const schemas = schema.oneOf || schema.anyOf;
      return generateExampleFromSchema(schemas![0], spec, visited);
    }

    // Handle object type
    if (schema.type === 'object' && schema.properties) {
      const example: Record<string, unknown> = {};

      const requiredFields = schema.required || [];
      const allFields = Object.keys(schema.properties);

      // First add required fields in the order they appear in the required array
      requiredFields.forEach((key: string) => {
        example[key] = generateExampleFromSchema(schema.properties![key], spec, visited);
      });

      // Then add optional fields
      allFields.forEach((key: string) => {
        if (!requiredFields.includes(key)) {
          example[key] = generateExampleFromSchema(schema.properties![key], spec, visited);
        }
      });

      return example;
    }

    // Handle generic objects (like metadata) - objects without specific properties
    if (schema.type === 'object') {
      return { "string": {} };
    }

    // Handle array type
    if (schema.type === 'array') {
      if (schema.items) {
        const itemExample = generateExampleFromSchema(schema.items, spec, visited);
        return [itemExample];
      }
      return [];
    }

    // Handle primitive types
    if (schema.type === 'string') return "string";
    if (schema.type === 'number' || schema.type === 'integer') return 1;
    if (schema.type === 'boolean') return true;
    if (schema.type === 'null') return null;

    // Fallback for unknown schemas
    return "string";
  }, []);

  const getPayloadExample = useCallback(() => {
    if (webhook.requestBody?.content['application/json']?.schema) {
      const jsonContent = webhook.requestBody.content['application/json'];
      // console.log('Webhook schema:', JSON.stringify(jsonContent.schema, null, 2));
      const examplePayload = generateExampleFromSchema(jsonContent.schema, spec);
      // console.log('Generated payload:', JSON.stringify(examplePayload, null, 2));
      return JSON.stringify(examplePayload, null, 2);
    }

    // Fallback example
    return JSON.stringify({
      type: "string",
      data: {
        "string": {}
      }
    }, null, 2);
  }, [webhook, spec, generateExampleFromSchema]);

  const generateJavaScriptHandler = useCallback(() => {
    return `// Express.js webhook handler example
app.post('/webhook', (req, res) => {
  const { type, data } = req.body;

  if (type === '${name}') {
    console.log('Received ${webhook.summary || name}:', data);

    // Process the webhook event
    // Add your business logic here

    res.status(200).json({ success: true });
  } else {
    res.status(400).json({ error: 'Unknown event type' });
  }
});`;
  }, [webhook, name]);

  const generatePythonHandler = useCallback(() => {
    return `# Flask webhook handler example
from flask import Flask, request, jsonify

@app.route('/webhook', methods=['POST'])
def handle_webhook():
    data = request.get_json()
    event_type = data.get('type')
    event_data = data.get('data')

    if event_type == '${name}':
        print(f'Received ${webhook.summary || name}: {event_data}')

        # Process the webhook event
        # Add your business logic here

        return jsonify({'success': True}), 200
    else:
        return jsonify({'error': 'Unknown event type'}), 400`;
  }, [webhook, name]);

  const getCodeExample = useCallback(() => {
    switch (activeCodeTab) {
      case 'payload': {
        return getPayloadExample();
      }
      case 'javascript': {
        return generateJavaScriptHandler();
      }
      case 'python': {
        return generatePythonHandler();
      }
      default: {
        return getPayloadExample();
      }
    }
  }, [activeCodeTab, getPayloadExample, generateJavaScriptHandler, generatePythonHandler]);

  // Update syntax highlighted code when active tab changes
  useEffect(() => {
    const updateHighlightedCode = async () => {
      try {
        const code = getCodeExample();
        let language = 'javascript';

        switch (activeCodeTab) {
          case 'payload': {
            language = 'json';
            break;
          }
          case 'javascript': {
            language = 'javascript';
            break;
          }
          case 'python': {
            language = 'python';
            break;
          }
        }

        const html = await codeToHtml(code, {
          lang: language,
          theme: language === 'json' ? 'one-dark-pro' : 'github-dark',
          transformers: [{
            pre(node: ShikiNode) {
              // Remove background styles from pre element
              if (node.properties.style) {
                node.properties.style = (node.properties.style as string).replace(/background[^;]*;?/g, '');
              }
            },
            code(node: ShikiNode) {
              // Remove background styles from code element
              if (node.properties.style) {
                node.properties.style = (node.properties.style as string).replace(/background[^;]*;?/g, '');
              }
            }
          } as ShikiTransformer]
        });
        setHighlightedCode(html);
      } catch (error) {
        console.error('Error highlighting code:', error);
        setHighlightedCode(`<pre><code>${getCodeExample()}</code></pre>`);
      }
    };

    updateHighlightedCode().catch(error => {
      console.error('Error updating highlighted code:', error);
    });
  }, [activeCodeTab, getCodeExample]);

  return (
    <div className="max-w-6xl mx-auto px-6 py-8">
      {/* Header Section */}
      <div className="mb-8 border-b border-fd-border pb-8">
        <div className="flex items-start justify-between gap-8">
          <div className="flex-1 min-w-0">
            {/* Method Badge and Title Row */}
            <div className="flex items-center gap-4 mb-6">
              <span className="inline-flex items-center justify-center px-3 py-1 rounded-md bg-gradient-to-r from-purple-500 to-purple-600 text-white shadow-purple-500/25 font-mono font-bold text-sm tracking-wider leading-none min-w-[70px] h-7">
                EVENT
              </span>
              <div className="h-8 w-px bg-fd-border"></div>
              <div className="text-2xl font-bold text-fd-foreground leading-none">
                {webhook.summary || name}
              </div>
            </div>

            {/* Event Type */}
            <div className="flex items-center gap-3 mb-4">
              <span className="text-xs text-fd-muted-foreground font-semibold uppercase tracking-wider leading-none">
                EVENT TYPE
              </span>
              <code className="text-fd-foreground font-mono text-sm bg-fd-muted px-3 py-2 rounded-md border leading-none font-medium">
                {name}
              </code>
            </div>

            {/* Description */}
            {description && (
              <div className="mt-6">
                <p className="text-fd-muted-foreground text-base leading-relaxed">
                  {description}
                </p>
              </div>
            )}
          </div>

          {/* Webhook Icon */}
          <div className="flex-shrink-0">
            <div className="w-16 h-16 rounded-lg bg-gradient-to-br from-purple-100 to-purple-200 dark:from-purple-900/30 dark:to-purple-800/30 flex items-center justify-center">
              <Webhook className="w-8 h-8 text-purple-600 dark:text-purple-400" />
            </div>
          </div>
        </div>
      </div>

      {/* Content - Stacked Layout */}
      <div className="space-y-8">
        {/* Webhook Info Panel */}
        <div className="bg-fd-card border border-fd-border rounded-lg">
          <div className="px-6 py-4 border-b border-fd-border bg-fd-muted/30">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-purple-600 dark:text-purple-400" />
              <div className="font-semibold text-fd-foreground text-base leading-none">Webhook Details</div>
            </div>
          </div>

          <div className="p-6 space-y-6">
            {/* Event Information */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <div className="text-sm font-semibold text-fd-foreground mb-2 leading-none">HTTP Method</div>
                <div className="text-sm text-fd-muted-foreground">{method}</div>
              </div>
              <div>
                <div className="text-sm font-semibold text-fd-foreground mb-2 leading-none">Content Type</div>
                <div className="text-sm text-fd-muted-foreground">application/json</div>
              </div>
            </div>

            {/* Trigger Information */}
            <div>
              <div className="text-sm font-semibold text-fd-foreground mb-2 leading-none">When is this webhook triggered?</div>
              <div className="text-sm text-fd-muted-foreground leading-relaxed">
                {webhook.description || `This webhook is triggered when a ${name.replace('.', ' ')} event occurs in your Stack project.`}
              </div>
            </div>
          </div>
        </div>

        {/* Payload Structure */}
        {webhook.requestBody && (
          <PayloadStructureSection
            requestBody={webhook.requestBody}
            spec={spec}
          />
        )}

        {/* Code Examples */}
        <div className="bg-fd-card border border-fd-border rounded-lg">
          <div className="px-6 py-4 border-b border-fd-border bg-fd-muted/30">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Code className="w-4 h-4 text-green-600 dark:text-green-400" />
                <div className="font-semibold text-fd-foreground text-base leading-none">Examples</div>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  handleCopy(getCodeExample())
                    .catch(error => {
                      console.error('Failed to copy code example', error);
                    });
                }}
              >
                {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
              </Button>
            </div>
          </div>

          {/* Example Tabs */}
          <div className="flex border-b border-fd-border">
            {[
              { id: 'payload', label: 'Payload' },
              { id: 'javascript', label: 'JavaScript Handler' },
              { id: 'python', label: 'Python Handler' },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveCodeTab(tab.id as 'javascript' | 'python' | 'payload')}
                className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors leading-none ${
                  activeCodeTab === tab.id
                    ? 'border-fd-primary text-fd-primary bg-fd-primary/5'
                    : 'border-transparent text-fd-muted-foreground hover:text-fd-foreground'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Code Content */}
          <div className="p-6">
            <div
              className="rounded-lg border bg-[#0a0a0a] p-4 overflow-auto max-h-[500px] text-sm [&_*]:!bg-transparent [&_pre]:!bg-transparent [&_code]:!bg-transparent"
              style={{
                background: '#0a0a0a !important',
              }}
            >
              <div
                dangerouslySetInnerHTML={{ __html: highlightedCode }}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// Payload Structure Section
function PayloadStructureSection({
  requestBody,
  spec,
}: {
  requestBody: OpenAPIWebhookOperation['requestBody'],
  spec: OpenAPISpec,
}) {
  if (!requestBody) return null;

  const renderSchema = (schema: OpenAPISchema, depth = 0): React.ReactElement => {
    // Handle $ref references
    if (schema.$ref) {
      const refPath = schema.$ref.replace('#/', '').split('/');
      let refSchema: OpenAPISchema | undefined = spec as unknown as OpenAPISchema;
      for (const part of refPath) {
        refSchema = (refSchema as Record<string, unknown>)[part] as OpenAPISchema;
      }
      return renderSchema(refSchema!, depth);
    }

    // Handle object type
    if (schema.type === 'object' && schema.properties) {
      return (
        <div className={`space-y-2 ${depth > 0 ? 'ml-4 border-l border-fd-border pl-4' : ''}`}>
          {Object.entries(schema.properties).map(([key, prop]: [string, OpenAPISchema]) => (
            <div key={key} className="space-y-1">
              <div className="flex items-center gap-2 flex-wrap">
                <code className="text-sm font-semibold text-fd-foreground bg-fd-muted px-2 py-0.5 rounded">
                  {key}
                </code>
                {prop.type && (
                  <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded dark:bg-blue-900/30 dark:text-blue-300">
                    {prop.type}
                  </span>
                )}
                {schema.required?.includes(key) && (
                  <span className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded dark:bg-red-900/30 dark:text-red-300">
                    required
                  </span>
                )}
              </div>
              {prop.description && (
                <div className="text-sm text-fd-muted-foreground ml-2">
                  {prop.description}
                </div>
              )}
              {prop.type === 'object' && prop.properties && (
                <div className="mt-2">
                  {renderSchema(prop, depth + 1)}
                </div>
              )}
            </div>
          ))}
        </div>
      );
    }

    // Handle array type
    if (schema.type === 'array' && schema.items) {
      return (
        <div className="space-y-2">
          <div className="text-sm text-fd-muted-foreground">Array of:</div>
          {renderSchema(schema.items, depth + 1)}
        </div>
      );
    }

    // Handle primitive types
    return (
      <div className="text-sm text-fd-muted-foreground">
        {schema.type || 'unknown'} {schema.description && `- ${schema.description}`}
      </div>
    );
  };

  const content = requestBody.content;
  const jsonContent = content['application/json'];

  return (
    <div className="bg-fd-card border border-fd-border rounded-lg">
      <div className="px-6 py-4 border-b border-fd-border bg-fd-muted/30">
        <div className="flex items-center gap-2">
          <ArrowRight className="w-4 h-4 text-blue-600 dark:text-blue-400" />
          <div className="font-semibold text-fd-foreground text-base leading-none">Payload Structure</div>
        </div>
      </div>
      <div className="p-6">
        {renderSchema(jsonContent.schema)}
      </div>
    </div>
  );
}
