"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useStackApp, useUser } from "../../lib/hooks";
import { globalRegistry } from "../hooks/use-component-registry";

// IF_PLATFORM react-like

function ChecklistItem({ pass, warn, label }: { pass?: boolean; warn?: boolean; label: string }) {
  const status = pass ? 'pass' : warn ? 'warn' : 'fail';
  const icon = pass ? '\u2713' : warn ? '!' : '\u2717';
  return (
    <div className="sdt-checklist-item">
      <span className={`sdt-check-icon sdt-check-${status}`}>{icon}</span>
      <span>{label}</span>
    </div>
  );
}

function UserStatusCard() {
  const user = useUser();

  if (!user) {
    return (
      <div className="sdt-user-card">
        <div className="sdt-user-avatar">?</div>
        <div className="sdt-user-info">
          <div className="sdt-user-name">No user signed in</div>
          <div className="sdt-user-email">Sign in to see user details</div>
        </div>
        <span className="sdt-badge sdt-badge-warning">Signed Out</span>
      </div>
    );
  }

  const initials = (user.displayName || user.primaryEmail || '?')
    .split(' ')
    .map((s: string) => s[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  return (
    <div className="sdt-user-card">
      <div className="sdt-user-avatar">
        {user.profileImageUrl ? (
          <img src={user.profileImageUrl} alt="" />
        ) : (
          initials
        )}
      </div>
      <div className="sdt-user-info">
        <div className="sdt-user-name">{user.displayName || 'Anonymous'}</div>
        <div className="sdt-user-email">{user.primaryEmail || 'No email'}</div>
      </div>
      <span className="sdt-badge sdt-badge-success">Signed In</span>
    </div>
  );
}

export function OverviewTab() {
  const app = useStackApp();
  const user = useUser();
  const [componentCount, setComponentCount] = useState(globalRegistry.components.size);

  useEffect(() => {
    return globalRegistry.subscribe((components) => {
      setComponentCount(components.size);
    });
  }, []);

  const projectId = app.projectId;
  const sdkVersion = app.version;

  // Build checklist
  const checks = useMemo(() => {
    const items: { pass?: boolean; warn?: boolean; label: string }[] = [];

    items.push({
      pass: !!projectId && projectId !== 'default',
      label: `Project ID configured${projectId ? ` (${projectId})` : ''}`,
    });

    items.push({
      pass: true,
      label: 'StackProvider is mounted',
    });

    items.push({
      pass: componentCount > 0,
      warn: componentCount === 0,
      label: `${componentCount} Stack component${componentCount !== 1 ? 's' : ''} detected on page`,
    });

    items.push({
      pass: !!user,
      warn: !user,
      label: user ? 'User is authenticated' : 'No user authenticated (sign in to test auth flow)',
    });

    return items;
  }, [projectId, componentCount, user]);

  return (
    <>
      {/* Setup Checklist */}
      <div className="sdt-section">
        <div className="sdt-section-title">Setup Checklist</div>
        <div className="sdt-checklist">
          {checks.map((check, i) => (
            <ChecklistItem key={i} {...check} />
          ))}
        </div>
      </div>

      {/* User Status */}
      <div className="sdt-section">
        <div className="sdt-section-title">Current User</div>
        <UserStatusCard />
      </div>

      {/* Project Info */}
      <div className="sdt-section">
        <div className="sdt-section-title">Project Info</div>
        <div className="sdt-info-grid">
          <div className="sdt-info-card">
            <div className="sdt-info-label">Project ID</div>
            <div className="sdt-info-value sdt-info-value-mono">{projectId || 'Not set'}</div>
          </div>
          <div className="sdt-info-card">
            <div className="sdt-info-label">SDK Version</div>
            <div className="sdt-info-value sdt-info-value-mono">{sdkVersion || 'Unknown'}</div>
          </div>
          <div className="sdt-info-card">
            <div className="sdt-info-label">Environment</div>
            <div className="sdt-info-value">
              <span className="sdt-badge sdt-badge-info">Development</span>
            </div>
          </div>
          <div className="sdt-info-card">
            <div className="sdt-info-label">Components on Page</div>
            <div className="sdt-info-value">{componentCount}</div>
          </div>
        </div>
      </div>
    </>
  );
}

// END_PLATFORM
