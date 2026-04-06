import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

type ServiceCheck = {
  name: string;
  description: string;
  port: number;
  protocol: 'http' | 'tcp';
  httpPath?: string;
};

const SERVICES: ServiceCheck[] = [
  {
    name: 'Stack Dashboard',
    description: 'Dashboard UI',
    port: 26700,
    protocol: 'http',
    httpPath: '/handler/sign-in',
  },
  {
    name: 'Stack Backend',
    description: 'API server',
    port: 26701,
    protocol: 'http',
    httpPath: '/health?db=1',
  },
  {
    name: 'MinIO (S3)',
    description: 'Object storage',
    port: 26702,
    protocol: 'http',
    httpPath: '/minio/health/live',
  },
  {
    name: 'Inbucket (HTTP)',
    description: 'Email capture UI',
    port: 26703,
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

export async function GET() {
  const results = await Promise.all(
    SERVICES.map(async (svc) => {
      const check = await checkHttp(svc.port, svc.httpPath ?? '/');
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
