"use client";

import { DesignButton, DesignCategoryTabs } from "@/components/design-components";
import { ArrowLeftIcon } from "@phosphor-icons/react";
import { useState } from "react";
import { getRunsForWorkflow, getWorkflowById } from "./mock-data";
import {
  EditableCodePanel,
  useWorkflowVersions,
  WorkflowKpiRow,
  WorkflowRunsGrid,
  WorkflowTitleRow,
  WorkflowsTable,
  type WorkflowDetailProps,
} from "./shared";

// The Workflows page: an infinite-scroll table of workflows, and a
// drill-in detail with the workflow's KPIs and two tabs — the runs grid and
// the always-editable code (version selector defaults to latest; saving
// mints the next version).

type DetailTab = "runs" | "code";

export function WorkflowDetail({ selectedWorkflowId, onSelect, onClose }: WorkflowDetailProps) {
  if (selectedWorkflowId == null) {
    return <WorkflowsTable onOpen={onSelect} />;
  }
  return <WorkflowDetailInner workflowId={selectedWorkflowId} onClose={onClose} />;
}

function WorkflowDetailInner({ workflowId, onClose }: { workflowId: string, onClose: () => void }) {
  const workflow = getWorkflowById(workflowId);
  const controller = useWorkflowVersions(workflowId);
  const [tab, setTab] = useState<DetailTab>("runs");

  return (
    <div className="flex flex-col gap-4">
      <div>
        <DesignButton variant="ghost" size="sm" onClick={onClose}>
          <ArrowLeftIcon className="mr-1 h-3.5 w-3.5" />All workflows
        </DesignButton>
      </div>

      <WorkflowTitleRow workflow={workflow} />
      <WorkflowKpiRow workflow={workflow} />

      <DesignCategoryTabs
        categories={[
          { id: "runs", label: "Runs", count: getRunsForWorkflow(workflowId).length },
          { id: "code", label: "Code", count: controller.versions.length },
        ]}
        selectedCategory={tab}
        onSelect={(id) => {
          if (id !== "runs" && id !== "code") {
            throw new Error(`Unknown workflow detail tab "${id}"`);
          }
          setTab(id);
        }}
        gradient="blue"
        size="sm"
      />

      {tab === "runs" && <WorkflowRunsGrid workflowId={workflowId} />}
      {tab === "code" && <EditableCodePanel controller={controller} />}
    </div>
  );
}
