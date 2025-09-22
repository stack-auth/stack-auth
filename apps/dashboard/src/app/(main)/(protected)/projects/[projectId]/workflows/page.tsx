"use client";

import { deindent } from "@stackframe/stack-shared/dist/utils/strings";
import { generateUuid } from "@stackframe/stack-shared/dist/utils/uuids";
import { Button, Card, CardContent, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, Input, Label, Textarea, toast } from "@stackframe/stack-ui";
import { Plus } from "lucide-react";
import { useState } from "react";
import { IllustratedInfo } from "../../../../../../components/illustrated-info";
import { PageLayout } from "../page-layout";
import { useAdminApp } from "../use-admin-app";
import { WorkflowList } from "./workflow-list";

function EmptyState({ onCreateWorkflow }: { onCreateWorkflow: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center h-full px-4 py-12 max-w-3xl mx-auto">
      <IllustratedInfo
        illustration={
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-background rounded p-3 shadow-sm border">
              <div className="h-2 bg-muted rounded mb-2"></div>
              <div className="space-y-2">
                <div className="flex gap-2">
                  <div className="h-6 w-6 bg-primary/20 rounded"></div>
                  <div className="h-6 flex-1 bg-muted rounded"></div>
                </div>
                <div className="flex gap-2 ml-6">
                  <div className="h-6 w-6 bg-primary/20 rounded"></div>
                  <div className="h-6 flex-1 bg-muted rounded"></div>
                </div>
                <div className="flex gap-2 ml-12">
                  <div className="h-6 w-6 bg-primary/20 rounded"></div>
                  <div className="h-6 flex-1 bg-muted rounded"></div>
                </div>
              </div>
            </div>
            <div className="bg-background rounded p-3 shadow-sm border">
              <div className="h-2 bg-muted rounded mb-2"></div>
              <div className="space-y-2">
                <div className="flex gap-2">
                  <div className="h-6 w-6 bg-primary/20 rounded"></div>
                  <div className="h-6 flex-1 bg-muted rounded"></div>
                </div>
                <div className="flex gap-2 ml-6">
                  <div className="h-6 w-6 bg-primary/20 rounded"></div>
                  <div className="h-6 flex-1 bg-muted rounded"></div>
                </div>
              </div>
            </div>
          </div>
        }
        title="Welcome to Workflows!"
        description={[
          <>Workflows help you automate complex business processes.</>,
          <>Create your first workflow to get started with automation.</>,
        ]}
      />
      <Button onClick={onCreateWorkflow}>
        <Plus className="h-4 w-4 mr-2" />
        Create Your First Workflow
      </Button>
    </div>
  );
}

function CreateWorkflowDialog({
  open,
  onOpenChange,
  onSave
}: {
  open: boolean,
  onOpenChange: (open: boolean) => void,
  onSave: (id: string, displayName: string, tsSource: string, enabled: boolean) => Promise<void>,
}) {
  const [displayName, setDisplayName] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!displayName) {
      alert("Please fill in all required fields");
      return;
    }

    setIsSubmitting(true);
    try {
      await onSave(generateUuid(), displayName, deindent`
        onSignUp(async (user) => {
          await stackApp.sendEmail({ userIds: [user.id], subject: "Welcome to the app!", html: "<p>Example email</p>" });
          return scheduleCallback({
            scheduleAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 7),
            data: { "userId": user.id },
            callbackId: "in-7-days",
          });
        });

        registerCallback("in-7-days", async (data) => {
          await stackApp.sendEmail({ userIds: [data.userId], subject: "Welcome to the app!", html: "<p>Example email</p>" });
        });
      `, false);
      onOpenChange(false);
      setDisplayName("");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Create New Workflow</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 mb-4 mt-4">
          <div>
            <Label htmlFor="workflow-name">Display Name</Label>
            <Input
              id="workflow-name"
              placeholder="e.g., User Onboarding"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              width="200px"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={isSubmitting}>
            {isSubmitting ? "Creating..." : "Create Workflow"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function WorkflowsPage() {
  const stackAdminApp = useAdminApp();
  const project = stackAdminApp.useProject();
  const config = project.useConfig();
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [editingWorkflow, setEditingWorkflow] = useState<any>(null);

  const workflows = Object.entries(config.workflows.availableWorkflows).map(([id, workflow]) => ({
    id,
    ...workflow
  }));

  const handleCreateWorkflow = () => {
    setShowCreateDialog(true);
  };

  const handleSaveWorkflow = async (id: string, displayName: string, tsSource: string, enabled: boolean) => {
    await project.updateConfig({
      [`workflows.availableWorkflows.${id}`]: {
        displayName,
        tsSource,
        enabled,
      }
    });
    toast({ title: "Workflow created successfully" });
  };

  const handleEditWorkflow = (workflow: any) => {
    setEditingWorkflow(workflow);
    setShowEditDialog(true);
  };

  const handleUpdateWorkflow = async (id: string, displayName: string, tsSource: string) => {
    await project.updateConfig({
      [`workflows.availableWorkflows.${id}`]: {
        displayName,
        tsSource,
        enabled: editingWorkflow?.enabled ?? true
      }
    });
    toast({ title: "Workflow updated successfully" });
    setShowEditDialog(false);
    setEditingWorkflow(null);
  };

  const handleDeleteWorkflow = async (workflowId: string) => {
    if (confirm(`Are you sure you want to delete the workflow "${workflowId}"?`)) {
      await project.updateConfig({
        [`workflows.availableWorkflows.${workflowId}`]: null
      });
      toast({ title: "Workflow deleted" });
    }
  };

  const handleDuplicateWorkflow = async (workflow: any) => {
    const newId = `${workflow.id}_copy`;
    let finalId = newId;
    let counter = 1;

    // Find unique ID
    const availableWorkflows = config.workflows.availableWorkflows;
    while (finalId in availableWorkflows) {
      finalId = `${newId}_${counter}`;
      counter++;
    }

    await project.updateConfig({
      [`workflows.availableWorkflows.${finalId}`]: {
        displayName: `${workflow.displayName} (Copy)`,
        tsSource: workflow.tsSource,
        enabled: false
      }
    });
    toast({ title: "Workflow duplicated successfully" });
  };

  const handleToggleEnabled = async (workflow: any) => {
    await project.updateConfig({
      [`workflows.availableWorkflows.${workflow.id}.enabled`]: !workflow.enabled
    });
    toast({
      title: workflow.enabled ? "Workflow disabled" : "Workflow enabled"
    });
  };

  if (workflows.length === 0) {
    return (
      <>
        <EmptyState onCreateWorkflow={handleCreateWorkflow} />
        <CreateWorkflowDialog
          open={showCreateDialog}
          onOpenChange={setShowCreateDialog}
          onSave={handleSaveWorkflow}
        />
      </>
    );
  }

  return (
    <>
      <PageLayout title="Workflows">
        <div className="flex gap-6 flex-1" style={{ flexBasis: "0px", overflow: "scroll" }}>
          <Card className="flex w-full">
            <CardContent className="flex w-full p-0">
              <div className="flex-1">
                <WorkflowList
                  workflows={workflows}
                  projectId={project.id}
                  onAddClick={handleCreateWorkflow}
                  onEdit={handleEditWorkflow}
                  onDelete={(id) => {
                    handleDeleteWorkflow(id).catch(() => {
                      toast({ title: "Failed to delete workflow", variant: "destructive" });
                    });
                  }}
                  onDuplicate={(workflow) => {
                    handleDuplicateWorkflow(workflow).catch(() => {
                      toast({ title: "Failed to duplicate workflow", variant: "destructive" });
                    });
                  }}
                  onToggleEnabled={(workflow) => {
                    handleToggleEnabled(workflow).catch(() => {
                      toast({ title: "Failed to toggle workflow", variant: "destructive" });
                    });
                  }}
                />
              </div>
            </CardContent>
          </Card>
        </div>
      </PageLayout>
      <CreateWorkflowDialog
        open={showCreateDialog}
        onOpenChange={setShowCreateDialog}
        onSave={handleSaveWorkflow}
      />
      {editingWorkflow && (
        <Dialog open={showEditDialog} onOpenChange={setShowEditDialog}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Edit Workflow</DialogTitle>
            </DialogHeader>
            <EditWorkflowForm
              workflow={editingWorkflow}
              onSave={handleUpdateWorkflow}
              onCancel={() => {
                setShowEditDialog(false);
                setEditingWorkflow(null);
              }}
            />
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}

function EditWorkflowForm({
  workflow,
  onSave,
  onCancel
}: {
  workflow: any,
  onSave: (id: string, displayName: string, tsSource: string) => Promise<void>,
  onCancel: () => void,
}) {
  const [displayName, setDisplayName] = useState(workflow.displayName);
  const [tsSource, setTsSource] = useState(workflow.tsSource);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!displayName) {
      toast({ title: "Please fill in all required fields", variant: "destructive" });
      return;
    }

    setIsSubmitting(true);
    try {
      await onSave(workflow.id, displayName, tsSource);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
      <div className="space-y-4">
        <div>
          <Label htmlFor="edit-workflow-id">Workflow ID</Label>
          <Input
            id="edit-workflow-id"
            value={workflow.id}
            disabled
            className="bg-muted"
          />
        </div>
        <div>
          <Label htmlFor="edit-workflow-name">Display Name</Label>
          <Input
            id="edit-workflow-name"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="edit-workflow-source">TypeScript Source</Label>
          <Textarea
            id="edit-workflow-source"
            className="font-mono text-sm min-h-[200px]"
            value={tsSource}
            onChange={(e) => setTsSource(e.target.value)}
          />
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onCancel} disabled={isSubmitting}>
          Cancel
        </Button>
        <Button onClick={handleSubmit} disabled={isSubmitting}>
          {isSubmitting ? "Saving..." : "Save Changes"}
        </Button>
      </DialogFooter>
    </>
  );
}
