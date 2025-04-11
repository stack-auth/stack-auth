import { projectsCrudHandlers } from "./crud";

export const GET = projectsCrudHandlers.readHandler;
export const PATCH = projectsCrudHandlers.updateHandler;
export const DELETE = projectsCrudHandlers.deleteHandler;
