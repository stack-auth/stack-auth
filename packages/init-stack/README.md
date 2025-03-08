# Stack Auth Initialization Tool

This package provides a command-line tool to initialize Stack Auth in your project.

## Usage

```bash
npx init-stack [project-path] [options]
```

## Options

- `--help`, `-h`: Show help message
- `--dry-run`: Run without making any changes
- `--neon`: Use Neon database
- `--js`: Initialize for JavaScript project
- `--next`: Initialize for Next.js project
- `--npm`: Use npm as package manager
- `--yarn`: Use yarn as package manager
- `--pnpm`: Use pnpm as package manager
- `--bun`: Use bun as package manager
- `--client`: Initialize client-side only
- `--server`: Initialize server-side only
- `--no-browser`: Don't open browser for environment variable setup

## Environment Variables

- `STACK_DISABLE_INTERACTIVE`: Set to any value to disable interactive prompts. Useful for CI/CD environments.

## Examples

Initialize Stack Auth in a Next.js project without opening the browser:

```bash
npx init-stack --next --no-browser
```

Initialize Stack Auth in a JavaScript project with npm:

```bash
npx init-stack --js --npm
```

For more information, please visit [Stack Auth Documentation](https://docs.stack-auth.com/getting-started/setup).
