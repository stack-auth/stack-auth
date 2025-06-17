'use client';

import { ArrowRight, Check, Code, Copy, Play, Send, Settings, Sparkles, Zap } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useAPIPageContext } from './api-page-wrapper';
import { Button } from './button';

// Types for OpenAPI specification
type OpenAPISpec = {
  openapi: string,
  info: {
    title: string,
    version: string,
    description?: string,
  },
  servers: Array<{
    url: string,
    description?: string,
  }>,
  paths: Record<string, Record<string, OpenAPIOperation>>,
  webhooks?: Record<string, Record<string, OpenAPIOperation>>,
  components?: {
    schemas?: Record<string, any>,
    securitySchemes?: Record<string, any>,
  },
}

type OpenAPIOperation = {
  summary?: string,
  description?: string,
  operationId?: string,
  tags?: string[],
  parameters?: OpenAPIParameter[],
  requestBody?: {
    required?: boolean,
    content: Record<string, {
      schema: any,
    }>,
  },
  responses: Record<string, {
    description: string,
    content?: Record<string, {
      schema: any,
    }>,
  }>,
  security?: Array<Record<string, string[]>>,
}

type OpenAPIParameter = {
  name: string,
  in: 'query' | 'path' | 'header' | 'cookie',
  required?: boolean,
  description?: string,
  schema: any,
  example?: any,
}

type EnhancedAPIPageProps = {
  document: string,
  operations: Array<{
    path: string,
    method: string,
  }>,
  webhooks?: Array<{
    name: string,
    method: string,
  }>,
  hasHead?: boolean,
}

type RequestState = {
  parameters: Record<string, any>,
  headers: Record<string, string>,
  body: string,
  response: {
    status?: number,
    data?: any,
    headers?: Record<string, string>,
    loading: boolean,
    error?: string,
    timestamp?: number,
    duration?: number,
  },
}

const HTTP_METHOD_COLORS = {
  GET: 'from-blue-500 to-blue-600 text-white shadow-blue-500/25',
  POST: 'from-green-500 to-green-600 text-white shadow-green-500/25',
  PUT: 'from-orange-500 to-orange-600 text-white shadow-orange-500/25',
  PATCH: 'from-yellow-500 to-yellow-600 text-white shadow-yellow-500/25',
  DELETE: 'from-red-500 to-red-600 text-white shadow-red-500/25',
} as const;

// Custom Tooltip Component
function Tooltip({ children, content }: { children: React.ReactNode, content: string }) {
  const [isVisible, setIsVisible] = useState(false);

  return (
    <div
      className="relative inline-block"
      onMouseEnter={() => setIsVisible(true)}
      onMouseLeave={() => setIsVisible(false)}
    >
      {children}
      {isVisible && (
        <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 z-50">
          <div className="bg-fd-popover text-fd-popover-foreground text-xs font-medium px-3 py-2 rounded-lg shadow-lg border border-fd-border whitespace-nowrap">
            {content}
            <div className="absolute top-full left-1/2 transform -translate-x-1/2 w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-fd-popover"></div>
          </div>
        </div>
      )}
    </div>
  );
}

export function EnhancedAPIPage({ document, operations, webhooks = [], hasHead = true }: EnhancedAPIPageProps) {
  const { sharedHeaders, reportError, isHeadersPanelOpen } = useAPIPageContext();
  const [spec, setSpec] = useState<OpenAPISpec | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [requestState, setRequestState] = useState<RequestState>({
    parameters: {},
    headers: {},
    body: '{}',
    response: {
      loading: false,
    },
  });

  // Update request headers when shared headers change
  useEffect(() => {
    setRequestState(prev => ({ ...prev, headers: sharedHeaders }));
  }, [sharedHeaders]);

  // Auto-populate request body based on OpenAPI schema
  useEffect(() => {
    if (operations.length > 0) {
      const firstOperation = operations[0];
      const operation = spec?.paths[firstOperation.path]?.[firstOperation.method.toLowerCase()];

      if (operation?.requestBody) {
        const content = operation.requestBody.content;
        const jsonContent = content['application/json'];

        if (jsonContent.schema) {
          console.log('OpenAPI Schema for', firstOperation.path, ':', jsonContent.schema);
          const exampleBody = generateExampleFromSchema(jsonContent.schema, spec || undefined);
          console.log('Generated example body:', exampleBody);
          setRequestState(prev => ({
            ...prev,
            body: JSON.stringify(exampleBody, null, 2)
          }));
        }
      }
    }
  }, [spec, operations]);

  // Helper function to generate example data from OpenAPI schema
  const generateExampleFromSchema = (schema: any, spec?: OpenAPISpec): any => {
    console.log('Processing schema:', JSON.stringify(schema, null, 2));

    if (!schema) return {};

    // Handle $ref references first
    if (schema.$ref) {
      console.log('Found $ref:', schema.$ref);
      const refPath = schema.$ref.replace('#/', '').split('/');
      let refSchema: any = spec;
      for (const part of refPath) {
        refSchema = refSchema?.[part];
      }
      if (refSchema) {
        return generateExampleFromSchema(refSchema, spec);
      }
    }

    // Handle allOf (merge all schemas)
    if (schema.allOf) {
      console.log('Found allOf with', schema.allOf.length, 'schemas');
      const merged = {};
      for (const subSchema of schema.allOf) {
        const subExample = generateExampleFromSchema(subSchema, spec);
        Object.assign(merged, subExample);
      }
      return merged;
    }

    // Handle oneOf/anyOf (use first schema)
    if (schema.oneOf || schema.anyOf) {
      const schemas = schema.oneOf || schema.anyOf;
      console.log('Found oneOf/anyOf with', schemas.length, 'schemas');
      if (schemas.length > 0) {
        return generateExampleFromSchema(schemas[0], spec);
      }
    }

    // Handle object type - prioritize this over top-level examples
    if (schema.type === 'object' && schema.properties) {
      console.log('Processing object with properties:', Object.keys(schema.properties));
      const example: any = {};

      Object.entries(schema.properties).forEach(([key, prop]: [string, any]) => {
        console.log(`Processing property ${key}:`, prop);

        if (prop.example !== undefined) {
          example[key] = prop.example;
        } else {
          // Just use the field name as the value
          example[key] = key;
        }
      });

      console.log('Generated object example:', example);
      return example;
    }

    // Handle direct examples only for non-object types
    if (schema.example !== undefined) {
      console.log('Found direct example:', schema.example);
      return schema.example;
    }

    // Handle array type
    if (schema.type === 'array') {
      if (schema.items) {
        const itemExample = generateExampleFromSchema(schema.items, spec);
        return [itemExample];
      }
      return [];
    }

    // For primitive types, return empty string
    return "";
  };

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

  const executeRequest = useCallback(async (operation: OpenAPIOperation, path: string, method: string) => {
    const startTime = Date.now();
    setRequestState(prev => ({
      ...prev,
      response: { ...prev.response, loading: true, error: undefined, timestamp: startTime }
    }));

    try {
      const baseUrl = spec?.servers[0]?.url || '';
      let url = baseUrl + path;

      // Replace path parameters
      const pathParams = operation.parameters?.filter(p => p.in === 'path') || [];
      pathParams.forEach(param => {
        const value = requestState.parameters[param.name];
        if (value) {
          url = url.replace(`{${param.name}}`, encodeURIComponent(value));
        }
      });

      // Add query parameters
      const queryParams = operation.parameters?.filter(p => p.in === 'query') || [];
      const searchParams = new URLSearchParams();
      queryParams.forEach(param => {
        const value = requestState.parameters[param.name];
        if (value !== undefined && value !== '') {
          searchParams.append(param.name, value);
        }
      });
      if (searchParams.toString()) {
        url += '?' + searchParams.toString();
      }

      // Filter out empty headers
      const filteredHeaders = Object.fromEntries(
        Object.entries(requestState.headers).filter(([key, value]) => key && value)
      );

      const requestOptions: RequestInit = {
        method: method.toUpperCase(),
        headers: filteredHeaders,
      };

      if (['POST', 'PUT', 'PATCH'].includes(method.toUpperCase()) && requestState.body) {
        requestOptions.body = requestState.body;
      }

      const response = await fetch(url, requestOptions);
      const responseData = await response.json().catch(() => ({}));
      const endTime = Date.now();

      // Report error to the wrapper for smart error handling
      if (!response.ok) {
        reportError(response.status, responseData);
      }

      setRequestState(prev => ({
        ...prev,
        response: {
          loading: false,
          status: response.status,
          data: responseData,
          headers: Object.fromEntries(response.headers.entries()),
          timestamp: startTime,
          duration: endTime - startTime,
        }
      }));
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Request failed';

      // Report network errors as well
      reportError(0, { message: errorMessage });

      setRequestState(prev => ({
        ...prev,
        response: {
          loading: false,
          error: errorMessage,
          timestamp: startTime,
          duration: Date.now() - startTime,
        }
      }));
    }
  }, [spec, requestState.parameters, requestState.headers, requestState.body, reportError]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="flex flex-col items-center gap-4">
          <div className="relative">
            <div className="animate-spin rounded-full h-12 w-12 border-4 border-fd-muted"></div>
            <div className="animate-spin rounded-full h-12 w-12 border-4 border-t-fd-primary absolute top-0"></div>
          </div>
          <p className="text-fd-muted-foreground text-sm">Loading API specification...</p>
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
              <span className="text-red-600 dark:text-red-400 text-xl">⚠️</span>
            </div>
            <h3 className="text-lg font-semibold text-red-800 dark:text-red-300">
              Failed to load API specification
            </h3>
          </div>
          <p className="text-red-600 dark:text-red-400 leading-relaxed">{error || 'Unknown error occurred'}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-fd-background">
      {/* Base URL - Enhanced design */}
      <div className="text-center mb-12">
        <div className="inline-block">
          <div className="flex items-center justify-center gap-2 mb-3">
            <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
            <span className="text-xs text-fd-muted-foreground font-semibold tracking-wider uppercase">API Base URL</span>
          </div>
          <div className="bg-fd-card border border-fd-border rounded-xl px-6 py-4 shadow-sm">
            <code className="text-fd-foreground font-mono text-sm font-medium">
              {spec.servers[0]?.url || 'https://api.stack-auth.com/api/v1'}
            </code>
          </div>
        </div>
      </div>

      {/* Operations */}
      {operations.map(({ path, method }) => {
        const operation = spec.paths[path][method.toLowerCase()];
        return (
          <ModernAPIPlayground
            key={`${method}-${path}`}
            operation={operation}
            path={path}
            method={method.toUpperCase()}
            spec={spec}
            requestState={requestState}
            setRequestState={setRequestState}
            onExecute={() => {
              executeRequest(operation, path, method)
                .catch(error => console.error('Failed to execute request:', error));
            }}
            onCopy={(text: string) => {
              copyToClipboard(text)
                .catch(error => console.error('Failed to copy to clipboard:', error));
            }}
            isHeadersPanelOpen={isHeadersPanelOpen}
          />
        );
      })}
    </div>
  );
}

// Modern API Playground Component
function ModernAPIPlayground({
  operation,
  path,
  method,
  spec,
  requestState,
  setRequestState,
  onExecute,
  onCopy,
  isHeadersPanelOpen,
}: {
  operation: OpenAPIOperation,
  path: string,
  method: string,
  spec: OpenAPISpec,
  requestState: RequestState,
  setRequestState: React.Dispatch<React.SetStateAction<RequestState>>,
  onExecute: () => void,
  onCopy: (text: string) => void,
  isHeadersPanelOpen: boolean,
}) {
  const [copied, setCopied] = useState(false);
  const [activeCodeTab, setActiveCodeTab] = useState<'curl' | 'javascript' | 'python'>('curl');
  const methodColorClass = HTTP_METHOD_COLORS[method.toUpperCase() as keyof typeof HTTP_METHOD_COLORS];

  const handleCopy = async (text: string) => {
    onCopy(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const generateCurlCommand = useCallback(() => {
    const baseUrl = spec.servers[0]?.url || '';
    let url = baseUrl + path;

    // Replace path parameters
    const pathParams = operation.parameters?.filter(p => p.in === 'path') || [];
    pathParams.forEach(param => {
      const value = requestState.parameters[param.name] || `{${param.name}}`;
      url = url.replace(`{${param.name}}`, value);
    });

    // Add query parameters
    const queryParams = operation.parameters?.filter(p => p.in === 'query') || [];
    const searchParams = new URLSearchParams();
    queryParams.forEach(param => {
      const value = requestState.parameters[param.name];
      if (value !== undefined && value !== '') {
        searchParams.append(param.name, value);
      }
    });
    if (searchParams.toString()) {
      url += '?' + searchParams.toString();
    }

    let curlCommand = `curl -X ${method} "${url}"`;

    // Add headers (only non-empty ones)
    Object.entries(requestState.headers).forEach(([key, value]) => {
      if (key && value) {
        curlCommand += ` \\\n  -H "${key}: ${value}"`;
      }
    });

    // Add body for POST/PUT/PATCH
    if (['POST', 'PUT', 'PATCH'].includes(method) && requestState.body !== '{}') {
      curlCommand += ` \\\n  -d '${requestState.body}'`;
    }

    return curlCommand;
  }, [operation, path, method, spec, requestState]);

  const generateJavaScriptCode = useCallback(() => {
    const baseUrl = spec.servers[0]?.url || '';
    let url = baseUrl + path;

    // Replace path parameters
    const pathParams = operation.parameters?.filter(p => p.in === 'path') || [];
    pathParams.forEach(param => {
      const value = requestState.parameters[param.name] || `{${param.name}}`;
      url = url.replace(`{${param.name}}`, value);
    });

    // Add query parameters
    const queryParams = operation.parameters?.filter(p => p.in === 'query') || [];
    const searchParams = new URLSearchParams();
    queryParams.forEach(param => {
      const value = requestState.parameters[param.name];
      if (value !== undefined && value !== '') {
        searchParams.append(param.name, value);
      }
    });
    if (searchParams.toString()) {
      url += '?' + searchParams.toString();
    }

    const headers = Object.fromEntries(
      Object.entries(requestState.headers).filter(([key, value]) => key && value)
    );

    let jsCode = `const response = await fetch("${url}", {\n  method: "${method}"`;

    if (Object.keys(headers).length > 0) {
      jsCode += `,\n  headers: ${JSON.stringify(headers, null, 4).replace(/^/gm, '  ')}`;
    }

    if (['POST', 'PUT', 'PATCH'].includes(method) && requestState.body !== '{}') {
      jsCode += `,\n  body: ${requestState.body}`;
    }

    jsCode += `\n});\n\nconst data = await response.json();\nconsole.log(data);`;

    return jsCode;
  }, [operation, path, method, spec, requestState]);

  const generatePythonCode = useCallback(() => {
    const baseUrl = spec.servers[0]?.url || '';
    let url = baseUrl + path;

    // Replace path parameters
    const pathParams = operation.parameters?.filter(p => p.in === 'path') || [];
    pathParams.forEach(param => {
      const value = requestState.parameters[param.name] || `{${param.name}}`;
      url = url.replace(`{${param.name}}`, value);
    });

    // Add query parameters
    const queryParams = operation.parameters?.filter(p => p.in === 'query') || [];
    const searchParams = new URLSearchParams();
    queryParams.forEach(param => {
      const value = requestState.parameters[param.name];
      if (value !== undefined && value !== '') {
        searchParams.append(param.name, value);
      }
    });
    if (searchParams.toString()) {
      url += '?' + searchParams.toString();
    }

    const headers = Object.fromEntries(
      Object.entries(requestState.headers).filter(([key, value]) => key && value)
    );

    let pythonCode = `import requests\nimport json\n\n`;
    pythonCode += `url = "${url}"\n`;

    if (Object.keys(headers).length > 0) {
      pythonCode += `headers = ${JSON.stringify(headers, null, 2).replace(/"/g, "'")}\n`;
    }

    if (['POST', 'PUT', 'PATCH'].includes(method) && requestState.body !== '{}') {
      pythonCode += `data = ${requestState.body}\n\n`;
      pythonCode += `response = requests.${method.toLowerCase()}(url${Object.keys(headers).length > 0 ? ', headers=headers' : ''}${requestState.body !== '{}' ? ', json=data' : ''})\n`;
    } else {
      pythonCode += `\nresponse = requests.${method.toLowerCase()}(url${Object.keys(headers).length > 0 ? ', headers=headers' : ''})\n`;
    }

    pythonCode += `print(response.json())`;

    return pythonCode;
  }, [operation, path, method, spec, requestState]);

  const getCodeExample = () => {
    switch (activeCodeTab) {
      case 'curl': {
        return generateCurlCommand();
      }
      case 'javascript': {
        return generateJavaScriptCode();
      }
      case 'python': {
        return generatePythonCode();
      }
      default: {
        return generateCurlCommand();
      }
    }
  };

  return (
    <div className={`max-w-6xl mx-auto px-6 py-8 transition-all duration-200 ${
      isHeadersPanelOpen ? 'pr-8' : ''
    }`}>
      {/* Header Section */}
      <div className="mb-8 border-b border-fd-border pb-8">
        <div className="flex items-start justify-between gap-8">
          <div className="flex-1 min-w-0">
            {/* Method and Title */}
            <div className="flex items-center gap-4 mb-4">
              <span className={`inline-flex items-center px-3 py-1 rounded-md bg-gradient-to-r ${methodColorClass} font-mono font-bold text-xs tracking-wider`}>
                {method}
              </span>
              <h1 className="text-2xl font-bold text-fd-foreground">
                {operation.summary || 'API Endpoint'}
              </h1>
            </div>

            {/* Description */}
            {operation.description && (
              <p className="text-fd-muted-foreground mb-4 text-base leading-relaxed">
                {operation.description}
              </p>
            )}

            {/* Endpoint Path */}
            <div className="flex items-center gap-2">
              <span className="text-sm text-fd-muted-foreground font-medium">ENDPOINT</span>
              <code className="text-fd-foreground font-mono text-sm bg-fd-muted px-3 py-1 rounded border">
                {path}
              </code>
            </div>
          </div>

          {/* Try It Button */}
          <Button
            onClick={onExecute}
            disabled={requestState.response.loading}
            className="px-6 py-3 bg-fd-primary text-fd-primary-foreground font-semibold rounded-lg border-0"
          >
            {requestState.response.loading ? (
              <>
                <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent mr-2" />
                Sending...
              </>
            ) : (
              <>
                <Play className="w-4 h-4 mr-2" />
                Try it out
              </>
            )}
          </Button>
        </div>
      </div>

      {/* Content - Stacked Layout */}
      <div className="space-y-8">
        {/* Request Panel */}
        <div className="bg-fd-card border border-fd-border rounded-lg">
          <div className="px-6 py-4 border-b border-fd-border bg-fd-muted/30">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
                <Send className="w-4 h-4 text-blue-600 dark:text-blue-400" />
              </div>
              <h3 className="font-semibold text-fd-foreground">Request</h3>
            </div>
          </div>

          <div className="p-6 space-y-6">
            {/* Parameters */}
            {operation.parameters && operation.parameters.length > 0 && (
              <ParametersSection
                parameters={operation.parameters}
                values={requestState.parameters}
                onChange={(params) => setRequestState(prev => ({ ...prev, parameters: params }))}
              />
            )}

            {/* Request Body */}
            {operation.requestBody && (
              <RequestBodySection
                requestBody={operation.requestBody}
                value={requestState.body}
                onChange={(body) => setRequestState(prev => ({ ...prev, body }))}
              />
            )}
          </div>
        </div>

        {/* Response Panel */}
        <ResponsePanel response={requestState.response} />

        {/* Code Examples */}
        <div className="bg-fd-card border border-fd-border rounded-lg">
          <div className="px-6 py-4 border-b border-fd-border bg-fd-muted/30">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
                  <Code className="w-4 h-4 text-green-600 dark:text-green-400" />
                </div>
                <h3 className="font-semibold text-fd-foreground">Code Examples</h3>
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

          {/* Language Tabs */}
          <div className="flex border-b border-fd-border">
            {[
              { id: 'curl', label: 'cURL' },
              { id: 'javascript', label: 'JavaScript' },
              { id: 'python', label: 'Python' },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveCodeTab(tab.id as any)}
                className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
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
            <pre className="bg-fd-muted rounded-lg p-4 text-sm font-mono overflow-x-auto whitespace-pre-wrap break-words">
              <code className="text-fd-foreground">{getCodeExample()}</code>
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
}

// Parameters Section - Clean design
function ParametersSection({
  parameters,
  values,
  onChange,
}: {
  parameters: OpenAPIParameter[],
  values: Record<string, any>,
  onChange: (values: Record<string, any>) => void,
}) {
  const groupedParams = parameters.reduce((acc, param) => {
    if (!(param.in in acc)) acc[param.in] = [];
    acc[param.in].push(param);
    return acc;
  }, {} as Record<string, OpenAPIParameter[]>);

  return (
    <div className="space-y-4">
      <h4 className="font-semibold text-fd-foreground flex items-center gap-2">
        <Settings className="w-4 h-4" />
        Parameters
      </h4>
      {Object.entries(groupedParams).map(([type, params]) => (
        <div key={type} className="space-y-3">
          <h5 className="text-xs font-medium text-fd-muted-foreground uppercase tracking-wider">
            {type} Parameters
          </h5>
          <div className="space-y-3">
            {params.map((param) => (
              <div key={param.name} className="space-y-1">
                <label className="text-sm font-medium text-fd-foreground flex items-center gap-2">
                  {param.name}
                  {param.required && (
                    <span className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded dark:bg-red-900/30 dark:text-red-300">
                      required
                    </span>
                  )}
                </label>
                <input
                  type={param.schema?.type === 'number' ? 'number' : 'text'}
                  placeholder={param.example || param.description || `Enter ${param.name}`}
                  value={values[param.name] || ''}
                  onChange={(e) => onChange({ ...values, [param.name]: e.target.value })}
                  className="w-full px-3 py-2 border border-fd-border rounded-lg bg-fd-background text-fd-foreground text-sm focus:outline-none focus:ring-2 focus:ring-fd-primary focus:border-fd-primary"
                />
                {param.description && (
                  <p className="text-xs text-fd-muted-foreground">{param.description}</p>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// Request Body Section - Clean design
function RequestBodySection({
  requestBody,
  value,
  onChange,
}: {
  requestBody: OpenAPIOperation['requestBody'],
  value: string,
  onChange: (value: string) => void,
}) {
  if (!requestBody) return null;

  return (
    <div className="space-y-3">
      <h4 className="font-semibold text-fd-foreground">Request Body</h4>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Enter JSON request body"
        rows={8}
        className="w-full px-3 py-2 border border-fd-border rounded-lg bg-fd-background text-fd-foreground font-mono text-sm focus:outline-none focus:ring-2 focus:ring-fd-primary focus:border-fd-primary"
      />
    </div>
  );
}

// Response Panel - Clean design
function ResponsePanel({ response }: { response: RequestState['response'] }) {
  if (response.loading) {
    return (
      <div className="bg-fd-card border border-fd-border rounded-lg">
        <div className="px-6 py-4 border-b border-fd-border bg-fd-muted/30">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center">
              <Sparkles className="w-4 h-4 text-purple-600 dark:text-purple-400" />
            </div>
            <h3 className="font-semibold text-fd-foreground">Response</h3>
          </div>
        </div>
        <div className="p-12 flex flex-col items-center justify-center">
          <div className="relative mb-4">
            <div className="animate-spin rounded-full h-8 w-8 border-2 border-fd-muted"></div>
            <div className="animate-spin rounded-full h-8 w-8 border-2 border-t-purple-500 absolute top-0"></div>
          </div>
          <p className="text-fd-muted-foreground text-sm">Sending request...</p>
        </div>
      </div>
    );
  }

  if (response.error) {
    return (
      <div className="bg-fd-card border border-fd-border rounded-lg">
        <div className="px-6 py-4 border-b border-fd-border bg-fd-muted/30">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
              <span className="text-red-600 dark:text-red-400">❌</span>
            </div>
            <h3 className="font-semibold text-fd-foreground">Error</h3>
          </div>
        </div>
        <div className="p-6">
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
            <p className="text-red-800 dark:text-red-300 font-medium mb-2">Request Failed</p>
            <p className="text-red-600 dark:text-red-400 text-sm whitespace-pre-wrap break-words">{response.error}</p>
          </div>
        </div>
      </div>
    );
  }

  if (!response.status) {
    return (
      <div className="bg-fd-card border border-fd-border rounded-lg">
        <div className="px-6 py-4 border-b border-fd-border bg-fd-muted/30">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gray-100 dark:bg-gray-900/30 flex items-center justify-center">
              <ArrowRight className="w-4 h-4 text-gray-600 dark:text-gray-400" />
            </div>
            <h3 className="font-semibold text-fd-foreground">Response</h3>
          </div>
        </div>
        <div className="p-12 flex flex-col items-center justify-center">
          <div className="w-12 h-12 rounded-full bg-fd-muted/30 flex items-center justify-center mb-4">
            <Zap className="w-6 h-6 text-fd-muted-foreground" />
          </div>
          <p className="text-fd-muted-foreground text-center text-sm">
            Click &quot;Try it out&quot; to see the API response
          </p>
        </div>
      </div>
    );
  }

  const statusColor = response.status < 300
    ? 'from-green-500 to-green-600'
    : response.status < 400
      ? 'from-yellow-500 to-yellow-600'
      : 'from-red-500 to-red-600';

  return (
    <div className="bg-fd-card border border-fd-border rounded-lg">
      <div className="px-6 py-4 border-b border-fd-border bg-fd-muted/30">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
              <span className="text-green-600 dark:text-green-400">✓</span>
            </div>
            <h3 className="font-semibold text-fd-foreground">Response</h3>
          </div>
          <div className="flex items-center gap-3">
            {response.duration && (
              <span className="text-xs text-fd-muted-foreground bg-fd-muted px-2 py-1 rounded">
                {response.duration}ms
              </span>
            )}
            <span className={`inline-flex items-center px-3 py-1 rounded-md bg-gradient-to-r ${statusColor} text-white font-mono font-bold text-xs`}>
              {response.status}
            </span>
          </div>
        </div>
      </div>

      <div className="p-6 space-y-4">
        {response.headers && Object.keys(response.headers).length > 0 && (
          <div>
            <h4 className="text-sm font-semibold text-fd-foreground mb-2">Response Headers</h4>
            <div className="bg-fd-muted rounded-lg p-3 border">
              <pre className="text-xs font-mono overflow-auto max-h-32 whitespace-pre-wrap break-words">
                {JSON.stringify(response.headers, null, 2)}
              </pre>
            </div>
          </div>
        )}

        {response.data && (
          <div>
            <h4 className="text-sm font-semibold text-fd-foreground mb-2">Response Body</h4>
            <div className="bg-fd-muted rounded-lg p-3 border">
              <pre className="text-sm font-mono overflow-auto max-h-96 text-fd-foreground whitespace-pre-wrap break-words">
                {JSON.stringify(response.data, null, 2)}
              </pre>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
