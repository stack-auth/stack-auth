'use client';

import {
  Badge,
  Button,
  Card,
  CardContent,
  Input,
  ScrollArea,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Separator,
  Skeleton,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  toast,
  Typography
} from "@/components/ui";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup
} from "@/components/ui/resizable";
import { getPublicEnvVar } from "@/lib/env";
import {
  ArrowLeftIcon,
  BuildingsIcon,
  CaretRightIcon,
  ClockIcon,
  GearIcon,
  GlobeIcon,
  ListBulletsIcon,
  MagnifyingGlassIcon,
  ShieldIcon,
  UserIcon,
  UsersIcon,
  WarningIcon,
  XIcon,
} from "@phosphor-icons/react";
import { useUser } from "@stackframe/stack";
import { fromNow } from "@stackframe/stack-shared/dist/utils/dates";
import { runAsynchronouslyWithAlert } from "@stackframe/stack-shared/dist/utils/promises";
import { useCallback, useEffect, useState } from "react";

// Types for API responses
type SupportProject = {
  id: string,
  displayName: string,
  description: string,
  createdAt: string,
  updatedAt: string,
  isProductionMode: boolean,
  ownerTeamId: string | null,
  ownerTeam: { id: string, displayName: string } | null,
  logoUrl: string | null,
  logoFullUrl: string | null,
  logoDarkModeUrl: string | null,
  logoFullDarkModeUrl: string | null,
  stripeAccountId: string | null,
  userCount: number,
  teamCount: number,
  tenancyCount: number,
  // Full rendered config with all settings
  config: unknown,
  // Raw config override for debugging
  configOverride: unknown,
};

type SupportUser = {
  id: string,
  displayName: string | null,
  primaryEmail: string | null,
  primaryEmailVerified: boolean,
  isAnonymous: boolean,
  createdAt: string,
  profileImageUrl: string | null,
  teams: { id: string, displayName: string }[],
  authMethods: string[],
  clientMetadata: unknown,
  serverMetadata: unknown,
};

type SupportTeam = {
  id: string,
  displayName: string,
  createdAt: string,
  profileImageUrl: string | null,
  memberCount: number,
  members: { userId: string, displayName: string | null, email: string | null }[],
  clientMetadata: unknown,
  serverMetadata: unknown,
};

type SupportEvent = {
  id: string,
  eventTypes: string[],
  eventStartedAt: string,
  eventEndedAt: string,
  isWide: boolean,
  data: {
    userId?: string,
    teamId?: string,
    description?: string,
    details?: unknown,
  },
  ipInfo: {
    ip: string,
    countryCode: string | null,
    cityName: string | null,
    isTrusted: boolean,
  } | null,
};

type PanelContent =
  | { type: 'project', project: SupportProject }
  | { type: 'user', user: SupportUser, projectId: string }
  | { type: 'team', team: SupportTeam, projectId: string }
  | { type: 'search' }
  | null;

// Custom hook for localStorage state
function useLocalStorage<T>(key: string, initialValue: T): [T, (value: T | ((prev: T) => T)) => void] {
  const [storedValue, setStoredValue] = useState<T>(initialValue);

  useEffect(() => {
    try {
      const item = window.localStorage.getItem(key);
      if (item) {
        setStoredValue(JSON.parse(item));
      }
    } catch {
      // If error, use initial value
    }
  }, [key]);

  const setValue = useCallback((value: T | ((prev: T) => T)) => {
    setStoredValue((prev) => {
      const valueToStore = value instanceof Function ? value(prev) : value;
      window.localStorage.setItem(key, JSON.stringify(valueToStore));
      return valueToStore;
    });
  }, [key]);

  return [storedValue, setValue];
}

// Hook to get auth headers for API requests
function useAuthHeaders() {
  const user = useUser({ or: 'redirect', projectIdMustMatch: "internal" });

  const getHeaders = useCallback(async (): Promise<Record<string, string>> => {
    const authJson = await user.getAuthJson();
    return {
      'Content-Type': 'application/json',
      'X-Stack-Project-Id': 'internal',
      'X-Stack-Access-Type': 'client',
      'X-Stack-Access-Token': authJson.accessToken ?? '',
      'X-Stack-Publishable-Client-Key': getPublicEnvVar('NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY') ?? '',
    };
  }, [user]);

  return { getHeaders, user };
}

export default function PageClient() {
  const { user } = useAuthHeaders();

  // Authorization is handled by the backend via team membership check.
  // The API will return 403 if the user is not a member of the support team.
  return (
    <SupportDashboard
      userName={user.displayName ?? user.primaryEmail ?? 'Support Agent'}
    />
  );
}

function SupportDashboard({
  userName,
}: {
  userName: string,
}) {
  const { getHeaders } = useAuthHeaders();
  const [leftPanel, setLeftPanel] = useState<PanelContent>({ type: 'search' });
  const [rightPanel, setRightPanel] = useState<PanelContent>(null);
  const [, setWidgetConfig] = useLocalStorage<string[]>(
    'support-dashboard-widgets',
    ['recent-projects', 'search']
  );

  const baseApiUrl = getPublicEnvVar('NEXT_PUBLIC_STACK_API_URL') ?? '';

  const openInPanel = useCallback((content: PanelContent, panel: 'left' | 'right' | 'auto') => {
    if (panel === 'auto') {
      // If left has content and right is empty, open in right
      if (leftPanel && !rightPanel) {
        setRightPanel(content);
      } else {
        setLeftPanel(content);
      }
    } else if (panel === 'left') {
      setLeftPanel(content);
    } else {
      setRightPanel(content);
    }
  }, [leftPanel, rightPanel]);

  return (
    <div className="flex flex-col h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border px-4 py-3 flex items-center justify-between bg-card">
        <div className="flex items-center gap-3">
          <ShieldIcon className="h-6 w-6 text-primary" weight="duotone" />
          <div>
            <Typography type="label" className="text-lg font-bold">
              Internal Support Dashboard
            </Typography>
            <Typography variant="secondary" className="text-xs">
              Welcome, {userName}
            </Typography>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <div className="flex-1 overflow-hidden">
        <ResizablePanelGroup direction="horizontal" className="h-full">
          {/* Left Panel */}
          <ResizablePanel defaultSize={50} minSize={30}>
            <div className="h-full flex flex-col min-w-0 overflow-hidden">
              <PanelHeader
                content={leftPanel}
                onClose={() => setLeftPanel({ type: 'search' })}
                side="left"
              />
              <div className="flex-1 overflow-hidden">
                <PanelContentView
                  content={leftPanel}
                  getHeaders={getHeaders}
                  baseApiUrl={baseApiUrl}
                  onOpenContent={(content) => openInPanel(content, 'auto')}
                />
              </div>
            </div>
          </ResizablePanel>

          <ResizableHandle withHandle />

          {/* Right Panel */}
          <ResizablePanel defaultSize={50} minSize={30}>
            <div className="h-full flex flex-col min-w-0 overflow-hidden">
              {rightPanel ? (
                <>
                  <PanelHeader
                    content={rightPanel}
                    onClose={() => setRightPanel(null)}
                    side="right"
                  />
                  <div className="flex-1 overflow-hidden">
                    <PanelContentView
                      content={rightPanel}
                      getHeaders={getHeaders}
                      baseApiUrl={baseApiUrl}
                      onOpenContent={(content) => openInPanel(content, 'right')}
                    />
                  </div>
                </>
              ) : (
                <EmptyPanelState />
              )}
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>
    </div>
  );
}

function PanelHeader({
  content,
  onClose,
}: {
  content: PanelContent,
  onClose: () => void,
  side: 'left' | 'right',
}) {
  let title = '';
  let icon = null;

  if (!content) return null;

  switch (content.type) {
    case 'search': {
      title = 'Search';
      icon = <MagnifyingGlassIcon className="h-4 w-4" />;
      break;
    }
    case 'project': {
      title = content.project.displayName;
      icon = <BuildingsIcon className="h-4 w-4" />;
      break;
    }
    case 'user': {
      title = content.user.displayName ?? content.user.primaryEmail ?? 'User';
      icon = <UserIcon className="h-4 w-4" />;
      break;
    }
    case 'team': {
      title = content.team.displayName;
      icon = <UsersIcon className="h-4 w-4" />;
      break;
    }
  }

  return (
    <div className="px-4 py-2 border-b border-border bg-muted/30 flex items-center justify-between">
      <div className="flex items-center gap-2">
        {icon}
        <Typography type="label" className="font-medium truncate max-w-[200px]">
          {title}
        </Typography>
      </div>
      {content.type !== 'search' && (
        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onClose}>
          <XIcon className="h-4 w-4" />
        </Button>
      )}
    </div>
  );
}

function EmptyPanelState() {
  return (
    <div className="h-full flex flex-col items-center justify-center text-muted-foreground p-8">
      <ArrowLeftIcon className="h-8 w-8 mb-4" />
      <Typography variant="secondary" className="text-center">
        Select an item from the left panel to view details here
      </Typography>
    </div>
  );
}

function PanelContentView({
  content,
  getHeaders,
  baseApiUrl,
  onOpenContent,
}: {
  content: PanelContent,
  getHeaders: () => Promise<Record<string, string>>,
  baseApiUrl: string,
  onOpenContent: (content: PanelContent) => void,
}) {
  if (!content) return <EmptyPanelState />;

  switch (content.type) {
    case 'search': {
      return (
        <SearchPanel
          getHeaders={getHeaders}
          baseApiUrl={baseApiUrl}
          onSelectProject={(project) => onOpenContent({ type: 'project', project })}
        />
      );
    }
    case 'project': {
      return (
        <ProjectDetailPanel
          project={content.project}
          getHeaders={getHeaders}
          baseApiUrl={baseApiUrl}
          onSelectUser={(user) => onOpenContent({ type: 'user', user, projectId: content.project.id })}
          onSelectTeam={(team) => onOpenContent({ type: 'team', team, projectId: content.project.id })}
          onSelectOwnerTeam={(team) => onOpenContent({ type: 'team', team, projectId: 'internal' })}
          onSelectOwnerUser={(userId) => {
            // Fetch user details from internal project using exact userId parameter
            runAsynchronouslyWithAlert(async () => {
              const headers = await getHeaders();
              const response = await fetch(
                `${baseApiUrl}/api/v1/internal/support/projects/internal/users?userId=${userId}`,
                { headers }
              );
              if (response.ok) {
                const data = await response.json();
                const user = data.items[0];
                if (user) {
                  onOpenContent({ type: 'user', user, projectId: 'internal' });
                } else {
                  toast({ variant: "destructive", title: "User not found" });
                }
              } else {
                toast({ variant: "destructive", title: "Failed to fetch user details" });
              }
            });
          }}
        />
      );
    }
    case 'user': {
      return (
        <UserDetailPanel
          user={content.user}
          projectId={content.projectId}
          getHeaders={getHeaders}
          baseApiUrl={baseApiUrl}
          onSelectTeam={(team) => onOpenContent({ type: 'team', team, projectId: content.projectId })}
        />
      );
    }
    case 'team': {
      return (
        <TeamDetailPanel
          team={content.team}
          projectId={content.projectId}
          getHeaders={getHeaders}
          baseApiUrl={baseApiUrl}
          onSelectUser={(user) => onOpenContent({ type: 'user', user, projectId: content.projectId })}
        />
      );
    }
    default: {
      return null;
    }
  }
}

function SearchPanel({
  getHeaders,
  baseApiUrl,
  onSelectProject,
}: {
  getHeaders: () => Promise<Record<string, string>>,
  baseApiUrl: string,
  onSelectProject: (project: SupportProject) => void,
}) {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SupportProject[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [total, setTotal] = useState(0);
  const [searchType, setSearchType] = useState<'all' | 'id'>('all');

  const performSearch = useCallback(async () => {
    setIsLoading(true);
    try {
      const headers = await getHeaders();
      const params = new URLSearchParams({ limit: '50' });

      if (searchQuery.trim()) {
        if (searchType === 'id') {
          params.set('projectId', searchQuery.trim());
        } else {
          params.set('search', searchQuery.trim());
        }
      }

      const response = await fetch(`${baseApiUrl}/api/v1/internal/support/projects?${params}`, {
        headers,
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(error.error || 'Failed to fetch projects');
      }

      const data = await response.json();
      setSearchResults(data.items);
      setTotal(data.total);
    } catch (e) {
      toast({ variant: "destructive", title: e instanceof Error ? e.message : "Search failed" });
    } finally {
      setIsLoading(false);
    }
  }, [getHeaders, baseApiUrl, searchQuery, searchType]);

  // Initial load
  useEffect(() => {
    runAsynchronouslyWithAlert(performSearch());
  }, []);

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(() => {
      runAsynchronouslyWithAlert(performSearch());
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery, searchType, performSearch]);

  return (
    <ScrollArea className="h-full">
      <div className="p-4 space-y-4">
        <div className="space-y-2">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder={searchType === 'id' ? "Enter exact project ID..." : "Search projects..."}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>
            <Select value={searchType} onValueChange={(v) => setSearchType(v as 'all' | 'id')}>
              <SelectTrigger className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All fields</SelectItem>
                <SelectItem value="id">Project ID</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Typography variant="secondary" className="text-xs">
            {total} project{total !== 1 ? 's' : ''} found
          </Typography>
        </div>

        <div className="space-y-2">
          {isLoading ? (
            Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-24 w-full" />
            ))
          ) : searchResults.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <MagnifyingGlassIcon className="h-8 w-8 mx-auto mb-2" />
              <Typography>No projects found</Typography>
            </div>
          ) : (
            searchResults.map((project) => (
              <ProjectCard
                key={project.id}
                project={project}
                onClick={() => onSelectProject(project)}
              />
            ))
          )}
        </div>
      </div>
    </ScrollArea>
  );
}

function ProjectCard({
  project,
  onClick
}: {
  project: SupportProject,
  onClick: () => void,
}) {
  return (
    <Card
      className="cursor-pointer hover:bg-muted/50 transition-colors hover:transition-none"
      onClick={onClick}
    >
      <CardContent className="p-4">
        <div className="flex items-start justify-between">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <Typography type="label" className="font-semibold truncate">
                {project.displayName}
              </Typography>
              {project.isProductionMode && (
                <Badge variant="default" className="text-xs">Production</Badge>
              )}
            </div>
            <Typography variant="secondary" className="text-xs font-mono truncate">
              {project.id}
            </Typography>
            {project.description && (
              <Typography variant="secondary" className="text-sm mt-1 line-clamp-2">
                {project.description}
              </Typography>
            )}
          </div>
          <CaretRightIcon className="h-5 w-5 text-muted-foreground flex-shrink-0" />
        </div>
        <div className="flex items-center gap-4 mt-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <UsersIcon className="h-3 w-3" />
            {project.userCount} users
          </span>
          <span className="flex items-center gap-1">
            <ClockIcon className="h-3 w-3" />
            {fromNow(new Date(project.createdAt))}
          </span>
          {project.ownerTeam && (
            <span className="flex items-center gap-1 truncate">
              <BuildingsIcon className="h-3 w-3" />
              {project.ownerTeam.displayName}
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function ProjectDetailPanel({
  project,
  getHeaders,
  baseApiUrl,
  onSelectUser,
  onSelectTeam,
  onSelectOwnerTeam,
  onSelectOwnerUser,
}: {
  project: SupportProject,
  getHeaders: () => Promise<Record<string, string>>,
  baseApiUrl: string,
  onSelectUser: (user: SupportUser) => void,
  onSelectTeam: (team: SupportTeam) => void,
  onSelectOwnerTeam: (team: SupportTeam) => void,
  onSelectOwnerUser: (userId: string) => void,
}) {
  const [users, setUsers] = useState<SupportUser[]>([]);
  const [teams, setTeams] = useState<SupportTeam[]>([]);
  const [events, setEvents] = useState<SupportEvent[]>([]);
  const [ownerTeamDetails, setOwnerTeamDetails] = useState<SupportTeam | null>(null);
  const [isLoadingUsers, setIsLoadingUsers] = useState(true);
  const [isLoadingTeams, setIsLoadingTeams] = useState(true);
  const [isLoadingEvents, setIsLoadingEvents] = useState(true);
  const [isLoadingOwner, setIsLoadingOwner] = useState(true);
  const [userSearch, setUserSearch] = useState('');
  const [teamSearch, setTeamSearch] = useState('');

  // Fetch owner team details from the internal project
  useEffect(() => {
    if (!project.ownerTeamId) {
      setIsLoadingOwner(false);
      return;
    }

    const fetchOwnerTeam = async () => {
      setIsLoadingOwner(true);
      try {
        const headers = await getHeaders();
        // Fetch the owner team from the "internal" project using exact teamId parameter
        const response = await fetch(
          `${baseApiUrl}/api/v1/internal/support/projects/internal/teams?teamId=${project.ownerTeamId}`,
          { headers }
        );
        if (response.ok) {
          const data = await response.json();
          // Take the first (and should be only) result
          setOwnerTeamDetails(data.items[0] ?? null);
        } else {
          const error = await response.json().catch(() => ({ error: response.statusText }));
          console.error('Failed to fetch owner team:', error);
        }
      } finally {
        setIsLoadingOwner(false);
      }
    };
    runAsynchronouslyWithAlert(fetchOwnerTeam());
  }, [project.ownerTeamId, getHeaders, baseApiUrl]);

  // Fetch users
  useEffect(() => {
    const fetchUsers = async () => {
      setIsLoadingUsers(true);
      try {
        const headers = await getHeaders();
        const params = new URLSearchParams({ limit: '25' });
        if (userSearch) params.set('search', userSearch);
        const response = await fetch(
          `${baseApiUrl}/api/v1/internal/support/projects/${project.id}/users?${params}`,
          { headers }
        );
        if (response.ok) {
          const data = await response.json();
          setUsers(data.items);
        } else {
          const error = await response.json().catch(() => ({ error: response.statusText }));
          console.error('Failed to fetch users:', error);
          toast({ variant: "destructive", title: `Failed to load users: ${error.error || 'Unknown error'}` });
        }
      } finally {
        setIsLoadingUsers(false);
      }
    };
    const timer = setTimeout(() => {
      runAsynchronouslyWithAlert(fetchUsers());
    }, 300);
    return () => clearTimeout(timer);
  }, [project.id, getHeaders, baseApiUrl, userSearch]);

  // Fetch teams
  useEffect(() => {
    const fetchTeams = async () => {
      setIsLoadingTeams(true);
      try {
        const headers = await getHeaders();
        const params = new URLSearchParams({ limit: '25' });
        if (teamSearch) params.set('search', teamSearch);
        const response = await fetch(
          `${baseApiUrl}/api/v1/internal/support/projects/${project.id}/teams?${params}`,
          { headers }
        );
        if (response.ok) {
          const data = await response.json();
          setTeams(data.items);
        } else {
          const error = await response.json().catch(() => ({ error: response.statusText }));
          console.error('Failed to fetch teams:', error);
          toast({ variant: "destructive", title: `Failed to load teams: ${error.error || 'Unknown error'}` });
        }
      } finally {
        setIsLoadingTeams(false);
      }
    };
    const timer = setTimeout(() => {
      runAsynchronouslyWithAlert(fetchTeams());
    }, 300);
    return () => clearTimeout(timer);
  }, [project.id, getHeaders, baseApiUrl, teamSearch]);

  // Fetch events on mount
  useEffect(() => {
    const fetchEvents = async () => {
      setIsLoadingEvents(true);
      try {
        const headers = await getHeaders();
        const response = await fetch(
          `${baseApiUrl}/api/v1/internal/support/projects/${project.id}/events?limit=30`,
          { headers }
        );
        if (response.ok) {
          const data = await response.json();
          setEvents(data.items);
        } else {
          const error = await response.json().catch(() => ({ error: response.statusText }));
          console.error('Failed to fetch events:', error);
          toast({ variant: "destructive", title: `Failed to load events: ${error.error || 'Unknown error'}` });
        }
      } finally {
        setIsLoadingEvents(false);
      }
    };
    runAsynchronouslyWithAlert(fetchEvents());
  }, [project.id, getHeaders, baseApiUrl]);

  return (
    <ScrollArea className="h-full w-full">
      <div className="p-4 space-y-6 min-w-0 overflow-hidden">
        {/* Project Info */}
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Typography type="label" className="text-lg font-bold">
              {project.displayName}
            </Typography>
            {project.isProductionMode && (
              <Badge variant="default">Production</Badge>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <InfoItem label="Project ID" value={project.id} mono copyable />
            <InfoItem label="Created" value={fromNow(new Date(project.createdAt))} />
            <InfoItem label="Users" value={String(project.userCount)} />
            {project.ownerTeam && (
              <InfoItem label="Owner Team" value={project.ownerTeam.displayName} />
            )}
          </div>

          {project.description && (
            <div>
              <Typography variant="secondary" className="text-xs uppercase tracking-wide">
                Description
              </Typography>
              <Typography className="text-sm">{project.description}</Typography>
            </div>
          )}
        </div>

        <Separator />

        {/* Owner Team Section - Most Important! */}
        {project.ownerTeamId && (
          <div className="space-y-3">
            <Typography type="label" className="text-sm font-medium flex items-center gap-2">
              <ShieldIcon className="h-4 w-4" />
              Project Owner (Internal Team)
            </Typography>
            {isLoadingOwner ? (
              <Skeleton className="h-24 w-full" />
            ) : ownerTeamDetails ? (
              <Card
                className="border-primary/50 bg-primary/5 cursor-pointer hover:bg-primary/10 transition-colors hover:transition-none"
                onClick={() => onSelectOwnerTeam(ownerTeamDetails)}
              >
                <CardContent className="p-4">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <Typography type="label" className="font-semibold text-lg">
                        {ownerTeamDetails.displayName}
                      </Typography>
                      <Typography variant="secondary" className="text-xs font-mono">
                        Team ID: {ownerTeamDetails.id}
                      </Typography>
                      <Typography variant="secondary" className="text-sm mt-2">
                        {ownerTeamDetails.memberCount} member{ownerTeamDetails.memberCount !== 1 ? 's' : ''}
                      </Typography>
                    </div>
                    <CaretRightIcon className="h-5 w-5 text-muted-foreground" />
                  </div>

                  {/* Owner Team Members - Click to view user details */}
                  <div className="mt-4 space-y-2" onClick={(e) => e.stopPropagation()}>
                    <Typography variant="secondary" className="text-xs uppercase tracking-wide">
                      Team Members (click to view)
                    </Typography>
                    {ownerTeamDetails.members.map((member) => (
                      <div
                        key={member.userId}
                        className="flex items-center gap-2 text-sm p-2 bg-background rounded cursor-pointer hover:bg-muted/50 transition-colors hover:transition-none"
                        onClick={() => onSelectOwnerUser(member.userId)}
                      >
                        <UserIcon className="h-4 w-4 text-muted-foreground" />
                        <div className="flex-1 min-w-0">
                          <span className="font-medium">{member.displayName ?? 'Unnamed'}</span>
                          {member.email && (
                            <span className="text-muted-foreground ml-2">({member.email})</span>
                          )}
                        </div>
                        <CaretRightIcon className="h-4 w-4 text-muted-foreground" />
                      </div>
                    ))}
                    {ownerTeamDetails.memberCount > 5 && (
                      <Typography variant="secondary" className="text-xs">
                        + {ownerTeamDetails.memberCount - 5} more members
                      </Typography>
                    )}
                  </div>
                </CardContent>
              </Card>
            ) : (
              <Card>
                <CardContent className="p-4">
                  <Typography variant="secondary">
                    Owner team not found (ID: {project.ownerTeamId})
                  </Typography>
                </CardContent>
              </Card>
            )}
          </div>
        )}

        {!project.ownerTeamId && (
          <Card className="border-yellow-500/50 bg-yellow-500/5">
            <CardContent className="p-4">
              <Typography variant="secondary" className="flex items-center gap-2">
                <WarningIcon className="h-4 w-4 text-yellow-500" />
                No owner team assigned to this project
              </Typography>
            </CardContent>
          </Card>
        )}

        <Separator />

        {/* Tabs for Project's own Users, Teams, Events, Config */}
        <Tabs defaultValue="config">
          <TabsList className="w-full grid grid-cols-4">
            <TabsTrigger value="config">
              <GearIcon className="h-4 w-4 mr-1" />
              <span className="hidden sm:inline">Config</span>
            </TabsTrigger>
            <TabsTrigger value="events">
              <ListBulletsIcon className="h-4 w-4 mr-1" />
              <span className="hidden sm:inline">Events</span>
            </TabsTrigger>
            <TabsTrigger value="users">
              <UserIcon className="h-4 w-4 mr-1" />
              <span className="hidden sm:inline">End Users</span>
            </TabsTrigger>
            <TabsTrigger value="teams">
              <UsersIcon className="h-4 w-4 mr-1" />
              <span className="hidden sm:inline">End Teams</span>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="users" className="space-y-3 mt-4">
            <Input
              placeholder="Search users..."
              value={userSearch}
              onChange={(e) => setUserSearch(e.target.value)}
              className="h-8"
            />
            {isLoadingUsers ? (
              Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-16 w-full" />
              ))
            ) : users.length === 0 ? (
              <Typography variant="secondary" className="text-center py-4">
                No users found
              </Typography>
            ) : (
              users.map((user) => (
                <UserCard key={user.id} user={user} onClick={() => onSelectUser(user)} />
              ))
            )}
          </TabsContent>

          <TabsContent value="teams" className="space-y-3 mt-4">
            <Input
              placeholder="Search teams..."
              value={teamSearch}
              onChange={(e) => setTeamSearch(e.target.value)}
              className="h-8"
            />
            {isLoadingTeams ? (
              Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-16 w-full" />
              ))
            ) : teams.length === 0 ? (
              <Typography variant="secondary" className="text-center py-4">
                No teams found
              </Typography>
            ) : (
              teams.map((team) => (
                <TeamCard key={team.id} team={team} onClick={() => onSelectTeam(team)} />
              ))
            )}
          </TabsContent>

          <TabsContent value="events" className="space-y-3 mt-4">
            {isLoadingEvents ? (
              Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))
            ) : events.length === 0 ? (
              <Typography variant="secondary" className="text-center py-4">
                No events found
              </Typography>
            ) : (
              events.map((event) => (
                <EventCard key={event.id} event={event} />
              ))
            )}
          </TabsContent>

          <TabsContent value="config" className="mt-4">
            <ConfigViewer project={project} />
          </TabsContent>
        </Tabs>
      </div>
    </ScrollArea>
  );
}

// Config item display component
function ConfigItem({ label, value, type = 'text' }: { label: string, value: unknown, type?: 'text' | 'boolean' | 'list' | 'json' }) {
  if (value === undefined || value === null) return null;

  let displayValue: React.ReactNode;

  if (type === 'boolean' || typeof value === 'boolean') {
    const boolValue = Boolean(value);
    displayValue = (
      <Badge variant={boolValue ? "default" : "secondary"} className="text-xs">
        {boolValue ? 'Enabled' : 'Disabled'}
      </Badge>
    );
  } else if (type === 'list' && Array.isArray(value)) {
    if (value.length === 0) {
      displayValue = <span className="text-muted-foreground italic">None</span>;
    } else {
      displayValue = (
        <div className="flex flex-wrap gap-1">
          {value.map((item, i) => (
            <Badge key={i} variant="outline" className="text-xs">
              {typeof item === 'object' ? JSON.stringify(item) : String(item)}
            </Badge>
          ))}
        </div>
      );
    }
  } else if (type === 'json' || typeof value === 'object') {
    displayValue = (
      <pre className="text-xs bg-muted p-2 rounded max-h-32 overflow-x-auto whitespace-pre-wrap">
        {JSON.stringify(value, null, 2)}
      </pre>
    );
  } else {
    displayValue = <span className="font-mono text-sm">{String(value)}</span>;
  }

  return (
    <div className="py-2 border-b border-border/50 last:border-0">
      <div className="flex gap-4">
        <Typography variant="secondary" className="text-xs w-[140px] flex-shrink-0">
          {label}
        </Typography>
        <div className="flex-1">{displayValue}</div>
      </div>
    </div>
  );
}

// Config section component
function ConfigSection({ title, children }: { title: string, children: React.ReactNode }) {
  // If no children render (all null), don't show the section
  return (
    <Card>
      <CardContent className="p-4">
        <Typography type="label" className="font-semibold mb-3">{title}</Typography>
        <div>{children}</div>
      </CardContent>
    </Card>
  );
}

function ConfigViewer({ project }: { project: SupportProject }) {
  const [viewMode, setViewMode] = useState<'visual' | 'json'>('visual');
  const config = project.config as Record<string, unknown> | null;

  return (
    <div className="space-y-4">
      {/* View Mode Toggle */}
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          color={viewMode === 'visual' ? 'primary' : 'outline'}
          onClick={() => setViewMode('visual')}
        >
          Visual
        </Button>
        <Button
          size="sm"
          color={viewMode === 'json' ? 'primary' : 'outline'}
          onClick={() => setViewMode('json')}
        >
          JSON
        </Button>
      </div>

      {viewMode === 'visual' ? (
        <div className="space-y-4">
          {/* Project Metadata */}
          <ConfigSection title="Project Metadata">
            <ConfigItem label="Project ID" value={project.id} />
            <ConfigItem label="Display Name" value={project.displayName} />
            <ConfigItem label="Description" value={project.description || '(none)'} />
            <ConfigItem label="Created" value={new Date(project.createdAt).toLocaleString()} />
            <ConfigItem label="Updated" value={project.updatedAt ? new Date(project.updatedAt).toLocaleString() : 'N/A'} />
            <ConfigItem label="Production Mode" value={project.isProductionMode} type="boolean" />
            <ConfigItem label="Users" value={project.userCount} />
            <ConfigItem label="Teams" value={project.teamCount} />
            <ConfigItem label="Stripe Account" value={project.stripeAccountId} />
            <ConfigItem label="Owner Team ID" value={project.ownerTeamId} />
          </ConfigSection>

          {/* Authentication Settings - uses flat snake_case keys */}
          {config && (
            <ConfigSection title="Authentication">
              <ConfigItem label="Sign Up Enabled" value={config.sign_up_enabled} type="boolean" />
              <ConfigItem label="Password Auth" value={config.credential_enabled} type="boolean" />
              <ConfigItem label="Magic Link / OTP" value={config.magic_link_enabled} type="boolean" />
              <ConfigItem label="Passkey" value={config.passkey_enabled} type="boolean" />
              <ConfigItem label="Allow Localhost" value={config.allow_localhost} type="boolean" />
              <ConfigItem label="OAuth Merge" value={config.oauth_account_merge_strategy} />
            </ConfigSection>
          )}

          {/* OAuth Providers */}
          {config && (
            <ConfigSection title="OAuth Providers">
              <ConfigItem
                label="Providers"
                value={Array.isArray(config.oauth_providers)
                  ? config.oauth_providers.map((p: unknown) => (p as Record<string, unknown>).id)
                  : undefined}
                type="list"
              />
            </ConfigSection>
          )}

          {/* Team Settings */}
          {config && (
            <ConfigSection title="Teams">
              <ConfigItem label="Create on Sign Up" value={config.create_team_on_sign_up} type="boolean" />
              <ConfigItem label="Client Creation" value={config.client_team_creation_enabled} type="boolean" />
              <ConfigItem label="Team API Keys" value={config.allow_team_api_keys} type="boolean" />
            </ConfigSection>
          )}

          {/* User Settings */}
          {config && (
            <ConfigSection title="Users">
              <ConfigItem label="Client Deletion" value={config.client_user_deletion_enabled} type="boolean" />
              <ConfigItem label="User API Keys" value={config.allow_user_api_keys} type="boolean" />
            </ConfigSection>
          )}

          {/* Email Settings */}
          {config && (
            <ConfigSection title="Email">
              <ConfigItem label="Email Theme" value={config.email_theme} />
              <ConfigItem label="Email Config" value={config.email_config} type="json" />
            </ConfigSection>
          )}

          {/* Domains */}
          {config && (
            <ConfigSection title="Domains">
              <ConfigItem label="Domains" value={config.domains} type="json" />
            </ConfigSection>
          )}

          {/* Raw Config Override (for debugging) */}
          {project.configOverride !== null && project.configOverride !== undefined ? (
            <ConfigSection title="Raw Config Override (Debug)">
              <Typography variant="secondary" className="text-xs mb-2">
                Only the settings explicitly changed from defaults (stored in DB).
              </Typography>
              <pre className="text-xs overflow-auto max-h-48 bg-muted p-3 rounded">
                {JSON.stringify(project.configOverride, null, 2)}
              </pre>
            </ConfigSection>
          ) : null}
        </div>
      ) : (
        <div className="space-y-4 overflow-hidden">
          {/* Full JSON Config */}
          <Card>
            <CardContent className="p-4 space-y-3 overflow-hidden">
              <Typography type="label" className="font-semibold">Full Rendered Configuration</Typography>
              <Typography variant="secondary" className="text-xs">
                Complete config with all defaults and overrides applied.
              </Typography>
              <pre className="text-xs overflow-auto max-h-[500px] bg-muted p-3 rounded break-all whitespace-pre-wrap">
                {JSON.stringify(project.config, null, 2)}
              </pre>
            </CardContent>
          </Card>

          {/* Raw Override JSON */}
          {project.configOverride !== null && project.configOverride !== undefined ? (
            <Card>
              <CardContent className="p-4 space-y-3">
                <Typography type="label" className="font-semibold text-muted-foreground">Raw Config Override</Typography>
                <Typography variant="secondary" className="text-xs">
                  Only explicitly changed settings (stored in database).
                </Typography>
                <pre className="text-xs overflow-auto max-h-48 bg-muted p-3 rounded break-all whitespace-pre-wrap">
                  {JSON.stringify(project.configOverride, null, 2)}
                </pre>
              </CardContent>
            </Card>
          ) : null}
        </div>
      )}
    </div>
  );
}

function UserCard({ user, onClick }: { user: SupportUser, onClick: () => void }) {
  return (
    <Card className="cursor-pointer hover:bg-muted/50 transition-colors hover:transition-none" onClick={onClick}>
      <CardContent className="p-3">
        <div className="flex items-center justify-between">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <Typography type="label" className="font-medium truncate">
                {user.displayName ?? 'Unnamed User'}
              </Typography>
              {user.isAnonymous && (
                <Badge variant="secondary" className="text-xs">Anonymous</Badge>
              )}
            </div>
            <Typography variant="secondary" className="text-xs truncate">
              {user.primaryEmail ?? user.id}
            </Typography>
          </div>
          <CaretRightIcon className="h-4 w-4 text-muted-foreground" />
        </div>
        <div className="flex items-center gap-2 mt-2 flex-wrap">
          {user.authMethods.map((method) => (
            <Badge key={method} variant="outline" className="text-xs">
              {method}
            </Badge>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function TeamCard({ team, onClick }: { team: SupportTeam, onClick: () => void }) {
  return (
    <Card className="cursor-pointer hover:bg-muted/50 transition-colors hover:transition-none" onClick={onClick}>
      <CardContent className="p-3">
        <div className="flex items-center justify-between">
          <div className="flex-1 min-w-0">
            <Typography type="label" className="font-medium truncate">
              {team.displayName}
            </Typography>
            <Typography variant="secondary" className="text-xs">
              {team.memberCount} member{team.memberCount !== 1 ? 's' : ''}
            </Typography>
          </div>
          <CaretRightIcon className="h-4 w-4 text-muted-foreground" />
        </div>
      </CardContent>
    </Card>
  );
}

function EventCard({ event }: { event: SupportEvent }) {
  // Clean up event types for display (remove $ prefix)
  const eventTypeDisplay = event.eventTypes
    .map(t => t.replace(/^\$/, ''))
    .join(', ');

  return (
    <Card>
      <CardContent className="p-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <Typography type="label" className="font-medium text-sm">
              {eventTypeDisplay || 'Unknown Event'}
            </Typography>
            <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
              <ClockIcon className="h-3 w-3" />
              <span>{fromNow(new Date(event.eventStartedAt))}</span>
              {event.ipInfo && (
                <>
                  <GlobeIcon className="h-3 w-3 ml-2" />
                  <span>
                    {event.ipInfo.cityName && `${event.ipInfo.cityName}, `}
                    {event.ipInfo.countryCode ?? event.ipInfo.ip}
                  </span>
                </>
              )}
            </div>
            {event.data.userId && (
              <Typography variant="secondary" className="text-xs font-mono mt-1 truncate">
                User: {event.data.userId}
              </Typography>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function UserDetailPanel({
  user,
  projectId,
  getHeaders,
  baseApiUrl,
  onSelectTeam,
}: {
  user: SupportUser,
  projectId: string,
  getHeaders: () => Promise<Record<string, string>>,
  baseApiUrl: string,
  onSelectTeam: (team: SupportTeam) => void,
}) {
  const [isLoadingTeam, setIsLoadingTeam] = useState<string | null>(null);

  const handleTeamClick = async (teamIdToFind: string) => {
    setIsLoadingTeam(teamIdToFind);
    try {
      const headers = await getHeaders();
      const response = await fetch(
        `${baseApiUrl}/api/v1/internal/support/projects/${projectId}/teams?teamId=${teamIdToFind}`,
        { headers }
      );
      if (response.ok) {
        const data = await response.json();
        const team = data.items[0];
        if (team) {
          onSelectTeam(team);
        } else {
          toast({ variant: "destructive", title: "Team not found" });
        }
      } else {
        toast({ variant: "destructive", title: "Failed to fetch team details" });
      }
    } catch {
      toast({ variant: "destructive", title: "Failed to fetch team details" });
    } finally {
      setIsLoadingTeam(null);
    }
  };

  return (
    <ScrollArea className="h-full">
      <div className="p-4 space-y-6">
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Typography type="label" className="text-lg font-bold">
              {user.displayName ?? 'Unnamed User'}
            </Typography>
            {user.isAnonymous && (
              <Badge variant="secondary">Anonymous</Badge>
            )}
            {user.primaryEmailVerified && (
              <Badge variant="default" className="bg-green-600">Verified</Badge>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <InfoItem label="User ID" value={user.id} mono copyable />
            <InfoItem label="Email" value={user.primaryEmail ?? 'None'} copyable={!!user.primaryEmail} />
            <InfoItem label="Created" value={fromNow(new Date(user.createdAt))} />
            <InfoItem label="Teams" value={String(user.teams.length)} />
            <InfoItem label="Project" value={projectId} mono copyable />
          </div>
        </div>

        <Separator />

        <div className="space-y-2">
          <Typography type="label" className="text-sm font-medium">Auth Methods</Typography>
          <div className="flex flex-wrap gap-2">
            {user.authMethods.length === 0 ? (
              <Typography variant="secondary">None</Typography>
            ) : (
              user.authMethods.map((method) => (
                <Badge key={method} variant="outline">{method}</Badge>
              ))
            )}
          </div>
        </div>

        {user.teams.length > 0 && (
          <>
            <Separator />
            <div className="space-y-2">
              <Typography type="label" className="text-sm font-medium">Teams - Click to view details</Typography>
              {user.teams.map((team) => (
                <Card
                  key={team.id}
                  className="cursor-pointer hover:bg-muted/50 transition-colors hover:transition-none"
                  onClick={() => runAsynchronouslyWithAlert(handleTeamClick(team.id))}
                >
                  <CardContent className="p-3 flex items-center justify-between">
                    <div>
                      <Typography type="label" className="font-medium">
                        {team.displayName}
                      </Typography>
                      <Typography variant="secondary" className="text-xs font-mono">
                        {team.id}
                      </Typography>
                    </div>
                    {isLoadingTeam === team.id ? (
                      <Skeleton className="h-4 w-4 rounded-full" />
                    ) : (
                      <CaretRightIcon className="h-4 w-4 text-muted-foreground" />
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          </>
        )}

        {(user.clientMetadata !== null || user.serverMetadata !== null) && (
          <>
            <Separator />
            <div className="space-y-2">
              <Typography type="label" className="text-sm font-medium">Metadata</Typography>
              <Tabs defaultValue="client">
                <TabsList>
                  <TabsTrigger value="client">Client</TabsTrigger>
                  <TabsTrigger value="server">Server</TabsTrigger>
                </TabsList>
                <TabsContent value="client">
                  <pre className="text-xs overflow-auto max-h-48 bg-muted p-3 rounded mt-2">
                    {JSON.stringify(user.clientMetadata, null, 2)}
                  </pre>
                </TabsContent>
                <TabsContent value="server">
                  <pre className="text-xs overflow-auto max-h-48 bg-muted p-3 rounded mt-2">
                    {JSON.stringify(user.serverMetadata, null, 2)}
                  </pre>
                </TabsContent>
              </Tabs>
            </div>
          </>
        )}
      </div>
    </ScrollArea>
  );
}

function TeamDetailPanel({
  team,
  projectId,
  getHeaders,
  baseApiUrl,
  onSelectUser,
}: {
  team: SupportTeam,
  projectId: string,
  getHeaders: () => Promise<Record<string, string>>,
  baseApiUrl: string,
  onSelectUser: (user: SupportUser) => void,
}) {
  const [isLoadingMember, setIsLoadingMember] = useState<string | null>(null);

  const handleMemberClick = async (userIdToFind: string) => {
    setIsLoadingMember(userIdToFind);
    try {
      const headers = await getHeaders();
      const response = await fetch(
        `${baseApiUrl}/api/v1/internal/support/projects/${projectId}/users?userId=${userIdToFind}`,
        { headers }
      );
      if (response.ok) {
        const data = await response.json();
        const user = data.items[0];
        if (user) {
          onSelectUser(user);
        } else {
          toast({ variant: "destructive", title: "User not found" });
        }
      } else {
        toast({ variant: "destructive", title: "Failed to fetch user details" });
      }
    } catch {
      toast({ variant: "destructive", title: "Failed to fetch user details" });
    } finally {
      setIsLoadingMember(null);
    }
  };

  return (
    <ScrollArea className="h-full">
      <div className="p-4 space-y-6">
        <div className="space-y-3">
          <Typography type="label" className="text-lg font-bold">
            {team.displayName}
          </Typography>

          <div className="grid grid-cols-2 gap-3">
            <InfoItem label="Team ID" value={team.id} mono copyable />
            <InfoItem label="Created" value={fromNow(new Date(team.createdAt))} />
            <InfoItem label="Members" value={String(team.memberCount)} />
            <InfoItem label="Project" value={projectId} mono copyable />
          </div>
        </div>

        <Separator />

        <div className="space-y-2">
          <Typography type="label" className="text-sm font-medium">
            Members ({team.memberCount}) - Click to view details
          </Typography>
          {team.members.map((member) => (
            <Card
              key={member.userId}
              className="cursor-pointer hover:bg-muted/50 transition-colors hover:transition-none"
              onClick={() => runAsynchronouslyWithAlert(handleMemberClick(member.userId))}
            >
              <CardContent className="p-3 flex items-center justify-between">
                <div>
                  <Typography type="label" className="font-medium">
                    {member.displayName ?? 'Unnamed'}
                  </Typography>
                  <Typography variant="secondary" className="text-xs">
                    {member.email ?? member.userId}
                  </Typography>
                </div>
                {isLoadingMember === member.userId ? (
                  <Skeleton className="h-4 w-4 rounded-full" />
                ) : (
                  <CaretRightIcon className="h-4 w-4 text-muted-foreground" />
                )}
              </CardContent>
            </Card>
          ))}
          {team.memberCount > 5 && (
            <Typography variant="secondary" className="text-center text-xs">
              + {team.memberCount - 5} more members
            </Typography>
          )}
        </div>

        {(team.clientMetadata !== null || team.serverMetadata !== null) && (
          <>
            <Separator />
            <div className="space-y-2">
              <Typography type="label" className="text-sm font-medium">Metadata</Typography>
              <Tabs defaultValue="client">
                <TabsList>
                  <TabsTrigger value="client">Client</TabsTrigger>
                  <TabsTrigger value="server">Server</TabsTrigger>
                </TabsList>
                <TabsContent value="client">
                  <pre className="text-xs overflow-auto max-h-48 bg-muted p-3 rounded mt-2">
                    {JSON.stringify(team.clientMetadata, null, 2)}
                  </pre>
                </TabsContent>
                <TabsContent value="server">
                  <pre className="text-xs overflow-auto max-h-48 bg-muted p-3 rounded mt-2">
                    {JSON.stringify(team.serverMetadata, null, 2)}
                  </pre>
                </TabsContent>
              </Tabs>
            </div>
          </>
        )}
      </div>
    </ScrollArea>
  );
}

function InfoItem({
  label,
  value,
  mono,
  copyable
}: {
  label: string,
  value: string,
  mono?: boolean,
  copyable?: boolean,
}) {
  const handleCopy = async () => {
    await navigator.clipboard.writeText(value);
    toast({ variant: "success", title: "Copied to clipboard" });
  };

  return (
    <div className="space-y-0.5">
      <Typography variant="secondary" className="text-xs uppercase tracking-wide">
        {label}
      </Typography>
      <div className="flex items-center gap-1">
        <Typography
          className={`text-sm truncate ${mono ? 'font-mono' : ''}`}
          title={value}
        >
          {value}
        </Typography>
        {copyable && (
          <Button
            variant="ghost"
            size="icon"
            className="h-5 w-5 flex-shrink-0"
            onClick={(e) => {
              e.stopPropagation();
              runAsynchronouslyWithAlert(handleCopy());
            }}
          >
            <svg className="h-3 w-3" viewBox="0 0 16 16" fill="currentColor">
              <path d="M0 6.75C0 5.784.784 5 1.75 5h1.5a.75.75 0 0 1 0 1.5h-1.5a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-1.5a.75.75 0 0 1 1.5 0v1.5A1.75 1.75 0 0 1 9.25 16h-7.5A1.75 1.75 0 0 1 0 14.25Z" />
              <path d="M5 1.75C5 .784 5.784 0 6.75 0h7.5C15.216 0 16 .784 16 1.75v7.5A1.75 1.75 0 0 1 14.25 11h-7.5A1.75 1.75 0 0 1 5 9.25Zm1.75-.25a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25Z" />
            </svg>
          </Button>
        )}
      </div>
    </div>
  );
}
