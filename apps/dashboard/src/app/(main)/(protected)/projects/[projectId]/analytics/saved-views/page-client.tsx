"use client";

import { DesignAlert, DesignButton, DesignCard } from "@/components/design-components";
import { Link } from "@/components/link";
import { stringCompare } from "@hexclave/shared/dist/utils/strings";
import { FloppyDiskIcon } from "@phosphor-icons/react";
import { useMemo } from "react";
import { AppEnabledGuard } from "../../app-enabled-guard";
import { PageLayout } from "../../page-layout";
import { useAdminApp } from "../../use-admin-app";

type SavedQuery = {
  folderId: string,
  folderName: string,
  queryId: string,
  displayName: string,
  sqlQuery: string,
  description: string | undefined,
};

export default function PageClient() {
  const adminApp = useAdminApp();
  const project = adminApp.useProject();
  const config = project.useConfig();
  const queriesHref = `/projects/${encodeURIComponent(adminApp.projectId)}/warehouse/queries`;

  const queries = useMemo((): SavedQuery[] => {
    return Object.entries(config.warehouse.queryFolders)
      .flatMap(([folderId, folder]) => Object.entries(folder.queries).map(([queryId, query]) => ({
        folderId,
        folderName: folder.displayName,
        queryId,
        displayName: query.displayName,
        sqlQuery: query.sqlQuery,
        description: query.description,
      })))
      .sort((left, right) => stringCompare(left.displayName, right.displayName));
  }, [config.warehouse.queryFolders]);

  return (
    <AppEnabledGuard appId="analytics">
      <PageLayout
        title="Saved Views"
        description="Reusable ClickHouse queries live in Warehouse. This list is the same catalog the Queries editor uses."
        actions={(
          <DesignButton size="sm" variant="secondary" asChild>
            <Link href={queriesHref}>Open Queries</Link>
          </DesignButton>
        )}
        scrollMain
      >
        {queries.length === 0 ? (
          <DesignAlert
            variant="info"
            title="No saved queries yet"
            description="Save a query from Warehouse → Queries to see it here. Table layouts are still edited in the Queries workspace."
          />
        ) : (
          <div className="space-y-3">
            {queries.map((query) => (
              <DesignCard
                key={`${query.folderId}-${query.queryId}`}
                title={query.displayName}
                subtitle={`${query.folderName}${query.description == null || query.description.trim() === "" ? "" : ` · ${query.description}`}`}
                icon={FloppyDiskIcon}
              >
                <pre className="overflow-x-auto rounded-lg bg-foreground/[0.03] p-3 font-mono text-[11px] text-foreground ring-1 ring-foreground/[0.06]">{query.sqlQuery}</pre>
                <div className="mt-3">
                  <DesignButton size="sm" variant="secondary" asChild>
                    <Link href={queriesHref}>Open in Queries</Link>
                  </DesignButton>
                </div>
              </DesignCard>
            ))}
          </div>
        )}
      </PageLayout>
    </AppEnabledGuard>
  );
}
