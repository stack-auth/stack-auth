"use client";

import { useStackApp, useUser } from "@stackframe/stack";
import { runAsynchronously } from "@stackframe/stack-shared/dist/utils/promises";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

type LogEntry = {
  time: number;
  msg: string;
  ok: boolean;
};

export function FallbackTestClient() {
  const app = useStackApp();
  const user = useUser();
  const pathname = usePathname();
  const [log, setLog] = useState<LogEntry[]>([]);
  const [running, setRunning] = useState(false);
  const renderCount = useRef(0);
  renderCount.current++;

  const addLog = useCallback((msg: string, ok: boolean) => {
    setLog(prev => [...prev, { time: Date.now(), msg, ok }]);
  }, []);

  const runTests = useCallback(async () => {
    setLog([]);
    setRunning(true);

    // Test 1: getProject
    {
      const start = Date.now();
      try {
        const project = await app.getProject();
        addLog(`getProject: ${project.id} (${Date.now() - start}ms)`, true);
      } catch (e: any) {
        addLog(`getProject FAILED: ${e.message?.slice(0, 80)} (${Date.now() - start}ms)`, false);
      }
    }

    // Test 2: useUser
    addLog(`useUser: ${user ? user.primaryEmail ?? user.id : "(not signed in)"}`, true);

    // Test 3: 5x getProject to show sticky latency
    {
      const times: number[] = [];
      for (let i = 0; i < 5; i++) {
        const start = Date.now();
        try {
          await app.getProject();
          times.push(Date.now() - start);
        } catch {
          times.push(-1);
        }
      }
      const avg = times.filter(t => t >= 0).reduce((a, b) => a + b, 0) / times.filter(t => t >= 0).length;
      addLog(`getProject x5: [${times.map(t => t >= 0 ? `${t}ms` : "FAIL").join(", ")}] avg=${Math.round(avg)}ms`, times.every(t => t >= 0));
    }

    setRunning(false);
  }, [app, user, addLog]);

  useEffect(() => {
    runAsynchronously(runTests());
  }, []);  // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div>
      <section style={{ marginBottom: 24, padding: 16, background: "#f0f8ff", borderRadius: 8 }}>
        <h2 style={{ marginTop: 0 }}>Client-side</h2>

        <div style={{ marginBottom: 12, fontSize: 12, color: "#666" }}>
          <strong>Debug:</strong> renders={renderCount.current} | pathname={pathname}
        </div>

        <div style={{ marginBottom: 16, fontFamily: "monospace", fontSize: 13, lineHeight: 1.8 }}>
          {log.map((entry, i) => (
            <div key={i} style={{ color: entry.ok ? "#2a7" : "#c33" }}>
              {entry.ok ? "OK" : "ERR"} {entry.msg}
            </div>
          ))}
          {log.length === 0 && <div style={{ color: "#999" }}>Running...</div>}
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button onClick={() => void runTests()} disabled={running} style={{ padding: "6px 14px", cursor: running ? "wait" : "pointer" }}>
            {running ? "Running..." : "Re-run"}
          </button>
        </div>
      </section>

      <section style={{ padding: 16, background: "#fff8f0", borderRadius: 8 }}>
        <h2 style={{ marginTop: 0 }}>SPA Navigation Test</h2>
        <p style={{ fontSize: 13, color: "#666" }}>
          Click these links (client-side navigation) and come back.
          If sticky fallback persists, requests after navigating back should still be fast.
        </p>
        <div style={{ display: "flex", gap: 12 }}>
          <Link href="/" style={{ color: "#06c" }}>Home</Link>
          <Link href="/fallback-test" style={{ color: "#06c" }}>This page (reload)</Link>
          <Link href="/settings" style={{ color: "#06c" }}>Settings</Link>
        </div>
      </section>
    </div>
  );
}
