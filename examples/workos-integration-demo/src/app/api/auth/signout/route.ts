import { signOut } from "@workos-inc/authkit-nextjs";

async function handleSignOut() {
  await signOut();
  return new Response(null, { status: 204 });
}

export const GET = handleSignOut;
export const POST = handleSignOut;
