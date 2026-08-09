import { authkitMiddleware } from "@workos-inc/authkit-nextjs";

export default authkitMiddleware({
  debug: true,
  redirectUri: "http://localhost:8110/auth/callback",
});

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
