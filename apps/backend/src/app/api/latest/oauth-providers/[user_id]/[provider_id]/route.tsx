import { oauthProviderCrudHandlers } from "../../crud";

export const GET = oauthProviderCrudHandlers.readHandler;
export const POST = oauthProviderCrudHandlers.createHandler;
export const PATCH = oauthProviderCrudHandlers.updateHandler;
export const DELETE = oauthProviderCrudHandlers.deleteHandler;
