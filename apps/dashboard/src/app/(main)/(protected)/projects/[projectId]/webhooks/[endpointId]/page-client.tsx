"use client";

import { DesignAlert, DesignBadge, DesignButton, DesignCard, DesignEditableGrid, type DesignEditableGridItem } from "@/components/design-components";
import { CopyButton, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui";
import { getPublicEnvVar } from '@/lib/env';
import { CaretLeftIcon, CaretRightIcon, InfoIcon, KeyIcon, LinkIcon, TextAlignLeftIcon } from "@phosphor-icons/react";
import { useMemo, useState } from "react";
import { SvixProvider, useEndpoint, useEndpointMessageAttempts, useEndpointSecret } from "svix-react";
import { AppEnabledGuard } from "../../app-enabled-guard";
import { PageLayout } from "../../page-layout";
import { useAdminApp } from "../../use-admin-app";
import { getSvixResult } from "../utils";

const statusToString = new Map<number, string>([
  [0, "Success"],
  [1, "Pending"],
  [2, "Fail"],
  [3, "Sending"],
]);

function PageInner(props: { endpointId: string }) {
  const endpoint = getSvixResult(useEndpoint(props.endpointId));

  return (
    <PageLayout title="Webhook Endpoint" description={endpoint.loaded ? endpoint.data.url : 'Loading...'}>
      <DesignCard
        title="Details"
        subtitle="The details of this endpoint"
        icon={InfoIcon}
        glassmorphic
      >
        <EndpointDetails endpointId={props.endpointId} />
      </DesignCard>

      <DesignCard
        title="Events History"
        subtitle="The log of events sent to this endpoint"
        icon={TextAlignLeftIcon}
        glassmorphic
      >
        <MessageTable endpointId={props.endpointId} />
      </DesignCard>
    </PageLayout>
  );
}

function EndpointDetails(props: { endpointId: string }) {
  const endpoint = getSvixResult(useEndpoint(props.endpointId));
  const secret = getSvixResult(useEndpointSecret(props.endpointId));
  const detailsItems = useMemo<DesignEditableGridItem[]>(() => ([
    {
      type: "custom",
      icon: <LinkIcon className="h-3.5 w-3.5" />,
      name: "URL",
      children: (
        <span className="-ml-2 block rounded-xl border border-transparent px-2 py-1 text-sm text-foreground/90">
          {endpoint.loaded ? endpoint.data.url : "Loading..."}
        </span>
      ),
    },
    {
      type: "custom",
      icon: <TextAlignLeftIcon className="h-3.5 w-3.5" />,
      name: "Description",
      children: (
        <span className="-ml-2 block rounded-xl border border-transparent px-2 py-1 text-sm text-foreground/80">
          {endpoint.loaded ? (endpoint.data.description || "-") : "Loading..."}
        </span>
      ),
    },
    {
      type: "custom",
      icon: <KeyIcon className="h-3.5 w-3.5" />,
      name: "Verification Secret",
      children: (
        <div className="-ml-2 flex w-full items-center gap-2 rounded-xl border border-transparent px-2 py-1">
          <code className="min-w-0 truncate rounded-md bg-foreground/[0.04] px-2 py-0.5 text-sm">
            {secret.loaded ? secret.data.key : "Loading..."}
          </code>
          <CopyButton content={secret.loaded ? secret.data.key : ''} className={secret.loaded ? 'shrink-0' : 'hidden'} />
        </div>
      ),
    },
  ]), [endpoint, secret]);

  return (
    <DesignEditableGrid
      items={detailsItems}
      columns={1}
      deferredSave={false}
    />
  );
}

function MessageTable(props: { endpointId: string }) {
  const messages = getSvixResult(useEndpointMessageAttempts(props.endpointId, { limit: 10, withMsg: true }));

  if (!messages.loaded) return messages.rendered;

  if (messages.data.length === 0) {
    return (
      <DesignAlert
        variant="info"
        description="No events sent yet."
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="border rounded-md">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[200px]">ID</TableHead>
              <TableHead className="w-[100px]">Message</TableHead>
              <TableHead className="w-[300px]">Timestamp</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {messages.data.map(message => (
              <TableRow key={message.id}>
                <TableCell>{message.id}</TableCell>
                <TableCell>
                  <DesignBadge
                    label={statusToString.get(message.status) ?? "Unknown"}
                    color={
                      message.status === 0
                        ? "green"
                        : message.status === 2
                          ? "red"
                          : message.status === 1
                            ? "orange"
                            : "blue"
                    }
                    size="sm"
                  />
                </TableCell>
                <TableCell>{message.timestamp.toLocaleString()}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div className="flex justify-end gap-4">
        <DesignButton size='sm' variant='secondary' disabled={!messages.hasPrevPage} onClick={messages.prevPage}>
          <CaretLeftIcon />
        </DesignButton>

        <DesignButton size='sm' variant='secondary' disabled={!messages.hasNextPage} onClick={messages.nextPage}>
          <CaretRightIcon />
        </DesignButton>
      </div>
    </div>
  );
}

export default function PageClient(props: { endpointId: string }) {
  const stackAdminApp = useAdminApp();
  const svixToken = stackAdminApp.useSvixToken();
  const [updateCounter, setUpdateCounter] = useState(0);

  // This is a hack to make sure svix hooks update when content changes
  const svixTokenUpdated = useMemo(() => {
    return svixToken + '';
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [svixToken, updateCounter]);

  return (
    <AppEnabledGuard appId="webhooks">
      <SvixProvider
        token={svixTokenUpdated}
        appId={stackAdminApp.projectId}
        options={{ serverUrl: getPublicEnvVar('NEXT_PUBLIC_STACK_SVIX_SERVER_URL') }}
      >
        <PageInner endpointId={props.endpointId} />
      </SvixProvider>
    </AppEnabledGuard>
  );
}
