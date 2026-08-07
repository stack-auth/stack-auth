import { HexclaveAssertionError } from "@hexclave/shared/dist/utils/errors";
import { ZodError } from "zod";
import { RAW_CONNECTOR_CORPUS } from "./corpus";
import { connectorDefinitionSchema, type ConnectorDefinition } from "./schema";

function parseDefinition(raw: unknown, index: number): ConnectorDefinition {
  try {
    return connectorDefinitionSchema.parse(raw);
  } catch (error) {
    if (error instanceof ZodError) {
      const issue = error.issues.at(0);
      throw new HexclaveAssertionError(
        `Invalid mined connector at corpus index ${index}: ${issue?.path.join(".") ?? "unknown field"}: ${issue?.message ?? "invalid value"}`,
      );
    }
    throw error;
  }
}

export const ESTUARY_CONNECTOR_DEFINITIONS = RAW_CONNECTOR_CORPUS.map(parseDefinition);

const BY_ID = new Map(ESTUARY_CONNECTOR_DEFINITIONS.map(definition => [definition.id, definition]));
if (BY_ID.size !== ESTUARY_CONNECTOR_DEFINITIONS.length) {
  throw new HexclaveAssertionError("The mined connector corpus contains duplicate connector ids");
}

export function getEstuaryConnectorDefinition(id: string): ConnectorDefinition | null {
  return BY_ID.get(id) ?? null;
}

import.meta.vitest?.describe("v2.1 connector corpus", () => {
  import.meta.vitest?.test("loads every mined connector without transforming it", ({ expect }) => {
    expect(ESTUARY_CONNECTOR_DEFINITIONS).toHaveLength(96);
    expect(BY_ID.size).toBe(96);
    expect(ESTUARY_CONNECTOR_DEFINITIONS.reduce((sum, definition) => sum + definition.streams.length, 0)).toBe(1012);
  });

  import.meta.vitest?.test("preserves the corrected auth-tier distribution", ({ expect }) => {
    const counts = new Map<string, number>();
    for (const definition of ESTUARY_CONNECTOR_DEFINITIONS) {
      counts.set(definition.authTierOverall, (counts.get(definition.authTierOverall) ?? 0) + 1);
    }
    expect(Object.fromEntries(counts)).toEqual({
      T1_SIMPLE: 81,
      T3_BYO_REFRESH: 10,
      T2_BYO_APP: 5,
    });
  });
});
