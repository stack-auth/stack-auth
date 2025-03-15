import { ContactChannelsCrud } from "@stackframe/stack-shared/dist/interface/crud/contact-channels";


export type ContactChannel = {
  id: string,
  value: string,
  type: 'email',
  isPrimary: boolean,
  isVerified: boolean,
  usedForAuth: boolean,

  sendVerificationEmail(): Promise<void>,
  update(data: ContactChannelUpdateOptions): Promise<void>,
  delete(): Promise<void>,
}

export type ContactChannelCreateOptions = {
  value: string,
  type: 'email',
  usedForAuth: boolean,
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

export type ContactChannelUpdateOptions = {
  usedForAuth?: boolean,
  value?: string,
  isPrimary?: boolean,
}

export function contactChannelUpdateOptionsToCrud(options: ContactChannelUpdateOptions): ContactChannelsCrud["Client"]["Update"] {
  return {
    value: options.value,
    used_for_auth: options.usedForAuth,
    is_primary: options.isPrimary,
  };
}

export type ServerContactChannel = ContactChannel & {
  update(data: ServerContactChannelUpdateOptions): Promise<void>,
}
export type ServerContactChannelUpdateOptions = ContactChannelUpdateOptions & {
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

export type ServerContactChannelCreateOptions = ContactChannelCreateOptions & {
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
