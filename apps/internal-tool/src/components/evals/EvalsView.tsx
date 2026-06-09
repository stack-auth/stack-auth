"use client";

import { useEffect, useState } from "react";
import { clsx } from "clsx";
import { runAsynchronously } from "@hexclave/shared/dist/utils/promises";
import { useEvalsDB } from "../../hooks/useEvalsDB";
import { EvalChat } from "./EvalChat";
import { RunLauncher } from "./RunLauncher";
import { RunsPanel } from "./RunsPanel";
import { WorkflowsPanel } from "./WorkflowsPanel";

type SubTab = "runs" | "workflows";

export function EvalsView() {
  const { workflows, runs, stepRuns, artifacts, connectionState, conn } = useEvalsDB();
  const [subTab, setSubTab] = useState<SubTab>("runs");
  const [showLauncher, setShowLauncher] = useState(false);
  const [showChat, setShowChat] = useState(false);

  // Seeds the built-in default workflow server-side on first visit.
  useEffect(() => {
    runAsynchronously(async () => {
      await fetch("/api/evals/workflows").catch(() => undefined);
    });
  }, []);

  return (
    <div className="flex h-[calc(100vh-57px)]">
      <div className="flex-1 min-w-0 overflow-y-auto p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="flex gap-1 bg-gray-100 rounded-lg p-0.5">
              <button
                onClick={() => setSubTab("runs")}
                className={clsx(
                  "px-3 py-1 text-xs font-medium rounded-md transition-colors",
                  subTab === "runs" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700",
                )}
              >
                Runs
              </button>
              <button
                onClick={() => setSubTab("workflows")}
                className={clsx(
                  "px-3 py-1 text-xs font-medium rounded-md transition-colors",
                  subTab === "workflows" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700",
                )}
              >
                Workflows
              </button>
            </div>
            {connectionState !== "connected" && (
              <span className="text-[11px] text-amber-600">spacetimedb: {connectionState}</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowLauncher(true)}
              className="px-3 py-1.5 text-xs font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700"
            >
              + New Run
            </button>
            <button
              onClick={() => setShowChat(open => !open)}
              className={clsx(
                "px-3 py-1.5 text-xs font-medium rounded-md ring-1",
                showChat ? "bg-gray-900 text-white ring-gray-900" : "bg-white text-gray-700 ring-gray-300 hover:bg-gray-50",
              )}
            >
              💬 Chat
            </button>
          </div>
        </div>

        {subTab === "runs" && (
          <RunsPanel runs={runs} stepRuns={stepRuns} artifacts={artifacts} conn={conn} />
        )}
        {subTab === "workflows" && (
          <WorkflowsPanel workflows={workflows} />
        )}
      </div>

      {showChat && (
        <aside className="w-[420px] shrink-0 border-l border-gray-200 bg-white">
          <EvalChat />
        </aside>
      )}

      {showLauncher && (
        <RunLauncher
          workflows={workflows}
          onClose={() => setShowLauncher(false)}
          onLaunched={() => setSubTab("runs")}
        />
      )}
    </div>
  );
}
