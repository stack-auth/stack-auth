'use client';

import { SharedContentLayout } from '@/components/layouts/shared-content-layout';
import { ArrowLeft, Book, FileText } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';

type DocSummary = {
  title: string,
  description: string,
  id: string,
}

type DocContent = {
  title: string,
  description: string,
  content: string,
}

// Treat common placeholder values as empty descriptions
function isBlankDescription(description?: string | null): boolean {
  if (!description) return true;
  const trimmed = description.trim();
  if (!trimmed) return true;
  const lowered = trimmed.toLowerCase();
  return lowered === 'undefined' || lowered === 'null' || lowered === 'none' || lowered === 'n/a' || lowered === 'na';
}

export default function McpBrowserPage() {
  const [docs, setDocs] = useState<DocSummary[]>([]);
  const [selectedDoc, setSelectedDoc] = useState<DocContent | null>(null);
  const [loading, setLoading] = useState(true);
  const [docLoading, setDocLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Function to call MCP tools
  const callMcpTool = async (toolName: string, args: Record<string, string> = {}) => {
    const response = await fetch('/api/internal/mcp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'tools/call',
        params: {
          name: toolName,
          arguments: args,
        },
        id: Date.now(),
      }),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    // Parse Server-Sent Events format response
    const text = await response.text();

    // Look for the data line in the SSE response
    const lines = text.split('\n');
    let jsonData = null;

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        try {
          jsonData = JSON.parse(line.substring(6));
          break;
        } catch (e) {
          // Continue looking for valid JSON data
        }
      }
    }

    if (!jsonData) {
      throw new Error('Invalid MCP response format');
    }

    if (jsonData.error) {
      throw new Error(jsonData.error.message || 'MCP tool call failed');
    }

    return jsonData.result;
  };

  // Parse the doc summaries from the text response
  const parseDocSummaries = (text: string): DocSummary[] => {
    const docs: DocSummary[] = [];
    const lines = text.split('\n');

    let currentDoc: Partial<DocSummary> = {};

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('Title: ')) {
        if (currentDoc.title && currentDoc.description && currentDoc.id) {
          docs.push(currentDoc as DocSummary);
        }
        currentDoc = { title: trimmed.substring(7) };
      } else if (trimmed.startsWith('Description: ')) {
        currentDoc.description = trimmed.substring(13);
      } else if (trimmed.startsWith('ID: ')) {
        currentDoc.id = trimmed.substring(4);
      }
    }

    // Don't forget the last doc
    if (currentDoc.title && currentDoc.description && currentDoc.id) {
      docs.push(currentDoc as DocSummary);
    }

    return docs;
  };

  // Load available docs on component mount
  useEffect(() => {
    const loadDocs = async () => {
      try {
        setLoading(true);
        const result = await callMcpTool('list_available_docs');
        const textContent = result.content[0]?.text || '';
        const parsedDocs = parseDocSummaries(textContent);
        setDocs(parsedDocs);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load docs');
      } finally {
        setLoading(false);
      }
    };

    loadDocs().catch(err => {
      setError(err instanceof Error ? err.message : 'Failed to load docs');
      setLoading(false);
    });
  }, []);

  // Load a specific document
  const loadDoc = async (docId: string) => {
    try {
      setDocLoading(true);
      const result = await callMcpTool('get_docs_by_id', { id: docId });
      const textContent = result.content[0]?.text || '';

      // Parse the response which includes title, description, and content
      const lines = textContent.split('\n');
      let content = '';
      let title = '';
      let description = '';
      let inContent = false;
      let isApiDoc = false;

      for (const line of lines) {
        if (line.startsWith('Title: ')) {
          title = line.substring(7);
        } else if (line.startsWith('Description: ')) {
          description = line.substring(13);
        } else if (line.startsWith('Content:')) {
          inContent = true;
        } else if (line.startsWith('OpenAPI')) {
          // This is an API doc - capture everything after title/description
          isApiDoc = true;
          inContent = true;
        } else if (inContent) {
          content += line + '\n';
        }
      }

      // For API docs, if we don't have explicit content, use everything after the description
      if (isApiDoc && !content.trim()) {
        const titleDescEnd = textContent.indexOf('\n\n');
        if (titleDescEnd !== -1 && titleDescEnd + 2 < textContent.length) {
          content = textContent.substring(titleDescEnd + 2);
        } else if (titleDescEnd === -1) {
          // If no double newline found, try to extract content after "Description: " line
          const descMatch = textContent.match(/Description: .*?\n([\s\S]*)/);
          if (descMatch && descMatch[1]) {
            content = descMatch[1].trim();
          }
        }
      }

      const safeDescription = isBlankDescription(description) ? '' : description;
      setSelectedDoc({ title, description: safeDescription, content: content.trim() });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load document');
    } finally {
      setDocLoading(false);
    }
  };

  if (loading) {
    return (
      <SharedContentLayout>
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-4">MCP Browser</h1>
        </div>
        <div className="text-center py-8">Loading documentation...</div>
      </SharedContentLayout>
    );
  }

  if (error) {
    return (
      <SharedContentLayout>
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-4">MCP Browser</h1>
        </div>
        <div className="border border-red-200 bg-red-50 text-red-700 px-4 py-3 rounded">
          Error: {error}
        </div>
      </SharedContentLayout>
    );
  }

  return (
    <SharedContentLayout>
      <div className="mb-8">
        <div className="flex items-center gap-4 mb-6">
          <Link
            href="/docs"
            className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-primary transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Docs
          </Link>
        </div>

        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 bg-blue-100 dark:bg-blue-900/20 rounded-lg">
            <Book className="h-6 w-6 text-blue-600 dark:text-blue-400" />
          </div>
          <h1 className="text-3xl font-bold">MCP Browser</h1>
        </div>

        <p className="text-muted-foreground">
          Browse Stack Auth documentation through the Model Context Protocol server.
          Found <span className="font-medium text-foreground">{docs.length}</span> documentation pages.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Documentation List */}
        <div className="border rounded-lg">
          <div className="p-4 border-b bg-gradient-to-r from-blue-50/50 to-indigo-50/50 dark:from-blue-950/20 dark:to-indigo-950/20">
            <div className="flex items-center gap-2">
              <FileText className="h-5 w-5 text-blue-600 dark:text-blue-400 flex-shrink-0" />
              <div className="text-lg font-semibold">Available Documentation</div>
            </div>
          </div>
          <div className="max-h-[600px] overflow-y-auto">
            {docs.map((doc) => (
              <div
                key={doc.id}
                className="p-4 border-b last:border-b-0 hover:bg-muted/50 cursor-pointer transition-all duration-200 hover:shadow-sm group"
                onClick={() => {
                  loadDoc(doc.id).catch(err => {
                    setError(err instanceof Error ? err.message : 'Failed to load document');
                  });
                }}
              >
                <div className="font-medium text-primary hover:underline mb-2 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
                  {doc.title}
                </div>
                {!isBlankDescription(doc.description) && (
                  <p className="text-sm text-muted-foreground mb-3 line-clamp-2">
                    {doc.description}
                  </p>
                )}
                <div className="inline-flex items-center gap-1 px-2 py-1 bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 text-xs rounded-full border border-gray-200 dark:border-gray-700">
                  <FileText className="h-3 w-3" />
                  {doc.id}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Document Content */}
        <div className="border rounded-lg">
          <div className="p-4 border-b bg-gradient-to-r from-green-50/50 to-emerald-50/50 dark:from-green-950/20 dark:to-emerald-950/20">
            <div className="flex items-center gap-2">
              <div className="p-1.5 bg-green-100 dark:bg-green-900/30 rounded flex-shrink-0">
                <FileText className="h-4 w-4 text-green-600 dark:text-green-400" />
              </div>
              <div className="text-lg font-semibold">Document Content</div>
            </div>
          </div>
          <div className="p-4">
            {docLoading ? (
              <div className="text-center py-12">
                <div className="inline-flex items-center gap-2 text-muted-foreground">
                  <div className="w-4 h-4 border-2 border-blue-200 border-t-blue-600 dark:border-blue-800 dark:border-t-blue-400 rounded-full animate-spin"></div>
                  Loading document...
                </div>
              </div>
            ) : selectedDoc ? (
              <div>
                <div className="mb-4">
                  <div className="text-xl font-semibold mb-1">{selectedDoc.title}</div>
                  {!isBlankDescription(selectedDoc.description) && (
                    <p className="text-muted-foreground">
                      {selectedDoc.description}
                    </p>
                  )}
                </div>
                <div className="bg-slate-50 dark:bg-slate-900/50 p-4 rounded-lg border border-slate-200 dark:border-slate-800 max-h-[500px] overflow-y-auto">
                  <pre className="whitespace-pre text-sm font-mono text-slate-800 dark:text-slate-200 overflow-x-auto">
                    {selectedDoc.content}
                  </pre>
                </div>
              </div>
            ) : (
              <div className="text-center py-12">
                <div className="text-muted-foreground">
                  <FileText className="h-12 w-12 mx-auto mb-3 text-muted-foreground/50" />
                  <p className="text-lg font-medium mb-1">Select a document</p>
                  <p className="text-sm">Choose any document from the list to view its content</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </SharedContentLayout>
  );
}
