/// <reference types="@prisma/client" />

declare global {
  namespace NodeJS {
    interface ProcessEnv {
      STACK_DATABASE_CONNECTION_STRING: string;
      STACK_DIRECT_DATABASE_CONNECTION_STRING?: string;
    }
  }
}

export {};
