"use client";

import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Progress } from "@stackframe/stack-ui";
import { CheckCircle, Circle, Loader2 } from "lucide-react";
import { useState } from "react";
import { useAdminApp } from "../../use-admin-app";

type MigrationStep = "idle" | "fetching-projects" | "projects-fetched" | "converting" | "completed";

export function PageClient() {
  const adminApp = useAdminApp();
  const [step, setStep] = useState<MigrationStep>("idle");
  const [projectIds, setProjectIds] = useState<string[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [results, setResults] = useState<Array<{ projectId: string, success: boolean, templatesConverted?: number, totalTemplates?: number, error?: string }>>([]);

  const fetchAllProjectIds = async () => {
    setIsLoading(true);
    setStep("fetching-projects");

    try {
      let allProjectIds: string[] = [];
      let cursor: string | null = null;

      do {
        const response = await adminApp.getAllProjectsIdsForMigration(cursor || undefined);
        allProjectIds = [...allProjectIds, ...response.projectIds];
        cursor = response.nextCursor;

        // Update state to show progress
        setProjectIds([...allProjectIds]);
      } while (cursor !== null);

      setStep("projects-fetched");
    } catch (error) {
      console.error("Error fetching project IDs:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const convertEmailTemplates = async () => {
    setIsLoading(true);
    setStep("converting");
    setCurrentIndex(0);
    setResults([]);

    try {
      for (let i = 0; i < projectIds.length; i++) {
        setCurrentIndex(i + 1);
        const projectId = projectIds[i];

        try {
          const result = await adminApp.convertEmailTemplates(projectId);
          setResults(prev => [...prev, {
            projectId,
            success: true,
            templatesConverted: result.templatesConverted,
            totalTemplates: result.totalTemplates
          }]);
        } catch (error) {
          setResults(prev => [...prev, {
            projectId,
            success: false,
            error: error instanceof Error ? error.message : "Unknown error"
          }]);
        }
      }

      setStep("completed");
    } catch (error) {
      console.error("Error during conversion:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const progressPercentage = projectIds.length > 0 ? (currentIndex / projectIds.length) * 100 : 0;

  return (
    <div className="p-6 flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold">Email Templates Migration</h1>
        <p className="text-muted-foreground">
          Migrate email templates from the old system to the new configuration format.
        </p>
      </div>

      {/* Progress Bar */}
      {(step === "converting" || step === "completed") && (
        <Card>
          <CardHeader>
            <CardTitle>Migration Progress</CardTitle>
            <CardDescription>
              {currentIndex} / {projectIds.length} projects processed
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Progress value={progressPercentage} className="w-full" />
          </CardContent>
        </Card>
      )}

      {/* Step 1: Fetch Project IDs */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {step === "idle" ? (
              <Circle className="h-5 w-5" />
            ) : step === "fetching-projects" ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <CheckCircle className="h-5 w-5 text-green-500" />
            )}
            Step 1: Fetch Project IDs
          </CardTitle>
          <CardDescription>
            Retrieve all project IDs that need email template migration.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {projectIds.length > 0 && (
            <div className="text-sm text-muted-foreground">
              Found {projectIds.length} projects to migrate
            </div>
          )}

          <Button
            onClick={fetchAllProjectIds}
            disabled={isLoading || step === "converting" || step === "completed"}
          >
            {step === "fetching-projects" ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Fetching Project IDs... ({projectIds.length} found)
              </>
            ) : (
              "Get Project IDs"
            )}
          </Button>
        </CardContent>
      </Card>

      {/* Step 2: Convert Templates */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {step === "converting" ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : step === "completed" ? (
              <CheckCircle className="h-5 w-5 text-green-500" />
            ) : (
              <Circle className="h-5 w-5" />
            )}
            Step 2: Convert Email Templates
          </CardTitle>
          <CardDescription>
            Process each project and convert their email templates.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {results.length > 0 && (
            <div className="text-sm text-muted-foreground">
              Processed {results.length} / {projectIds.length} projects
            </div>
          )}

          <Button
            onClick={convertEmailTemplates}
            disabled={isLoading || step !== "projects-fetched" && step !== "completed"}
            variant={step === "completed" ? "secondary" : "default"}
          >
            {step === "converting" ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Converting... ({currentIndex}/{projectIds.length})
              </>
            ) : step === "completed" ? (
              "Migration Completed"
            ) : (
              "Convert Email Templates"
            )}
          </Button>
        </CardContent>
      </Card>

      {/* Results Summary */}
      {results.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Migration Results</CardTitle>
            <CardDescription>
              Summary of the migration process
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span>Successful conversions:</span>
                <span className="font-medium text-green-600">
                  {results.filter(r => r.success).length}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span>Failed conversions:</span>
                <span className="font-medium text-red-600">
                  {results.filter(r => !r.success).length}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span>Total templates converted:</span>
                <span className="font-medium">
                  {results
                    .filter(r => r.success)
                    .reduce((sum, r) => sum + (r.templatesConverted || 0), 0)}
                </span>
              </div>
            </div>

            {/* Show failed conversions */}
            {results.some(r => !r.success) && (
              <div className="mt-4">
                <h4 className="text-sm font-medium text-red-600 mb-2">Failed Projects:</h4>
                <div className="space-y-1 max-h-40 overflow-y-auto">
                  {results
                    .filter(r => !r.success)
                    .map((result, index) => (
                      <div key={index} className="text-xs text-muted-foreground">
                        {result.projectId}: {result.error}
                      </div>
                    ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
