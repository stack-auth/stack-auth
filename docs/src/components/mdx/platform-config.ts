// Centralized platform and framework configuration
export interface PlatformConfig {
  [platformName: string]: {
    [frameworkName: string]: {
      defaultFilename?: string;
      language: string;
    };
  };
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
  },
  "TypeScript": {
    "Next.js": {
      defaultFilename: "app/api/route.ts",
      language: "typescript"
    },
    "Express": {
      defaultFilename: "server.ts",
      language: "typescript"
    },
    "React": {
      defaultFilename: "components/LoginForm.tsx",
      language: "typescript"
    },
    "Node.js": {
      defaultFilename: "index.ts",
      language: "typescript"
    }
  },
  "Go": {
    "Gin": {
      defaultFilename: "main.go",
      language: "go"
    },
    "Echo": {
      defaultFilename: "server.go",
      language: "go"
    },
    "Standard Library": {
      defaultFilename: "handler.go",
      language: "go"
    }
  },
  "Java": {
    "Spring Boot": {
      defaultFilename: "AuthController.java",
      language: "java"
    },
    "Spring Security": {
      defaultFilename: "SecurityConfig.java",
      language: "java"
    }
  },
  "C#": {
    ".NET Core": {
      defaultFilename: "AuthController.cs",
      language: "csharp"
    },
    "ASP.NET": {
      defaultFilename: "LoginController.cs",
      language: "csharp"
    }
  },
  "PHP": {
    "Laravel": {
      defaultFilename: "AuthController.php",
      language: "php"
    },
    "Symfony": {
      defaultFilename: "SecurityController.php",
      language: "php"
    },
    "Plain PHP": {
      defaultFilename: "login.php",
      language: "php"
    }
  },
  "Ruby": {
    "Rails": {
      defaultFilename: "sessions_controller.rb",
      language: "ruby"
    },
    "Sinatra": {
      defaultFilename: "app.rb",
      language: "ruby"
    }
  },
  "Rust": {
    "Axum": {
      defaultFilename: "main.rs",
      language: "rust"
    },
    "Actix": {
      defaultFilename: "handlers.rs",
      language: "rust"
    }
  }
};

// Helper function to get available platforms
export function getAvailablePlatforms(): string[] {
  return Object.keys(PLATFORM_CONFIG);
}

// Helper function to get frameworks for a platform
export function getFrameworksForPlatform(platform: string): string[] {
  return Object.keys(PLATFORM_CONFIG[platform] || {});
}

// Helper function to get config for a platform/framework combination
export function getPlatformFrameworkConfig(platform: string, framework: string) {
  return PLATFORM_CONFIG[platform]?.[framework];
}

// Default framework preferences (can be overridden)
export const DEFAULT_FRAMEWORK_PREFERENCES: { [platform: string]: string } = {
  "Python": "Django",
  "JavaScript": "Next.js", 
  "TypeScript": "Next.js",
  "Go": "Gin",
  "Java": "Spring Boot",
  "C#": ".NET Core",
  "PHP": "Laravel",
  "Ruby": "Rails",
  "Rust": "Axum"
};

