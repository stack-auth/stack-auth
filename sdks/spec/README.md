# Stack Auth SDK Specification

This folder contains the specification for generating Stack Auth SDKs in multiple programming languages.

## Purpose

The spec files describe the SDK interface and behavior in a language-agnostic way. When given to an AI code generator (like Claude or Cursor), they should produce functionally equivalent SDKs in any target language.

## Repository Structure

```
sdks/
├── spec/                               # This folder - SDK specification
│   ├── README.md
│   ├── _utilities.spec.md              # Common patterns (auth, HTTP, tokens)
│   ├── _errors.spec.md                 # Common error types
│   ├── apps/
│   │   ├── client-app.spec.md          # StackClientApp
│   │   ├── server-app.spec.md          # StackServerApp
│   │   └── admin-app.spec.md           # StackAdminApp
│   └── types/
│       ├── users/
│       │   ├── base-user.spec.md       # User base properties
│       │   ├── current-user.spec.md    # CurrentUser (authenticated)
│       │   └── server-user.spec.md     # ServerUser
│       ├── teams/
│       │   ├── team.spec.md            # Team
│       │   └── server-team.spec.md     # ServerTeam
│       ├── auth/
│       │   └── oauth-connection.spec.md
│       ├── contact-channels/
│       │   └── contact-channel.spec.md
│       ├── projects/
│       │   └── project.spec.md
│       ├── permissions/
│       │   └── permission.spec.md
│       └── payments/
│           ├── customer.spec.md
│           └── item.spec.md
└── implementations/                    # Generated SDKs (by language)
    ├── python/
    ├── go/
    └── ...
```

## Notation

The spec files use the following notation:

| Notation | Meaning |
|----------|---------|
| `[authenticated]` | Include access token, handle 401 refresh |
| `[server-only]` | Requires secretServerKey |
| `[admin-only]` | Requires superSecretAdminKey |
| `[BROWSER-ONLY]` | Requires browser environment |
| `{ field, field }` | Request body (JSON) |
| `"Does not error"` | Function handles errors internally |
| `"Errors: ..."` | Lists possible errors with code/message |

## Language Adaptation

The generator should adapt:

- **Naming conventions**: camelCase (JS), snake_case (Python), PascalCase (Go)
- **Async patterns**: Promises (JS), async/await (Python), goroutines (Go)
- **Error handling**: Exceptions vs Result types (language preference)
- **Framework hooks**: For React, add `use*` equivalents to `get*`/`list*` methods

## Usage

To generate an SDK:

1. Provide these spec files to an AI code generator
2. Specify the target language and any framework requirements
3. The generator produces implementation code in `sdks/implementations/<language>/`

Example prompt for Python:
```
Generate a Python SDK from the Stack Auth specification in sdks/spec/.
Use snake_case naming, async/await with httpx, and raise exceptions for errors.
Output to sdks/implementations/python/
```

Example prompt for React:
```
All get* and list* functions should have a use* hook equivalent.
```
