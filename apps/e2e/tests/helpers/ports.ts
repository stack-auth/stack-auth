const getPortPrefix = () => process.env.STACK_PORT_PREFIX ?? "81";

/**
 * Returns the port with the configured prefix and provided suffix.
 */
export const withPortPrefix = (suffix: string) => `${getPortPrefix()}${suffix}`;

/**
 * Builds a localhost URL using the configured port prefix.
 */
export const localhostUrl = (suffix: string, path = "") =>
  `http://localhost:${withPortPrefix(suffix)}${path}`;
