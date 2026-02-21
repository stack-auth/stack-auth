"use client";

import { DesignListItemRow } from "@/components/design-components/list";
import { FormDialog } from "@/components/form-dialog";
import { InputField } from "@/components/form-fields";
import { useRouter } from "@/components/router";
import { ActionDialog, Button, Typography } from "@/components/ui";
import { useUpdateConfig } from "@/lib/config-update";
import {
  ChartBarIcon,
  PlusIcon,
  TrashIcon,
} from "@phosphor-icons/react";
import { DesignCard } from "@stackframe/dashboard-ui-components";
import { generateUuid } from "@stackframe/stack-shared/dist/utils/uuids";
import { useMemo, useState } from "react";
import * as yup from "yup";
import { PageLayout } from "../page-layout";
import { useAdminApp } from "../use-admin-app";

type DashboardEntry = {
  id: string,
  displayName: string,
};

export default function PageClient() {
  const adminApp = useAdminApp();
  const project = adminApp.useProject();
  const config = project.useConfig();
  const updateConfig = useUpdateConfig();
  const router = useRouter();
  const [deleteDialogId, setDeleteDialogId] = useState<string | null>(null);

  const dashboards = useMemo((): DashboardEntry[] => {
    return Object.entries(config.customDashboards).map(([id, dashboard]) => ({
      id,
      displayName: dashboard.displayName,
    }));
  }, [config.customDashboards]);

  const dashboardToDelete = deleteDialogId
    ? dashboards.find(d => d.id === deleteDialogId)
    : null;

  const handleDelete = async (id: string) => {
    await updateConfig({
      adminApp,
      configUpdate: {
        [`customDashboards.${id}`]: null,
      },
      pushable: false,
    });
    setDeleteDialogId(null);
  };

  return (
    <PageLayout
      title="Custom Dashboards"
      description="Custom Dashboards for your project"
      actions={
        <NewDashboardButton
          adminApp={adminApp}
          updateConfig={updateConfig}
          router={router}
        />
      }
    >
      {dashboards.length === 0 ? (
        <DesignCard gradient="default">
          <div className="flex flex-col items-center justify-center gap-3 py-10 text-center">
            <div className="w-12 h-12 rounded-2xl bg-foreground/[0.04] ring-1 ring-foreground/[0.06] flex items-center justify-center">
              <ChartBarIcon className="h-6 w-6 text-muted-foreground" />
            </div>
            <div>
              <Typography className="font-semibold text-foreground">No dashboards yet</Typography>
              <Typography variant="secondary" className="text-sm mt-1">
                Create a dashboard from the command palette (Cmd+K) or click &quot;New Dashboard&quot; above.
              </Typography>
            </div>
          </div>
        </DesignCard>
      ) : (
        <div className="flex flex-col gap-3">
          {dashboards.map((dashboard) => (
            <DesignListItemRow
              key={dashboard.id}
              icon={ChartBarIcon}
              title={dashboard.displayName}
              size="lg"
              onClick={() => router.push(`dashboards/${dashboard.id}`)}
              buttons={[
                {
                  id: "delete",
                  label: "Delete",
                  icon: <TrashIcon className="h-4 w-4" />,
                  display: "icon",
                  onClick: [
                    {
                      id: "delete-action",
                      label: "Delete Dashboard",
                      onClick: () => setDeleteDialogId(dashboard.id),
                      itemVariant: "destructive" as const,
                    },
                  ],
                },
              ]}
            />
          ))}
        </div>
      )}

      <ActionDialog
        open={deleteDialogId !== null}
        onClose={() => setDeleteDialogId(null)}
        title="Delete Dashboard"
        okButton={{
          label: "Delete",
          onClick: async () => {
            if (deleteDialogId) {
              await handleDelete(deleteDialogId);
            }
          },
          props: { variant: "destructive" },
        }}
        cancelButton={{ label: "Cancel" }}
      >
        <Typography variant="secondary" className="text-sm">
          Are you sure you want to delete &quot;{dashboardToDelete?.displayName ?? "this dashboard"}&quot;? This action cannot be undone.
        </Typography>
      </ActionDialog>
    </PageLayout>
  );
}

function NewDashboardButton({
  adminApp,
  updateConfig,
  router,
}: {
  adminApp: ReturnType<typeof useAdminApp>,
  updateConfig: ReturnType<typeof useUpdateConfig>,
  router: ReturnType<typeof useRouter>,
}) {
  const handleCreate = async (values: { name: string }) => {
    const id = generateUuid();
    await updateConfig({
      adminApp,
      configUpdate: {
        [`customDashboards.${id}`]: {
          displayName: values.name,
          tsxSource: "",
        },
      },
      pushable: false,
    });
    router.push(`dashboards/${id}`);
  };

  return (
    <FormDialog
      title="New Dashboard"
      trigger={
        <Button className="gap-2">
          <PlusIcon className="h-4 w-4" />
          New Dashboard
        </Button>
      }
      onSubmit={handleCreate}
      formSchema={yup.object({
        name: yup.string().defined().min(1, "Name is required"),
      })}
      render={(form) => (
        <InputField
          control={form.control}
          name="name"
          label="Dashboard Name"
          placeholder="Enter dashboard name"
          required
        />
      )}
    />
  );
}
