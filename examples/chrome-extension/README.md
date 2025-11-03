# Stack Auth Chrome Extension Example

This is an example Chrome extension that demonstrates how to integrate Stack Auth authentication into a Chrome extension.

## Features

- User authentication with Stack Auth
- Persistent login state using Chrome extension storage
- Simple popup interface showing user information
- Sign in/sign out functionality

## Prerequisites

Before you begin, make sure you have:

1. Node.js 18+ and pnpm installed
2. A Stack Auth project set up at [app.stack-auth.com](https://app.stack-auth.com)
3. Chrome browser for testing

## Setup Instructions

### 1. Install Dependencies

From the root of the Stack Auth repository, install all dependencies:

```bash
pnpm install
```

### 2. Configure Environment Variables

Edit the `.env.development` file in this directory with your Stack Auth project credentials:

```bash
VITE_STACK_API_URL=https://api.stack-auth.com
VITE_STACK_PROJECT_ID=your-project-id
VITE_STACK_PUBLISHABLE_CLIENT_KEY=your-publishable-client-key
```

You can get these values from your Stack Auth project dashboard at [app.stack-auth.com](https://app.stack-auth.com).

**Note:** The default `.env.development` file contains credentials for Stack's internal development environment. Replace these with your own project credentials for production use.

### 3. Build the Extension

Build the extension using Vite:

```bash
pnpm build
```

This will create a `dist` folder with all the necessary files for the Chrome extension.

### 4. Load the Extension in Chrome

1. Open Chrome and navigate to `chrome://extensions/`
2. Enable "Developer mode" by toggling the switch in the top right corner
3. Click "Load unpacked" button
4. Navigate to the `dist` folder in this directory and select it
5. The extension should now appear in your extensions list

### 5. Try the Extension

1. Click the Stack Auth extension icon in your Chrome toolbar (you may need to pin it first)
2. A popup will appear with a "Sign In" button
3. Click "Sign In" to authenticate with Stack Auth
4. After signing in, you'll see your user information displayed
5. Click "Sign Out" to sign out

## Development

For development with hot reload:

```bash
pnpm dev
```

This will start a development server. However, note that you'll still need to reload the extension manually in Chrome after making changes, as Chrome extensions don't support hot module replacement in the same way as web apps.

After making changes:
1. Run `pnpm build` to rebuild the extension
2. Go to `chrome://extensions/`
3. Click the refresh icon on your extension card

## Project Structure

```
chrome-extension/
├── public/
│   └── manifest.json       # Chrome extension manifest
├── src/
│   ├── App.tsx            # Main app component with auth UI
│   ├── popup.tsx          # Popup entry point
│   └── stack.ts           # Stack Auth configuration
├── popup.html             # Popup HTML template
├── package.json           # Dependencies and scripts
├── vite.config.ts         # Vite configuration for extension
└── tsconfig.json          # TypeScript configuration
```

## How It Works

This extension uses Stack Auth's `chrome-extension-local` token store, which stores authentication tokens in Chrome's local storage. This ensures that users remain authenticated even after closing and reopening the extension.

The main components:

- **stack.ts**: Configures the Stack Auth client with `tokenStore: "chrome-extension-local"`
- **App.tsx**: Main UI component that checks authentication state and displays user info
- **manifest.json**: Chrome extension configuration with necessary permissions

## Troubleshooting

### Extension doesn't load
- Make sure you built the extension first with `pnpm build`
- Check that you're loading the `dist` folder, not the root directory

### Authentication fails
- Verify your environment variables are correct
- Check that your Stack Auth project is properly configured
- Ensure your project's allowed origins include `chrome-extension://` URLs

### Changes not appearing
- Remember to rebuild with `pnpm build` after making changes
- Reload the extension in `chrome://extensions/`

## Additional Scripts

- `pnpm typecheck` - Run TypeScript type checking
- `pnpm lint` - Run ESLint
- `pnpm clean` - Clean build artifacts and node_modules

## Learn More

- [Stack Auth Documentation](https://docs.stack-auth.com)
- [Chrome Extension Development Guide](https://developer.chrome.com/docs/extensions/)
- [Stack Auth React SDK](https://docs.stack-auth.com/sdk/react)
