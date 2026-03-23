export const config = {
  "auth": {
    "allowSignUp": true,
    "password": {
      "allowSignIn": true
    },
    "otp": {
      "allowSignIn": false
    },
    "passkey": {
      "allowSignIn": false
    },
    "oauth": {
      "accountMergeStrategy": "link_method",
      "providers": {
        "google": {
          "type": "google",
          "allowSignIn": true,
          "allowConnectedAccounts": true
        },
        "github": {
          "type": "github",
          "allowSignIn": true,
          "allowConnectedAccounts": true
        }
      }
    },
    "signUpRulesDefaultAction": "allow"
  },
  "teams": {
    "createPersonalTeamOnSignUp": false,
    "allowClientTeamCreation": false
  },
  "users": {
    "allowClientUserDeletion": false
  },
  "onboarding": {
    "requireEmailVerification": false
  },
  "apiKeys": {
    "enabled": {
      "team": false,
      "user": false
    }
  },
  "domains": {
    "allowLocalhost": true,
    "trustedDomains": {}
  },
  "rbac": {
    "permissions": {},
    "defaultPermissions": {
      "teamCreator": {},
      "teamMember": {},
      "signUp": {}
    }
  },
  "apps": {
    "installed": {}
  },
  "apps.installed.authentication.enabled": true,
  "apps.installed.analytics.enabled": true,
  "apps.installed.api-keys.enabled": true
};
