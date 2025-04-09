import { userApiKeyCreateHandler, userApiKeyCrudHandlers } from "../handlers";

export const GET = userApiKeyCrudHandlers.listHandler;
export const POST = userApiKeyCreateHandler;
