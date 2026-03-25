import { emailOutboxCrudHandlers } from "../crud";

export const GET = emailOutboxCrudHandlers.readHandler;
export const PATCH = emailOutboxCrudHandlers.updateHandler;

