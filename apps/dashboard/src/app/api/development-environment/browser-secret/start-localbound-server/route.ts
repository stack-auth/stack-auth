import { startRemoteDevelopmentEnvironmentBrowserSecretLocalboundServer } from "@/lib/remote-development-environment/browser-secret";
import { NextRequest } from "next/server";


export async function POST(req: NextRequest) {
  return await startRemoteDevelopmentEnvironmentBrowserSecretLocalboundServer(req);
}
