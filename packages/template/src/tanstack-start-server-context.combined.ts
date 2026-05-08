import * as browserContext from "./tanstack-start-server-context.default";
import * as serverContext from "./tanstack-start-server-context.server";

export declare const getCookie: typeof serverContext.getCookie | typeof browserContext.getCookie;
export declare const getCookies: typeof serverContext.getCookies | typeof browserContext.getCookies;
export declare const setCookie: typeof serverContext.setCookie | typeof browserContext.setCookie;
export declare const deleteCookie: typeof serverContext.deleteCookie | typeof browserContext.deleteCookie;
export declare const getRequestHeader: typeof serverContext.getRequestHeader | typeof browserContext.getRequestHeader;
