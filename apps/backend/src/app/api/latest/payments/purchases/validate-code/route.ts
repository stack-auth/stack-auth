import { NextRequest } from "next/server";
import { purchaseUrlVerificationCodeHandler } from "../verification-code-handler";

export async function POST(request: NextRequest) {
  const { code } = await request.json();
  const verificationCode = await purchaseUrlVerificationCodeHandler.validateCode(code);

  return Response.json({
    offer: verificationCode.data.offer,
    stripe_account_id: verificationCode.data.stripeAccountId,
  });
}
