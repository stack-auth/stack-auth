import { HexclaveAssertionError } from "@hexclave/shared/dist/utils/errors";

export const dynamic = "force-dynamic";

export function GET() {
  throw new HexclaveAssertionError(`Server debug error thrown successfully!`);
}
