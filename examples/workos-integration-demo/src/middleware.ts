import { authkitMiddleware } from "@workos-inc/authkit-nextjs";
import { getWorkOSRedirectUri } from "./lib/workos";

export default authkitMiddleware({
  debug: true,
  redirectUri: getWorkOSRedirectUri(),
});

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
