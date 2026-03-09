export class CliError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CliError";
  }
}

export class AuthError extends CliError {
  constructor(message: string) {
    super(message);
    this.name = "AuthError";
  }
}
