import { subscriptionCrudHandlers } from "../crud";

export const GET = subscriptionCrudHandlers.readHandler;
export const PATCH = subscriptionCrudHandlers.updateHandler;
export const DELETE = subscriptionCrudHandlers.deleteHandler;
