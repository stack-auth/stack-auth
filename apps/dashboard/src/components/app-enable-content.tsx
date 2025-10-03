"use client";

import { Link } from "@/components/link";
import { DASHBOARD_APPS, type AppId } from "@/lib/apps";
import { Button, Card, CardContent, CardHeader, CardTitle } from "@stackframe/stack-ui";
import { ExternalLink, Plus } from "lucide-react";

interface AppEnableContentProps {
  appId: AppId;
  projectId: string;
  onEnable?: () => void;
  isEnabled?: boolean;
}

export function AppEnableContent({ 
  appId, 
  projectId, 
  onEnable, 
  isEnabled = false 
}: AppEnableContentProps) {
  const app = DASHBOARD_APPS[appId];
  
  if (!app) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] p-8">
        <h1 className="text-2xl font-bold mb-4">App Not Found</h1>
        <p className="text-muted-foreground mb-6">
          The requested app could not be found.
        </p>
        <Link href={`/projects/${projectId}/apps/explore`}>
          <Button>
            <ExternalLink size={16} className="mr-2" />
            Explore Apps
          </Button>
        </Link>
      </div>
    );
  }

  const IconComponent = app.icon;
  const ScreenshotComponent = app.screenshots[0];
  const DescriptionComponent = app.description;

  return (
    <div className="flex flex-col items-center justify-center min-h-[400px] p-8">
      <div className="max-w-2xl w-full space-y-6">
        {/* App Header */}
        <div className="text-center space-y-4">
          <div className="flex justify-center">
            <div className="w-20 h-20 bg-muted rounded-lg flex items-center justify-center">
              <IconComponent size={40} className="text-muted-foreground" />
            </div>
          </div>
          
          <div>
            <h1 className="text-3xl font-bold">{app.displayName}</h1>
            <p className="text-muted-foreground text-lg">{app.subtitle}</p>
          </div>

          {/* Tags */}
          <div className="flex flex-wrap justify-center gap-2">
            {app.tags.map((tag) => (
              <span
                key={tag}
                className="px-3 py-1 bg-muted text-sm rounded-full"
              >
                {tag}
              </span>
            ))}
          </div>
        </div>

        {/* Screenshot Preview */}
        {app.screenshots.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-center">Preview</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="bg-muted rounded-lg p-6">
                <ScreenshotComponent />
              </div>
            </CardContent>
          </Card>
        )}

        {/* Description */}
        <Card>
          <CardHeader>
            <CardTitle>About {app.displayName}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="prose prose-sm max-w-none">
              <DescriptionComponent />
            </div>
          </CardContent>
        </Card>

        {/* Action Buttons */}
        <div className="flex flex-col sm:flex-row gap-4 justify-center">
          {!isEnabled && onEnable && (
            <Button onClick={onEnable} size="lg">
              <Plus size={20} className="mr-2" />
              Enable {app.displayName}
            </Button>
          )}
          
          <Link href={`/projects/${projectId}/apps/explore`}>
            <Button variant="outline" size="lg">
              <ExternalLink size={20} className="mr-2" />
              Explore All Apps
            </Button>
          </Link>
        </div>

        {/* Status Message */}
        {isEnabled && (
          <div className="text-center">
            <p className="text-green-600 font-medium">
              ✓ {app.displayName} is already enabled
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
