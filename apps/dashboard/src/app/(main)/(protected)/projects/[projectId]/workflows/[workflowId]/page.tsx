"use client";

import { useRouter } from "@/components/router";
import { Button, Card, CardContent, CardHeader, CardTitle, toast } from "@stackframe/stack-ui";
import { ArrowLeft, Save } from "lucide-react";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { PageLayout } from "../../page-layout";
import { useAdminApp } from "../../use-admin-app";

export default function WorkflowDetailPage() {
  const params = useParams();
  const router = useRouter();
  const workflowId = params.workflowId as string;
  const projectId = params.projectId as string;

  const stackAdminApp = useAdminApp();
  const project = stackAdminApp.useProject();
  const config = project.useConfig();

  const availableWorkflows = config.workflows.availableWorkflows;
  const workflow = workflowId in availableWorkflows ? availableWorkflows[workflowId] : undefined;
  const [workflowContent, setWorkflowContent] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isToggling, setIsToggling] = useState(false);

  useEffect(() => {
    if (workflow && workflow.tsSource) {
      setWorkflowContent(workflow.tsSource);
    }
  }, [workflow]);

  const handleSave = async () => {
    setIsLoading(true);
    try {
      await project.updateConfig({
        [`workflows.availableWorkflows.${workflowId}.tsSource`]: workflowContent
      });
      toast({ title: "Workflow saved successfully" });
    } catch (error) {
      toast({ title: "Failed to save workflow", variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  };

  const handleBack = () => {
    router.push(`/projects/${projectId}/workflows`);
  };

  const handleToggleEnabled = async () => {
    if (!workflow) return;
    setIsToggling(true);
    try {
      await project.updateConfig({
        [`workflows.availableWorkflows.${workflowId}.enabled`]: !workflow.enabled,
      });
      toast({ title: workflow.enabled ? "Workflow disabled" : "Workflow enabled" });
    } catch (error) {
      toast({ title: "Failed to toggle workflow", variant: "destructive" });
    } finally {
      setIsToggling(false);
    }
  };

  if (workflow === undefined) {
    return (
      <PageLayout title="Workflow Not Found">
        <div className="flex flex-col items-center justify-center h-full">
          <p className="text-muted-foreground mb-4">The workflow {JSON.stringify(workflowId)} was not found.</p>
          <Button onClick={handleBack} variant="outline">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Workflows
          </Button>
        </div>
      </PageLayout>
    );
  }

  return (
    <PageLayout
      title={workflow.displayName || workflowId}
      actions={
        <div className="flex gap-2">
          <Button onClick={handleBack} variant="outline" size="sm">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back
          </Button>
          <Button onClick={handleToggleEnabled} size="sm" variant={workflow.enabled ? "outline" : "default"} disabled={isToggling}>
            {workflow.enabled ? "Disable" : "Enable"}
          </Button>
          <Button onClick={handleSave} size="sm" disabled={isLoading}>
            <Save className="h-4 w-4 mr-2" />
            {isLoading ? "Saving..." : "Save"}
          </Button>
        </div>
      }
    >
      <div className="flex gap-6 flex-1" style={{ flexBasis: "0px", overflow: "scroll" }}>
        <Card className="w-full">
          <CardHeader>
            <CardTitle className="text-base">Workflow Definition</CardTitle>
            <p className="text-sm text-muted-foreground">
              {workflow.enabled ? "This workflow is enabled" : "This workflow is disabled"}
            </p>
          </CardHeader>
          <CardContent>
            <div className="relative">
              <textarea
                value={workflowContent}
                onChange={(e) => setWorkflowContent(e.target.value)}
                className="w-full min-h-[600px] p-4 font-mono text-sm bg-muted/50 border rounded-md resize-none focus:outline-none focus:ring-2 focus:ring-primary"
                spellCheck={false}
                placeholder="Enter your workflow code here..."
                disabled={isLoading}
              />
            </div>
          </CardContent>
        </Card>
      </div>
    </PageLayout>
  );
}
