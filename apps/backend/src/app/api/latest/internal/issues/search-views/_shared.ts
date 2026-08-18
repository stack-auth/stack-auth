import type { SavedIssueSearchViewRouteHandlerOptions } from "@/lib/issues/saved-search-views/route-handlers";
import { adminAuthTypeSchema } from "@hexclave/shared/dist/schema-fields";

/**
 * Dashboard tree: admin-key only and hidden from the public OpenAPI docs.
 * Admin keys carry no end-user identity, so the shared route handlers derive a
 * null actor user id here and the persistence layer exposes and creates only
 * project-visible views (see savedIssueSearchViewActorUserId in the factory
 * for why the admin key must not become a fake private-view owner).
 */
export const internalSavedIssueSearchViewRouteOptions: SavedIssueSearchViewRouteHandlerOptions = {
  authTypeSchema: adminAuthTypeSchema,
  mutationAuthTypeSchema: adminAuthTypeSchema,
  metadata: {
    list: {
      hidden: true,
      summary: "List dashboard issue search views",
      description: "Lists bounded project-visible issue-search views in the authenticated project branch. Private views require a real end-user identity and are intentionally omitted from normal admin-key dashboard requests.",
      tags: ["Issues"],
    },
    create: {
      hidden: true,
      summary: "Create a dashboard issue search view",
      description: "Creates a bounded project-visible issue-search view in the authenticated project branch. Private views are rejected when the admin request has no real end-user identity.",
      tags: ["Issues"],
    },
    get: {
      hidden: true,
      summary: "Get a dashboard issue search view",
      description: "Returns one issue-search view only when it is visible in the authenticated project branch.",
      tags: ["Issues"],
    },
    update: {
      hidden: true,
      summary: "Update a dashboard issue search view",
      description: "Updates one issue-search view for the authenticated dashboard admin. Existing private-view ownership is retained; no owner is inferred from an admin key.",
      tags: ["Issues"],
    },
    delete: {
      hidden: true,
      summary: "Delete a dashboard issue search view",
      description: "Deletes one issue-search view for the authenticated dashboard admin within the authenticated project branch.",
      tags: ["Issues"],
    },
  },
};
