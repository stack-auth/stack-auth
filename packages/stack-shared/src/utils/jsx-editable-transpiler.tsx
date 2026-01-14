import * as parser from '@babel/parser';
import traverse, { NodePath } from '@babel/traverse';
import generate from '@babel/generator';
import * as t from '@babel/types';
import { createHash } from 'crypto';

/**
 * Metadata for an editable text region in JSX source code.
 * This information is used by the AI to accurately locate and update text.
 */
export type EditableMetadata = {
  /** Unique identifier for this editable region */
  id: string,

  /** Exact source code location */
  loc: {
    start: number,
    end: number,
    line: number,
    column: number,
  },

  /** The original text content */
  originalText: string,

  /** Hash of original text for quick mismatch detection */
  textHash: string,

  /** JSX ancestry path from component root to this text node */
  jsxPath: string[],

  /** The immediate parent JSX element */
  parentElement: {
    tagName: string,
    props: Record<string, string>,
  },

  /** Surrounding source context for disambiguation */
  sourceContext: {
    before: string,
    after: string,
  },

  /** Index among sibling text nodes in the same parent */
  siblingIndex: number,

  /** Total count of this exact text in the source */
  occurrenceCount: number,

  /** Which occurrence this is (1-indexed) */
  occurrenceIndex: number,

  /** Which file this text is in */
  sourceFile: "template" | "theme",
};

/**
 * Result of transpiling JSX source to include editable markers.
 */
export type TranspileResult = {
  /** The transformed source code with __Editable wrappers */
  code: string,
  /** Map of editable region IDs to their metadata */
  editableRegions: Record<string, EditableMetadata>,
};

/**
 * The __Editable component definition that gets injected into transformed source.
 * It renders sentinel tokens around text that will be converted to HTML comments.
 */
const EDITABLE_COMPONENT_CODE = `
function __Editable({ __id, children }) {
  return (
    <>
      {\`⟦STACK_EDITABLE_START:\${__id}⟧\`}
      {children}
      {\`⟦STACK_EDITABLE_END:\${__id}⟧\`}
    </>
  );
}
`;

/**
 * Transpiles TSX source code to wrap all static JSX text nodes with __Editable components.
 *
 * For example:
 * ```tsx
 * <Text>Hi, {name}! Welcome.</Text>
 * ```
 * becomes:
 * ```tsx
 * <Text>
 *   <__Editable __id="e1">Hi, </__Editable>
 *   {name}
 *   <__Editable __id="e2">! Welcome.</__Editable>
 * </Text>
 * ```
 */
export function transpileJsxForEditing(
  source: string,
  options: {
    sourceFile: "template" | "theme",
  }
): TranspileResult {
  const editableRegions: Record<string, EditableMetadata> = {};
  let idCounter = 0;

  // Count occurrences of each text for the occurrenceCount/occurrenceIndex fields
  const textOccurrences = new Map<string, number>();

  // First pass: count all text occurrences
  const astForCounting = parser.parse(source, {
    sourceType: 'module',
    plugins: ['jsx', 'typescript'],
  });

  traverse(astForCounting, {
    JSXText(path) {
      const text = path.node.value;
      // Skip whitespace-only text nodes
      if (text.trim() === '') return;
      textOccurrences.set(text, (textOccurrences.get(text) ?? 0) + 1);
    },
  });

  // Track current occurrence index for each text
  const textCurrentIndex = new Map<string, number>();

  // Parse the source again for transformation
  const ast = parser.parse(source, {
    sourceType: 'module',
    plugins: ['jsx', 'typescript'],
  });

  // Helper to get JSX ancestry path
  function getJsxPath(path: NodePath<t.JSXText>): string[] {
    const jsxPath: string[] = [];
    let current: NodePath | null = path.parentPath;

    while (current) {
      if (t.isJSXElement(current.node)) {
        const openingElement = current.node.openingElement;
        if (t.isJSXIdentifier(openingElement.name)) {
          jsxPath.unshift(openingElement.name.name);
        } else if (t.isJSXMemberExpression(openingElement.name)) {
          jsxPath.unshift(generate(openingElement.name).code);
        }
      } else if (t.isFunctionDeclaration(current.node) && current.node.id) {
        jsxPath.unshift(current.node.id.name);
        break;
      } else if (t.isVariableDeclarator(current.node) && t.isIdentifier(current.node.id)) {
        jsxPath.unshift(current.node.id.name);
        break;
      }
      current = current.parentPath;
    }

    return jsxPath;
  }

  // Helper to get parent element info
  function getParentElement(path: NodePath<t.JSXText>): { tagName: string, props: Record<string, string> } {
    let current: NodePath | null = path.parentPath;

    while (current) {
      if (t.isJSXElement(current.node)) {
        const openingElement = current.node.openingElement;
        let tagName = '';

        if (t.isJSXIdentifier(openingElement.name)) {
          tagName = openingElement.name.name;
        } else if (t.isJSXMemberExpression(openingElement.name)) {
          tagName = generate(openingElement.name).code;
        }

        const props: Record<string, string> = {};
        for (const attr of openingElement.attributes) {
          if (t.isJSXAttribute(attr) && t.isJSXIdentifier(attr.name)) {
            const propName = attr.name.name;
            if (t.isStringLiteral(attr.value)) {
              props[propName] = attr.value.value;
            } else if (t.isJSXExpressionContainer(attr.value) && !t.isJSXEmptyExpression(attr.value.expression)) {
              // For expressions, just note that it's dynamic
              props[propName] = `{${generate(attr.value.expression).code}}`;
            }
          }
        }

        return { tagName, props };
      }
      current = current.parentPath;
    }

    return { tagName: 'unknown', props: {} };
  }

  // Helper to get sibling index among text nodes
  function getSiblingIndex(path: NodePath<t.JSXText>): number {
    const parent = path.parentPath;
    if (!t.isJSXElement(parent.node) && !t.isJSXFragment(parent.node)) {
      return 0;
    }

    const children = parent.node.children;
    let textIndex = 0;

    for (const child of children) {
      if (child === path.node) {
        return textIndex;
      }
      if (t.isJSXText(child) && child.value.trim() !== '') {
        textIndex++;
      }
    }

    return textIndex;
  }

  // Helper to get source context (lines before/after)
  function getSourceContext(loc: { start: number, end: number }): { before: string, after: string } {
    const lines = source.split('\n');
    let currentPos = 0;
    let startLine = 0;

    // Find line number for start position
    for (let i = 0; i < lines.length; i++) {
      if (currentPos + lines[i].length >= loc.start) {
        startLine = i;
        break;
      }
      currentPos += lines[i].length + 1; // +1 for newline
    }

    const beforeLines = lines.slice(Math.max(0, startLine - 3), startLine).join('\n');
    const afterLines = lines.slice(startLine + 1, startLine + 4).join('\n');

    return { before: beforeLines, after: afterLines };
  }

  // Transform JSXText nodes
  traverse(ast, {
    JSXText(path) {
      const decodedText = path.node.value;

      // Skip whitespace-only text nodes
      if (decodedText.trim() === '') return;

      // Skip if node doesn't have location info
      // Use explicit null checks since start/end can validly be 0
      if (!path.node.loc || path.node.start == null || path.node.end == null) return;

      // IMPORTANT: Use the RAW source text, not the decoded path.node.value
      // Babel's parser decodes HTML entities (e.g., &lt; -> <) in JSX text,
      // but we need to preserve the original source to avoid XSS vulnerabilities
      const rawText = source.slice(path.node.start, path.node.end);

      // Use source file prefix to ensure unique IDs across template and theme
      const prefix = options.sourceFile === 'template' ? 't' : 'h'; // t for template, h for theme (header)
      const id = `${prefix}${idCounter++}`;
      const occurrenceCount = textOccurrences.get(decodedText) ?? 1;
      const currentIndex = (textCurrentIndex.get(decodedText) ?? 0) + 1;
      textCurrentIndex.set(decodedText, currentIndex);

      const metadata: EditableMetadata = {
        id,
        loc: {
          start: path.node.start,
          end: path.node.end,
          line: path.node.loc.start.line,
          column: path.node.loc.start.column,
        },
        originalText: rawText,
        textHash: createHash('sha256').update(rawText).digest('hex').slice(0, 16),
        jsxPath: getJsxPath(path),
        parentElement: getParentElement(path),
        sourceContext: getSourceContext({ start: path.node.start, end: path.node.end }),
        siblingIndex: getSiblingIndex(path),
        occurrenceCount,
        occurrenceIndex: currentIndex,
        sourceFile: options.sourceFile,
      };

      editableRegions[id] = metadata;

      // Create the __Editable wrapper
      // <__Editable __id="...">text</__Editable>
      // Use rawText to preserve HTML entities from the original source
      const editableElement = t.jsxElement(
        t.jsxOpeningElement(
          t.jsxIdentifier('__Editable'),
          [
            t.jsxAttribute(
              t.jsxIdentifier('__id'),
              t.stringLiteral(id)
            ),
          ],
          false
        ),
        t.jsxClosingElement(t.jsxIdentifier('__Editable')),
        [t.jsxText(rawText)],
        false
      );

      path.replaceWith(editableElement);
    },
  });

  // Generate the transformed code
  const output = generate(ast, {
    retainLines: true,
    compact: false,
  });

  // Inject the __Editable component at the top of the file (after imports)
  let code = output.code;

  // Find the position after all imports
  const importEndMatch = code.match(/^(import\s+[\s\S]*?from\s+['"][^'"]+['"];?\s*)+/m);
  if (importEndMatch) {
    const insertPos = (importEndMatch.index ?? 0) + importEndMatch[0].length;
    code = code.slice(0, insertPos) + '\n' + EDITABLE_COMPONENT_CODE + '\n' + code.slice(insertPos);
  } else {
    // No imports found, add at the beginning
    code = EDITABLE_COMPONENT_CODE + '\n' + code;
  }

  return {
    code,
    editableRegions,
  };
}

/**
 * Post-processes rendered HTML to convert sentinel tokens to HTML comments.
 *
 * Converts:
 * - `⟦STACK_EDITABLE_START:<id>⟧` → `<!-- STACK_EDITABLE_START <id> -->`
 * - `⟦STACK_EDITABLE_END:<id>⟧` → `<!-- STACK_EDITABLE_END <id> -->`
 */
export function convertSentinelTokensToComments(html: string): string {
  return html
    .replace(/⟦STACK_EDITABLE_START:([^⟧]+)⟧/g, '<!-- STACK_EDITABLE_START $1 -->')
    .replace(/⟦STACK_EDITABLE_END:([^⟧]+)⟧/g, '<!-- STACK_EDITABLE_END $1 -->');
}
