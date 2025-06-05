'use client';
import { baseOptions } from '@/app/layout.config';
import { usePathname } from 'fumadocs-core/framework';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { useMemo, useState } from 'react';
import { getCurrentPlatform, getPlatformUrl, PLATFORMS } from '../../lib/platform-utils';
import { useDynamicNavigation } from '../dynamic-navigation';
import type { Option } from '../layout/root-toggle';
import { SidebarItem, SidebarSeparator } from '../layout/sidebar';
import { DocsLayout, type DocsLayoutProps } from './docs';

interface DynamicDocsLayoutProps extends Omit<DocsLayoutProps, 'links'> {
  children: ReactNode;
}

function getPlatformDisplayName(platform: string): string {
  const platformNames: Record<string, string> = {
    'next': 'Next.js',
    'react': 'React',
    'js': 'JavaScript', 
    'python': 'Python'
  };
  return platformNames[platform] || platform;
}

// HTTP Method Badge Component
function HttpMethodBadge({ method }: { method: 'GET' | 'POST' | 'PATCH' | 'DELETE' | 'PUT' }) {
  const getBadgeStyles = (method: string) => {
    switch (method) {
      case 'GET':
        return 'bg-green-100 text-green-800 border-green-200 dark:bg-green-900/30 dark:text-green-300 dark:border-green-700';
      case 'POST':
        return 'bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-700';
      case 'PATCH':
      case 'PUT':
        return 'bg-orange-100 text-orange-800 border-orange-200 dark:bg-orange-900/30 dark:text-orange-300 dark:border-orange-700';
      case 'DELETE':
        return 'bg-red-100 text-red-800 border-red-200 dark:bg-red-900/30 dark:text-red-300 dark:border-red-700';
      default:
        return 'bg-gray-100 text-gray-800 border-gray-200 dark:bg-gray-900/30 dark:text-gray-300 dark:border-gray-700';
    }
  };

  return (
    <span className={`inline-flex items-center justify-center px-0.5 py-0.5 rounded-md text-xs font-medium border ${getBadgeStyles(method)} leading-none w-14 flex-shrink-0`}>
      {method}
    </span>
  );
}

// Enhanced SidebarItem with badge
function SidebarItemWithBadge({ 
  href, 
  method, 
  children 
}: { 
  href: string; 
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE' | 'PUT'; 
  children: ReactNode; 
}) {
  return (
    <SidebarItem href={href}>
      <div className="flex items-start gap-2 w-full py-0.5">
        <HttpMethodBadge method={method} />
        <span className="text-sm flex-1 leading-snug">{children}</span>
      </div>
    </SidebarItem>
  );
}

// Helper function to check if we're in a specific section that should use page tree navigation
function isInSpecificSection(pathname: string): boolean {
  const sectionPatterns = [
    /\/docs\/pages-\w+\/components(?:\/|$)/,  // components section
    /\/docs\/pages-\w+\/sdk(?:\/|$)/,        // sdk section  
    // Note: API section is handled separately, not included here
  ];
  
  return sectionPatterns.some(pattern => pattern.test(pathname));
}

// Helper function to check if we're in the shared API docs
function isInApiSection(pathname: string): boolean {
  return /\/docs\/api(?:\/|$)/.test(pathname);
}

// Helper function to check if we're in the customization section
function isInCustomizationSection(pathname: string): boolean {
  return /\/docs\/pages-\w+\/customization(?:\/|$)/.test(pathname);
}

// Custom collapsible section component
function CollapsibleSection({ 
  title, 
  children, 
  defaultOpen = false 
}: { 
  title: string; 
  children: ReactNode; 
  defaultOpen?: boolean; 
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  
  return (
    <div className="space-y-1">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 w-full text-left px-2 py-1.5 text-sm font-medium text-fd-muted-foreground hover:text-fd-foreground transition-colors"
      >
        {isOpen ? (
          <ChevronDown className="h-3 w-3" />
        ) : (
          <ChevronRight className="h-3 w-3" />
        )}
        {title}
      </button>
      {isOpen && (
        <div className="ml-4 space-y-1">
          {children}
        </div>
      )}
    </div>
  );
}

// Custom sidebar content for components section
function ComponentsSidebarContent() {
  const pathname = usePathname();
  const currentPlatform = getCurrentPlatform(pathname);
  
  if (!currentPlatform) return null;

  const baseUrl = `/docs/pages-${currentPlatform}/components`;

  return (
    <div className="space-y-1 mt-6 pt-4 border-t border-fd-border/30">
      <SidebarItem href={`${baseUrl}/overview`}>
        Overview
      </SidebarItem>
      
      <SidebarSeparator>
        Authentication
      </SidebarSeparator>
      <SidebarItem href={`${baseUrl}/sign-in`}>
        Sign In
      </SidebarItem>
      <SidebarItem href={`${baseUrl}/sign-up`}>
        Sign Up
      </SidebarItem>
      <SidebarItem href={`${baseUrl}/credential-sign-in`}>
        Credential Sign In
      </SidebarItem>
      <SidebarItem href={`${baseUrl}/credential-sign-up`}>
        Credential Sign Up
      </SidebarItem>
      <SidebarItem href={`${baseUrl}/magic-link-sign-in`}>
        Magic Link Sign In
      </SidebarItem>
      <SidebarItem href={`${baseUrl}/forgot-password`}>
        Forgot Password
      </SidebarItem>
      <SidebarItem href={`${baseUrl}/password-reset`}>
        Password Reset
      </SidebarItem>

      <SidebarSeparator>
        OAuth
      </SidebarSeparator>
      <SidebarItem href={`${baseUrl}/oauth-button`}>
        OAuth Button
      </SidebarItem>
      <SidebarItem href={`${baseUrl}/oauth-button-group`}>
        OAuth Button Group
      </SidebarItem>

      <SidebarSeparator>
        User Interface
      </SidebarSeparator>
      <SidebarItem href={`${baseUrl}/user-button`}>
        User Button
      </SidebarItem>
      <SidebarItem href={`${baseUrl}/account-settings`}>
        Account Settings
      </SidebarItem>
      <SidebarItem href={`${baseUrl}/selected-team-switcher`}>
        Selected Team Switcher
      </SidebarItem>

      <SidebarSeparator>
        Layout & Providers
      </SidebarSeparator>
      <SidebarItem href={`${baseUrl}/stack-provider`}>
        Stack Provider
      </SidebarItem>
      <SidebarItem href={`${baseUrl}/stack-handler`}>
        Stack Handler
      </SidebarItem>
      <SidebarItem href={`${baseUrl}/stack-theme`}>
        Stack Theme
      </SidebarItem>
    </div>
  );
}

// Custom sidebar content for API section
function ApiSidebarContent() {
  return (
    <div className="space-y-1">
      <SidebarItem href="/docs/api/overview">
        Overview
      </SidebarItem>
      
      <SidebarSeparator>Client API</SidebarSeparator>
      
      <CollapsibleSection title="Anonymous">
        <SidebarItemWithBadge href="/docs/api/client/anonymous/sign-up" method="POST">
          Sign Up
        </SidebarItemWithBadge>
      </CollapsibleSection>
      
      <CollapsibleSection title="API Keys">
        <SidebarItemWithBadge href="/docs/api/client/api-keys/user-api-keys-get" method="GET">
          List User API Keys
        </SidebarItemWithBadge>
        <SidebarItemWithBadge href="/docs/api/client/api-keys/user-api-keys-post" method="POST">
          Create User API Key
        </SidebarItemWithBadge>
        <SidebarItemWithBadge href="/docs/api/client/api-keys/api-key-id-get" method="GET">
          Get User API Key
        </SidebarItemWithBadge>
        <SidebarItemWithBadge href="/docs/api/client/api-keys/api-key-id-patch" method="PATCH">
          Update User API Key
        </SidebarItemWithBadge>
        <SidebarItemWithBadge href="/docs/api/client/api-keys/team-api-keys-get" method="GET">
          List Team API Keys
        </SidebarItemWithBadge>
        <SidebarItemWithBadge href="/docs/api/client/api-keys/team-api-keys-post" method="POST">
          Create Team API Key
        </SidebarItemWithBadge>
        <SidebarItemWithBadge href="/docs/api/client/api-keys/api-key-id-get-1" method="GET">
          Get Team API Key
        </SidebarItemWithBadge>
        <SidebarItemWithBadge href="/docs/api/client/api-keys/api-key-id-patch-1" method="PATCH">
          Update Team API Key
        </SidebarItemWithBadge>
      </CollapsibleSection>
      
      <CollapsibleSection title="CLI Authentication">
        <SidebarItemWithBadge href="/docs/api/client/cli-authentication/cli" method="GET">
          CLI Authentication
        </SidebarItemWithBadge>
        <SidebarItemWithBadge href="/docs/api/client/cli-authentication/poll" method="GET">
          Poll CLI Status
        </SidebarItemWithBadge>
        <SidebarItemWithBadge href="/docs/api/client/cli-authentication/complete" method="POST">
          Complete CLI Auth
        </SidebarItemWithBadge>
      </CollapsibleSection>
      
      <CollapsibleSection title="Contact Channels">
        <SidebarItemWithBadge href="/docs/api/client/contact-channels/contact-channels-get" method="GET">
          List Contact Channels
        </SidebarItemWithBadge>
        <SidebarItemWithBadge href="/docs/api/client/contact-channels/contact-channels-post" method="POST">
          Create Contact Channel
        </SidebarItemWithBadge>
        <SidebarItemWithBadge href="/docs/api/client/contact-channels/verify" method="POST">
          Verify Email
        </SidebarItemWithBadge>
        <SidebarItemWithBadge href="/docs/api/client/contact-channels/check-code" method="POST">
          Check Verification Code
        </SidebarItemWithBadge>
        <SidebarItemWithBadge href="/docs/api/client/contact-channels/contact-channel-id-get" method="GET">
          Get Contact Channel
        </SidebarItemWithBadge>
        <SidebarItemWithBadge href="/docs/api/client/contact-channels/contact-channel-id-patch" method="PATCH">
          Update Contact Channel
        </SidebarItemWithBadge>
        <SidebarItemWithBadge href="/docs/api/client/contact-channels/contact-channel-id-delete" method="DELETE">
          Delete Contact Channel
        </SidebarItemWithBadge>
        <SidebarItemWithBadge href="/docs/api/client/contact-channels/send-verification-code" method="POST">
          Send Verification Code
        </SidebarItemWithBadge>
      </CollapsibleSection>
      
      <CollapsibleSection title="OAuth">
        <SidebarItemWithBadge href="/docs/api/client/oauth/token" method="POST">
          OAuth Token
        </SidebarItemWithBadge>
        <SidebarItemWithBadge href="/docs/api/client/oauth/provider-id" method="GET">
          OAuth Authorize
        </SidebarItemWithBadge>
      </CollapsibleSection>
      
      <CollapsibleSection title="OTP">
        <SidebarItemWithBadge href="/docs/api/client/otp/otp-sign-in" method="POST">
          OTP Sign In
        </SidebarItemWithBadge>
        <SidebarItemWithBadge href="/docs/api/client/otp/send-sign-in-code" method="POST">
          Send OTP Code
        </SidebarItemWithBadge>
        <SidebarItemWithBadge href="/docs/api/client/otp/mfa-sign-in" method="POST">
          MFA Sign In
        </SidebarItemWithBadge>
        <SidebarItemWithBadge href="/docs/api/client/otp/check-code" method="POST">
          Check OTP Code
        </SidebarItemWithBadge>
      </CollapsibleSection>
      
      <CollapsibleSection title="Password">
        <SidebarItemWithBadge href="/docs/api/client/password/password-sign-in" method="POST">
          Password Sign In
        </SidebarItemWithBadge>
        <SidebarItemWithBadge href="/docs/api/client/password/password-sign-up" method="POST">
          Password Sign Up
        </SidebarItemWithBadge>
        <SidebarItemWithBadge href="/docs/api/client/password/update" method="PATCH">
          Update Password
        </SidebarItemWithBadge>
        <SidebarItemWithBadge href="/docs/api/client/password/set" method="POST">
          Set Password
        </SidebarItemWithBadge>
        <SidebarItemWithBadge href="/docs/api/client/password/send-reset-code" method="POST">
          Send Reset Code
        </SidebarItemWithBadge>
        <SidebarItemWithBadge href="/docs/api/client/password/reset" method="POST">
          Reset Password
        </SidebarItemWithBadge>
        <SidebarItemWithBadge href="/docs/api/client/password/reset-check-code" method="POST">
          Check Reset Code
        </SidebarItemWithBadge>
      </CollapsibleSection>
      
      <CollapsibleSection title="Permissions">
        <SidebarItemWithBadge href="/docs/api/client/permissions/team-permissions" method="GET">
          Team Permissions
        </SidebarItemWithBadge>
        <SidebarItemWithBadge href="/docs/api/client/permissions/project-permissions" method="GET">
          Project Permissions
        </SidebarItemWithBadge>
      </CollapsibleSection>
      
      <CollapsibleSection title="Projects">
        <SidebarItemWithBadge href="/docs/api/client/projects/current" method="GET">
          Current Project
        </SidebarItemWithBadge>
      </CollapsibleSection>
      
      <CollapsibleSection title="Sessions">
        <SidebarItemWithBadge href="/docs/api/client/sessions/sessions" method="GET">
          Sessions Overview
        </SidebarItemWithBadge>
        <SidebarItemWithBadge href="/docs/api/client/sessions/current" method="GET">
          Current Session
        </SidebarItemWithBadge>
        <SidebarItemWithBadge href="/docs/api/client/sessions/id" method="DELETE">
          Get Session
        </SidebarItemWithBadge>
        <SidebarItemWithBadge href="/docs/api/client/sessions/refresh" method="POST">
          Refresh Session
        </SidebarItemWithBadge>
      </CollapsibleSection>
      
      <CollapsibleSection title="Teams">
        <SidebarItemWithBadge href="/docs/api/client/teams/teams-get" method="GET">
          List Teams
        </SidebarItemWithBadge>
        <SidebarItemWithBadge href="/docs/api/client/teams/teams-post" method="POST">
          Create Team
        </SidebarItemWithBadge>
        <SidebarItemWithBadge href="/docs/api/client/teams/team-id-get" method="GET">
          Get Team
        </SidebarItemWithBadge>
        <SidebarItemWithBadge href="/docs/api/client/teams/team-id-patch" method="PATCH">
          Update Team
        </SidebarItemWithBadge>
        <SidebarItemWithBadge href="/docs/api/client/teams/team-id-delete" method="DELETE">
          Delete Team
        </SidebarItemWithBadge>
        <SidebarItemWithBadge href="/docs/api/client/teams/team-invitations" method="GET">
          Team Invitations
        </SidebarItemWithBadge>
        <SidebarItemWithBadge href="/docs/api/client/teams/team-member-profiles" method="GET">
          Team Member Profiles
        </SidebarItemWithBadge>
      </CollapsibleSection>
      
      <CollapsibleSection title="Users">
        <SidebarItemWithBadge href="/docs/api/client/users/me-get" method="GET">
          Get Current User
        </SidebarItemWithBadge>
        <SidebarItemWithBadge href="/docs/api/client/users/me-patch" method="PATCH">
          Update Current User
        </SidebarItemWithBadge>
        <SidebarItemWithBadge href="/docs/api/client/users/me-delete" method="DELETE">
          Delete Current User
        </SidebarItemWithBadge>
      </CollapsibleSection>

      <SidebarSeparator>Server API</SidebarSeparator>
      <div className="text-sm text-fd-muted-foreground px-2 py-1">
        Similar structure with server-specific endpoints...
      </div>

      <SidebarSeparator>Admin API</SidebarSeparator>
      <div className="text-sm text-fd-muted-foreground px-2 py-1">
        Similar structure with admin-specific endpoints...
      </div>

      <SidebarSeparator>Webhooks</SidebarSeparator>
      <CollapsibleSection title="Teams">
        <SidebarItem href="/docs/api/webhooks/teams/team.created">
          <div className="flex items-start gap-2 w-full py-0.5">
            <span className="inline-flex items-center px-1 py-0.5 rounded text-xs font-medium border bg-purple-100 text-purple-800 border-purple-200 dark:bg-purple-900/30 dark:text-purple-300 dark:border-purple-700 leading-none">
              EVENT
            </span>
            <span className="text-sm flex-1 leading-snug">Team Created</span>
          </div>
        </SidebarItem>
        <SidebarItem href="/docs/api/webhooks/teams/team.updated">
          <div className="flex items-start gap-2 w-full py-0.5">
            <span className="inline-flex items-center px-1 py-0.5 rounded text-xs font-medium border bg-purple-100 text-purple-800 border-purple-200 dark:bg-purple-900/30 dark:text-purple-300 dark:border-purple-700 leading-none">
              EVENT
            </span>
            <span className="text-sm flex-1 leading-snug">Team Updated</span>
          </div>
        </SidebarItem>
        <SidebarItem href="/docs/api/webhooks/teams/team.deleted">
          <div className="flex items-start gap-2 w-full py-0.5">
            <span className="inline-flex items-center px-1 py-0.5 rounded text-xs font-medium border bg-purple-100 text-purple-800 border-purple-200 dark:bg-purple-900/30 dark:text-purple-300 dark:border-purple-700 leading-none">
              EVENT
            </span>
            <span className="text-sm flex-1 leading-snug">Team Deleted</span>
          </div>
        </SidebarItem>
      </CollapsibleSection>
      
      <CollapsibleSection title="Users">
        <SidebarItem href="/docs/api/webhooks/users/user.created">
          <div className="flex items-start gap-2 w-full py-0.5">
            <span className="inline-flex items-center px-1 py-0.5 rounded text-xs font-medium border bg-purple-100 text-purple-800 border-purple-200 dark:bg-purple-900/30 dark:text-purple-300 dark:border-purple-700 leading-none">
              EVENT
            </span>
            <span className="text-sm flex-1 leading-snug">User Created</span>
          </div>
        </SidebarItem>
        <SidebarItem href="/docs/api/webhooks/users/user.updated">
          <div className="flex items-start gap-2 w-full py-0.5">
            <span className="inline-flex items-center px-1 py-0.5 rounded text-xs font-medium border bg-purple-100 text-purple-800 border-purple-200 dark:bg-purple-900/30 dark:text-purple-300 dark:border-purple-700 leading-none">
              EVENT
            </span>
            <span className="text-sm flex-1 leading-snug">User Updated</span>
          </div>
        </SidebarItem>
        <SidebarItem href="/docs/api/webhooks/users/user.deleted">
          <div className="flex items-start gap-2 w-full py-0.5">
            <span className="inline-flex items-center px-1 py-0.5 rounded text-xs font-medium border bg-purple-100 text-purple-800 border-purple-200 dark:bg-purple-900/30 dark:text-purple-300 dark:border-purple-700 leading-none">
              EVENT
            </span>
            <span className="text-sm flex-1 leading-snug">User Deleted</span>
          </div>
        </SidebarItem>
      </CollapsibleSection>
    </div>
  );
}

export function DynamicDocsLayout({ children, ...props }: DynamicDocsLayoutProps) {
  const dynamicLinks = useDynamicNavigation();
  const pathname = usePathname();
  
  const platformOptions: Option[] = useMemo(() => {
    const currentPlatform = getCurrentPlatform(pathname);
    
    return PLATFORMS.map(platform => ({
      url: getPlatformUrl(platform, currentPlatform === platform ? '' : 'overview'),
      title: getPlatformDisplayName(platform),
      description: `Stack Auth ${getPlatformDisplayName(platform)}`,
    }));
  }, [pathname]);

  // For API docs, use minimal layout without platform tabs
  if (isInApiSection(pathname)) {
    return (
      <DocsLayout 
        {...baseOptions} 
        {...props}
        links={[
          {
            type: 'custom',
            children: <ApiSidebarContent />
          }
        ]}
        sidebar={{
          ...props.sidebar,
          tabs: [], // No platform tabs for shared API docs
          // Hide the page tree when showing custom API content
          components: {
            Item: () => null,
            Folder: () => null,
            Separator: () => null,
          },
        }}
      >
        {children}
      </DocsLayout>
    );
  }

  // For customization section, use normal page tree without platform tabs
  if (isInCustomizationSection(pathname)) {
    return (
      <DocsLayout 
        {...baseOptions} 
        {...props}
        links={dynamicLinks}
        sidebar={{
          ...props.sidebar,
          tabs: [], // No platform tabs for customization section
        }}
      >
        {children}
      </DocsLayout>
    );
  }
  
  // Check if we're in a specific section
  const shouldShowMainNavigation = !isInSpecificSection(pathname);

  return (
    <DocsLayout 
      {...baseOptions} 
      {...props}
      links={shouldShowMainNavigation ? dynamicLinks : [
        // When in components section, show main navigation PLUS custom components
        ...dynamicLinks,
        {
          type: 'custom',
          children: <ComponentsSidebarContent />
        }
      ]}
      sidebar={{
        ...props.sidebar,
        tabs: platformOptions,
        // Hide the page tree when showing custom content
        components: shouldShowMainNavigation ? undefined : {
          Item: () => null,
          Folder: () => null,
          Separator: () => null,
        },
      }}
    >
      {children}
    </DocsLayout>
  );
} 
