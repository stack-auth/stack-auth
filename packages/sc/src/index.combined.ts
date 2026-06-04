import * as def from "./index.default";
import * as reactServer from "./index.react-server";

export declare const cookies: typeof reactServer.cookies | typeof def.cookies;
export declare const headers: typeof reactServer.headers | typeof def.headers;
export declare const isReactServer: boolean;
