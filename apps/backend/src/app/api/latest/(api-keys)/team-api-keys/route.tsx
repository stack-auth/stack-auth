import { teamApiKeyCreateHandler, teamApiKeyCrudHandlers } from "../handlers";

export const GET = teamApiKeyCrudHandlers.listHandler;
export const POST = teamApiKeyCreateHandler;
