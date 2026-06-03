// This file is generated from docs-mintlify/docs.json.

const docsJson = {
  "$schema": "https://mintlify.com/docs.json",
  "name": "Hexclave Documentation",
  "theme": "mint",
  "logo": {
    "dark": "/images/logo-dark.svg",
    "light": "/images/logo-light.svg"
  },
  "favicon": "/images/favicon.ico",
  "colors": {
    "primary": "#6b5df7",
    "light": "#8b7cf9",
    "dark": "#6b5df7"
  },
  "background": {
    "color": {
      "dark": "#09090b"
    }
  },
  "contextual": {
    "options": [
      "copy",
      "view",
      "assistant",
      "chatgpt",
      "claude",
      "perplexity",
      "grok",
      "aistudio",
      "devin",
      "windsurf",
      "mcp",
      "cursor",
      "vscode",
      "devin-mcp"
    ]
  },
  "fonts": {
    "heading": {
      "family": "Geist",
      "weight": 500
    },
    "body": {
      "family": "Geist",
      "weight": 400
    }
  },
  "navbar": {
    "links": [
      {
        "type": "github",
        "href": "https://github.com/hexclave/hexclave"
      }
    ],
    "primary": {
      "type": "button",
      "label": "Dashboard",
      "href": "https://app.hexclave.com"
    }
  },
  "navigation": {
    "tabs": [
      {
        "tab": "Documentation",
        "pages": [
          "index",
          {
            "group": "Getting Started",
            "pages": [
              "guides/getting-started/setup",
              "guides/getting-started/user-fundamentals",
              "guides/getting-started/ai-integration"
            ]
          },
          {
            "group": "Going Further",
            "pages": [
              "guides/going-further/stack-app",
              "guides/going-further/backend-integration",
              "guides/going-further/cli",
              "guides/going-further/user-metadata"
            ]
          },
          {
            "group": "Apps",
            "pages": [
              {
                "group": "Authentication",
                "icon": "/images/app-icons/authentication.svg",
                "pages": [
                  "guides/apps/authentication/overview",
                  "guides/apps/authentication/user-onboarding",
                  "guides/apps/authentication/restricted-users",
                  "guides/apps/authentication/connected-accounts",
                  "guides/apps/authentication/jwts",
                  "guides/apps/authentication/sign-up-rules",
                  "guides/apps/authentication/cli-authentication",
                  {
                    "group": "All Auth Providers",
                    "root": "guides/apps/authentication/auth-providers",
                    "pages": [
                      "guides/apps/authentication/auth-providers/apple",
                      "guides/apps/authentication/auth-providers/bitbucket",
                      "guides/apps/authentication/auth-providers/discord",
                      "guides/apps/authentication/auth-providers/facebook",
                      "guides/apps/authentication/auth-providers/github",
                      "guides/apps/authentication/auth-providers/gitlab",
                      "guides/apps/authentication/auth-providers/google",
                      "guides/apps/authentication/auth-providers/linkedin",
                      "guides/apps/authentication/auth-providers/microsoft",
                      "guides/apps/authentication/auth-providers/passkey",
                      "guides/apps/authentication/auth-providers/spotify",
                      "guides/apps/authentication/auth-providers/twitch",
                      "guides/apps/authentication/auth-providers/two-factor-auth",
                      "guides/apps/authentication/auth-providers/x-twitter"
                    ]
                  }
                ]
              },
              "guides/apps/emails/overview",
              "guides/apps/payments/overview",
              "guides/apps/analytics/overview",
              {
                "group": "Teams",
                "icon": "/images/app-icons/teams.svg",
                "pages": [
                  "guides/apps/teams/overview",
                  "guides/apps/teams/team-selection"
                ]
              },
              "guides/apps/fraud-protection/overview",
              "guides/apps/rbac/overview",
              "guides/apps/api-keys/overview",
              "guides/apps/data-vault/overview",
              "guides/apps/webhooks/overview",
              "guides/apps/launch-checklist/overview"
            ]
          },
          {
            "group": "Integrations",
            "pages": [
              "guides/integrations/tanstack-start/overview",
              "guides/integrations/supabase/overview",
              "guides/integrations/convex/overview",
              "guides/integrations/vercel/overview"
            ]
          },
          {
            "group": "Other",
            "pages": [
              "guides/other/self-host",
              "guides/other/known-errors",
              "migration",
              {
                "group": "Customization",
                "pages": [
                  "guides/other/customization/custom-pages",
                  "guides/other/customization/custom-styles",
                  "guides/other/customization/dark-mode",
                  "guides/other/customization/internationalization",
                  {
                    "group": "Page Examples",
                    "pages": [
                      "guides/other/customization/page-examples/sign-in",
                      "guides/other/customization/page-examples/sign-up",
                      "guides/other/customization/page-examples/forgot-password",
                      "guides/other/customization/page-examples/password-reset"
                    ]
                  }
                ]
              },
              {
                "group": "Tutorials",
                "pages": [
                  "guides/other/tutorials/build-a-saas-with-hexclave",
                  "guides/other/tutorials/build-a-team-based-app",
                  "guides/other/tutorials/ship-production-ready-auth"
                ]
              }
            ]
          }
        ]
      },
      {
        "tab": "SDK Reference",
        "pages": [
          "sdk/overview",
          {
            "group": "Objects",
            "pages": [
              "sdk/objects/stack-app"
            ]
          },
          {
            "group": "Types",
            "pages": [
              "sdk/types/user",
              "sdk/types/team",
              "sdk/types/team-user",
              "sdk/types/team-permission",
              "sdk/types/team-profile",
              "sdk/types/contact-channel",
              "sdk/types/email",
              "sdk/types/api-key",
              "sdk/types/project",
              "sdk/types/connected-account",
              "sdk/types/item",
              "sdk/types/customer"
            ]
          },
          {
            "group": "Hooks",
            "pages": [
              "sdk/hooks/use-stack-app",
              "sdk/hooks/use-user"
            ]
          }
        ]
      },
      {
        "tab": "REST API",
        "pages": [
          "api/overview",
          {
            "group": "Client API",
            "openapi": {
              "source": "openapi/client.json",
              "directory": "api/client"
            }
          },
          {
            "group": "Server API",
            "openapi": {
              "source": "openapi/server.json",
              "directory": "api/server"
            }
          },
          {
            "group": "Admin API",
            "openapi": {
              "source": "openapi/admin.json",
              "directory": "api/admin",
              "hidden": "true"
            }
          },
          {
            "group": "Webhooks",
            "openapi": {
              "source": "openapi/webhooks.json",
              "directory": "api/webhooks"
            }
          }
        ]
      }
    ]
  },
  "footer": {
    "socials": {
      "x": "https://x.com/stack_auth",
      "github": "https://github.com/hexclave/hexclave",
      "discord": "https://discord.hexclave.com"
    }
  },
  "seo": {
    "metatags": {
      "robots": "noindex"
    }
  },
  "settings": {
    "customScripts": [
      "/apps-sidebar-filter.js",
      "/code-language-labels.js"
    ]
  },
  "redirects": [
    {
      "source": "/rest-api/overview",
      "destination": "/api/overview"
    },
    {
      "source": "/getting-started/setup",
      "destination": "/guides/getting-started/setup"
    },
    {
      "source": "/docs/getting-started/setup",
      "destination": "/guides/getting-started/setup"
    },
    {
      "source": "/docs/next/getting-started/setup",
      "destination": "/guides/getting-started/setup"
    },
    {
      "source": "/docs/sdk",
      "destination": "/sdk/overview"
    },
    {
      "source": "/docs/apps/analytics",
      "destination": "/guides/apps/analytics/overview"
    },
    {
      "source": "/docs/apps/api-keys",
      "destination": "/guides/apps/api-keys/overview"
    },
    {
      "source": "/docs/others/convex",
      "destination": "/guides/integrations/convex/overview"
    },
    {
      "source": "/docs/concepts/teams",
      "destination": "/guides/apps/teams/overview"
    },
    {
      "source": "/docs/concepts/custom-user-data",
      "destination": "/guides/going-further/user-metadata"
    },
    {
      "source": "/others/js-client",
      "destination": "/guides/going-further/stack-app"
    },
    {
      "source": "/customization/custom-pages",
      "destination": "/guides/other/customization/custom-pages"
    },
    {
      "source": "/customization/custom-styles",
      "destination": "/guides/other/customization/custom-styles"
    },
    {
      "source": "/customization/dark-mode",
      "destination": "/guides/other/customization/dark-mode"
    },
    {
      "source": "/customization/internationalization",
      "destination": "/guides/other/customization/internationalization"
    },
    {
      "source": "/customization/page-examples",
      "destination": "/guides/other/customization/page-examples/sign-in"
    },
    {
      "source": "/customization/page-examples/sign-in",
      "destination": "/guides/other/customization/page-examples/sign-in"
    },
    {
      "source": "/customization/page-examples/sign-up",
      "destination": "/guides/other/customization/page-examples/sign-up"
    },
    {
      "source": "/customization/page-examples/forgot-password",
      "destination": "/guides/other/customization/page-examples/forgot-password"
    },
    {
      "source": "/customization/page-examples/password-reset",
      "destination": "/guides/other/customization/page-examples/password-reset"
    },
    {
      "source": "/docs/customization/custom-pages",
      "destination": "/guides/other/customization/custom-pages"
    },
    {
      "source": "/docs/customization/custom-styles",
      "destination": "/guides/other/customization/custom-styles"
    },
    {
      "source": "/docs/customization/dark-mode",
      "destination": "/guides/other/customization/dark-mode"
    },
    {
      "source": "/docs/customization/internationalization",
      "destination": "/guides/other/customization/internationalization"
    },
    {
      "source": "/docs/customization/page-examples/:slug*",
      "destination": "/guides/other/customization/page-examples/:slug*"
    }
  ]
} as const;

export default docsJson;
