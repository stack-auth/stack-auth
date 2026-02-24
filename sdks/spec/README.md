# Stack Auth SDK Specification

This folder contains the specification for Stack Auth's SDKs.

When writing this specification, try to write imperative pseudocode as much as possible (be explicit about what things are named, etc.).

## Notation

The spec files use the following notation:

| Notation | Meaning |
|----------|---------|
| `[authenticated]` | Include access token, handle 401 refresh |
| `[server-only]` | Requires secretServerKey |
| `[BROWSER-LIKE]` | Requires browser or browser-like environment (browser, WebView, in-app browser). On mobile, open an in-app browser (ASWebAuthenticationSession on iOS, Custom Tabs on Android). On desktop, open the system browser with a registered URL scheme. |
| `[BROWSER-ONLY]` | Strictly requires browser environment (DOM, window object) |
| `[CLI-ONLY]` | Only in languages/platforms with an interactive terminal |
| `[JS-ONLY]` | Only available in the JavaScript SDK |
| `{ field, field }` | Request body (JSON) |
| `"Does not error"` | Function handles errors internally |
| `"Errors: ..."` | Lists possible errors with code/message |

See _utilities.spec.md for more details.

## Language Adaptation

The languages should adapt:

- **Naming conventions**: camelCase (JS), snake_case (Python), PascalCase (Go), etc.
- **Async patterns**: Promises (JS), async/await (Python), goroutines (Go)
- **Error handling**: Exceptions vs Result types (language preference)
- **Parameter conventions**: Objects vs. kwargs, etc.
- **Framework hooks**: Eg. for React, add `use*` equivalents to `get*`/`list*` methods
- **Everything else, wherever it makes sense**: Every language is unique and the patterns will differ. If you have to decide between what's idiomatic in a language vs. what was done in the Stack Auth SDK for other languages, use the idiomatic pattern.

## Implementation Notes

### Object Construction

When constructing SDK objects (User, Team, etc.) from API responses:
1. Map naming conventions to your language's naming convention
2. Objects should hold a reference to the SDK client for making API calls
3. Objects can be mutable or immutable based on language conventions
4. `update()` methods should update local properties after successful API call

### Caching

Normal functions should not cache. Some frameworks, like React, have hooks that require caching; for these, require explicit guidance.

### Pagination

Most `list*` methods support pagination:
- Request with `cursor` and `limit` query params
- Response includes `pagination: { next_cursor?: string }`
- `next_cursor` is null or absent when no more pages
- Default limit is typically 100
- Note that not all backend APIs support pagination, and some just return all items at once.

### Date/Time Formats

- API uses milliseconds since epoch for timestamps (e.g., `signed_up_at_millis`)
- Convert to your language's native Date/DateTime type
