// Dummy data for development
export const DUMMY_PAYMENTS_CONFIG: any = {
  groups: {
    "basic-plans": { displayName: "Basic Plans" },
    "pro-plans": { displayName: "Professional Plans" },
    "enterprise": { displayName: "Enterprise" },
    "add-ons": { displayName: "Add-ons" },
  },
  offers: {
    "free-trial": {
      displayName: "Free Trial",
      customerType: "user" as const,
      groupId: "basic-plans",
      freeTrial: [14, "day"] as [number, "day"],
      stackable: false,
      serverOnly: false,
      prices: "include-by-default" as const,
      includedItems: {
        "basic-features": { quantity: 1 },
        "cloud-storage-5gb": { quantity: 1 },
      },
    },
    "starter": {
      displayName: "Starter",
      customerType: "user" as const,
      groupId: "basic-plans",
      stackable: false,
      serverOnly: false,
      prices: {
        "monthly": { USD: "9.99", interval: [1, "month"] as [number, "month"] },
        "yearly": { USD: "99.90", interval: [1, "year"] as [number, "year"] },
      },
      includedItems: {
        "basic-features": { quantity: 1 },
        "cloud-storage-10gb": { quantity: 1 },
        "email-support": { quantity: 1 },
        "api-calls": { quantity: 1000 },
      },
    },
    "professional": {
      displayName: "Professional",
      customerType: "user" as const,
      groupId: "pro-plans",
      stackable: false,
      serverOnly: false,
      prices: {
        "monthly": { USD: "29.99", interval: [1, "month"] as [number, "month"] },
        "yearly": { USD: "299.90", interval: [1, "year"] as [number, "year"] },
        "quarterly": { USD: "89.97", interval: [3, "month"] as [number, "month"] },
      },
      includedItems: {
        "pro-features": { quantity: 1 },
        "cloud-storage-100gb": { quantity: 1 },
        "priority-support": { quantity: 1 },
        "api-calls": { quantity: 10000 },
        "team-members": { quantity: 5 },
        "custom-domain": { quantity: 1 },
      },
    },
    "business": {
      displayName: "Business",
      customerType: "team" as const,
      groupId: "pro-plans",
      stackable: false,
      serverOnly: false,
      prices: {
        "monthly": { USD: "99.99", interval: [1, "month"] as [number, "month"] },
        "yearly": { USD: "999.90", interval: [1, "year"] as [number, "year"] },
      },
      includedItems: {
        "pro-features": { quantity: 1 },
        "cloud-storage-1tb": { quantity: 1 },
        "priority-support": { quantity: 1 },
        "api-calls": { quantity: 100000 },
        "team-members": { quantity: 20 },
        "custom-domain": { quantity: 3 },
        "advanced-analytics": { quantity: 1 },
        "sso": { quantity: 1 },
      },
    },
    "enterprise-standard": {
      displayName: "Enterprise Standard",
      customerType: "team" as const,
      groupId: "enterprise",
      stackable: false,
      serverOnly: false,
      prices: {
        "yearly": { USD: "2999.00", interval: [1, "year"] as [number, "year"] },
      },
      includedItems: {
        "enterprise-features": { quantity: 1 },
        "cloud-storage-unlimited": { quantity: 1 },
        "dedicated-support": { quantity: 1 },
        "api-calls": { quantity: 1000000 },
        "team-members": { quantity: 100 },
        "custom-domain": { quantity: 10 },
        "advanced-analytics": { quantity: 1 },
        "sso": { quantity: 1 },
        "audit-logs": { quantity: 1 },
        "sla": { quantity: 1 },
      },
    },
    "enterprise-plus": {
      displayName: "Enterprise Plus",
      customerType: "custom" as const,
      groupId: "enterprise",
      stackable: false,
      serverOnly: false,
      prices: {
        "custom": { USD: "0.00" },
      },
      includedItems: {
        "enterprise-features": { quantity: 1 },
        "cloud-storage-unlimited": { quantity: 1 },
        "white-glove-support": { quantity: 1 },
        "api-calls": { quantity: 999999 },
        "team-members": { quantity: 999 },
        "custom-domain": { quantity: 999 },
        "advanced-analytics": { quantity: 1 },
        "sso": { quantity: 1 },
        "audit-logs": { quantity: 1 },
        "sla": { quantity: 1 },
        "custom-integrations": { quantity: 1 },
        "dedicated-infrastructure": { quantity: 1 },
      },
    },
    "extra-storage": {
      displayName: "Extra Storage",
      customerType: "user" as const,
      groupId: "add-ons",
      stackable: true,
      serverOnly: false,
      prices: {
        "monthly": { USD: "4.99", interval: [1, "month"] as [number, "month"] },
      },
      includedItems: {
        "cloud-storage-50gb": { quantity: 1 },
      },
    },
    "additional-api-calls": {
      displayName: "API Call Pack",
      customerType: "user" as const,
      groupId: "add-ons",
      stackable: true,
      serverOnly: false,
      prices: {
        "monthly": { USD: "9.99", interval: [1, "month"] as [number, "month"] },
      },
      includedItems: {
        "api-calls": { quantity: 5000 },
      },
    },
    "team-member-addon": {
      displayName: "Extra Team Member",
      customerType: "team" as const,
      groupId: "add-ons",
      stackable: true,
      serverOnly: false,
      prices: {
        "monthly": { USD: "14.99", interval: [1, "month"] as [number, "month"] },
      },
      includedItems: {
        "team-members": { quantity: 1 },
      },
    },
    "premium-support": {
      displayName: "Premium Support",
      customerType: "team" as const,
      stackable: false,
      serverOnly: false,
      prices: {
        "monthly": { USD: "299.00", interval: [1, "month"] as [number, "month"] },
      },
      includedItems: {
        "24-7-support": { quantity: 1 },
        "dedicated-account-manager": { quantity: 1 },
      },
    },
  },
  items: {
    "basic-features": {
      displayName: "Basic Features",
      customerType: "user" as const,
    },
    "pro-features": {
      displayName: "Professional Features",
      customerType: "user" as const,
    },
    "enterprise-features": {
      displayName: "Enterprise Features",
      customerType: "team" as const,
    },
    "cloud-storage-5gb": {
      displayName: "5GB Cloud Storage",
      customerType: "user" as const,
    },
    "cloud-storage-10gb": {
      displayName: "10GB Cloud Storage",
      customerType: "user" as const,
    },
    "cloud-storage-50gb": {
      displayName: "50GB Cloud Storage",
      customerType: "user" as const,
    },
    "cloud-storage-100gb": {
      displayName: "100GB Cloud Storage",
      customerType: "user" as const,
    },
    "cloud-storage-1tb": {
      displayName: "1TB Cloud Storage",
      customerType: "team" as const,
    },
    "cloud-storage-unlimited": {
      displayName: "Unlimited Cloud Storage",
      customerType: "team" as const,
    },
    "email-support": {
      displayName: "Email Support",
      customerType: "user" as const,
    },
    "priority-support": {
      displayName: "Priority Support",
      customerType: "user" as const,
    },
    "dedicated-support": {
      displayName: "Dedicated Support",
      customerType: "team" as const,
    },
    "white-glove-support": {
      displayName: "White Glove Support",
      customerType: "custom" as const,
    },
    "24-7-support": {
      displayName: "24/7 Phone Support",
      customerType: "team" as const,
    },
    "api-calls": {
      displayName: "API Calls",
      customerType: "user" as const,
    },
    "team-members": {
      displayName: "Team Members",
      customerType: "team" as const,
    },
    "custom-domain": {
      displayName: "Custom Domain",
      customerType: "user" as const,
    },
    "advanced-analytics": {
      displayName: "Advanced Analytics",
      customerType: "team" as const,
    },
    "sso": {
      displayName: "Single Sign-On (SSO)",
      customerType: "team" as const,
    },
    "audit-logs": {
      displayName: "Audit Logs",
      customerType: "team" as const,
    },
    "sla": {
      displayName: "Service Level Agreement",
      customerType: "team" as const,
    },
    "custom-integrations": {
      displayName: "Custom Integrations",
      customerType: "custom" as const,
    },
    "dedicated-infrastructure": {
      displayName: "Dedicated Infrastructure",
      customerType: "custom" as const,
    },
    "dedicated-account-manager": {
      displayName: "Dedicated Account Manager",
      customerType: "team" as const,
    },
  },
};
