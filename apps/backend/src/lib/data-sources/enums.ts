/**
 * The Prisma enum values, in both directions.
 *
 * Shared so that the orchestration and the serializer cannot disagree about what
 * a stored value means — two copies of the same mapping is exactly the kind of
 * thing that stays consistent right up until a third source type is added.
 */

export const MODE_TO_PRISMA = {
  cursor: "CURSOR",
  cdc: "CDC",
} as const;

export const MODE_FROM_PRISMA = {
  CURSOR: "cursor",
  CDC: "cdc",
} as const;

export const TYPE_TO_PRISMA = {
  postgres: "POSTGRES",
  convex: "CONVEX",
} as const;

export const TYPE_FROM_PRISMA = {
  POSTGRES: "postgres",
  CONVEX: "convex",
} as const;
