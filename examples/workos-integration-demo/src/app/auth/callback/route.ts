import { handleAuth } from "@workos-inc/authkit-nextjs";
import { getWorkOSBaseUrl } from "../../../lib/workos";

export const GET = handleAuth({
  baseURL: getWorkOSBaseUrl(),
});
