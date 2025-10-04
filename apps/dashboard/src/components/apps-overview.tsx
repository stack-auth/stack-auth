"use client";

import { useAdminApp } from "@/app/(main)/(protected)/projects/[projectId]/use-admin-app";
import { Link } from "@/components/link";
import { getIntegrations, getRegularApps } from "@/lib/apps";
import { Button } from "@stackframe/stack-ui";
import { ChevronDown, ChevronUp, ExternalLink, Plus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import {
  DndContext,
  DragEndEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  arrayMove,
  rectSortingStrategy,
  SortableContext,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

interface AppsOverviewProps {
  projectId: string;
}

/** A single app tile */
function AppTile({
  id,
  name,
  Icon,
}: {
  id: string;
  name: string;
  Icon: React.ComponentType<{ size?: number | string; className?: string }>;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <li ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <div className={`tile p-4 sm:p-5 flex items-center gap-3 ${isDragging ? "tile--dragging" : ""}`}>
        <div className="h-10 w-10 rounded-xl border border-gray-200 dark:border-white/15 bg-gray-100 dark:bg-white/5 flex items-center justify-center flex-shrink-0">
          <Icon size={20} className="opacity-85 text-gray-700 dark:text-gray-300" />
        </div>
        <span className="text-sm font-medium leading-none text-gray-900 dark:text-white truncate">{name}</span>
      </div>
    </li>
  );
}

export function AppsOverview({ projectId }: AppsOverviewProps) {
  const stackAdminApp = useAdminApp();
  const project = stackAdminApp.useProject();
  const config = project.useConfig();

  const registry = useMemo(() => [...getRegularApps(), ...getIntegrations()], []);
  const installed = (config?.apps?.installed ?? {}) as Record<string, { enabled?: boolean }>;

  // Local state: enabled & disabled ids (keeps UI snappy, save afterwards)
  const [enabled, setEnabled] = useState<string[]>([]);
  const [disabled, setDisabled] = useState<string[]>([]);
  const [showDisabled, setShowDisabled] = useState(false);

  useEffect(() => {
    const enabledIds: string[] = [];
    const disabledIds: string[] = [];
    for (const app of registry) {
      (installed[app.id]?.enabled ? enabledIds : disabledIds).push(app.id);
    }
    setEnabled(enabledIds);
    setDisabled(disabledIds);
  }, [registry, installed]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over) return;

    const sourceList = enabled.includes(active.id as string) ? "enabled" : "disabled";
    const targetList = enabled.includes(over.id as string)
      ? "enabled"
      : disabled.includes(over.id as string)
      ? "disabled"
      : sourceList;

    // same list reordering
    if (sourceList === targetList) {
      const list = sourceList === "enabled" ? enabled : disabled;
      const oldIndex = list.indexOf(active.id as string);
      const newIndex = list.indexOf(over.id as string);
      const moved = arrayMove(list, oldIndex, newIndex);
      sourceList === "enabled" ? setEnabled(moved) : setDisabled(moved);
      return;
    }

    // cross-list move
    if (sourceList === "enabled") {
      setEnabled((l) => l.filter((x) => x !== active.id));
      setDisabled((l) => [active.id as string, ...l]);
      saveEnablement(active.id as string, false);
    } else {
      setDisabled((l) => l.filter((x) => x !== active.id));
      setEnabled((l) => [active.id as string, ...l]);
      saveEnablement(active.id as string, true);
    }
  };

  /** TODO: wire this to your backend/config update */
  function saveEnablement(appId: string, enabled: boolean) {
    // implement a real mutation here (optimistic UI already applied)
    // e.g., stackAdminApp.updateProjectConfig({ apps: { installed: { [appId]: { enabled }}}})
    // keep it debounced if you expect many moves
    // no-op for now
  }

  const byId = Object.fromEntries(registry.map((a) => [a.id, a]));

  return (
    <div className="bg-card border rounded-2xl overflow-hidden">
      <DndContext sensors={sensors} onDragEnd={onDragEnd}>
        {/* Card Header */}
        <div className="p-4 sm:p-6 border-b border-gray-200/50 dark:border-white/10">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-semibold tracking-tight text-gray-900 dark:text-white">Apps</h3>
            <div className="flex items-center gap-2">
              <Link href={`/projects/${projectId}/apps/explore`}>
                <Button size="sm" className="rounded-full bg-blue-600 hover:bg-blue-700 text-white">
                  <Plus size={16} className="mr-1.5" />
                  Add New
                </Button>
              </Link>
              <Link href={`/projects/${projectId}/apps/explore`}>
                <Button variant="ghost" size="sm" className="rounded-full text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200">
                  <ExternalLink size={16} />
                </Button>
              </Link>
            </div>
          </div>
        </div>

        {/* Card Content */}
        <div className="p-4 sm:p-6">
          {/* ENABLED Section */}
          <div className="mb-6">
            <div className="text-xs font-medium tracking-[0.18em] text-gray-700 dark:text-white/70 mb-3 sm:mb-4">
              ENABLED
            </div>
            {enabled.length ? (
              <SortableContext items={enabled} strategy={rectSortingStrategy}>
                <ul className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 sm:gap-4">
                  {enabled.map((id) => {
                    const app = byId[id];
                    if (!app) return null;
                    const Icon = app.icon;
                    return <AppTile key={id} id={id} name={app.displayName} Icon={Icon} />;
                  })}
                </ul>
              </SortableContext>
            ) : (
              <div className="text-sm text-gray-600 dark:text-white/60 py-6">No apps enabled yet. Drag from below or click <span className="underline">Add New</span>.</div>
            )}
          </div>

          {/* Toggle button for disabled apps */}
          {disabled.length > 0 && (
            <div className="flex justify-center mb-4">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowDisabled(!showDisabled)}
                className="text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-white/5 rounded-full px-4 py-2"
              >
                {showDisabled ? (
                  <>
                    <ChevronUp size={16} className="mr-1.5" />
                    Hide Disabled Apps
                  </>
                ) : (
                  <>
                    <ChevronDown size={16} className="mr-1.5" />
                    Show Disabled Apps ({disabled.length})
                  </>
                )}
              </Button>
            </div>
          )}

          {/* DISABLED Section - Only show when toggled */}
          {showDisabled && (
            <div className="border-t border-gray-200/50 dark:border-white/10 pt-6">
              <div className="text-xs font-medium tracking-[0.18em] text-gray-500 dark:text-white/50 mb-3 sm:mb-4">
                DISABLED
              </div>
              <SortableContext items={disabled} strategy={rectSortingStrategy}>
                <ul className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 sm:gap-4">
                  {disabled.map((id) => {
                    const app = byId[id];
                    if (!app) return null;
                    const Icon = app.icon;
                    return <AppTile key={id} id={id} name={app.displayName} Icon={Icon} />;
                  })}
                </ul>
              </SortableContext>
            </div>
          )}
        </div>
      </DndContext>
    </div>
  );
}
