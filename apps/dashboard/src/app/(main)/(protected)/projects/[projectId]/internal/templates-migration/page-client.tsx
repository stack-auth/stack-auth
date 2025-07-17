"use client";

import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@stackframe/stack-ui";
import { useState } from "react";
import { useAdminApp } from "../../use-admin-app";

export default function PageClient() {
  const adminApp = useAdminApp();
  const [projectIds, setProjectIds] = useState<string[]>([]);
  const [isLoadingProjectIds, setIsLoadingProjectIds] = useState(false);
  const [isMigrationRunning, setIsMigrationRunning] = useState(false);
  const [migrationResults, setMigrationResults] = useState<Array<{ projectId: string, templatesConverted: number, totalTemplates: number }>>([]);

  const handleGetProjectIds = async () => {
    setIsLoadingProjectIds(true);
    try {
      const ids = await adminApp.getProjectIdsForTemplatesMigration();
      setProjectIds(ids);
    } catch (error) {
      console.error("Error getting project IDs:", error);
    } finally {
      setIsLoadingProjectIds(false);
    }
  };

  const handleRunMigration = async () => {
    setIsMigrationRunning(true);
    setMigrationResults([]);

    try {
      for (const projectId of projectIds) {
        const result = await adminApp.convertEmailTemplates(projectId);
        setMigrationResults(prev => [...prev, {
          projectId,
          templatesConverted: result.templates_converted,
          totalTemplates: result.total_templates
        }]);
      }
    } catch (error) {
      console.error("Error running migration:", error);
    } finally {
      setIsMigrationRunning(false);
    }
  };

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="space-y-2">
        <h1 className="text-3xl font-bold">Templates Migration</h1>
        <p className="text-muted-foreground">
          Migrate email templates from the old system to the new system
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Migration Process</CardTitle>
          <CardDescription>
            First, load the list of project IDs, then run the migration for all projects
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-4">
            <Button
              onClick={handleGetProjectIds}
              disabled={isLoadingProjectIds}
              variant="outline"
            >
              {isLoadingProjectIds ? "Loading..." : "Get Project IDs"}
            </Button>

            <Button
              onClick={handleRunMigration}
              disabled={projectIds.length === 0 || isMigrationRunning}
              variant="default"
            >
              {isMigrationRunning ? "Running Migration..." : "Run Migration"}
            </Button>
          </div>

          {projectIds.length > 0 && (
            <div className="space-y-2">
              <h3 className="font-semibold">Found {projectIds.length} projects:</h3>
              <div className="grid grid-cols-2 gap-2 max-h-32 overflow-y-auto">
                {projectIds.map(id => (
                  <code key={id} className="text-sm bg-muted p-2 rounded">
                    {id}
                  </code>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Migration Results</CardTitle>
          <CardDescription>
            {migrationResults.length} / {projectIds.length} projects migrated
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {migrationResults.map(result => (
              <div key={result.projectId} className="flex justify-between items-center p-3 bg-muted rounded">
                <code className="font-mono text-sm">{result.projectId}</code>
                <span className="text-sm">
                  {result.templatesConverted} templates converted (out of {result.totalTemplates} total)
                </span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
