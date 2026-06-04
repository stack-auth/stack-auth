import { branchConfigSchema, getConfigOverrideErrors } from "@hexclave/shared/dist/config/schema";
import { ITEM_IDS, PLAN_LIMITS } from "@hexclave/shared/dist/plans";
import { NextResponse } from "next/server";
import { hexclaveServerApp } from "src/hexclave";

function readValidationResult(result: Awaited<ReturnType<typeof getConfigOverrideErrors>>) {
  if (result.status === "ok") {
    return {
      accepted: true,
      error: null,
    };
  }
  return {
    accepted: false,
    error: result.error,
  };
}

export async function GET() {
  const project = await hexclaveServerApp.getProject();
  const includeByDefaultValidation = await getConfigOverrideErrors(branchConfigSchema, {
    "payments.products.paymentsDemoInvalidFree.prices": "include-by-default",
  });

  return NextResponse.json({
    projectId: project.id,
    includeByDefaultValidation: readValidationResult(includeByDefaultValidation),
    expected: {
      freePrice: "0.00",
      freeInterval: [1, "month"],
      freeEmailsPerMonth: PLAN_LIMITS.free.emailsPerMonth,
      emailItemId: ITEM_IDS.emailsPerMonth,
      emailsPerMonthRepeat: [1, "month"],
    },
  });
}
