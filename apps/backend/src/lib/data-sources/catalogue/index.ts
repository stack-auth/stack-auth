import { HexclaveAssertionError, StatusError } from "@hexclave/shared/dist/utils/errors";
import { stringCompare } from "@hexclave/shared/dist/utils/strings";
import { evaluateConnectorCapability, type ConnectorCapability, type RunnableConnector } from "./capabilities";
import { ESTUARY_CONNECTOR_DEFINITIONS } from "./load";
import { LOCAL_FIXTURE_CONNECTOR } from "./local-fixture";
import type { ConnectorDefinition } from "./schema";

export const ALL_CONNECTORS: ConnectorDefinition[] = [
  ...ESTUARY_CONNECTOR_DEFINITIONS,
  LOCAL_FIXTURE_CONNECTOR,
].sort((a, b) => stringCompare(a.displayName, b.displayName));

const BY_ID = new Map(ALL_CONNECTORS.map(definition => [definition.id, definition]));
if (BY_ID.size !== ALL_CONNECTORS.length) {
  throw new HexclaveAssertionError("The connector catalogue contains duplicate ids");
}

const CAPABILITIES = new Map(
  ALL_CONNECTORS.map(definition => [definition.id, evaluateConnectorCapability(definition)]),
);

export function getConnector(connectorId: string): ConnectorDefinition | null {
  return BY_ID.get(connectorId) ?? null;
}

export function getConnectorOrThrow(connectorId: string): ConnectorDefinition {
  const definition = getConnector(connectorId);
  if (definition == null) throw new StatusError(StatusError.BadRequest, `Unknown data source connector: ${connectorId}`);
  return definition;
}

export function getConnectorCapability(connectorId: string): ConnectorCapability | null {
  return CAPABILITIES.get(connectorId) ?? null;
}

export function getRunnableConnector(connectorId: string): RunnableConnector | null {
  const capability = getConnectorCapability(connectorId);
  return capability?.status === "supported" ? capability.runnable : null;
}

export function getRunnableConnectorOrThrow(connectorId: string): RunnableConnector {
  const definition = getConnectorOrThrow(connectorId);
  const capability = getConnectorCapability(connectorId);
  if (capability == null || capability.status === "unsupported") {
    const reason = capability?.reasons.join("; ") ?? "runtime capability was not evaluated";
    throw new StatusError(
      StatusError.BadRequest,
      `Connector "${definition.displayName}" cannot run yet: ${reason}.`,
    );
  }
  return capability.runnable;
}

export function listCatalogueConnectors(): RunnableConnector[] {
  return ALL_CONNECTORS.flatMap(definition => {
    const capability = CAPABILITIES.get(definition.id);
    return capability?.status === "supported" ? [capability.runnable] : [];
  });
}

export function listAllConnectors(): ConnectorDefinition[] {
  return ALL_CONNECTORS;
}

export function getCatalogueStats() {
  const runnable = listCatalogueConnectors();
  return {
    total: ALL_CONNECTORS.length,
    connectable: runnable.length,
    exposed: runnable.length,
    streams: ALL_CONNECTORS.reduce((sum, connector) => sum + connector.streams.length, 0),
    runnable_streams: runnable.reduce((sum, connector) => sum + connector.streams.length, 0),
  };
}

import.meta.vitest?.describe("connector catalogue", () => {
  import.meta.vitest?.test("uses the v2.1 corpus as its source of truth", ({ expect }) => {
    const stats = getCatalogueStats();
    expect(stats.total).toBe(97);
    expect(stats.streams).toBe(1013);
    expect(stats.connectable).toBeGreaterThan(0);
    expect(stats.connectable).toBeLessThan(stats.total);
  });

  import.meta.vitest?.test("every exposed connector has executable streams", ({ expect }) => {
    for (const connector of listCatalogueConnectors()) {
      expect(connector.credentialMode.tier).toBe("T1_SIMPLE");
      expect(connector.streams.length).toBeGreaterThan(0);
      expect(connector.transport.spec.baseUrl).not.toBeNull();
      for (const stream of connector.streams) {
        expect(stream.supportedSyncModes.length).toBeGreaterThan(0);
      }
    }
  });

  import.meta.vitest?.test("continuous connectors remain catalogued but fail closed", ({ expect }) => {
    expect(getConnector("kinesis")?.execution.mode).toBe("log");
    expect(getRunnableConnector("kinesis")).toBeNull();
    expect(getConnectorCapability("kinesis")).toEqual(expect.objectContaining({
      status: "unsupported",
      reasons: expect.arrayContaining(["continuous/log execution is not implemented"]),
    }));
  });
});
