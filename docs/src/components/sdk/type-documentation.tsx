'use client';

import { runAsynchronously } from '@stackframe/stack-shared/dist/utils/promises';
import React, { useEffect, useState } from 'react';
import { codeToHtml } from 'shiki';
import { Accordion, ClickableTableOfContents, ParamField } from '../mdx/sdk-components';
import { AsideSection, CollapsibleTypesSection, MethodAside, MethodContent, MethodLayout } from '../ui/method-layout';

// Type definitions based on the types.json structure
type TypeMember = {
  name: string,
  optional: boolean,
  sourcePath: string,
  line: number,
  kind: 'property' | 'method',
  type?: string,
  description?: string,
  signatures?: Array<{
    signature: string,
    parameters: Array<{
      name: string,
      type: string,
      optional: boolean,
      propertyDescriptions?: Record<string, {
        type: string,
        optional: boolean,
        description?: string,
      }>,
    }>,
    returnType: string,
  }>,
  platforms?: string[],
  tags?: Array<{
    name: string,
    text: string,
  }>,
};

type TypeInfo = {
  name: string,
  kind: 'type',
  sourcePath: string,
  line: number,
  category: 'types',
  definition: string,
  description?: string,
  members: TypeMember[],
  mixins?: string[],
};

type TypeDocumentationProps = {
  typeInfo: TypeInfo,
  platform?: string,
  parentTypes?: string[],
};

function formatTypeSignature(type: string): string {
  // Clean up long import paths and make types more readable
  let cleaned = type
    .replace(/import\([^)]+\)\./g, '') // Remove import() paths
    .replace(/\s+/g, ' ') // Normalize whitespace
    .trim();
  
  // Simplify long union types of string literals (e.g., "a" | "b" | "c" | ... -> string)
  const stringLiteralUnionMatch = cleaned.match(/^"[\w-]+"(\s*\|\s*"[\w-]+")+$/);
  if (stringLiteralUnionMatch) {
    const options = cleaned.split('|').map(s => s.trim().replace(/"/g, ''));
    if (options.length > 4) {
      // For long union types, show a simplified version
      return `string (one of: ${options.slice(0, 3).join(', ')}, ... +${options.length - 3} more)`;
    }
  }
  
  // Simplify complex conditional/union types (too complex to display inline)
  if (cleaned.includes(' extends ') && cleaned.length > 100) {
    return 'object (see signature for details)';
  }
  
  return cleaned;
}

// Format return type, keeping it concise for display
function formatReturnType(returnType: string): string {
  let cleaned = formatTypeSignature(returnType);
  
  // Simplify very long object types in Promise<...>
  // Match Promise<{ ... many properties ... }[]> or Promise<{ ... }>
  const promiseMatch = cleaned.match(/^Promise<(\{.+\})(\[\])?>/);
  if (promiseMatch) {
    const objectType = promiseMatch[1];
    const isArray = promiseMatch[2];
    
    // If the object type is very long (>150 chars), it's likely an expanded entity type
    if (objectType.length > 150) {
      // Try to detect what type it might be based on distinctive properties
      if (objectType.includes('type: "user"') && objectType.includes('createdAt:') && objectType.includes('description:')) {
        return isArray ? 'Promise<UserApiKey[]>' : 'Promise<UserApiKey>';
      }
      if (objectType.includes('type: "team"') && objectType.includes('createdAt:') && objectType.includes('description:')) {
        return isArray ? 'Promise<TeamApiKey[]>' : 'Promise<TeamApiKey>';
      }
      if (objectType.includes('displayName:') && objectType.includes('primaryEmail:')) {
        return isArray ? 'Promise<User[]>' : 'Promise<User>';
      }
      if (objectType.includes('displayName') && objectType.includes('profilePictureUrl')) {
        return isArray ? 'Promise<Team[]>' : 'Promise<Team>';
      }
      if (objectType.includes('permissionId') && objectType.includes('userId')) {
        return isArray ? 'Promise<TeamPermission[]>' : 'Promise<TeamPermission>';
      }
      if (objectType.includes('value:') && objectType.includes('type:') && objectType.includes('isPrimary')) {
        return isArray ? 'Promise<ContactChannel[]>' : 'Promise<ContactChannel>';
      }
      // Generic fallback based on distinctive markers
      if (objectType.includes('id:') && objectType.includes('createdAt:')) {
        return isArray ? 'Promise<Entity[]>' : 'Promise<Entity>';
      }
      // Last resort
      return isArray ? 'Promise<T[]>' : 'Promise<T>';
    }
  }
  
  return cleaned;
}

// Parse object properties from a type string like "{ prop1?: type1; prop2: type2; }"
// Also handles intersection types like "{ a: string } & { b: number }"
function parseObjectProperties(typeString: string): Array<{ name: string, type: string, optional: boolean }> | null {
  const allProperties: Array<{ name: string, type: string, optional: boolean }> = [];
  
  // Strip trailing "| undefined" for optional parameters
  let cleanedType = typeString.replace(/\s*\|\s*undefined\s*$/g, '').trim();
  
  // Don't try to parse if it doesn't contain curly braces (not an object type)
  if (!cleanedType.includes('{') || !cleanedType.includes('}')) {
    return null;
  }
  
  // Don't try to parse complex conditional types or unions with conditionals
  if (cleanedType.includes(' extends ') || cleanedType.includes('? {')) {
    return null;
  }
  
  // Handle intersection types - split by & at the top level
  const intersectionParts = splitIntersectionType(cleanedType);
  
  for (const part of intersectionParts) {
    const trimmedPart = part.trim();
    
    // Match object type pattern
    const objectMatch = trimmedPart.match(/^\{\s*(.+?)\s*;?\s*\}$/s);
    if (!objectMatch) continue;

    const propsString = objectMatch[1];

    // Split by semicolons, handling nested objects and generics
    let currentProp = '';
    let depth = 0;
    let inGeneric = 0;

    for (let i = 0; i < propsString.length; i++) {
      const char = propsString[i];
      
      if (char === '<') inGeneric++;
      if (char === '>') inGeneric--;
      if (char === '{') depth++;
      if (char === '}') depth--;
      
      if (char === ';' && depth === 0 && inGeneric === 0) {
        if (currentProp.trim()) {
          const prop = parseSingleProperty(currentProp.trim());
          if (prop) allProperties.push(prop);
        }
        currentProp = '';
      } else {
        currentProp += char;
      }
    }
    
    // Handle last property (may not have trailing semicolon)
    if (currentProp.trim()) {
      const prop = parseSingleProperty(currentProp.trim());
      if (prop) allProperties.push(prop);
    }
  }

  return allProperties.length > 0 ? allProperties : null;
}

// Split intersection type at top level (e.g., "A & B" -> ["A", "B"])
function splitIntersectionType(typeString: string): string[] {
  const parts: string[] = [];
  let current = '';
  let depth = 0;
  let inGeneric = 0;

  for (let i = 0; i < typeString.length; i++) {
    const char = typeString[i];
    const nextChar = typeString[i + 1];
    
    if (char === '<') inGeneric++;
    if (char === '>') inGeneric--;
    if (char === '{') depth++;
    if (char === '}') depth--;
    
    if (char === '&' && depth === 0 && inGeneric === 0) {
      if (current.trim()) parts.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  
  if (current.trim()) parts.push(current.trim());
  
  return parts.length > 0 ? parts : [typeString];
}

function parseSingleProperty(propString: string): { name: string, type: string, optional: boolean } | null {
  // Match property pattern: "propName?: type" or "propName: type"
  const match = propString.match(/^(\w+)(\??):\s*(.+)$/);
  if (!match) return null;

  // Clean up the type by removing "| undefined" 
  let type = match[3].trim().replace(/\s*\|\s*undefined\s*$/g, '').trim();

  return {
    name: match[1],
    optional: match[2] === '?',
    type
  };
}

// Format a method signature nicely for display  
function formatMethodSignature(
  signature: { 
    parameters: Array<{ 
      name: string, 
      type: string, 
      optional: boolean, 
      propertyDescriptions?: Record<string, { type: string, optional: boolean, description?: string }> 
    }>, 
    returnType: string 
  }, 
  methodName: string
): string {
  const formattedReturnType = formatReturnType(signature.returnType);
  
  if (signature.parameters.length === 0) {
    if (formattedReturnType.length > 80) {
      return `declare function ${methodName}():\n  ${formattedReturnType};`;
    }
    return `declare function ${methodName}(): ${formattedReturnType};`;
  }
  
  const params = signature.parameters.map(param => {
    // If we have propertyDescriptions, use them to format inline object
    if (param.propertyDescriptions && Object.keys(param.propertyDescriptions).length > 0) {
      const props = Object.entries(param.propertyDescriptions).map(([propName, propInfo]) => {
        return `  ${propName}${propInfo.optional ? '?' : ''}: ${propInfo.type};`;
      }).join('\n');
      return `${param.name}${param.optional ? '?' : ''}: {\n${props}\n}`;
    }
    
    // Try to parse inline expanded type
    const properties = parseObjectProperties(param.type);
    
    if (properties && properties.length > 0) {
      const propsFormatted = properties.map(prop => 
        `  ${prop.name}${prop.optional ? '?' : ''}: ${prop.type};`
      ).join('\n');
      
      return `${param.name}${param.optional ? '?' : ''}: {\n${propsFormatted}\n}`;
    } else {
      return `${param.name}${param.optional ? '?' : ''}: ${param.type}`;
    }
  }).join(', ');

  const oneLine = `declare function ${methodName}(${params}): ${formattedReturnType};`;
  if (oneLine.length > 100) {
    return `declare function ${methodName}(${params}):\n  ${formattedReturnType};`;
  }
  
  return oneLine;
}

// Syntax highlighted code block component
function SyntaxHighlightedCode({ code, language = 'typescript' }: { code: string, language?: string }) {
  const [highlightedCode, setHighlightedCode] = useState<string>('');
  const [isClient, setIsClient] = useState(false);

  useEffect(() => {
    setIsClient(true);
  }, []);

  useEffect(() => {
    if (!isClient) return;

    const updateHighlightedCode = async () => {
      try {
        const isDarkMode = document.documentElement.classList.contains('dark') ||
          getComputedStyle(document.documentElement).getPropertyValue('--fd-background').includes('0 0% 3.9%');
        const theme = isDarkMode ? 'github-dark' : 'github-light';

        const html = await codeToHtml(code, {
          lang: language,
          theme,
          transformers: [{
            pre(node) {
              if (node.properties.style) {
                node.properties.style = (node.properties.style as string).replace(/background[^;]*;?/g, '');
              }
            },
            code(node) {
              if (node.properties.style) {
                node.properties.style = (node.properties.style as string).replace(/background[^;]*;?/g, '');
              }
            }
          }]
        });
        setHighlightedCode(html);
      } catch (error) {
        console.error('Error highlighting code:', error);
        setHighlightedCode(`<pre><code>${code}</code></pre>`);
      }
    };

    runAsynchronously(updateHighlightedCode);

    // Listen for theme changes
    const observer = new MutationObserver(() => {
      runAsynchronously(updateHighlightedCode);
    });

    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class']
    });

    return () => observer.disconnect();
  }, [code, language, isClient]);

  if (!highlightedCode) {
    return <pre><code>{code}</code></pre>;
  }

  return <div dangerouslySetInnerHTML={{ __html: highlightedCode }} />;
}

function buildAnchorId(typeName: string, memberName: string): string {
  const cleanType = typeName.replace(/[^a-z0-9]/gi, '').toLowerCase();
  const cleanMember = memberName.replace(/[^a-z0-9]/gi, '').toLowerCase();
  return `#${cleanType}${cleanMember}`;
}

function generateTableOfContents(typeInfo: TypeInfo, platform = 'react-like', membersToShow?: TypeMember[], parentTypes?: string[]): string {
  const lines: string[] = [];
  const members = membersToShow || typeInfo.members;
  
  // Filter platform-specific members upfront
  const filteredMembers = members.filter(member => 
    !member.platforms || member.platforms.includes(platform)
  );
  
  // Track which members have been processed (for grouping hooks with their async counterparts)
  const processed = new Set<string>();

  lines.push(`type ${typeInfo.name} = {`);

  // Add inheritance information if parentTypes are provided
  if (parentTypes && parentTypes.length > 0) {
    parentTypes.forEach(parentType => {
      lines.push(`    // Inherits all functionality from ${parentType}`);
      // Generate link based on type - for now, same page anchor
      const anchor = `#${parentType.toLowerCase()}`;
      lines.push(`    & ${parentType} //$stack-link-to:${anchor}`);
    });
    if (filteredMembers.length > 0) {
      lines.push(`    & {`);
    } else {
      // No new members, just close
      lines.push('};');
      return lines.join('\n');
    }
  }

  // Determine indentation based on whether we have parent types
  const indent = parentTypes && parentTypes.length > 0 ? '        ' : '    ';
  
  filteredMembers.forEach(member => {
    if (processed.has(member.name)) return;

    const memberName = member.name;
    const isOptional = member.optional ? '?' : '';
    const anchorId = buildAnchorId(typeInfo.name, memberName);

    if (member.kind === 'property') {
      const cleanType = formatTypeSignature(member.type || 'unknown');
      lines.push(`${indent}${memberName}${isOptional}: ${cleanType}; //$stack-link-to:${anchorId}`);
      processed.add(memberName);
    } else if (member.kind === 'method') {
      // Check if this is a hook (useX) or an async method (getX/listX)
      const isHook = memberName.startsWith('use') && memberName.length > 3;
      
      if (isHook) {
        // This is a hook - skip it for now, it will be paired with its async counterpart
        return;
      }
      
      // This is an async method - render it and look for its corresponding hook
      const signature = member.signatures?.[member.signatures.length - 1];
      if (signature) {
        const params = signature.parameters.map(p => p.optional ? `${p.name}?` : p.name).join(', ');
        const returnType = formatTypeSignature(signature.returnType);
        lines.push(`${indent}${memberName}(${params}): ${returnType}; //$stack-link-to:${anchorId}`);
        processed.add(memberName);
        
        // Look for corresponding hook: getX -> useX, listX -> useX (plural)
        let hookName = '';
        if (memberName.startsWith('get')) {
          hookName = 'use' + memberName.slice(3);
        } else if (memberName.startsWith('list')) {
          hookName = 'use' + memberName.slice(4);
        }
        
        const hookMember = filteredMembers.find(m => m.name === hookName);
        // Check if hook exists and is react-like (or has no platform restriction)
        const isReactHook = hookMember && (!hookMember.platforms || hookMember.platforms.includes('react-like'));
        if (hookMember && isReactHook) {
          // Found the corresponding hook - render it indented
          const hookAnchorId = buildAnchorId(typeInfo.name, hookName);
          const hookSig = hookMember.signatures?.[hookMember.signatures.length - 1];
          if (hookSig) {
            const hookParams = hookSig.parameters.map(p => p.optional ? `${p.name}?` : p.name).join(', ');
            const hookReturn = formatTypeSignature(hookSig.returnType);
            lines.push(`${indent}// NEXT_LINE_PLATFORM react-like`);
            lines.push(`${indent}⤷ ${hookName}(${hookParams}): ${hookReturn}; //$stack-link-to:${hookAnchorId}`);
            processed.add(hookName);
          }
        }
      }
    }
  });

  // Add any remaining hooks that weren't paired
  filteredMembers.forEach(member => {
    if (processed.has(member.name)) return;
    if (member.kind !== 'method') return;
    
    const memberName = member.name;
    const anchorId = buildAnchorId(typeInfo.name, memberName);
    const signature = member.signatures?.[member.signatures.length - 1];
    
    if (signature) {
      const params = signature.parameters.map(p => p.optional ? `${p.name}?` : p.name).join(', ');
      const returnType = formatTypeSignature(signature.returnType);
      lines.push(`${indent}${memberName}(${params}): ${returnType}; //$stack-link-to:${anchorId}`);
      processed.add(memberName);
    }
  });

  // Close the nested object if we have parent types with new members
  if (parentTypes && parentTypes.length > 0 && filteredMembers.length > 0) {
    lines.push(`    };`);
    lines.push('};');
  } else if (!parentTypes || parentTypes.length === 0) {
    // No parent types, just close normally
  lines.push('};');
  }
  // If we had parentTypes but no new members, we already closed above

  return lines.join('\n');
}

function renderMemberDocumentation(typeInfo: TypeInfo, member: TypeMember, platform = 'react-like') {
  const memberName = member.name;
  
  // Check if this is a React hook (methods only, not properties like userId)
  const isReactHook = member.kind === 'method' &&
    memberName.startsWith('use') && 
    memberName.length > 3 && 
    (!member.platforms || member.platforms.includes('react-like'));
  
  // For methods with multiple overloads, prefer the first non-tuple signature
  // Tuple signatures (args: [...]) are internal representations and less user-friendly
  let primarySignature = member.signatures?.[0];
  
  // If we have multiple signatures, try to find the most complete non-tuple one
  if (member.signatures && member.signatures.length > 1) {
    // Filter out tuple signatures
    const nonTupleSignatures = member.signatures.filter(sig => 
      !sig.parameters.some(p => p.type.match(/^\[.+\]$/))
    );
    
    if (nonTupleSignatures.length > 0) {
      // Use the one with the most parameters (most complete)
      primarySignature = nonTupleSignatures.reduce((prev, current) => 
        current.parameters.length > prev.parameters.length ? current : prev
      );
    } else {
      // All are tuple signatures, use the last one (most specific for inheritance)
      primarySignature = member.signatures[member.signatures.length - 1];
    }
  }

  // Skip platform-specific members if they don't match current platform
  if (member.platforms && !member.platforms.includes(platform)) {
    return null;
  }

  return (
    <CollapsibleTypesSection
      key={memberName}
      type={typeInfo.name}
      property={memberName}
      signature={member.kind === 'method' && primarySignature
        ? primarySignature.parameters.map(p => p.name).join(', ')
        : undefined
      }
      isReactHook={isReactHook}
      defaultOpen={false}
    >
      <MethodLayout>
        <MethodContent>
          {isReactHook && (
            <div className="mb-3 flex items-center gap-2">
              <div className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800/50">
                <svg className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M14.23 12.004a2.236 2.236 0 0 1-2.235 2.236 2.236 2.236 0 0 1-2.236-2.236 2.236 2.236 0 0 1 2.235-2.236 2.236 2.236 0 0 1 2.236 2.236zm2.648-10.69c-1.346 0-3.107.96-4.888 2.622-1.78-1.653-3.542-2.602-4.887-2.602-.41 0-.783.093-1.106.278-1.375.793-1.683 3.264-.973 6.365C1.98 8.917 0 10.42 0 12.004c0 1.59 1.99 3.097 5.043 4.03-.704 3.113-.39 5.588.988 6.38.32.187.69.275 1.102.275 1.345 0 3.107-.96 4.888-2.624 1.78 1.654 3.542 2.603 4.887 2.603.41 0 .783-.09 1.106-.275 1.374-.792 1.683-3.263.973-6.365C22.02 15.096 24 13.59 24 12.004c0-1.59-1.99-3.097-5.043-4.032.704-3.11.39-5.587-.988-6.38-.318-.184-.688-.277-1.092-.278zm-.005 1.09v.006c.225 0 .406.044.558.127.666.382.955 1.835.73 3.704-.054.46-.142.945-.25 1.44-.96-.236-2.006-.417-3.107-.534-.66-.905-1.345-1.727-2.035-2.447 1.592-1.48 3.087-2.292 4.105-2.295zm-9.77.02c1.012 0 2.514.808 4.11 2.28-.686.72-1.37 1.537-2.02 2.442-1.107.117-2.154.298-3.113.538-.112-.49-.195-.964-.254-1.42-.23-1.868.054-3.32.714-3.707.19-.09.4-.127.563-.132zm4.882 3.05c.455.468.91.992 1.36 1.564-.44-.02-.89-.034-1.345-.034-.46 0-.915.01-1.36.034.44-.572.895-1.096 1.345-1.565zM12 8.1c.74 0 1.477.034 2.202.093.406.582.802 1.203 1.183 1.86.372.64.71 1.29 1.018 1.946-.308.655-.646 1.31-1.013 1.95-.38.66-.773 1.288-1.18 1.87-.728.063-1.466.098-2.21.098-.74 0-1.477-.035-2.202-.093-.406-.582-.802-1.204-1.183-1.86-.372-.64-.71-1.29-1.018-1.946.303-.657.646-1.313 1.013-1.954.38-.66.773-1.286 1.18-1.868.728-.064 1.466-.098 2.21-.098zm-3.635.254c-.24.377-.48.763-.704 1.16-.225.39-.435.782-.635 1.174-.265-.656-.49-1.31-.676-1.947.64-.15 1.315-.283 2.015-.386zm7.26 0c.695.103 1.365.23 2.006.387-.18.632-.405 1.282-.66 1.933-.2-.39-.41-.783-.64-1.174-.225-.392-.465-.774-.705-1.146zm3.063.675c.484.15.944.317 1.375.498 1.732.74 2.852 1.708 2.852 2.476-.005.768-1.125 1.74-2.857 2.475-.42.18-.88.342-1.355.493-.28-.958-.646-1.956-1.1-2.98.45-1.017.81-2.01 1.085-2.964zm-13.395.004c.278.96.645 1.957 1.1 2.98-.45 1.017-.812 2.01-1.086 2.964-.484-.15-.944-.318-1.37-.5-1.732-.737-2.852-1.706-2.852-2.474 0-.768 1.12-1.742 2.852-2.476.42-.18.88-.342 1.356-.494zm11.678 4.28c.265.657.49 1.312.676 1.948-.64.157-1.316.29-2.016.39.24-.375.48-.762.705-1.158.225-.39.435-.788.636-1.18zm-9.945.02c.2.392.41.783.64 1.175.23.39.465.772.705 1.143-.695-.102-1.365-.23-2.006-.386.18-.63.406-1.282.66-1.933zM17.92 16.32c.112.493.2.968.254 1.423.23 1.868-.054 3.32-.714 3.708-.147.09-.338.128-.563.128-1.012 0-2.514-.807-4.11-2.28.686-.72 1.37-1.536 2.02-2.44 1.107-.118 2.154-.3 3.113-.54zm-11.83.01c.96.234 2.006.415 3.107.532.66.905 1.345 1.727 2.035 2.446-1.595 1.483-3.092 2.295-4.11 2.295-.22-.005-.406-.05-.553-.132-.666-.38-.955-1.834-.73-3.703.054-.46.142-.944.25-1.438zm4.56.64c.44.02.89.034 1.345.034.46 0 .915-.01 1.36-.034-.44.572-.895 1.095-1.345 1.565-.455-.47-.91-.993-1.36-1.565z"/>
                </svg>
                <span className="text-xs font-medium text-blue-700 dark:text-blue-300">React Hook</span>
              </div>
              <span className="text-xs text-fd-muted-foreground italic">
                Only available in React-based frameworks
              </span>
            </div>
          )}
          
          <div className="prose-sm max-w-none">
            {member.description ? (
              // Parse and render description with proper formatting
              member.description.split('\n\n').map((paragraph, idx) => {
                // Check if this paragraph is a code block
                if (paragraph.trim().startsWith('```')) {
                  const lines = paragraph.split('\n');
                  const langMatch = lines[0].match(/^```(\w+)/);
                  const language = langMatch ? langMatch[1] : 'typescript';
                  const code = lines.slice(1, -1).join('\n'); // Remove ``` markers
                  return (
                    <div key={idx} className="my-3">
                      <SyntaxHighlightedCode code={code} language={language} />
                    </div>
                  );
                } else {
                  return <p key={idx} className="mb-2 last:mb-0 whitespace-pre-wrap">{paragraph}</p>;
                }
              })
            ) : (
              `⚠️ Documentation not available for ${memberName}.`
            )}
          </div>

          {member.tags?.some(tag => tag.name === 'deprecated') && (
            <>
              <br /><br />
              <div className="p-3 bg-yellow-50 dark:bg-yellow-950/20 border border-yellow-200 dark:border-yellow-800/50 rounded-lg">
              <div className="text-yellow-800 dark:text-yellow-200 text-sm font-medium mb-1">
                ⚠️ Deprecated
              </div>
              <div className="text-yellow-700 dark:text-yellow-300 text-sm">
                  {member.tags.find(tag => tag.name === 'deprecated')?.text || 'This item is deprecated.'}
                </div>
              </div>
            </>
          )}

          {member.kind === 'method' && (
            <>
              <h3>Parameters</h3>

              {(primarySignature?.parameters.length ?? 0) === 0 ? (
                <p>None.</p>
              ) : (
                <>
                  {(primarySignature?.parameters ?? []).map((param, index) => {
                    const formattedType = formatTypeSignature(param.type);
                    
                    // Check if we have propertyDescriptions (new format)
                    const hasPropertyInfo = param.propertyDescriptions && Object.keys(param.propertyDescriptions).length > 0;
                    
                    // Try to parse inline type as fallback
                    const properties = hasPropertyInfo ? null : parseObjectProperties(param.type);

                    return (
                    <ParamField
                      key={index}
                      path={param.name}
                        type={hasPropertyInfo || properties ? 'object' : formattedType}
                      required={!param.optional}
                    >
                        {hasPropertyInfo ? (
                          <>
                            An object containing properties.
                            <Accordion title="Show Properties">
                              {Object.entries(param.propertyDescriptions!).map(([propName, propInfo]) => (
                                <ParamField
                                  key={propName}
                                  path={propName}
                                  type={formatTypeSignature(propInfo.type)}
                                  required={!propInfo.optional}
                                >
                                  {propInfo.description || `Property of type ${formatTypeSignature(propInfo.type)}.`}
                                </ParamField>
                              ))}
                            </Accordion>
                          </>
                        ) : properties ? (
                          <>
                            An object containing properties.
                            <Accordion title="Show Properties">
                              {properties.map((prop, propIndex) => (
                                <ParamField
                                  key={propIndex}
                                  path={prop.name}
                                  type={formatTypeSignature(prop.type)}
                                  required={!prop.optional}
                                >
                                  Property of type {formatTypeSignature(prop.type)}.
                    </ParamField>
                  ))}
                            </Accordion>
                          </>
                        ) : (
                          `Parameter of type ${formattedType}.`
                        )}
                      </ParamField>
                    );
                  })}
            </>
          )}

              <h3>Returns</h3>
              <p>
                <code>{formatReturnType(primarySignature?.returnType ?? 'unknown')}</code>
              </p>
            </>
          )}
        </MethodContent>

        <MethodAside title="Type Definition">
          {member.kind === 'method' && primarySignature ? (
            <AsideSection title="Signature">
              <SyntaxHighlightedCode
                code={formatMethodSignature(primarySignature, memberName)}
                language="typescript"
              />
            </AsideSection>
          ) : (
            <SyntaxHighlightedCode
              code={`declare const ${memberName}: ${formatTypeSignature(member.type || 'unknown')};`}
              language="typescript"
            />
          )}

          {member.sourcePath && member.line ? (
            <div className="mt-4 pt-4 border-t border-fd-border">
              <a
                href={`https://github.com/stack-auth/stack/blob/main/packages/template/${member.sourcePath}#L${member.line}`}
                target="_blank"
                rel="noopener noreferrer"
                className="group flex items-center gap-2 px-3 py-2 rounded-lg border border-fd-border bg-fd-secondary/30 hover:bg-fd-secondary/50 hover:border-fd-accent-foreground/50 transition-all duration-200 no-underline"
              >
                <svg className="w-3.5 h-3.5 text-fd-muted-foreground group-hover:text-fd-accent-foreground transition-colors flex-shrink-0" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path fillRule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" clipRule="evenodd" />
                </svg>
                <span className="flex-1 text-xs font-medium text-fd-foreground group-hover:text-fd-accent-foreground transition-colors truncate">
                  View Source · {member.sourcePath.split('/').pop()}:{member.line}
                </span>
                <svg className="w-3 h-3 text-fd-muted-foreground group-hover:text-fd-accent-foreground group-hover:translate-x-0.5 transition-all flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </a>
            </div>
          ) : (
            <div className="mt-4 pt-4 border-t border-fd-border">
              <div className="px-3 py-2 rounded-lg border border-fd-border/50 bg-fd-muted/20 text-xs text-fd-muted-foreground">
                Generated property
              </div>
            </div>
          )}
        </MethodAside>
      </MethodLayout>
    </CollapsibleTypesSection>
  );
}

// Check if a member is new or enhanced compared to parent types
function isNewOrEnhancedMember(
  member: TypeMember, 
  typeInfo: TypeInfo,
  parentMembers: Map<string, TypeMember>
): boolean {
  const parentMember = parentMembers.get(member.name);
  
  if (!parentMember) {
    // Member doesn't exist in parent - it's new
    return true;
  }
  
  // Check if this member has signatures not in the parent
  const memberSigCount = member.signatures?.length ?? 0;
  const parentSigCount = parentMember.signatures?.length ?? 0;
  
  if (memberSigCount > 0 && parentSigCount > 0) {
    // Compare signatures - normalize Server* types
    const memberSigs = new Set(member.signatures?.map(s => s.signature) || []);
    const parentSigs = new Set(parentMember.signatures?.map(s => s.signature) || []);
    
    const normalizeServerTypes = (sig: string) => {
      return sig
        .replace(/Server(ContactChannel|User|Team|Permission|ApiKey|Item|Project|Email)/g, '$1')
        .trim();
    };
    
    const normalizedMemberSigs = new Set(Array.from(memberSigs).map(normalizeServerTypes));
    const normalizedParentSigs = new Set(Array.from(parentSigs).map(normalizeServerTypes));
    
    // Check if there are any new signatures not in parent
    const hasNewSignatures = Array.from(normalizedMemberSigs).some(sig => !normalizedParentSigs.has(sig));
    
    if (!hasNewSignatures) {
      // All member signatures exist in parent - not new
      return false;
    }
  }
  
  // For methods, compare the most specific signatures
  if (member.kind === 'method' && parentMember.kind === 'method') {
    const memberSig = member.signatures?.[member.signatures.length - 1];
    const parentSig = parentMember.signatures?.[parentMember.signatures.length - 1];
    
    if (memberSig && parentSig) {
      // Compare parameters - if they're different, it's enhanced
      if (memberSig.signature !== parentSig.signature) {
        const memberParams = memberSig.parameters.map(p => `${p.name}:${p.type}`).join(',');
        const parentParams = parentSig.parameters.map(p => `${p.name}:${p.type}`).join(',');
        
        if (memberParams !== parentParams) {
          return true; // Different parameters = enhanced
        }
      }
      
      // If parameters are identical, check if return type is meaningfully different
      // Ignore Server* vs non-Server* variations (e.g., ServerContactChannel vs ContactChannel)
      const normalizeServerTypes = (type: string) => {
        return type
          .replace(/Server(ContactChannel|User|Team|Permission|ApiKey|Item|Project|Email)/g, '$1')
          .replace(/\s+/g, ' ')
          .trim();
      };
      
      const memberReturn = normalizeServerTypes(memberSig.returnType);
      const parentReturn = normalizeServerTypes(parentSig.returnType);
      
      if (memberReturn !== parentReturn) {
        return true; // Meaningfully different return type
      }
    }
  }
  
  // For properties, check if the type is different
  if (member.kind === 'property' && parentMember.kind === 'property') {
    if (member.type !== parentMember.type) {
      return true;
    }
  }
  
  // Otherwise, it's the same as parent
  return false;
}

export function TypeDocumentation({ typeInfo, platform = 'react-like', parentTypes = [] }: TypeDocumentationProps) {
  const [parentMembers, setParentMembers] = React.useState<Map<string, TypeMember>>(new Map());
  const [loading, setLoading] = React.useState(parentTypes.length > 0);

  // Load parent type members for comparison
  React.useEffect(() => {
    if (parentTypes.length === 0) {
      setLoading(false);
      return;
    }

    async function loadParentTypes() {
      try {
        const response = await fetch('/sdk-docs/types.json');
        if (!response.ok) return;

        const typesData = await response.json();
        const allParentMembers = new Map<string, TypeMember>();

        for (const parentTypeName of parentTypes) {
          const parentType = typesData[parentTypeName];
          if (parentType && parentType.members) {
            for (const member of parentType.members) {
              // Merge signatures from all parents for the same member
              if (allParentMembers.has(member.name)) {
                const existing = allParentMembers.get(member.name)!;
                // Merge signatures from both parents
                if (existing.signatures && member.signatures) {
                  existing.signatures = [...existing.signatures, ...member.signatures];
                }
              } else {
                allParentMembers.set(member.name, { ...member });
              }
            }
          }
        }

        setParentMembers(allParentMembers);
      } catch (err) {
        console.error('Error loading parent types:', err);
      } finally {
        setLoading(false);
      }
    }
    runAsynchronously(loadParentTypes());
  }, [parentTypes]);

  if (loading) {
    return <div className="text-fd-muted-foreground">Loading...</div>;
  }

  // Filter members to only show new or enhanced ones
  const filteredMembers = parentTypes.length > 0
    ? typeInfo.members.filter(member => isNewOrEnhancedMember(member, typeInfo, parentMembers))
    : typeInfo.members;

  const inheritedCount = typeInfo.members.length - filteredMembers.length;

  return (
    <>
      {/* Inheritance note */}
      {parentTypes.length > 0 && (
        <div className="mb-6 p-4 rounded-lg border border-fd-border bg-fd-muted/30">
          <p className="text-sm text-fd-muted-foreground">
            This type extends{' '}
            {parentTypes.map((parent, idx) => (
              <React.Fragment key={parent}>
                <code className="text-fd-accent-foreground">{parent}</code>
                {idx < parentTypes.length - 1 && (idx === parentTypes.length - 2 ? ' and ' : ', ')}
              </React.Fragment>
            ))}
            {inheritedCount > 0 && ` (${inheritedCount} inherited ${inheritedCount === 1 ? 'member' : 'members'} not shown)`}.
            {filteredMembers.length === 0 && ' It does not add any new members.'}
          </p>
        </div>
      )}

      {/* Table of Contents */}
      {(filteredMembers.length > 0 || parentTypes.length > 0) && (
        <div className="mb-6">
          <ClickableTableOfContents
            title={`${typeInfo.name} Table of Contents${parentTypes.length > 0 && filteredMembers.length > 0 ? ' (New Members Only)' : ''}`}
            code={generateTableOfContents(typeInfo, platform, filteredMembers, parentTypes)}
            platform={platform}
          />
        </div>
      )}

      {/* Members Documentation */}
      {filteredMembers.map(member =>
              renderMemberDocumentation(typeInfo, member, platform)
      )}
    </>
  );
}

// Component to load and display a specific type from types.json
export function TypeFromJson({ 
  typeName, 
  platform = 'react-like',
  parentTypes = []
}: { 
  typeName: string, 
  platform?: string,
  parentTypes?: string[]
}) {
  const [typeInfo, setTypeInfo] = React.useState<TypeInfo | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    async function loadTypeInfo() {
      try {
        setLoading(true);
        setError(null);

        // Load the types.json file
        const response = await fetch('/sdk-docs/types.json');
        if (!response.ok) {
          throw new Error(`Failed to load types.json: ${response.statusText}`);
        }

        const typesData = await response.json();
        const foundType = typesData[typeName];

        if (!foundType) {
          throw new Error(`Type "${typeName}" not found in types.json`);
        }

        setTypeInfo(foundType);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setLoading(false);
      }
    }
    runAsynchronously(loadTypeInfo());
  }, [typeName]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="text-fd-muted-foreground">Loading type documentation...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800/50 rounded-lg p-4">
        <div className="text-red-800 dark:text-red-200 font-medium mb-1">Error Loading Type</div>
        <div className="text-red-700 dark:text-red-300 text-sm">{error}</div>
      </div>
    );
  }

  if (!typeInfo) {
    return (
      <div className="text-fd-muted-foreground text-center py-8">
        Type not found.
      </div>
    );
  }

  return <TypeDocumentation typeInfo={typeInfo} platform={platform} parentTypes={parentTypes} />;
}
