import { internalPaymentsProductsCrudHandlers } from "../crud";

export const GET = internalPaymentsProductsCrudHandlers.readHandler;
export const PATCH = internalPaymentsProductsCrudHandlers.updateHandler;
export const DELETE = internalPaymentsProductsCrudHandlers.deleteHandler;
