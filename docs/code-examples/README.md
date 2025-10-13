# Code Examples

TypeScript-based code examples for Stack Auth documentation.

## Structure

```
code-examples/
├── getting-started.ts   # All examples for getting-started/* pages
├── index.ts             # Aggregates all examples
└── README.md
```

## TypeScript Format

Each TypeScript file exports examples for a documentation section:

```typescript
import { CodeExample } from '../lib/code-examples';

export const gettingStartedExamples = {
  'setup': {
    'example-name': [
      {
        language: 'JavaScript',
        framework: 'Next.js',
        variant: 'server',  // optional: "server" or "client"
        code: `import { StackServerApp } from "@stackframe/stack";

export const stackServerApp = new StackServerApp({
  tokenStore: "nextjs-cookie",
});`,
        highlightLanguage: 'typescript',
        filename: 'stack/server.ts'
      }
    ] as CodeExample[]
  }
};
```

## Fields

- **language**: Programming language (e.g., "JavaScript", "Python")
- **framework**: Framework/runtime (e.g., "Next.js", "React", "Django")
- **variant**: (Optional) "server" or "client" for frameworks with both
- **code**: The actual code (use template literals for multi-line!)
- **highlightLanguage**: Syntax highlighting (e.g., "typescript", "python", "bash")
- **filename**: Display filename in docs

## Usage in MDX

```jsx
<PlatformCodeblock
  document="getting-started/setup"
  examples={["example-name"]}
  title="Example Title"
/>
```

## Benefits of TypeScript

- ✅ **Native template literals** - no escaping needed!
- ✅ **Full IDE support** - syntax highlighting, auto-complete
- ✅ **Type safety** - catch errors at build time
- ✅ **Auto-formatting** - Prettier formats the code for you
- ✅ **Cleaner diffs** - changes are easy to review

## Tips

- Use template literals for multi-line code
- Format code as you would in a real file
- Indentation is preserved exactly as written
- Group related examples under the same document subsection
- Add new sections by creating new TypeScript files and importing them in `index.ts`
