import { KnownErrors } from "..";

const minLength = 8;
const maxLength = 70;

export function getPasswordError(password: string): KnownErrors["PasswordRequirementsNotMet"] | undefined {
  if (password.length < minLength) {
    return new KnownErrors.PasswordTooShort(minLength);
  }

  if (password.length > maxLength) {
    return new KnownErrors.PasswordTooLong(maxLength);
  }

  return undefined;
}
