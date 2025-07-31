import { configOverridesCrudHandlers } from "./overrides/crud";

export const GET = configOverridesCrudHandlers.readHandler;
export const PATCH = configOverridesCrudHandlers.updateHandler;
