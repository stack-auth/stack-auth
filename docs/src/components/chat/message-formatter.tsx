'use client';

import React, { useEffect, useState } from 'react';
import { remark } from 'remark';
import remarkGfm from 'remark-gfm';
import { CompactCodeblock } from './compact-codeblock';

type MessageNode = {
  type: 'text' | 'code' | 'heading' | 'list' | 'listItem' | 'paragraph' | 'strong' | 'emphasis' | 'break',
  content?: string,
  language?: string,
  level?: number,
  children?: MessageNode[],
};

// Parse markdown text into a structured format
async function parseMarkdown(text: string): Promise<MessageNode[]> {
  const processor = remark().use(remarkGfm);
  const tree = processor.parse(text);

  function processNode(node: unknown): MessageNode[] {
    const nodes: MessageNode[] = [];

    switch ((node as { type: string }).type) {
      case 'root': {
        (node as { children?: unknown[] }).children?.forEach((child: unknown) => {
          nodes.push(...processNode(child));
        });
        break;
      }

      case 'paragraph': {
        const paragraphChildren: MessageNode[] = [];
        (node as { children?: unknown[] }).children?.forEach((child: unknown) => {
          paragraphChildren.push(...processNode(child));
        });
        nodes.push({
          type: 'paragraph',
          children: paragraphChildren
        });
        break;
      }

      case 'code': {
        nodes.push({
          type: 'code',
          content: (node as { value: string }).value,
          language: (node as { lang?: string }).lang || 'text'
        });
        break;
      }

      case 'heading': {
        const headingChildren: MessageNode[] = [];
        (node as { children?: unknown[] }).children?.forEach((child: unknown) => {
          headingChildren.push(...processNode(child));
        });
        nodes.push({
          type: 'heading',
          level: (node as { depth: number }).depth,
          children: headingChildren
        });
        break;
      }

      case 'list': {
        const listChildren: MessageNode[] = [];
        (node as { children?: unknown[] }).children?.forEach((child: unknown) => {
          listChildren.push(...processNode(child));
        });
        nodes.push({
          type: 'list',
          children: listChildren
        });
        break;
      }

      case 'listItem': {
        const listItemChildren: MessageNode[] = [];
        (node as { children?: unknown[] }).children?.forEach((child: unknown) => {
          listItemChildren.push(...processNode(child));
        });
        nodes.push({
          type: 'listItem',
          children: listItemChildren
        });
        break;
      }

      case 'strong': {
        const strongChildren: MessageNode[] = [];
        (node as { children?: unknown[] }).children?.forEach((child: unknown) => {
          strongChildren.push(...processNode(child));
        });
        nodes.push({
          type: 'strong',
          children: strongChildren
        });
        break;
      }

      case 'emphasis': {
        const emphasisChildren: MessageNode[] = [];
        (node as { children?: unknown[] }).children?.forEach((child: unknown) => {
          emphasisChildren.push(...processNode(child));
        });
        nodes.push({
          type: 'emphasis',
          children: emphasisChildren
        });
        break;
      }

      case 'break': {
        nodes.push({
          type: 'break'
        });
        break;
      }

      case 'text': {
        nodes.push({
          type: 'text',
          content: (node as { value: string }).value
        });
        break;
      }

      case 'inlineCode': {
        nodes.push({
          type: 'text',
          content: `\`${(node as { value: string }).value}\``
        });
        break;
      }

      default: {
        // For any unhandled node types, try to extract text content
        if ((node as { value?: string }).value) {
          nodes.push({
            type: 'text',
            content: (node as { value: string }).value
          });
        }
        break;
      }
    }

    return nodes;
  }

  return processNode(tree);
}

// Render a single message node
function renderNode(node: MessageNode, index: number): React.ReactNode {
  switch (node.type) {
    case 'text': {
      return node.content;
    }

    case 'code': {
      return (
        <div key={index} className="my-3">
          <CompactCodeblock
            code={node.content || ''}
            language={node.language || 'text'}
          />
        </div>
      );
    }

    case 'heading': {
      const HeadingTag = `h${Math.min(node.level || 1, 6)}` as keyof JSX.IntrinsicElements;
      return (
        <HeadingTag key={index} className="font-semibold mt-4 mb-2 text-sm">
          {node.children?.map(renderNode)}
        </HeadingTag>
      );
    }

    case 'paragraph': {
      return (
        <p key={index} className="mb-3 last:mb-0">
          {node.children?.map(renderNode)}
        </p>
      );
    }

    case 'list': {
      return (
        <ul key={index} className="mb-3 space-y-1 ml-3">
          {node.children?.map(renderNode)}
        </ul>
      );
    }

    case 'listItem': {
      return (
        <li key={index} className="text-xs relative pl-3 before:content-['•'] before:absolute before:left-0 before:text-fd-muted-foreground">
          {node.children?.map(renderNode)}
        </li>
      );
    }

    case 'strong': {
      return (
        <strong key={index} className="font-semibold">
          {node.children?.map(renderNode)}
        </strong>
      );
    }

    case 'emphasis': {
      return (
        <em key={index} className="italic">
          {node.children?.map(renderNode)}
        </em>
      );
    }

    case 'break': {
      return <br key={index} />;
    }

    default: {
      return null;
    }
  }
}

type MessageFormatterProps = {
  content: string,
  className?: string,
};

export function MessageFormatter({ content, className = '' }: MessageFormatterProps) {
  const [parsedNodes, setParsedNodes] = useState<MessageNode[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let isCancelled = false;

    const parseContent = async () => {
      setIsLoading(true);
      try {
        const nodes = await parseMarkdown(content);
        if (!isCancelled) {
          setParsedNodes(nodes);
        }
      } catch (error) {
        console.error('Error parsing markdown:', error);
        if (!isCancelled) {
          // Fallback to plain text
          setParsedNodes([{ type: 'text', content }]);
        }
      } finally {
        if (!isCancelled) {
          setIsLoading(false);
        }
      }
    };

    parseContent().catch((error) => {
      console.error('Error parsing markdown:', error);
    });

    return () => {
      isCancelled = true;
    };
  }, [content]);

  if (isLoading) {
    return (
      <div className={`whitespace-pre-wrap break-words ${className}`}>
        {content}
      </div>
    );
  }

  return (
    <div className={`break-words ${className}`}>
      {parsedNodes.map((node, index) => renderNode(node, index))}
    </div>
  );
}
