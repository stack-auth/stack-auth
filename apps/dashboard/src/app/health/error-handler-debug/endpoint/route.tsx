import { StackAssertionError } from "@stackframe/stack-shared/utils/errors";

export const dynamic = "force-dynamic";

export function GET() {
  throw new StackAssertionError(`Server debug error thrown successfully!`);
}
