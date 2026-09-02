import type { DataSourceJson } from "@hexclave/shared/dist/interface/admin-interface";
import { CloudIcon, DatabaseIcon } from "@phosphor-icons/react";

export type SourceTypeId = DataSourceJson["type"];

/**
 * What the customer picks between on the "add source" screen, and everything the
 * rest of these pages need to label one. Adding a source type is an entry here
 * plus its connect form.
 */
export const SOURCE_TYPES: Record<SourceTypeId, { label: string, category: string, icon: typeof DatabaseIcon }> = {
  postgres: { label: "PostgreSQL", category: "Database", icon: DatabaseIcon },
  convex: { label: "Convex", category: "Backend", icon: CloudIcon },
};

/**
 * How a source is identified in the UI: where it points, in its own terms. A
 * Postgres source is its host; a Convex source is its deployment URL.
 */
export function describeSource(source: DataSourceJson): string {
  switch (source.type) {
    case "postgres": {
      return source.config.host;
    }
    case "convex": {
      return source.config.deployment_url;
    }
  }
}
