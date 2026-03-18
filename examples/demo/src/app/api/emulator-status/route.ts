import { NextResponse } from 'next/server';
import net from 'net';

export const dynamic = 'force-dynamic';

const PORT_PREFIX = process.env.NEXT_PUBLIC_STACK_PORT_PREFIX ?? '81';

type ServiceCheck = {
  name: string;
  description: string;
  port: number;
  protocol: 'http' | 'tcp';
  httpPath?: string;
};

const SERVICES: ServiceCheck[] = [
  {
    name: 'PostgreSQL',
    description: 'Primary database',
    port: Number(`${PORT_PREFIX}28`),
    protocol: 'tcp',
  },
  {
    name: 'Inbucket (HTTP)',
    description: 'Email capture UI',
    port: Number(`${PORT_PREFIX}05`),
    protocol: 'http',
    httpPath: '/',
  },
  {
    name: 'Inbucket (SMTP)',
    description: 'Email SMTP server',
    port: Number(`${PORT_PREFIX}29`),
    protocol: 'tcp',
  },
  {
    name: 'Svix',
    description: 'Webhook delivery',
    port: Number(`${PORT_PREFIX}13`),
    protocol: 'http',
    httpPath: '/api/v1/health/',
  },
  {
    name: 'ClickHouse',
    description: 'Analytics database',
    port: Number(`${PORT_PREFIX}36`),
    protocol: 'http',
    httpPath: '/ping',
  },
  {
    name: 'MinIO (S3)',
    description: 'Object storage',
    port: Number(`${PORT_PREFIX}21`),
    protocol: 'http',
    httpPath: '/minio/health/live',
  },
  {
    name: 'QStash',
    description: 'Job queue',
    port: Number(`${PORT_PREFIX}25`),
    protocol: 'http',
    httpPath: '/',
  },
  {
    name: 'Stack Backend',
    description: 'API server',
    port: Number(`${PORT_PREFIX}02`),
    protocol: 'http',
    httpPath: '/',
  },
  {
    name: 'Stack Dashboard',
    description: 'Dashboard UI',
    port: Number(`${PORT_PREFIX}01`),
    protocol: 'http',
    httpPath: '/',
  },
];

async function checkHttp(port: number, path: string, timeoutMs = 3000): Promise<{ up: boolean; latencyMs: number }> {
  const start = performance.now();
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(`http://127.0.0.1:${port}${path}`, { signal: controller.signal });
    clearTimeout(timeout);
    return { up: res.ok || res.status < 500, latencyMs: Math.round(performance.now() - start) };
  } catch {
    return { up: false, latencyMs: Math.round(performance.now() - start) };
  }
}

async function checkTcp(port: number, timeoutMs = 3000): Promise<{ up: boolean; latencyMs: number }> {
  const start = performance.now();
  return await new Promise((resolve) => {
    const socket = net.createConnection({ host: '127.0.0.1', port }, () => {
      socket.destroy();
      resolve({ up: true, latencyMs: Math.round(performance.now() - start) });
    });
    socket.on('error', () => resolve({ up: false, latencyMs: Math.round(performance.now() - start) }));
    socket.setTimeout(timeoutMs, () => {
      socket.destroy();
      resolve({ up: false, latencyMs: Math.round(performance.now() - start) });
    });
  });
}

export async function GET() {
  const results = await Promise.all(
    SERVICES.map(async (svc) => {
      const check = svc.protocol === 'http'
        ? await checkHttp(svc.port, svc.httpPath ?? '/')
        : await checkTcp(svc.port);
      return {
        name: svc.name,
        description: svc.description,
        port: svc.port,
        status: check.up ? 'up' as const : 'down' as const,
        latencyMs: check.latencyMs,
      };
    })
  );

  return NextResponse.json({
    timestamp: new Date().toISOString(),
    services: results,
    summary: {
      total: results.length,
      up: results.filter((r) => r.status === 'up').length,
      down: results.filter((r) => r.status === 'down').length,
    },
  });
}
