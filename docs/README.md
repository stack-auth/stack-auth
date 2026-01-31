# Stack Auth Documentation

This is the documentation site for Stack Auth, built with [Next.js](https://nextjs.org) and [Fumadocs](https://fumadocs.dev).

## Development

```bash
pnpm dev
```

The docs server runs on port `8104` by default (or `${NEXT_PUBLIC_STACK_PORT_PREFIX}04`).

## Project Structure

### Content (`/content`)

| Directory | Description |
|-----------|-------------|
| `content/docs/` | Main documentation (guides, SDK reference, components) |
| `content/api/` | REST API reference documentation |

### App Routes (`/src/app`)

| Route | Description |
|-------|-------------|
| `/docs` | Main documentation pages |
| `/api` | API reference pages (rendered from OpenAPI specs) |
| `/docs-embed` | Embedded docs for dashboard companion widget |
| `/api-embed` | Embedded API docs for dashboard companion widget |
| `/mcp-browser` | MCP documentation browser |
| `/handler/[...stack]` | Stack Auth handler route |
| `/api/search` | Search API endpoint |
| `/api/chat` | AI documentation chat endpoint |
| `/llms.txt` | LLM-friendly documentation (plain text) |
| `/llms.mdx` | LLM-friendly documentation (MDX format) |

### SDK Route Handlers

These routes serve SDK-specific documentation:

- `/js/[...path]` - JavaScript SDK
- `/next/[...path]` - Next.js SDK
- `/react/[...path]` - React SDK
- `/python/[...path]` - Python SDK
- `/rest-api/[...path]` - REST API

### Key Files

| File | Description |
|------|-------------|
| `lib/source.ts` | Content source adapter using Fumadocs `loader()` |
| `source.config.ts` | Fumadocs MDX configuration (frontmatter schema, etc.) |
| `app/layout.config.tsx` | Shared layout options |
| `lib/platform-config.ts` | Platform/framework configuration for code examples |

### Components (`/src/components`)

| Directory | Description |
|-----------|-------------|
| `api/` | API playground components |
| `chat/` | AI chat interface |
| `layout/` | Layout UI components (search, navigation) |
| `layouts/` | Page layouts (docs, API) |
| `mdx/` | Custom MDX components |
| `stack-auth/` | Stack Auth demo components |
| `ui/` | Base UI components (button, etc.) |

### OpenAPI Specs (`/openapi`)

Contains OpenAPI JSON specifications organized by access level:
- `client-*.json` - Client-side API endpoints
- `server-*.json` - Server-side API endpoints
- `admin-*.json` - Admin API endpoints
- `webhooks-*.json` - Webhook event schemas

## Scripts

```bash
# Generate API docs from OpenAPI specs
pnpm generate-openapi-docs

# Clear generated docs
pnpm clear-docs
```

## Learn More

- [Fumadocs Documentation](https://fumadocs.dev)
- [Next.js Documentation](https://nextjs.org/docs)
- [Stack Auth Documentation](https://docs.stack-auth.com)
