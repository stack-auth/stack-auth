import { captureError } from "@hexclave/shared/dist/utils/errors";
import { Client, type ClientConfig } from "pg";

type PostgresClientErrorHandler = (error: Error) => void;

export function createObservedPostgresClient(
  config: ClientConfig,
  errorLocation: string,
  onError: PostgresClientErrorHandler = (error) => captureError(errorLocation, error),
): Client {
  const client = new Client(config);

  // node-postgres treats an EventEmitter "error" without a listener as fatal to
  // the whole process. Connection loss is reported through the application error
  // sink instead, while the caller still owns connect/query/end failures.
  client.on("error", onError);
  return client;
}
