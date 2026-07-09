"use client";

import { cn } from "@/components/ui";
import { SidebarSimpleIcon } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { AppEnabledGuard } from "../app-enabled-guard";
import { PageLayout } from "../page-layout";
import { CopilotPane } from "./components/copilot-pane";
import { InboxPane } from "./components/inbox-pane";
import { ThreadPane } from "./components/thread-pane";
import { DEMO_CONVERSATIONS, getConversation } from "./fixtures";
import { useDemoPlayback } from "./use-demo-playback";

const PANEL_SHELL_CLASS =
  "flex-1 min-h-0 overflow-hidden rounded-xl bg-white/90 ring-1 ring-black/[0.06] dark:bg-background/60 dark:ring-white/[0.06]";
const RESIZE_HANDLE_CLASS =
  "w-px bg-black/[0.08] transition-colors duration-150 hover:bg-black/[0.14] hover:transition-none dark:bg-border/40 dark:hover:bg-border";

export default function PageClient() {
  const demo = useDemoPlayback();
  const [selectedId, setSelectedId] = useState(DEMO_CONVERSATIONS[0].id);
  const [copilotOpen, setCopilotOpen] = useState(true);
  const selected = getConversation(selectedId) ?? DEMO_CONVERSATIONS[0];
  const playback = demo.stateFor(selected.id);

  // Scripted conversations play out when opened; the returned canceller keeps
  // StrictMode's double-mount and mid-script switches from leaking timers.
  const startScript = demo.startScript;
  useEffect(() => startScript(selectedId), [startScript, selectedId]);

  return (
    <AppEnabledGuard appId="support">
      <PageLayout fillWidth noPadding containedHeight>
        <div className="flex min-h-0 flex-1 flex-col gap-3 px-4 py-4 sm:px-6">
          <PanelGroup direction="horizontal" className={PANEL_SHELL_CLASS} autoSaveId="support-demo-panes">
            <Panel defaultSize={24} minSize={18} className="min-h-0 max-lg:hidden">
              <InboxPane
                conversations={DEMO_CONVERSATIONS}
                playbackFor={demo.stateFor}
                incidentTripped={demo.incidentTripped}
                selectedId={selected.id}
                onSelect={setSelectedId}
              />
            </Panel>
            <PanelResizeHandle className={cn(RESIZE_HANDLE_CLASS, "max-lg:hidden")} />
            <Panel defaultSize={48} minSize={30} className="min-h-0">
              <ThreadPane
                conversation={selected}
                playback={playback}
                demo={demo}
                headerExtra={(
                  <button
                    type="button"
                    onClick={() => setCopilotOpen((prev) => !prev)}
                    title={copilotOpen ? "Hide copilot" : "Show copilot"}
                    className="hidden shrink-0 rounded-md p-1.5 text-muted-foreground/50 transition-colors hover:bg-foreground/[0.04] hover:text-foreground/80 lg:block"
                  >
                    <SidebarSimpleIcon className={cn("h-3.5 w-3.5", copilotOpen && "text-foreground/70")} />
                  </button>
                )}
              />
            </Panel>
            {copilotOpen && (
              <>
                <PanelResizeHandle className={cn(RESIZE_HANDLE_CLASS, "max-lg:hidden")} />
                <Panel defaultSize={28} minSize={22} className="min-h-0 max-lg:hidden">
                  <CopilotPane
                    key={selected.id}
                    conversation={selected}
                    revealedDossierFields={playback.revealedDossierFields}
                    onThreadEffect={(body) => demo.appendSystemMessage(selected.id, body)}
                  />
                </Panel>
              </>
            )}
          </PanelGroup>
        </div>
      </PageLayout>
    </AppEnabledGuard>
  );
}
