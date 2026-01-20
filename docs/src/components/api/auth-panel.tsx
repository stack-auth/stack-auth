'use client';

import { AdminOwnedProject, CurrentInternalUser, useUser } from '@stackframe/stack';
import { runAsynchronously } from '@stackframe/stack-shared/dist/utils/promises';
import { stringCompare } from '@stackframe/stack-shared/dist/utils/strings';
import { ChevronDown, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useSidebar } from '../layouts/sidebar-context';
import { useAPIPageContext } from './api-page-wrapper';
import { Button } from './button';

type AuthTab = 'select-project' | 'manual';

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
  { key: 'X-Stack-Publishable-Client-Key', label: 'Client Key', placeholder: 'pck_your_key_here', required: false, hideWhenProjectSelected: true },
  { key: 'X-Stack-Secret-Server-Key', label: 'Server Key', placeholder: 'ssk_your_key_here', required: false, hideWhenProjectSelected: true },
  { key: 'X-Stack-Access-Token', label: 'Access Token', placeholder: 'user_access_token', required: false, hideWhenProjectSelected: true },
  { key: 'X-Stack-Admin-Access-Token', label: 'Admin Access Token', placeholder: 'admin_access_token', required: false, isSensitive: true },
];

type UserHookResult = ReturnType<typeof useUser>;

function isInternalUser(user: UserHookResult): user is CurrentInternalUser {
  return Boolean(user && 'useOwnedProjects' in user && typeof user.useOwnedProjects === 'function');
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

  // State for project selection and tabs
  const [selectedProjectId, setSelectedProjectId] = useState<string>('');
  const [activeTab, setActiveTab] = useState<AuthTab>('select-project');

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

  const [isHomePage, setIsHomePage] = useState(false);
  const [isScrolled, setIsScrolled] = useState(false);

  // Detect if we're on homepage and scroll state (same as AIChatDrawer)
  useEffect(() => {
    const checkHomePage = () => {
      setIsHomePage(document.body.classList.contains('home-page'));
    };

    const checkScrolled = () => {
      setIsScrolled(document.body.classList.contains('scrolled'));
    };

    // Initial check
    checkHomePage();
    checkScrolled();

    // Set up observers for class changes
    const observer = new MutationObserver(() => {
      checkHomePage();
      checkScrolled();
    });

    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ['class']
    });

    return () => {
      observer.disconnect();
    };
  }, []);

  // Calculate position based on homepage and scroll state (same as AIChatDrawer)
  const topPosition = isHomePage && isScrolled ? 'top-0' : 'top-0';
  const height = isHomePage && isScrolled ? 'h-screen' : 'h-[calc(100vh)]';

  const missingRequiredHeaders = stackAuthHeaders.filter(
    header => header.required && !(headers[header.key] ?? '').trim()
  );

  // Handle project selection
  const handleProjectSelect = (projectId: string) => {
    // Handle deselection (empty string)
    if (projectId === '') {
      setSelectedProjectId('');
      // Clear all headers when deselecting
      updateSharedHeaders(defaultHeaders);
      return;
    }

    // Validate project exists
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
      {/* Desktop Auth Panel */}
      <div
        className={`hidden md:flex fixed ${topPosition} right-4 top-4 bottom-4 bg-fd-background border border-fd-border rounded-xl flex-col transition-all duration-300 ease-out z-50 w-96 shadow-lg ${
          isAuthOpen ? 'translate-x-0 opacity-100' : 'translate-x-[calc(100%+1rem)] opacity-0'
        }`}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-fd-border bg-fd-background rounded-t-xl">
          <h3 className="font-semibold text-fd-foreground text-sm">
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

        {/* Tabs */}
        <div className="flex border-b border-fd-border">
          <button
            onClick={() => setActiveTab('select-project')}
            className={`flex-1 px-4 py-3 text-sm font-medium transition-colors hover:transition-none ${
              activeTab === 'select-project'
                ? 'text-fd-foreground border-b-2 border-fd-foreground'
                : 'text-fd-muted-foreground hover:text-fd-foreground'
            }`}
          >
            Select Project
          </button>
          <button
            onClick={() => setActiveTab('manual')}
            className={`flex-1 px-4 py-3 text-sm font-medium transition-colors hover:transition-none ${
              activeTab === 'manual'
                ? 'text-fd-foreground border-b-2 border-fd-foreground'
                : 'text-fd-muted-foreground hover:text-fd-foreground'
            }`}
          >
            Manual
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 min-h-0 overflow-y-auto">
          {activeTab === 'select-project' ? (
            <div className="p-4 space-y-4">
              {hasOwnedProjects && projects.length > 0 ? (
                <>
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-fd-foreground">
                      Select Project
                    </label>
                    <div className="relative">
                      <select
                        value={selectedProjectId}
                        onChange={(e) => handleProjectSelect(e.target.value)}
                        className="w-full px-3 py-2.5 pr-10 border rounded-lg text-sm bg-fd-muted/50 text-fd-foreground focus:outline-none focus:ring-2 focus:ring-fd-primary focus:border-fd-primary border-fd-border appearance-none cursor-pointer"
                      >
                        <option value="">Select a project...</option>
                        {sortedProjects.map((project) => (
                          <option key={project.id} value={project.id}>
                            {project.displayName}
                          </option>
                        ))}
                      </select>
                      <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-fd-muted-foreground pointer-events-none" />
                    </div>
                  </div>

                  {selectedProjectId && (
                    <div className="p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg">
                      <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full bg-green-500" />
                        <span className="text-sm font-medium text-green-700 dark:text-green-300">
                          Ready to make requests
                        </span>
                      </div>
                      <p className="text-xs text-green-600 dark:text-green-400 mt-1.5">
                        Because you're signed in, requests are automatically authenticated with your account.
                      </p>
                    </div>
                  )}
                </>
              ) : (
                <div className="text-center py-8">
                  <p className="text-sm text-fd-muted-foreground mb-2">
                    Sign in to quickly select from your projects
                  </p>
                  <p className="text-xs text-fd-muted-foreground">
                    Or use the Manual tab to enter credentials directly
                  </p>
                </div>
              )}
            </div>
          ) : (
            <div className="p-4 space-y-4">
              {stackAuthHeaders.map((header) => {
                const value = headers[header.key] ?? '';

                return (
                  <div key={header.key} className="space-y-2">
                    <label className="text-sm font-medium text-fd-foreground">
                      {header.label}
                    </label>
                    <input
                      type="text"
                      placeholder={header.placeholder}
                      value={value}
                      onChange={(e) => updateSharedHeaders({ ...headers, [header.key]: e.target.value })}
                      className="w-full px-3 py-2.5 border rounded-lg text-sm bg-fd-muted/50 text-fd-foreground placeholder:text-fd-muted-foreground focus:outline-none focus:ring-2 focus:ring-fd-primary focus:border-fd-primary border-fd-border"
                    />
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer Status */}
        <div className="border-t border-fd-border p-4 rounded-b-xl">
          <div className="flex items-center gap-2 text-sm">
            <div className={`w-2 h-2 rounded-full ${
              missingRequiredHeaders.length === 0 && Object.values(headers).some(v => v.trim())
                ? 'bg-green-500'
                : 'bg-fd-muted-foreground'
            }`} />
            <span className={`${
              missingRequiredHeaders.length === 0 && Object.values(headers).some(v => v.trim())
                ? 'text-green-600 dark:text-green-400'
                : 'text-fd-muted-foreground'
            }`}>
              {missingRequiredHeaders.length === 0 && Object.values(headers).some(v => v.trim())
                ? 'Ready'
                : 'Not configured'}
            </span>
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
        {/* Mobile Header */}
        <div className="flex items-center justify-between p-4 border-b border-fd-border bg-fd-background">
          <h3 className="font-semibold text-fd-foreground text-base">
            API Authentication
          </h3>
          <button
            onClick={toggleAuth}
            className="p-1.5 text-fd-muted-foreground hover:text-fd-foreground hover:bg-fd-muted rounded transition-colors hover:transition-none"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Mobile Tabs */}
        <div className="flex border-b border-fd-border">
          <button
            onClick={() => setActiveTab('select-project')}
            className={`flex-1 px-4 py-3 text-sm font-medium transition-colors hover:transition-none ${
              activeTab === 'select-project'
                ? 'text-fd-foreground border-b-2 border-fd-foreground'
                : 'text-fd-muted-foreground hover:text-fd-foreground'
            }`}
          >
            Select Project
          </button>
          <button
            onClick={() => setActiveTab('manual')}
            className={`flex-1 px-4 py-3 text-sm font-medium transition-colors hover:transition-none ${
              activeTab === 'manual'
                ? 'text-fd-foreground border-b-2 border-fd-foreground'
                : 'text-fd-muted-foreground hover:text-fd-foreground'
            }`}
          >
            Manual
          </button>
        </div>

        {/* Mobile Content */}
        <div className="flex-1 min-h-0 overflow-y-auto">
          {activeTab === 'select-project' ? (
            <div className="p-4 space-y-4">
              {hasOwnedProjects && projects.length > 0 ? (
                <>
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-fd-foreground">
                      Select Project
                    </label>
                    <div className="relative">
                      <select
                        value={selectedProjectId}
                        onChange={(e) => handleProjectSelect(e.target.value)}
                        className="w-full px-3 py-3 pr-10 border rounded-lg text-base bg-fd-muted/50 text-fd-foreground focus:outline-none focus:ring-2 focus:ring-fd-primary focus:border-fd-primary border-fd-border appearance-none cursor-pointer"
                      >
                        <option value="">Select a project...</option>
                        {sortedProjects.map((project) => (
                          <option key={project.id} value={project.id}>
                            {project.displayName}
                          </option>
                        ))}
                      </select>
                      <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-fd-muted-foreground pointer-events-none" />
                    </div>
                  </div>

                  {selectedProjectId && (
                    <div className="p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg">
                      <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full bg-green-500" />
                        <span className="text-sm font-medium text-green-700 dark:text-green-300">
                          Ready to make requests
                        </span>
                      </div>
                      <p className="text-sm text-green-600 dark:text-green-400 mt-2">
                        Because you're signed in, requests are automatically authenticated with your account.
                      </p>
                    </div>
                  )}
                </>
              ) : (
                <div className="text-center py-12">
                  <p className="text-base text-fd-muted-foreground mb-2">
                    Sign in to quickly select from your projects
                  </p>
                  <p className="text-sm text-fd-muted-foreground">
                    Or use the Manual tab to enter credentials directly
                  </p>
                </div>
              )}
            </div>
          ) : (
            <div className="p-4 space-y-4">
              {stackAuthHeaders.map((header) => {
                const value = headers[header.key] ?? '';

                return (
                  <div key={header.key} className="space-y-2">
                    <label className="text-sm font-medium text-fd-foreground">
                      {header.label}
                    </label>
                    <input
                      type="text"
                      placeholder={header.placeholder}
                      value={value}
                      onChange={(e) => updateSharedHeaders({ ...headers, [header.key]: e.target.value })}
                      className="w-full px-3 py-3 border rounded-lg text-base bg-fd-muted/50 text-fd-foreground placeholder:text-fd-muted-foreground focus:outline-none focus:ring-2 focus:ring-fd-primary focus:border-fd-primary border-fd-border"
                    />
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Mobile Footer */}
        <div className="border-t border-fd-border p-4 bg-fd-background">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm">
              <div className={`w-2 h-2 rounded-full ${
                missingRequiredHeaders.length === 0 && Object.values(headers).some(v => v.trim())
                  ? 'bg-green-500'
                  : 'bg-fd-muted-foreground'
              }`} />
              <span className={`${
                missingRequiredHeaders.length === 0 && Object.values(headers).some(v => v.trim())
                  ? 'text-green-600 dark:text-green-400'
                  : 'text-fd-muted-foreground'
              }`}>
                {missingRequiredHeaders.length === 0 && Object.values(headers).some(v => v.trim())
                  ? 'Ready'
                  : 'Not configured'}
              </span>
            </div>
            <Button onClick={toggleAuth} className="px-4 py-2">
              Done
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}
