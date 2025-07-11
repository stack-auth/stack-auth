import { projectsCrudHandlers } from "../../../../internal/projects/current/crud";

export const GET = projectsCrudHandlers.readHandler;
export const PATCH = projectsCrudHandlers.updateHandler;
