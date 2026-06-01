import type { DashboardReferenceApp } from "./types";

export const DASHBOARD_REFERENCE_APPS: DashboardReferenceApp[] = [
  {
    appId: "emails",
    groupLabel: "Emails",
    icon: "/images/app-icons/emails.svg",
    pages: [
      {
        slug: "sent",
        dashboardNavLabel: "Sent",
        title: "Sent",
        description: "Inspect the outbox, delivery status, and domain reputation.",
      },
      {
        slug: "drafts",
        dashboardNavLabel: "Drafts",
        title: "Drafts",
        description: "Compose, preview, and send one-off emails to selected recipients.",
      },
      {
        slug: "templates",
        dashboardNavLabel: "Templates",
        title: "Templates",
        description: "Author reusable TSX email templates with the AI builder.",
      },
      {
        slug: "email-settings",
        dashboardNavLabel: "Email Settings",
        title: "Email Settings",
        description: "Configure the email server, sender identity, and active theme.",
      },
    ],
  },
  {
    appId: "payments",
    groupLabel: "Payments",
    icon: "/images/app-icons/payments.svg",
    undocumentedDashboardNavLabels: ["Payouts"],
    pages: [
      {
        slug: "product-lines",
        dashboardNavLabel: "Product Lines",
        title: "Product Lines",
        description: "Group products into mutually exclusive tiers and lay them out as a pricing table",
      },
      {
        slug: "products-and-items",
        dashboardNavLabel: "Products & Items",
        title: "Products & Items",
        description: "Define what you sell and the entitlements it grants",
      },
      {
        slug: "customers",
        dashboardNavLabel: "Customers",
        title: "Customers",
        description: "Inspect any customer's item balances and grant products or adjust quantities",
      },
      {
        slug: "transactions",
        dashboardNavLabel: "Transactions",
        title: "Transactions",
        description: "Audit every payment event and issue refunds",
      },
      {
        slug: "settings",
        dashboardNavLabel: "Settings",
        title: "Settings",
        description: "Connect Stripe, toggle test mode, pick payment methods, and block new purchases",
      },
    ],
  },
  {
    appId: "analytics",
    groupLabel: "Analytics",
    icon: "/images/app-icons/analytics.svg",
    pages: [
      {
        slug: "tables",
        dashboardNavLabel: "Tables",
        title: "Tables",
        description: "Browse and search rows from any analytics table in your project",
      },
      {
        slug: "queries",
        dashboardNavLabel: "Queries",
        title: "Queries",
        description: "Write, run, and save reusable ClickHouse SQL queries",
      },
      {
        slug: "replays",
        dashboardNavLabel: "Replays",
        title: "Session Replays",
        description: "Watch session replays and filter by user, team, duration, last activity, and click count",
        sidebarTitle: "Replays",
      },
    ],
  },
];
