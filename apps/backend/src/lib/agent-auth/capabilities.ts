import { getPrismaClientForTenancy } from "@/prisma-client";
import { AGENT_AUTH_DEFAULT_LIST_USERS_LIMIT } from "./constants";
import { StatusError } from "@hexclave/shared/dist/utils/errors";
import { yupNumber, yupObject } from "@hexclave/shared/dist/schema-fields";
import type { Tenancy } from "@/lib/tenancies";
import * as yup from "yup";

export type AgentCapabilityConstraint = {
  min?: number,
  max?: number,
  in?: unknown[],
  not_in?: unknown[],
};

export type AgentCapabilityGrantConstraints = Record<string, AgentCapabilityConstraint | undefined>;

export type AgentCapabilityDefinition<TInput extends Record<string, unknown>, TResult> = {
  name: string,
  description: string,
  inputSchema: yup.Schema<TInput>,
  handler: (options: { tenancy: Tenancy, prisma: Awaited<ReturnType<typeof getPrismaClientForTenancy>>, input: TInput }) => Promise<TResult>,
  constrainInput: ((input: TInput, constraints: AgentCapabilityGrantConstraints | null | undefined) => TInput) | undefined,
};

function throwConstraintViolation(message: string): never {
  throw new StatusError(StatusError.BadRequest, message);
}

function assertKnownConstraintKeys(constraint: Record<string, unknown>) {
  for (const key of Object.keys(constraint)) {
    if (!["min", "max", "in", "not_in"].includes(key)) {
      throwConstraintViolation("constraint_violated");
    }
  }
}

function normalizeConstraintValue(value: unknown): AgentCapabilityConstraint {
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    throwConstraintViolation("constraint_violated");
  }
  assertKnownConstraintKeys(value as Record<string, unknown>);
  const constraint = value as Record<string, unknown>;
  const result: AgentCapabilityConstraint = {};
  if (constraint.min != null) {
    if (typeof constraint.min !== "number") throwConstraintViolation("constraint_violated");
    result.min = constraint.min;
  }
  if (constraint.max != null) {
    if (typeof constraint.max !== "number") throwConstraintViolation("constraint_violated");
    result.max = constraint.max;
  }
  if (constraint.in != null) {
    if (!Array.isArray(constraint.in)) throwConstraintViolation("constraint_violated");
    result.in = constraint.in;
  }
  if (constraint.not_in != null) {
    if (!Array.isArray(constraint.not_in)) throwConstraintViolation("constraint_violated");
    result.not_in = constraint.not_in;
  }
  return result;
}

export function normalizeGrantConstraints(capability: string, constraints: unknown): AgentCapabilityGrantConstraints | null {
  if (constraints == null) return null;
  if (capability === "get_project_info") {
    if (typeof constraints === "object" && !Array.isArray(constraints) && Object.keys(constraints).length > 0) {
      throwConstraintViolation("constraint_violated");
    }
    return {};
  }
  if (typeof constraints !== "object" || Array.isArray(constraints)) {
    throwConstraintViolation("constraint_violated");
  }
  const result: AgentCapabilityGrantConstraints = {};
  for (const [field, value] of Object.entries(constraints as Record<string, unknown>)) {
    result[field] = normalizeConstraintValue(value);
  }
  return result;
}

function clampNumber(value: number, min?: number, max?: number): number {
  let result = value;
  if (min != null) result = Math.max(result, min);
  if (max != null) result = Math.min(result, max);
  return result;
}

function assertConstraintSatisfied(field: string, value: unknown, constraint: AgentCapabilityConstraint) {
  if (constraint.min != null && (typeof value !== "number" || value < constraint.min)) {
    throwConstraintViolation("constraint_violated");
  }
  if (constraint.max != null && (typeof value !== "number" || value > constraint.max)) {
    throwConstraintViolation("constraint_violated");
  }
  if (constraint.in != null && !constraint.in.some((candidate) => Object.is(candidate, value))) {
    throwConstraintViolation("constraint_violated");
  }
  if (constraint.not_in != null && constraint.not_in.some((candidate) => Object.is(candidate, value))) {
    throwConstraintViolation("constraint_violated");
  }
  if (field !== "limit" && (constraint.min != null || constraint.max != null)) {
    throwConstraintViolation("constraint_violated");
  }
}

function applyConstraintsForListUsers(input: { limit?: number }, constraints: AgentCapabilityGrantConstraints | null | undefined) {
  if (constraints == null || Object.keys(constraints).length === 0) {
    return {
      limit: input.limit ?? AGENT_AUTH_DEFAULT_LIST_USERS_LIMIT,
    };
  }

  for (const field of Object.keys(constraints)) {
    if (field !== "limit") {
      throwConstraintViolation("constraint_violated");
    }
  }

  const limitConstraint = constraints.limit;
  if (limitConstraint == null) return input;
  const resolvedLimit = clampNumber(input.limit ?? AGENT_AUTH_DEFAULT_LIST_USERS_LIMIT, limitConstraint.min, limitConstraint.max);
  assertConstraintSatisfied("limit", resolvedLimit, limitConstraint);
  return { limit: resolvedLimit };
}

export function validateAgentCapabilityInput<TInput extends Record<string, unknown>>(
  capability: AgentCapabilityDefinition<TInput, unknown>,
  input: unknown,
): TInput {
  try {
    return capability.inputSchema.validateSync(input, {
      abortEarly: false,
      strict: true,
    });
  } catch (error) {
    if (error instanceof yup.ValidationError) {
      throw new StatusError(StatusError.BadRequest, "invalid_capability_input");
    }
    throw error;
  }
}

export const AGENT_CAPABILITIES = {
  list_users: {
    name: "list_users",
    description: "List real ProjectUsers in the current tenancy.",
    inputSchema: yupObject({
      limit: yupNumber().integer().positive().optional(),
    }),
    constrainInput: applyConstraintsForListUsers,
    handler: async ({ tenancy, prisma, input }: {
      tenancy: Tenancy,
      prisma: Awaited<ReturnType<typeof getPrismaClientForTenancy>>,
      input: { limit?: number },
    }) => {
      const users = await prisma.projectUser.findMany({
        where: { tenancyId: tenancy.id },
        orderBy: [
          { signedUpAt: "desc" },
          { projectUserId: "asc" },
        ],
        take: input.limit ?? AGENT_AUTH_DEFAULT_LIST_USERS_LIMIT,
      });
      const primaryEmailChannels = await prisma.contactChannel.findMany({
        where: {
          tenancyId: tenancy.id,
          projectUserId: {
            in: users.map((user) => user.projectUserId),
          },
          type: "EMAIL",
          isPrimary: "TRUE",
        },
        select: {
          projectUserId: true,
          value: true,
        },
      });
      const primaryEmailByUserId = new Map(primaryEmailChannels.map((channel) => [channel.projectUserId, channel.value]));

      return {
        users: users.map((user) => ({
          id: user.projectUserId,
          display_name: user.displayName ?? null,
          primary_email: primaryEmailByUserId.get(user.projectUserId) ?? null,
          signed_up_at: user.signedUpAt.toISOString(),
        })),
      };
    },
  },
  get_project_info: {
    name: "get_project_info",
    description: "Read the current project's identifier, display name, and user count.",
    inputSchema: yupObject({}),
    constrainInput: undefined,
    handler: async ({ tenancy, prisma }) => {
      const userCount = await prisma.projectUser.count({
        where: { tenancyId: tenancy.id },
      });
      return {
        project_id: tenancy.project.id,
        display_name: tenancy.project.display_name,
        user_count: userCount,
      };
    },
  },
} as const satisfies Record<string, AgentCapabilityDefinition<Record<string, unknown>, unknown>>;

export type AgentCapabilityName = keyof typeof AGENT_CAPABILITIES;

export function getAgentCapability(name: string) {
  const capability = Object.entries(AGENT_CAPABILITIES).find(([capabilityName]) => capabilityName === name)?.[1];
  if (capability == null) {
    throwConstraintViolation("capability_not_supported");
  }
  return capability;
}

export async function executeAgentCapability(options: {
  tenancy: Tenancy,
  capabilityName: string,
  input: unknown,
  constraints: AgentCapabilityGrantConstraints | null | undefined,
}) {
  const capability = getAgentCapability(options.capabilityName);
  const prisma = await getPrismaClientForTenancy(options.tenancy);
  const validatedInput = validateAgentCapabilityInput(capability, options.input ?? {});
  const constrainedInput = capability.constrainInput
    ? capability.constrainInput(validatedInput, options.constraints)
    : validatedInput;
  return await capability.handler({
    tenancy: options.tenancy,
    prisma,
    input: constrainedInput,
  });
}
