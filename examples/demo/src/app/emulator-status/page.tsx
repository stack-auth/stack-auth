'use client';

import { runAsynchronously } from '@stackframe/stack-shared/dist/utils/promises';
import { Card, CardContent, CardHeader, Typography } from '@stackframe/stack-ui';
import { useCallback, useEffect, useState } from 'react';

type ServiceResult = {
  name: string;
  description: string;
  port: number;
  status: 'up' | 'down';
  latencyMs: number;
};

type StatusResponse = {
  timestamp: string;
  services: ServiceResult[];
  summary: { total: number; up: number; down: number };
};

function StatusDot({ status }: { status: 'up' | 'down' | 'checking' }) {
  const color = status === 'up'
    ? 'bg-emerald-500'
    : status === 'down'
      ? 'bg-red-500'
      : 'bg-yellow-400 animate-pulse';
  return (
    <span className={`inline-block w-3 h-3 rounded-full ${color}`} />
  );
}

function ServiceRow({ service }: { service: ServiceResult }) {
  return (
    <div className="flex items-center justify-between py-3 px-4 border-b last:border-b-0 dark:border-gray-800">
      <div className="flex items-center gap-3">
        <StatusDot status={service.status} />
        <div>
          <span className="font-medium text-sm">{service.name}</span>
          <span className="text-xs text-gray-500 dark:text-gray-400 ml-2">{service.description}</span>
        </div>
      </div>
      <div className="flex items-center gap-4 text-xs text-gray-500 dark:text-gray-400">
        <span className="font-mono">:{service.port}</span>
        {service.status === 'up' && (
          <span className="text-emerald-600 dark:text-emerald-400">{service.latencyMs}ms</span>
        )}
        <span className={`px-2 py-0.5 rounded font-medium ${
          service.status === 'up'
            ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300'
            : 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300'
        }`}>
          {service.status === 'up' ? 'Online' : 'Offline'}
        </span>
      </div>
    </div>
  );
}

export default function EmulatorStatusPage() {
  const [data, setData] = useState<StatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(true);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/emulator-status', { cache: 'no-store' });
      const json = await res.json();
      setData(json as StatusResponse);
    } catch {
      // keep last known state
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    runAsynchronously(fetchStatus());
    if (!autoRefresh) return;
    const interval = setInterval(() => {
      runAsynchronously(fetchStatus());
    }, 5000);
    return () => clearInterval(interval);
  }, [fetchStatus, autoRefresh]);

  const summary = data?.summary;
  const allUp = summary != null && summary.down === 0;

  return (
    <div className="flex flex-col items-center justify-start w-full p-6 gap-6">
      <div className="max-w-2xl w-full space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <Typography type="h3">Local Emulator Status</Typography>
            <Typography className="text-sm text-gray-500 dark:text-gray-400">
              Monitoring services in the all-in-one dependencies container
            </Typography>
          </div>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-xs text-gray-500 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={autoRefresh}
                onChange={(e) => setAutoRefresh(e.target.checked)}
                className="rounded"
              />
              Auto-refresh
            </label>
            <button
              onClick={() => runAsynchronously(fetchStatus())}
              disabled={loading}
              className="text-xs px-3 py-1.5 rounded border dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-50"
            >
              Refresh
            </button>
          </div>
        </div>

        <Card>
          <CardContent className="py-4">
            {loading && !data ? (
              <div className="flex items-center gap-3">
                <StatusDot status="checking" />
                <Typography className="text-sm">Checking services...</Typography>
              </div>
            ) : summary ? (
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <StatusDot status={allUp ? 'up' : 'down'} />
                  <Typography className="text-sm font-medium">
                    {allUp
                      ? 'All services operational'
                      : `${summary.down} of ${summary.total} services are offline`}
                  </Typography>
                </div>
                <div className="flex items-center gap-4 text-xs text-gray-500">
                  <span className="text-emerald-600 dark:text-emerald-400 font-medium">{summary.up} up</span>
                  {summary.down > 0 && (
                    <span className="text-red-600 dark:text-red-400 font-medium">{summary.down} down</span>
                  )}
                  <span>updated {new Date(data.timestamp).toLocaleTimeString()}</span>
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <Typography type="h4">Services</Typography>
          </CardHeader>
          <CardContent className="p-0">
            {data?.services.map((svc) => (
              <ServiceRow key={svc.name} service={svc} />
            ))}
            {!data && loading && (
              <div className="p-4 text-center text-sm text-gray-400">Loading...</div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <Typography type="h4">Quick Start</Typography>
          </CardHeader>
          <CardContent className="space-y-3">
            <Typography className="text-sm">Start the QEMU local emulator:</Typography>
            <pre className="bg-gray-100 dark:bg-gray-900 rounded p-3 text-xs font-mono overflow-x-auto">
              {`# Pull the latest image and start the emulator
pnpm run emulator:start

# Check service health
pnpm run emulator:status

# Stop (data is preserved)
pnpm run emulator:stop

# Reset for a fresh boot
pnpm run emulator:reset`}
            </pre>
            <Typography className="text-sm text-gray-500">
              Dashboard: localhost:26700 | Backend: localhost:26701
            </Typography>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
