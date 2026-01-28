'use client';

import { AdminOwnedProject, CurrentInternalUser, useUser } from '@stackframe/stack';
import { runAsynchronously } from '@stackframe/stack-shared/dist/utils/promises';
import { stringCompare } from '@stackframe/stack-shared/dist/utils/strings';
import { AlertTriangle, Check, ChevronDown, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useSidebar } from '../layouts/sidebar-context';
import { Button } from '../mdx/button';
import { useAPIPageContext } from './api-page-wrapper';

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
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const mobileDropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      const isOutsideDesktop = dropdownRef.current && !dropdownRef.current.contains(target);
      const isOutsideMobile = mobileDropdownRef.current && !mobileDropdownRef.current.contains(target);

      // Only close if click is outside both dropdowns (or if the ref doesn't exist for that viewport)
      if (
        (!dropdownRef.current || isOutsideDesktop) &&
        (!mobileDropdownRef.current || isOutsideMobile)
      ) {
        setIsDropdownOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

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
            onClick={() => {
              setActiveTab('select-project');
              setIsDropdownOpen(false);
            }}
            className={`flex-1 px-4 py-3 text-sm font-medium transition-colors hover:transition-none ${
              activeTab === 'select-project'
                ? 'text-fd-foreground border-b-2 border-fd-foreground'
                : 'text-fd-muted-foreground hover:text-fd-foreground'
            }`}
          >
            Select Project
          </button>
          <button
            onClick={() => {
              setActiveTab('manual');
              setIsDropdownOpen(false);
            }}
            className={`flex-1 px-4 py-3 text-sm font-medium transition-colors hover:transition-none ${
              activeTab === 'manual'
                ? 'text-fd-foreground border-b-2 border-fd-foreground'
                : 'text-fd-muted-foreground hover:text-fd-foreground'
            }`}
          >
            Manual
          </button>
        </div>

        {/* Error Banner */}
        {highlightMissingHeaders && lastError && (
          <div className="mx-4 mt-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-red-600 dark:text-red-400 flex-shrink-0" />
              <span className="text-sm font-medium text-red-800 dark:text-red-300">
                {lastError.status} Error - Authentication required
              </span>
            </div>
            {missingRequiredHeaders.length > 0 && (
              <p className="text-sm text-red-600 dark:text-red-400 mt-1.5 ml-6">
                Missing: {missingRequiredHeaders.map(h => h.label).join(', ')}
              </p>
            )}
          </div>
        )}

        {/* Content */}
        <div className="flex-1 min-h-0 overflow-y-auto">
          {activeTab === 'select-project' ? (
            <div className="p-4 space-y-4">
              {hasOwnedProjects && projects.length > 0 ? (
                <>
                  <div className="space-y-2" ref={dropdownRef}>
                    <label className="text-sm font-medium text-fd-foreground">
                      Select Project
                    </label>
                    <div className="relative">
                      <button
                        type="button"
                        onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                        className="w-full px-3 py-2.5 pr-10 border rounded-lg text-sm bg-fd-muted/50 text-fd-foreground focus:outline-none focus:ring-2 focus:ring-fd-primary focus:border-fd-primary border-fd-border text-left flex items-center justify-between"
                      >
                        <span className={selectedProjectId ? 'text-fd-foreground' : 'text-fd-muted-foreground'}>
                          {selectedProjectId
                            ? sortedProjects.find(p => p.id === selectedProjectId)?.displayName
                            : 'Select a project...'}
                        </span>
                        <ChevronDown className={`w-4 h-4 text-fd-muted-foreground transition-transform ${isDropdownOpen ? 'rotate-180' : ''}`} />
                      </button>

                      {/* Dropdown Menu */}
                      {isDropdownOpen && (
                        <div className="absolute top-full left-0 right-0 mt-1 bg-fd-background border border-fd-border rounded-lg shadow-lg z-50 max-h-60 overflow-y-auto">
                          {sortedProjects.map((project) => (
                            <button
                              key={project.id}
                              type="button"
                              onClick={() => {
                                handleProjectSelect(project.id);
                                setIsDropdownOpen(false);
                              }}
                              className="w-full px-3 py-2.5 text-sm text-left hover:bg-fd-muted/50 flex items-center justify-between transition-colors hover:transition-none"
                            >
                              <span className="text-fd-foreground">{project.displayName}</span>
                              {selectedProjectId === project.id && (
                                <Check className="w-4 h-4 text-green-500" />
                              )}
                            </button>
                          ))}
                        </div>
                      )}
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
                        Because you&apos;re signed in, requests are automatically authenticated with your account.
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
                const isMissing = highlightMissingHeaders && header.required && !value.trim();

                return (
                  <div key={header.key} className="space-y-2">
                    <label className={`text-sm font-medium flex items-center gap-2 ${
                      isMissing ? 'text-red-600 dark:text-red-400' : 'text-fd-foreground'
                    }`}>
                      {header.label}
                      {header.required && (
                        <span className={`text-xs px-1.5 py-0.5 rounded ${
                          isMissing
                            ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300'
                            : 'bg-fd-muted text-fd-muted-foreground'
                        }`}>
                          required
                        </span>
                      )}
                    </label>
                    <input
                      type="text"
                      placeholder={header.placeholder}
                      value={value}
                      onChange={(e) => updateSharedHeaders({ ...headers, [header.key]: e.target.value })}
                      className={`w-full px-3 py-2.5 border rounded-lg text-sm bg-fd-muted/50 text-fd-foreground placeholder:text-fd-muted-foreground focus:outline-none focus:ring-2 ${
                        isMissing
                          ? 'border-red-300 dark:border-red-700 focus:ring-red-500'
                          : 'border-fd-border focus:ring-fd-primary focus:border-fd-primary'
                      }`}
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
            onClick={() => {
              setActiveTab('select-project');
              setIsDropdownOpen(false);
            }}
            className={`flex-1 px-4 py-3 text-sm font-medium transition-colors hover:transition-none ${
              activeTab === 'select-project'
                ? 'text-fd-foreground border-b-2 border-fd-foreground'
                : 'text-fd-muted-foreground hover:text-fd-foreground'
            }`}
          >
            Select Project
          </button>
          <button
            onClick={() => {
              setActiveTab('manual');
              setIsDropdownOpen(false);
            }}
            className={`flex-1 px-4 py-3 text-sm font-medium transition-colors hover:transition-none ${
              activeTab === 'manual'
                ? 'text-fd-foreground border-b-2 border-fd-foreground'
                : 'text-fd-muted-foreground hover:text-fd-foreground'
            }`}
          >
            Manual
          </button>
        </div>

        {/* Mobile Error Banner */}
        {highlightMissingHeaders && lastError && (
          <div className="mx-4 mt-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-red-600 dark:text-red-400 flex-shrink-0" />
              <span className="text-sm font-medium text-red-800 dark:text-red-300">
                {lastError.status} Error - Authentication required
              </span>
            </div>
            {missingRequiredHeaders.length > 0 && (
              <p className="text-sm text-red-600 dark:text-red-400 mt-1.5 ml-6">
                Missing: {missingRequiredHeaders.map(h => h.label).join(', ')}
              </p>
            )}
          </div>
        )}

        {/* Mobile Content */}
        <div className="flex-1 min-h-0 overflow-y-auto">
          {activeTab === 'select-project' ? (
            <div className="p-4 space-y-4">
              {hasOwnedProjects && projects.length > 0 ? (
                <>
                  <div className="space-y-2" ref={mobileDropdownRef}>
                    <label className="text-sm font-medium text-fd-foreground">
                      Select Project
                    </label>
                    <div className="relative">
                      <button
                        type="button"
                        onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                        className="w-full px-3 py-3 pr-10 border rounded-lg text-base bg-fd-muted/50 text-fd-foreground focus:outline-none focus:ring-2 focus:ring-fd-primary focus:border-fd-primary border-fd-border text-left flex items-center justify-between"
                      >
                        <span className={selectedProjectId ? 'text-fd-foreground' : 'text-fd-muted-foreground'}>
                          {selectedProjectId
                            ? sortedProjects.find(p => p.id === selectedProjectId)?.displayName
                            : 'Select a project...'}
                        </span>
                        <ChevronDown className={`w-5 h-5 text-fd-muted-foreground transition-transform ${isDropdownOpen ? 'rotate-180' : ''}`} />
                      </button>

                      {/* Dropdown Menu */}
                      {isDropdownOpen && (
                        <div className="absolute top-full left-0 right-0 mt-1 bg-fd-background border border-fd-border rounded-lg shadow-lg z-50 max-h-60 overflow-y-auto">
                          {sortedProjects.map((project) => (
                            <button
                              key={project.id}
                              type="button"
                              onClick={() => {
                                handleProjectSelect(project.id);
                                setIsDropdownOpen(false);
                              }}
                              className="w-full px-3 py-3 text-base text-left hover:bg-fd-muted/50 flex items-center justify-between transition-colors hover:transition-none"
                            >
                              <span className="text-fd-foreground">{project.displayName}</span>
                              {selectedProjectId === project.id && (
                                <Check className="w-5 h-5 text-green-500" />
                              )}
                            </button>
                          ))}
                        </div>
                      )}
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
                        Because you&apos;re signed in, requests are automatically authenticated with your account.
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
                const isMissing = highlightMissingHeaders && header.required && !value.trim();

                return (
                  <div key={header.key} className="space-y-2">
                    <label className={`text-sm font-medium flex items-center gap-2 ${
                      isMissing ? 'text-red-600 dark:text-red-400' : 'text-fd-foreground'
                    }`}>
                      {header.label}
                      {header.required && (
                        <span className={`text-xs px-1.5 py-0.5 rounded ${
                          isMissing
                            ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300'
                            : 'bg-fd-muted text-fd-muted-foreground'
                        }`}>
                          required
                        </span>
                      )}
                    </label>
                    <input
                      type="text"
                      placeholder={header.placeholder}
                      value={value}
                      onChange={(e) => updateSharedHeaders({ ...headers, [header.key]: e.target.value })}
                      className={`w-full px-3 py-3 border rounded-lg text-base bg-fd-muted/50 text-fd-foreground placeholder:text-fd-muted-foreground focus:outline-none focus:ring-2 ${
                        isMissing
                          ? 'border-red-300 dark:border-red-700 focus:ring-red-500'
                          : 'border-fd-border focus:ring-fd-primary focus:border-fd-primary'
                      }`}
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
