import { getSignInUrl } from "@workos-inc/authkit-nextjs";
import { redirect } from "next/navigation";

export async function GET() {
  redirect(await getSignInUrl({ redirectUri: "http://localhost:8110/auth/callback" }));
}
