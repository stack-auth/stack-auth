import { internalPaymentsPricesCrudHandlers } from "../crud";

export const GET = internalPaymentsPricesCrudHandlers.readHandler;
export const PATCH = internalPaymentsPricesCrudHandlers.updateHandler;
export const DELETE = internalPaymentsPricesCrudHandlers.deleteHandler;
