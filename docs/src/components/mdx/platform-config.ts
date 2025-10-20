// Centralized platform and framework configuration
export type PlatformConfig = {
  [platformName: string]: {
    [frameworkName: string]: {
      defaultFilename?: string,
      language: string,
    },
  },
}

export const PLATFORM_CONFIG: PlatformConfig = {
  "Python": {
    "Django": {
      defaultFilename: "views.py",
      language: "python"
    },
    "FastAPI": {
      defaultFilename: "main.py",
      language: "python"
    },
    "Flask": {
      defaultFilename: "app.py",
      language: "python"
    }
  },
  "JavaScript": {
    "Next.js": {
      defaultFilename: "app/api/route.ts",
      language: "typescript"
    },
    "Express": {
      defaultFilename: "server.js",
      language: "javascript"
    },
    "React": {
      defaultFilename: "components/LoginForm.tsx",
      language: "typescript"
    },
    "Node.js": {
      defaultFilename: "index.js",
      language: "javascript"
    }
  }
};

// Helper function to get available platforms
export function getAvailablePlatforms(): string[] {
  return Object.keys(PLATFORM_CONFIG);
}

// Helper function to get frameworks for a platform
export function getFrameworksForPlatform(platform: string): string[] {
  return Object.keys(PLATFORM_CONFIG[platform]);
}

// Helper function to get config for a platform/framework combination
export function getPlatformFrameworkConfig(platform: string, framework: string) {
  return PLATFORM_CONFIG[platform][framework];
}

// Default framework preferences (can be overridden)
export const DEFAULT_FRAMEWORK_PREFERENCES: { [platform: string]: string } = {
  "Python": "Django",
  "JavaScript": "Next.js"
};

