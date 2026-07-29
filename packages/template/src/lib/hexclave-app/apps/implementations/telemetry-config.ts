import { snapshotTelemetryResource, type TelemetryResource } from "@hexclave/shared/dist/utils/analytics-wire";

export type { TelemetryResource } from "@hexclave/shared/dist/utils/analytics-wire";

export type TelemetryOptions = {
  /**
   * Immutable identity of the application process/page producing telemetry.
   * Required whenever Analytics or Observability delivery is enabled.
   */
  resource?: TelemetryResource,
  /**
   * Serverless keep-alive hook shared by Analytics and Observability delivery.
   * It is intentionally omitted when an app is serialized across runtimes.
   */
  waitUntil?: (promise: Promise<unknown>) => void,
};

export function snapshotTelemetryOptions(options: TelemetryOptions | undefined): TelemetryOptions | undefined {
  if (options === undefined) return undefined;
  return {
    ...options,
    ...options.resource === undefined ? {} : { resource: snapshotTelemetryResource(options.resource) },
  };
}

export function telemetryOptionsToJson(options: TelemetryOptions | undefined): TelemetryOptions | undefined {
  if (options?.resource === undefined) return undefined;
  return { resource: snapshotTelemetryResource(options.resource) };
}

export function telemetryOptionsFromJson(options: TelemetryOptions | undefined): TelemetryOptions | undefined {
  return options;
}

export function requireTelemetryResource(options: TelemetryOptions | undefined): TelemetryResource {
  const resource = options?.resource;
  if (resource === undefined) {
    throw new Error("Hexclave telemetry: telemetry.resource with service.name is required when Analytics or Observability is enabled");
  }
  return snapshotTelemetryResource(resource);
}
