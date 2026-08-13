import { HexclaveAssertionError } from "@hexclave/shared/dist/utils/errors";
import { connection } from "next/server";

export async function GET() {
  await connection();
  throw new HexclaveAssertionError(`Server debug error thrown successfully!`);
}
