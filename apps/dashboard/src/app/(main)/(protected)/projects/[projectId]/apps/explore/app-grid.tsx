"use client";

import { DashboardAppDefinition } from "@/lib/apps";
import { Check, Plus } from "lucide-react";

interface AppGridProps {
  apps: DashboardAppDefinition[];
  onAppClick: (appId: string) => void;
  variant: "enabled" | "available";
}

export function AppGrid({ apps, onAppClick, variant }: AppGridProps) {
  if (apps.length === 0) {
    return (
      <p className="text-muted-foreground text-center py-8">
        No {variant} apps found.
      </p>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
      {apps.map((app) => {
        const IconComponent = app.icon;
        
        return (
          <div
            key={app.id}
            className="group relative bg-card border rounded-lg p-6 hover:shadow-lg transition-all duration-200 cursor-pointer"
            onClick={() => onAppClick(app.id)}
          >
            {/* App Icon */}
            <div className="flex items-center justify-center w-16 h-16 mx-auto mb-4 bg-muted rounded-lg">
              <IconComponent size={32} className="text-muted-foreground" />
            </div>

            {/* App Info */}
            <div className="text-center space-y-2">
              <h3 className="font-semibold text-lg">{app.displayName}</h3>
              <p className="text-sm text-muted-foreground line-clamp-2">
                {app.subtitle}
              </p>
              
              {/* Tags */}
              <div className="flex flex-wrap justify-center gap-1 mt-3">
                {app.tags.slice(0, 3).map((tag) => (
                  <span
                    key={tag}
                    className="px-2 py-1 bg-muted text-xs rounded-full"
                  >
                    {tag}
                  </span>
                ))}
                {app.tags.length > 3 && (
                  <span className="px-2 py-1 bg-muted text-xs rounded-full">
                    +{app.tags.length - 3}
                  </span>
                )}
              </div>
            </div>

            {/* Status Badge */}
            <div className="absolute top-4 right-4">
              {variant === "enabled" ? (
                <div className="flex items-center gap-1 bg-green-100 text-green-700 px-2 py-1 rounded-full text-xs font-medium">
                  <Check size={12} />
                  Enabled
                </div>
              ) : (
                <div className="flex items-center gap-1 bg-blue-100 text-blue-700 px-2 py-1 rounded-full text-xs font-medium">
                  <Plus size={12} />
                  Available
                </div>
              )}
            </div>

            {/* Hover Effect */}
            <div className="absolute inset-0 bg-gradient-to-t from-black/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-200 rounded-lg" />
          </div>
        );
      })}
    </div>
  );
}
