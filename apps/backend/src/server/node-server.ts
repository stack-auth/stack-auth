import type { Server as ElysiaServer } from "elysia/universal";
import { Server as NodeHttpServer } from "node:http";

export function getNodeServer(server: ElysiaServer): NodeHttpServer {
  if (!("raw" in server)) {
    throw new Error("Elysia did not expose the srvx server handle");
  }
  const rawServer = server.raw;
  if (typeof rawServer !== "object" || rawServer == null || !("node" in rawServer)) {
    throw new Error("srvx did not expose its Node adapter");
  }
  const nodeAdapter = rawServer.node;
  if (typeof nodeAdapter !== "object" || nodeAdapter == null || !("server" in nodeAdapter)) {
    throw new Error("srvx did not expose its Node HTTP server");
  }
  const nodeServer = nodeAdapter.server;
  if (!(nodeServer instanceof NodeHttpServer)) {
    throw new Error("srvx returned an unexpected Node HTTP server handle");
  }
  return nodeServer;
}

/**
 * Elysia's listen callback can run before Node has emitted `listening`. Waiting
 * on the raw server prevents readiness logs and shutdown state from claiming a
 * successful bind when Node rejects the requested address asynchronously.
 */
export async function waitForNodeServerToListen(server: ElysiaServer): Promise<ElysiaServer> {
  const nodeServer = getNodeServer(server);
  if (nodeServer.listening) {
    return server;
  }

  await new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      nodeServer.off("error", onError);
      nodeServer.off("listening", onListening);
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const onListening = () => {
      cleanup();
      resolve();
    };

    nodeServer.once("error", onError);
    nodeServer.once("listening", onListening);
    // Close the check/listener race in case Node began listening between the
    // initial check and listener registration.
    if (nodeServer.listening) {
      onListening();
    }
  });

  return server;
}
