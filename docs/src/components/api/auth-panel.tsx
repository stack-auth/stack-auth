'use client';

import { AdminOwnedProject, CurrentInternalUser, useUser } from '@stackframe/stack';
import { runAsynchronously } from '@stackframe/stack-shared/dist/utils/promises';
import { stringCompare } from '@stackframe/stack-shared/dist/utils/strings';
import { AlertTriangle, ChevronDown, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { cn } from '../../lib/cn';
import { useSidebar } from '../layouts/sidebar-context';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';
import { useAPIPageContext } from './api-page-wrapper';
import { Button } from './button';

type AuthMode = 'project' | 'manual';

type StackAuthHeaderKey =
  | 'X-Stack-Access-Type'
  | 'X-Stack-Project-Id'
  | 'X-Stack-Publishable-Client-Key'
  | 'X-Stack-Secret-Server-Key'
  | 'X-Stack-Access-Token'
  | 'X-Stack-Admin-Access-Token';

type StackAuthHeaderField = {
  key: StackAuthHeaderKey,
  label: string,
  placeholder: string,
  required: boolean,
  hideWhenProjectSelected?: boolean,
  isSensitive?: boolean,
};

const stackAuthHeaders: StackAuthHeaderField[] = [
  { key: 'X-Stack-Access-Type', label: 'Access Type', placeholder: 'client, server, or admin', required: true },
  { key: 'X-Stack-Project-Id', label: 'Project ID', placeholder: 'your-project-uuid', required: true },
  { key: 'X-Stack-Publishable-Client-Key', label: 'Client Key', placeholder: 'pck_your_key_here', required: false },
  { key: 'X-Stack-Secret-Server-Key', label: 'Server Key', placeholder: 'ssk_your_key_here', required: false },
  { key: 'X-Stack-Access-Token', label: 'Access Token', placeholder: 'user_access_token', required: false },
  { key: 'X-Stack-Admin-Access-Token', label: 'Admin Access Token', placeholder: 'admin_access_token', required: false },
];

type UserHookResult = ReturnType<typeof useUser>;

function isInternalUser(user: UserHookResult): user is CurrentInternalUser {
  return Boolean(user && 'useOwnedProjects' in user && typeof user.useOwnedProjects === 'function');
}

function ProjectDropdown({
  projects,
  selectedProjectId,
  onSelect,
}: {
  projects: AdminOwnedProject[],
  selectedProjectId: string,
  onSelect: (projectId: string) => void,
}) {
  const [open, setOpen] = useState(false);
  const selectedProject = projects.find(p => p.id === selectedProjectId);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "w-full px-3 py-2.5 pr-10 border rounded-lg text-sm bg-fd-background text-fd-foreground",
            "focus:outline-none focus:ring-2 focus:ring-fd-primary/20 focus:border-fd-primary",
            "border-fd-border cursor-pointer transition-colors",
            "flex items-center justify-between text-left"
          )}
        >
          <span className={selectedProjectId ? "text-fd-foreground" : "text-fd-muted-foreground"}>
            {selectedProject ? selectedProject.displayName : "Choose a project..."}
          </span>
          <ChevronDown className={cn(
            "w-4 h-4 text-fd-muted-foreground transition-transform",
            open && "rotate-180"
          )} />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-1.5" align="start">
        <div className="max-h-[300px] overflow-y-auto">
          <button
            type="button"
            onClick={() => {
              onSelect('');
              setOpen(false);
            }}
            className={cn(
              "w-full px-3 py-2.5 text-sm text-left rounded-md transition-colors",
              !selectedProjectId
                ? "bg-fd-primary/10 text-fd-primary font-medium"
                : "hover:bg-fd-accent hover:text-fd-accent-foreground"
            )}
          >
            Choose a project...
          </button>
          {projects.map((project) => (
            <button
              key={project.id}
              type="button"
              onClick={() => {
                onSelect(project.id);
                setOpen(false);
              }}
              className={cn(
                "w-full px-3 py-2.5 text-sm text-left rounded-md transition-colors",
                selectedProjectId === project.id
                  ? "bg-fd-primary/10 text-fd-primary font-medium"
                  : "hover:bg-fd-accent hover:text-fd-accent-foreground"
              )}
            >
              {project.displayName}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function AuthPanel() {
  const sidebarContext = useSidebar();

  // Always call hooks at the top level
  const apiContext = useAPIPageContext();

  // Get current user and their projects
  // Docs and dashboard share the same authentication (internal project)
  // So logged-in users will have access to their owned projects via useOwnedProjects()
  const user = useUser();
  const internalUser = isInternalUser(user) ? user : null;
  const ownedProjectsResult = internalUser?.useOwnedProjects();
  const projects = useMemo<AdminOwnedProject[]>(() => ownedProjectsResult ?? [], [ownedProjectsResult]);
  const hasOwnedProjects = Boolean(internalUser);

  // State for project selection
  const [selectedProjectId, setSelectedProjectId] = useState<string>('');

  // Mode: project selection OR manual entry
  const canUseProjectMode = hasOwnedProjects && projects.length > 0;
  const [authMode, setAuthMode] = useState<AuthMode>(canUseProjectMode ? 'project' : 'manual');

  // Use default functions if sidebar context is not available
  const { isAuthOpen, toggleAuth } = sidebarContext || {
    isAuthOpen: false,
    toggleAuth: () => {}
  };

  // Default headers structure
  // Note: Content-Type is handled automatically by the request handler when there's a body
  const defaultHeaders: Record<StackAuthHeaderKey, string> = {
    'X-Stack-Access-Type': '',
    'X-Stack-Project-Id': '',
    'X-Stack-Publishable-Client-Key': '',
    'X-Stack-Secret-Server-Key': '',
    'X-Stack-Access-Token': '',
    'X-Stack-Admin-Access-Token': '',
  };

  const { sharedHeaders, updateSharedHeaders, lastError, highlightMissingHeaders } = apiContext || {
    sharedHeaders: defaultHeaders,
    updateSharedHeaders: () => {},
    lastError: null,
    highlightMissingHeaders: false
  };

  // Ensure sharedHeaders is always a Record<string, string>
  const headers: Record<string, string> = sharedHeaders;

  // Refresh admin access token when project is selected
  useEffect(() => {
    if (!selectedProjectId || !user) {
      return;
    }

    runAsynchronously(async () => {
      // Get fresh access token from user's session
      const authJson = await user.getAuthJson();
      const adminAccessToken = authJson.accessToken ?? '';
      if (adminAccessToken) {
        // Update only the admin access token in headers
        updateSharedHeaders(prevHeaders => ({
          ...prevHeaders,
          'X-Stack-Admin-Access-Token': adminAccessToken,
        }));
      }
    });
  }, [selectedProjectId, user, updateSharedHeaders]);

  const missingRequiredHeaders = stackAuthHeaders.filter(
    header => header.required && !(headers[header.key] ?? '').trim()
  );

  // Handle project selection
  const handleProjectSelect = (projectId: string) => {
    if (!projects.some((projectItem) => projectItem.id === projectId)) {
      return;
    }

    setSelectedProjectId(projectId);

    // Initial headers setup - token will be populated by the useEffect
    const newHeaders = {
      ...headers,
      'X-Stack-Access-Type': 'admin',
      'X-Stack-Project-Id': projectId,
      'X-Stack-Admin-Access-Token': '', // Will be populated by refresh effect
      'X-Stack-Access-Token': '', // Not used for admin access
      'X-Stack-Publishable-Client-Key': '', // Not needed for admin auth
      'X-Stack-Secret-Server-Key': '', // Not needed for admin auth
    };

    updateSharedHeaders(newHeaders);
  };

  // Sort projects by name for better UX
  const sortedProjects = useMemo(() => {
    return [...projects].sort((a, b) => stringCompare(a.displayName, b.displayName));
  }, [projects]);

  return (
    <>
      {/* Desktop Auth Panel - Matching AIChatDrawer design */}
      <div
        className={`hidden md:block absolute top-4 right-4 max-h-[calc(100vh-2rem)] bg-fd-background border border-fd-border flex flex-col transition-all duration-300 ease-out z-50 w-96 rounded-lg pt-4 pr-4 pl-4 pb-2 shadow-lg ${
          isAuthOpen ? 'translate-x-0 opacity-100' : 'translate-x-full opacity-0'
        }`}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 pb-3 border-b border-fd-border">
          <h3 className="font-medium text-fd-foreground text-sm">
            API Authentication
          </h3>
          <button
            onClick={toggleAuth}
            className="p-1 text-fd-muted-foreground hover:text-fd-foreground hover:bg-fd-muted rounded transition-colors hover:transition-none"
            title="Close auth panel"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Error Message */}
        {highlightMissingHeaders && lastError && (
          <div className="mx-4 mt-3 p-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-md">
            <div className="flex items-center gap-2 text-xs">
              <AlertTriangle className="w-3 h-3 text-red-600 dark:text-red-400 flex-shrink-0" />
              <span className="text-red-800 dark:text-red-300 font-medium">
                {lastError.status} Error - Authentication required
              </span>
            </div>
          </div>
        )}

        {/* Mode Toggle - only show if user has projects */}
        {canUseProjectMode && (
          <div className="mx-4 mt-3 flex gap-4 border-b border-fd-border">
            <button
              type="button"
              onClick={() => setAuthMode('project')}
              className={cn(
                "pb-2 text-sm font-medium border-b-2 -mb-px transition-colors",
                authMode === 'project'
                  ? "border-fd-foreground text-fd-foreground"
                  : "border-transparent text-fd-muted-foreground hover:text-fd-foreground"
              )}
            >
              Select Project
            </button>
            <button
              type="button"
              onClick={() => setAuthMode('manual')}
              className={cn(
                "pb-2 text-sm font-medium border-b-2 -mb-px transition-colors",
                authMode === 'manual'
                  ? "border-fd-foreground text-fd-foreground"
                  : "border-transparent text-fd-muted-foreground hover:text-fd-foreground"
              )}
            >
              Manual
            </button>
          </div>
        )}

        {/* Content */}
        <div className="flex-1 min-h-0">
          <div className="h-full overflow-y-auto px-4 pt-4 pb-3 space-y-3">
            {/* Project Selection Mode */}
            {authMode === 'project' && canUseProjectMode && (
              <div className="space-y-3">
                <ProjectDropdown
                  projects={sortedProjects}
                  selectedProjectId={selectedProjectId}
                  onSelect={handleProjectSelect}
                />
                {selectedProjectId && (
                  <div className="flex items-center gap-2 p-2.5 rounded-lg bg-green-50 dark:bg-green-900/10 border border-green-200 dark:border-green-800">
                    <div className="w-2 h-2 rounded-full bg-green-500"></div>
                    <span className="text-sm text-green-700 dark:text-green-300">Ready to make requests</span>
                  </div>
                )}
                <p className="text-xs text-fd-muted-foreground pt-2">
                  Because you&apos;re signed in, requests are automatically authenticated with your account.
                </p>
              </div>
            )}

            {/* Manual Mode */}
            {(authMode === 'manual' || !canUseProjectMode) && (
              <div className="space-y-3">
                {stackAuthHeaders.map((header) => {
                  const value = headers[header.key] ?? '';
                  const isMissing = highlightMissingHeaders && header.required && !value.trim();

                  return (
                    <div key={header.key} className="space-y-1.5">
                      <label className="text-sm font-medium text-fd-foreground">
                        {header.label}
                      </label>
                      <input
                        type="text"
                        placeholder={header.placeholder}
                        value={value}
                        onChange={(e) => updateSharedHeaders({ ...headers, [header.key]: e.target.value })}
                        className={cn(
                          "w-full px-3 py-2 border rounded-lg text-sm bg-fd-background text-fd-foreground placeholder:text-fd-muted-foreground focus:outline-none focus:ring-2 focus:ring-fd-primary/20 focus:border-fd-primary transition-colors",
                          isMissing ? 'border-red-300 dark:border-red-700' : 'border-fd-border'
                        )}
                      />
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Status Footer */}
        <div className="border-t border-fd-border px-4 py-2.5">
          <div className="flex items-center justify-between text-sm">
            <div className="flex items-center gap-2">
              <div className={cn(
                "w-2 h-2 rounded-full",
                missingRequiredHeaders.length === 0 && Object.values(headers).some(v => v.trim())
                  ? 'bg-green-500'
                  : 'bg-fd-muted-foreground/50'
              )} />
              <span className="text-fd-muted-foreground">
                {missingRequiredHeaders.length === 0 && Object.values(headers).some(v => v.trim())
                  ? 'Ready'
                  : 'Not configured'}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Mobile Auth Panel */}
      <div
        className={`md:hidden fixed inset-0 z-50 flex flex-col bg-fd-background transition-all duration-300 ease-out ${
          isAuthOpen ? 'translate-x-0 opacity-100 pointer-events-auto' : 'translate-x-full opacity-0 pointer-events-none'
        }`}
        aria-hidden={!isAuthOpen}
      >
        {/* Mobile Header - with safe area for notched devices */}
        <div className="flex items-center justify-between px-4 py-4 pt-[max(1rem,env(safe-area-inset-top))] border-b border-fd-border bg-fd-background">
          <h3 className="font-medium text-fd-foreground text-base">
            API Authentication
          </h3>
          <button
            onClick={toggleAuth}
            className="p-2 -mr-2 text-fd-muted-foreground hover:text-fd-foreground hover:bg-fd-muted rounded-lg transition-colors hover:transition-none"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Error Message - Mobile */}
        {highlightMissingHeaders && lastError && (
          <div className="mx-4 mt-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
            <div className="flex items-center gap-2 text-sm">
              <AlertTriangle className="w-4 h-4 text-red-600 dark:text-red-400 flex-shrink-0" />
              <span className="text-red-800 dark:text-red-300 font-medium">
                {lastError.status} Error - Authentication required
              </span>
            </div>
          </div>
        )}

        {/* Mode Toggle - Mobile */}
        {canUseProjectMode && (
          <div className="mx-4 mt-4 flex gap-6 border-b border-fd-border">
            <button
              type="button"
              onClick={() => setAuthMode('project')}
              className={cn(
                "pb-3 text-base font-medium border-b-2 -mb-px transition-colors",
                authMode === 'project'
                  ? "border-fd-foreground text-fd-foreground"
                  : "border-transparent text-fd-muted-foreground"
              )}
            >
              Select Project
            </button>
            <button
              type="button"
              onClick={() => setAuthMode('manual')}
              className={cn(
                "pb-3 text-base font-medium border-b-2 -mb-px transition-colors",
                authMode === 'manual'
                  ? "border-fd-foreground text-fd-foreground"
                  : "border-transparent text-fd-muted-foreground"
              )}
            >
              Manual
            </button>
          </div>
        )}

        {/* Mobile Content */}
        <div className="flex-1 min-h-0">
          <div className="h-full overflow-y-auto px-4 pt-4 pb-6 space-y-4">
            {/* Project Selection Mode - Mobile */}
            {authMode === 'project' && canUseProjectMode && (
              <div className="space-y-4">
                <ProjectDropdown
                  projects={sortedProjects}
                  selectedProjectId={selectedProjectId}
                  onSelect={handleProjectSelect}
                />
                {selectedProjectId && (
                  <div className="flex items-center gap-3 p-3 rounded-lg bg-green-50 dark:bg-green-900/10 border border-green-200 dark:border-green-800">
                    <div className="w-2.5 h-2.5 rounded-full bg-green-500"></div>
                    <span className="text-base text-green-700 dark:text-green-300">Ready to make requests</span>
                  </div>
                )}
                <p className="text-sm text-fd-muted-foreground pt-2">
                  Because you&apos;re signed in, requests are automatically authenticated with your account.
                </p>
              </div>
            )}

            {/* Manual Mode - Mobile */}
            {(authMode === 'manual' || !canUseProjectMode) && (
              <div className="space-y-4">
                {stackAuthHeaders.map((header) => {
                  const value = headers[header.key] ?? '';
                  const isMissing = highlightMissingHeaders && header.required && !value.trim();

                  return (
                    <div key={header.key} className="space-y-2">
                      <label className="text-base font-medium text-fd-foreground">
                        {header.label}
                      </label>
                      <input
                        type="text"
                        placeholder={header.placeholder}
                        value={value}
                        onChange={(e) => updateSharedHeaders({ ...headers, [header.key]: e.target.value })}
                        className={cn(
                          "w-full px-4 py-3 border rounded-lg text-base bg-fd-background text-fd-foreground placeholder:text-fd-muted-foreground focus:outline-none focus:ring-2 focus:ring-fd-primary/20 focus:border-fd-primary transition-colors",
                          isMissing ? 'border-red-300 dark:border-red-700' : 'border-fd-border'
                        )}
                      />
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Mobile Status Footer - with safe area for home indicator */}
        <div className="border-t border-fd-border px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] bg-fd-background">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className={cn(
                "w-2.5 h-2.5 rounded-full",
                missingRequiredHeaders.length === 0 && Object.values(headers).some(v => v.trim())
                  ? 'bg-green-500'
                  : 'bg-fd-muted-foreground/50'
              )} />
              <span className="text-base text-fd-muted-foreground">
                {missingRequiredHeaders.length === 0 && Object.values(headers).some(v => v.trim())
                  ? 'Ready'
                  : 'Not configured'}
              </span>
            </div>
            <Button onClick={toggleAuth} className="px-6 py-2.5 text-base">
              Done
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}


