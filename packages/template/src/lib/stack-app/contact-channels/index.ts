import { ContactChannelsCrud } from "@stackframe/stack-shared/dist/interface/crud/contact-channels";

/**
 * Represents a user's contact information for authentication.
 *
 * Basic information about a contact channel, as seen by a user themselves.
 * Usually obtained by calling `user.listContactChannels()` or `user.useContactChannels()`.
 */
export type ContactChannel = {
  /**
   * The id of the contact channel as a string.
   */
  id: string,

  /**
   * The value of the contact channel. If type is "email", this is an email address.
   */
  value: string,

  /**
   * The type of the contact channel. Currently always "email".
   */
  type: 'email',

  /**
   * Indicates whether the contact channel is the user's primary contact channel.
   * If an email is set to primary, it will be the value on the `user.primaryEmail` field.
   */
  isPrimary: boolean,

  /**
   * Indicates whether the contact channel is verified.
   */
  isVerified: boolean,

  /**
   * Indicates whether the contact channel is used for authentication.
   * If set to `true`, the user can use this contact channel with OTP or password to sign in.
   */
  usedForAuth: boolean,

  /**
   * Sends a verification email to this contact channel.
   * Once the user clicks the verification link in the email, the contact channel will be marked as verified.
   *
   * @param options - Optional parameters
   * @param options.callbackUrl - URL to redirect to after verification
   */
  sendVerificationEmail(options?: { callbackUrl?: string }): Promise<void>,

  /**
   * Updates the contact channel.
   * After updating the value, the contact channel will be marked as unverified.
   *
   * @param data - The properties to update
   */
  update(data: ContactChannelUpdateOptions): Promise<void>,

  /**
   * Deletes the contact channel.
   */
  delete(): Promise<void>,
}

/**
 * Options for creating a new contact channel.
 */
export type ContactChannelCreateOptions = {
  /**
   * The value of the contact channel (e.g., email address).
   */
  value: string,

  /**
   * The type of contact channel. Currently always "email".
   */
  type: 'email',

  /**
   * Whether this contact channel can be used for authentication.
   */
  usedForAuth: boolean,

  /**
   * Whether this should be set as the user's primary contact channel.
   */
  isPrimary?: boolean,
}

export function contactChannelCreateOptionsToCrud(userId: string, options: ContactChannelCreateOptions): ContactChannelsCrud["Client"]["Create"] {
  return {
    value: options.value,
    type: options.type,
    used_for_auth: options.usedForAuth,
    is_primary: options.isPrimary,
    user_id: userId,
  };
}

/**
 * Options for updating a contact channel.
 */
export type ContactChannelUpdateOptions = {
  /**
   * Whether this contact channel can be used for authentication.
   */
  usedForAuth?: boolean,

  /**
   * The new value of the contact channel.
   */
  value?: string,

  /**
   * Whether this should be set as the user's primary contact channel.
   */
  isPrimary?: boolean,
}

export function contactChannelUpdateOptionsToCrud(options: ContactChannelUpdateOptions): ContactChannelsCrud["Client"]["Update"] {
  return {
    value: options.value,
    used_for_auth: options.usedForAuth,
    is_primary: options.isPrimary,
  };
}

/**
 * Like `ContactChannel`, but includes additional methods and properties that require the `SECRET_SERVER_KEY`.
 *
 * Usually obtained by calling `serverUser.listContactChannels()` or `serverUser.useContactChannels()`.
 */
export type ServerContactChannel = ContactChannel & {
  /**
   * Updates the contact channel.
   *
   * This method is similar to the one on `ContactChannel`, but also allows setting the `isVerified` property.
   *
   * @param data - The properties to update
   */
  update(data: ServerContactChannelUpdateOptions): Promise<void>,
}

/**
 * Options for updating a contact channel on the server.
 * Extends `ContactChannelUpdateOptions` with server-only properties.
 */
export type ServerContactChannelUpdateOptions = ContactChannelUpdateOptions & {
  /**
   * Whether the contact channel should be marked as verified.
   * Only available in server-side operations.
   */
  isVerified?: boolean,
}

export function serverContactChannelUpdateOptionsToCrud(options: ServerContactChannelUpdateOptions): ContactChannelsCrud["Server"]["Update"] {
  return {
    value: options.value,
    is_verified: options.isVerified,
    used_for_auth: options.usedForAuth,
    is_primary: options.isPrimary,
  };
}

/**
 * Options for creating a new contact channel on the server.
 * Extends `ContactChannelCreateOptions` with server-only properties.
 */
export type ServerContactChannelCreateOptions = ContactChannelCreateOptions & {
  /**
   * Whether the contact channel should be marked as verified upon creation.
   * Only available in server-side operations.
   */
  isVerified?: boolean,
}
export function serverContactChannelCreateOptionsToCrud(userId: string, options: ServerContactChannelCreateOptions): ContactChannelsCrud["Server"]["Create"] {
  return {
    type: options.type,
    value: options.value,
    is_verified: options.isVerified,
    user_id: userId,
    used_for_auth: options.usedForAuth,
    is_primary: options.isPrimary,
  };
}
