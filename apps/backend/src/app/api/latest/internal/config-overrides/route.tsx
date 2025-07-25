import { configOverridesCrudHandlers } from "./crud";

export const GET = configOverridesCrudHandlers.readHandler;
export const PATCH = configOverridesCrudHandlers.updateHandler;
