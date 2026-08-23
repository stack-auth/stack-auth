"use client";

import { DesignAlert, DesignButton, DesignDialog, DesignDialogClose } from "@/components/design-components";
import { activateGrowthAction, dismissGrowthAction } from "@/lib/growth/growth-api";
import { useGrowthStatus } from "@/lib/growth/growth-data";
import type { GrowthActionItem, GrowthActionWorkflow } from "@/lib/growth/growth-types";
import { humanizeGrowthWorkflowTriggers, splitGrowthWorkflowWarnings } from "@/lib/growth/growth-workflow-format";
import { captureError } from "@hexclave/shared/dist/utils/errors";
import { CheckCircleIcon, ProhibitIcon } from "@phosphor-icons/react";
import { useState, type ElementType, type ReactNode } from "react";
import { useAdminApp } from "../../use-admin-app";

/**
 * The activate/dismiss controls for a Growth action, and the informed-consent dialog in front of
 * them.
 *
 * Shared because an action can now be acted on from two places: its own detail page, and an
 * `<ActionButton>` inside a staff-authored stage page. Both must go through the same dialog and the
 * same endpoints — an authored page is data, so it can only ever reference an action, never grant
 * itself a shortcut around the confirmation the customer gets everywhere else.
 */

/**
 * Confirm-dialog-gated mutation button. In demo mode the dialog explains that mutations are disabled
 * instead of offering a confirm, so the flow is still explorable end to end.
 */
export function GrowthConfirmActionButton(props: {
  buttonLabel: string,
  buttonVariant: "default" | "outline",
  icon: ElementType,
  title: string,
  description: string,
  /** Rich dialog content rendered instead of the plain description paragraph (the description still shows in the header). */
  body?: ReactNode,
  confirmLabel: string,
  demo: boolean,
  onConfirm: () => Promise<void>,
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const Icon = props.icon;
  return (
    <DesignDialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setError(null);
      }}
      trigger={<DesignButton variant={props.buttonVariant} size="sm">{props.buttonLabel}</DesignButton>}
      icon={Icon}
      size="md"
      title={props.title}
      description={props.demo ? "Demo mode" : props.description}
      footer={
        props.demo ? (
          <DesignDialogClose asChild>
            <DesignButton variant="secondary" size="sm">Close</DesignButton>
          </DesignDialogClose>
        ) : (
          <>
            <DesignDialogClose asChild>
              <DesignButton variant="secondary" size="sm">Cancel</DesignButton>
            </DesignDialogClose>
            <DesignButton
              size="sm"
              onClick={async () => {
                setError(null);
                try {
                  await props.onConfirm();
                } catch (confirmError) {
                  captureError("growth-action-mutation", confirmError);
                  setError(confirmError instanceof Error ? confirmError.message : String(confirmError));
                  return;
                }
                setOpen(false);
              }}
            >
              {props.confirmLabel}
            </DesignButton>
          </>
        )
      }
    >
      <div className="flex flex-col gap-3">
        {props.demo ? (
          <DesignAlert variant="info">
            You are looking at fixture data — actions cannot be changed in demo mode.
          </DesignAlert>
        ) : (
          props.body ?? <p className="text-sm text-muted-foreground">{props.description}</p>
        )}
        {error != null && <DesignAlert variant="error">This didn&apos;t work: {error}</DesignAlert>}
      </div>
    </DesignDialog>
  );
}

/**
 * Execution-specific activation copy for a workflow-bearing action. This dialog is the customer's
 * one informed-consent moment before code runs on their project, so it states — from the wire, not
 * from generic copy — what the automation does, when it runs, which external domains its source
 * references, and how to undo it.
 */
export function GrowthActivateWorkflowDialogBody(props: { workflow: GrowthActionWorkflow }) {
  const { workflow } = props;
  const { externalDomains, otherWarnings } = splitGrowthWorkflowWarnings(workflow.warnings);
  return (
    <div className="flex flex-col gap-3 text-sm">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">What it does</p>
        <p className="mt-1 text-muted-foreground">{workflow.explanation}</p>
      </div>
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">When it runs</p>
        <p className="mt-1 text-muted-foreground">Runs {humanizeGrowthWorkflowTriggers(workflow.triggers)}.</p>
      </div>
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">External calls</p>
        {externalDomains.length === 0 ? (
          <p className="mt-1 text-muted-foreground">No external domains detected in the source — it only talks to your Hexclave project.</p>
        ) : (
          <p className="mt-1 text-muted-foreground">
            The source references: {externalDomains.map((domain, index) => (
              <span key={domain}>
                {index > 0 && ", "}
                <span className="font-mono text-foreground">{domain}</span>
              </span>
            ))}
          </p>
        )}
      </div>
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Undoing it</p>
        <p className="mt-1 text-muted-foreground">{workflow.rollbackNote}</p>
      </div>
      {otherWarnings.length > 0 && (
        <DesignAlert variant="warning">
          <ul className="list-disc pl-4">
            {otherWarnings.map((warning) => <li key={warning}>{warning}</li>)}
          </ul>
        </DesignAlert>
      )}
      <p className="text-xs text-muted-foreground">
        The automation is deployed as an ordinary workflow (id <span className="font-mono">{workflow.workflowId}</span>) that you can inspect, edit, or delete in the Workflows app at any time.
      </p>
    </div>
  );
}

export function GrowthActionMutationControls(props: { action: GrowthActionItem, onChanged: () => Promise<void>, className?: string }) {
  const { action } = props;
  const app = useAdminApp();
  const { demo } = useGrowthStatus();
  // Completed and dismissed are terminal: there is nothing left to confirm, so the controls go away
  // rather than rendering a disabled button the customer would try to click.
  if (action.status !== "proposed" && action.status !== "active") return null;
  return (
    <div className={props.className ?? "flex flex-wrap items-center gap-2 border-t border-foreground/[0.08] pt-4"}>
      {action.status === "proposed" && (
        <GrowthConfirmActionButton
          buttonLabel="Activate experiment"
          buttonVariant="default"
          icon={CheckCircleIcon}
          title="Activate this action?"
          description={action.workflow != null
            ? "Activating deploys and starts the attached automation, and begins the watched-metric comparison."
            : "Activating captures the before window and starts watching the same metrics after activation. You can dismiss it later."}
          body={action.workflow != null ? <GrowthActivateWorkflowDialogBody workflow={action.workflow} /> : undefined}
          confirmLabel={action.workflow != null ? "Activate & deploy automation" : "Activate experiment"}
          demo={demo}
          onConfirm={async () => {
            await activateGrowthAction(app, action.id);
            await props.onChanged();
          }}
        />
      )}
      <GrowthConfirmActionButton
        buttonLabel="Dismiss"
        buttonVariant="outline"
        icon={ProhibitIcon}
        title="Dismiss this action?"
        description={action.status === "active" && action.workflow != null && action.workflow.status !== "not_deployed"
          ? "Dismissing deletes the deployed automation and cancels any of its in-flight runs. The action's history and metrics stay, but the automation will never run again."
          : "Dismissed actions stop tracking metrics and move out of your list. This does not delete anything."}
        confirmLabel="Dismiss action"
        demo={demo}
        onConfirm={async () => {
          await dismissGrowthAction(app, action.id);
          await props.onChanged();
        }}
      />
    </div>
  );
}
