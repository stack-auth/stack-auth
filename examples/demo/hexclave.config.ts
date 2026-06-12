/**
 * Hexclave project configuration as code (demo app).
 *
 * Source of truth for RBAC permissions/roles, auth methods, OAuth providers,
 * sign-up rules, API keys, and payment plans. The Hexclave CLI (`stack dev`)
 * bundles + executes this file and provisions the project to match.
 *
 * It's wrapped in `defineHexclaveConfig(...)`, so the shared-backend config updater takes
 * its AI-agent path (not the deterministic regenerator): dashboard edits are
 * reconciled back here while preserving the comments and layout. `null` on any
 * value means "reset that key to its default".
 */
import { defineHexclaveConfig } from "@hexclave/next";

export const config = defineHexclaveConfig({
  rbac: {
    // Fine-grained, composable permissions. Higher-level ones contain the lower
    // ones, so a role only needs to grant the top of each chain.
    permissions: {
      read_content: { description: "View content within the team", scope: "team" },
      write_content: {
        description: "Create and edit content within the team",
        scope: "team",
        containedPermissionIds: { read_content: true },
      },
      invite_members: { description: "Invite new members to the team", scope: "team" },
      manage_members: {
        description: "Remove members and change their roles",
        scope: "team",
        containedPermissionIds: { invite_members: true },
      },
      manage_billing: {
        description: "Manage subscriptions, invoices, and payment methods",
        scope: "team",
      },
      team_admin: {
        description: "Full administrative control over the team",
        scope: "team",
        containedPermissionIds: { write_content: true, manage_members: true, manage_billing: true },
      },
    },
    // "Roles" = the default permission sets handed out at each lifecycle moment.
    // Team creators become admins; everyone else starts as a reader.
    defaultPermissions: {
      teamCreator: { team_admin: true },
      teamMember: { read_content: true },
      signUp: {},
    },
  },

  teams: {
    createPersonalTeamOnSignUp: true,
    allowClientTeamCreation: true,
  },

  users: {
    allowClientUserDeletion: false,
  },

  apiKeys: {
    enabled: { team: true, user: true },
  },

  auth: {
    allowSignUp: true,
    password: { allowSignIn: false },
    otp: { allowSignIn: true },
    passkey: { allowSignIn: false },
    oauth: {
      accountMergeStrategy: "link_method",
      providers: {
        google: { type: "google", allowSignIn: true, allowConnectedAccounts: true },
        github: { type: "github", allowSignIn: true, allowConnectedAccounts: true },
        microsoft: { type: "microsoft", allowSignIn: false, allowConnectedAccounts: true },
      },
    },
    // Rules are evaluated highest-priority-first; the default action applies when
    // nothing matches. Conditions are CEL expressions over the sign-up context.
    signUpRules: {
      block_example_domain: {
        enabled: false,
        displayName: "Block example.com domain",
        priority: 10,
        condition: 'email.endsWith("@example.com")',
        action: { type: "reject", message: "Sign-ups from example.com are not allowed" },
      },
      flag_freemail: {
        enabled: false,
        displayName: "Flag freemail sign-ups",
        priority: 5,
        condition: 'emailDomain == "gmail.com"',
        action: { type: "log" },
      },
    },
    signUpRulesDefaultAction: "allow",
  },

  payments: {
    blockNewPurchases: false,
    // Products within a product line are mutually exclusive (except add-ons).
    productLines: {
      saas: { displayName: "SaaS Plans", customerType: "user" },
      team_plans: { displayName: "Team Plans", customerType: "team" },
    },
    items: {
      api_calls: { displayName: "API Calls", customerType: "user" },
      seats: { displayName: "Team Seats", customerType: "team" },
    },
    products: {
      pro: {
        displayName: "Pro",
        productLineId: "saas",
        customerType: "user",
        prices: {
          monthly: { USD: "20", interval: [1, "month"] },
          yearly: { USD: "200", interval: [1, "year"], freeTrial: [14, "day"] },
        },
        includedItems: {
          api_calls: { quantity: 10000, repeat: [1, "month"], expires: "when-repeated" },
        },
      },
      team_pro: {
        displayName: "Team Pro",
        productLineId: "team_plans",
        customerType: "team",
        prices: {
          monthly: { USD: "99", interval: [1, "month"] },
        },
        includedItems: {
          seats: { quantity: 25, expires: "when-purchase-expires" },
        },
      },
      extra_seats: {
        displayName: "Extra Seats",
        productLineId: "team_plans",
        customerType: "team",
        isAddOnTo: { team_pro: true },
        stackable: true,
        prices: {
          per_seat: { USD: "10", interval: [1, "month"] },
        },
        includedItems: {
          seats: { quantity: 1, expires: "when-purchase-expires" },
        },
      },
    },
  },
});
