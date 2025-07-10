import { getSoleTenancyFromProjectBranch } from "@/lib/tenancies";
import { getPrismaClientForTenancy, globalPrismaClient } from "@/prisma-client";
import { VerificationCodeType } from "@prisma/client";
import { KnownErrors } from "@stackframe/stack-shared/dist/known-errors";
import { NextRequest } from "next/server";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');
  if (!code || code.length !== 45)
    return new Response('Invalid code', { status: 400 });

  const codeLower = code.toLowerCase();
  const verificationCode = await globalPrismaClient.verificationCode.findFirst({
    where: {
      code: codeLower,
      type: VerificationCodeType.ONE_TIME_PASSWORD,
    },
  });

  if (!verificationCode) throw new KnownErrors.VerificationCodeNotFound();
  if (verificationCode.expiresAt < new Date()) throw new KnownErrors.VerificationCodeExpired();
  if (verificationCode.usedAt) {
    return new Response('<p>You have already unsubscribed from this notification group</p>', {
      status: 200,
      headers: { 'Content-Type': 'text/html' },
    });
  }
  const { user_id, notification_category_id } = verificationCode.data as { user_id: string, notification_category_id: string };

  await globalPrismaClient.verificationCode.update({
    where: {
      projectId_branchId_code: {
        projectId: verificationCode.projectId,
        branchId: verificationCode.branchId,
        code: codeLower,
      },
    },
    data: { usedAt: new Date() },
  });

  const tenancy = await getSoleTenancyFromProjectBranch(verificationCode.projectId, verificationCode.branchId);
  await getPrismaClientForTenancy(tenancy).userNotificationPreference.upsert({
    where: {
      tenancyId_projectUserId_notificationCategoryId: {
        tenancyId: tenancy.id,
        projectUserId: user_id,
        notificationCategoryId: notification_category_id,
      },
    },
    update: {
      enabled: false,
    },
    create: {
      tenancyId: tenancy.id,
      projectUserId: user_id,
      notificationCategoryId: notification_category_id,
      enabled: false,
    },
  });

  return new Response('<p>Successfully unsubscribed from notification group</p>', {
    status: 200,
    headers: { 'Content-Type': 'text/html' },
  });
}
