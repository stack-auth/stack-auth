import { PrismaPg } from "@prisma/adapter-pg";
import { captureError } from "@hexclave/shared/dist/utils/errors";

type PrismaPgOptions = NonNullable<ConstructorParameters<typeof PrismaPg>[1]>;
type PrismaPgErrorHandler = (location: string, error: Error) => void;

export function createPrismaPgOptions(
  schema: string,
  poolLabel: string,
  onError: PrismaPgErrorHandler = captureError,
): PrismaPgOptions {
  return {
    schema,
    // Prisma receives a Pool created by this application. Without this option,
    // $disconnect removes Prisma's listener but deliberately leaves the pool open.
    disposeExternalPool: true,
    onPoolError: (error) => onError(`pg-pool-${poolLabel}`, error),
    onConnectionError: (error) => onError(`pg-connection-${poolLabel}`, error),
  };
}
