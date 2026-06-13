import { NextResponse } from "next/server";
import { hexclaveServerApp } from "src/hexclave";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readCount(value: unknown): number {
  if (!isRecord(value)) {
    return 1;
  }

  const count = value.count;
  if (count === undefined) {
    return 1;
  }
  if (typeof count !== "number" || !Number.isInteger(count) || count < 1 || count > 10) {
    throw new Error("count must be an integer between 1 and 10.");
  }
  return count;
}

export async function POST(request: Request) {
  const user = await hexclaveServerApp.getUser({ or: "throw" });
  const body: unknown = await request.json();
  const count = readCount(body);

  for (let i = 0; i < count; i++) {
    await hexclaveServerApp.sendEmail({
      userIds: [user.id],
      subject: `Payments demo quota test ${i + 1}/${count}`,
      html: `<p>Payments demo quota test email ${i + 1} of ${count}.</p>`,
    });
  }

  return NextResponse.json({
    sent: count,
    userId: user.id,
  });
}
