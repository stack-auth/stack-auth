import { contactsCrudHandlers } from "../crud";

export const GET = contactsCrudHandlers.readHandler;
export const PATCH = contactsCrudHandlers.updateHandler;
export const DELETE = contactsCrudHandlers.deleteHandler;
