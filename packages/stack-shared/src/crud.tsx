import * as yup from 'yup';
import { yupObject, yupString } from './schema-fields';
import { filterUndefined } from './utils/objects';
import { NullishCoalesce } from './utils/types';

export type AccessType = "client" | "server" | "admin";
export type CrudOperation = "create" | "read" | "update" | "delete";
export type CrudlOperation = "create" | "read" | "update" | "delete" | "list";
export type AccessTypeXCrudOperation = `${AccessType}${Capitalize<CrudOperation>}`;
export type AccessTypeXCrudlOperation = `${AccessType}${Capitalize<CrudlOperation>}`;

declare module 'yup' {
  // eslint-disable-next-line @typescript-eslint/consistent-type-definitions
  export interface CustomSchemaMetadata {
    openapiField?: {
      description?: string,
      exampleValue?: any,
      hidden?: boolean,
      onlyShowInOperations?: Capitalize<CrudlOperation>[],
    },
  }
}

type ShownEndpointDocumentation = {
  summary: string,
  description: string,
  tags?: string[],
  crudOperation?: Capitalize<CrudlOperation>,
};
export type EndpointDocumentation =
  | ({ hidden: true } & Partial<ShownEndpointDocumentation>)
  | ({ hidden?: boolean } & ShownEndpointDocumentation);


type InnerCrudSchema<
  CreateSchema extends yup.AnySchema | undefined = yup.AnySchema | undefined,
  ReadSchema extends yup.AnySchema | undefined = yup.AnySchema | undefined,
  UpdateSchema extends yup.AnySchema | undefined = yup.AnySchema | undefined,
  DeleteSchema extends yup.AnySchema | undefined = yup.AnySchema | undefined,
> = {
  createSchema: CreateSchema,
  createDocs: EndpointDocumentation | undefined,

  readSchema: ReadSchema,
  readDocs: EndpointDocumentation | undefined,
  listDocs: EndpointDocumentation | undefined,

  updateSchema: UpdateSchema,
  updateDocs: EndpointDocumentation | undefined,

  deleteSchema: DeleteSchema,
  deleteDocs: EndpointDocumentation | undefined,
};

export type CrudSchema<
  ClientSchema extends InnerCrudSchema = InnerCrudSchema,
  ServerSchema extends InnerCrudSchema = InnerCrudSchema,
  AdminSchema extends InnerCrudSchema = InnerCrudSchema,
> = {
  client: ClientSchema,
  server: ServerSchema,
  admin: AdminSchema,

  hasCreate: boolean,
  hasRead: boolean,
  hasUpdate: boolean,
  hasDelete: boolean,
};

export type CrudSchemaCreationOptions = {
  [K in AccessTypeXCrudOperation as `${K}Schema`]?: yup.AnySchema
};

type FillInOptionalsPrepareStep<O extends CrudSchemaCreationOptions> =
  & { [K in keyof Required<CrudSchemaCreationOptions>]: K extends keyof O ? O[K] : undefined };

type FillInOptionalsStep<O extends FillInOptionalsPrepareStep<CrudSchemaCreationOptions>> = {
  clientCreateSchema: NullishCoalesce<O['clientCreateSchema'], undefined>,
  clientReadSchema: NullishCoalesce<O['clientReadSchema'], undefined>,
  clientUpdateSchema: NullishCoalesce<O['clientUpdateSchema'], undefined>,
  clientDeleteSchema: NullishCoalesce<O['clientDeleteSchema'], undefined>,

  serverCreateSchema: NullishCoalesce<O['serverCreateSchema'], O['clientCreateSchema']>,
  serverReadSchema: NullishCoalesce<O['serverReadSchema'], O['clientReadSchema']>,
  serverUpdateSchema: NullishCoalesce<O['serverUpdateSchema'], O['clientUpdateSchema']>,
  serverDeleteSchema: NullishCoalesce<O['serverDeleteSchema'], O['clientDeleteSchema']>,

  adminCreateSchema: NullishCoalesce<O['adminCreateSchema'], O['serverCreateSchema']>,
  adminReadSchema: NullishCoalesce<O['adminReadSchema'], O['serverReadSchema']>,
  adminUpdateSchema: NullishCoalesce<O['adminUpdateSchema'], O['serverUpdateSchema']>,
  adminDeleteSchema: NullishCoalesce<O['adminDeleteSchema'], O['serverDeleteSchema']>,
};

type FillInOptionals<O extends CrudSchemaCreationOptions> = FillInOptionalsStep<FillInOptionalsStep<FillInOptionalsStep<FillInOptionalsPrepareStep<O>>>>;

type CrudSchemaFromOptionsInner<O extends FillInOptionals<any>> = CrudSchema<
  InnerCrudSchema<O['clientCreateSchema'], O['clientReadSchema'], O['clientUpdateSchema'], O['clientDeleteSchema']>,
  InnerCrudSchema<O['serverCreateSchema'], O['serverReadSchema'], O['serverUpdateSchema'], O['serverDeleteSchema']>,
  InnerCrudSchema<O['adminCreateSchema'], O['adminReadSchema'], O['adminUpdateSchema'], O['adminDeleteSchema']>
>;

export type CrudSchemaFromOptions<O extends CrudSchemaCreationOptions> = CrudSchemaFromOptionsInner<FillInOptionals<O>>;

type InnerCrudTypeOf<S extends InnerCrudSchema> =
  & (S['createSchema'] extends {} ? { Create: yup.InferType<S['createSchema']> } : {})
  & (S['readSchema'] extends {} ? { Read: yup.InferType<S['readSchema']> } : {})
  & (S['updateSchema'] extends {} ? { Update: yup.InferType<S['updateSchema']> } : {})
  & (S['deleteSchema'] extends {} ? { Delete: yup.InferType<S['deleteSchema']> } : {})
  & (S['readSchema'] extends {} ? { List: {
    items: yup.InferType<S['readSchema']>[],
    is_paginated: boolean,
    pagination?: {
      next_cursor: string | null,
    },
  }, } : {});

export type CrudTypeOf<S extends CrudSchema> = {
  Client: InnerCrudTypeOf<S['client']>,
  Server: InnerCrudTypeOf<S['server']>,
  Admin: InnerCrudTypeOf<S['admin']>,
}

type CrudDocsCreationOptions<SO extends CrudSchemaCreationOptions> = {
  [X in AccessTypeXCrudlOperation]?: EndpointDocumentation
};

export function createCrud<SO extends CrudSchemaCreationOptions>(options: SO & { docs?: CrudDocsCreationOptions<SO> }): CrudSchemaFromOptions<SO> {
  const docs = options.docs ?? {};
  const client = {
    createSchema: options.clientCreateSchema,
    createDocs: docs.clientCreate,

    readSchema: options.clientReadSchema,
    readDocs: docs.clientRead,
    listDocs: docs.clientList,

    updateSchema: options.clientUpdateSchema,
    updateDocs: docs.clientUpdate,

    deleteSchema: options.clientDeleteSchema,
    deleteDocs: docs.clientDelete,
  };

  const serverOverrides = filterUndefined({
    createSchema: options.serverCreateSchema,
    createDocs: docs.serverCreate,

    readSchema: options.serverReadSchema,
    readDocs: docs.serverRead,
    listDocs: docs.serverList,

    updateSchema: options.serverUpdateSchema,
    updateDocs: docs.serverUpdate,

    deleteSchema: options.serverDeleteSchema,
    deleteDocs: docs.serverDelete,
  });
  const server = {
    ...client,
    ...serverOverrides,
  };

  const adminOverrides = filterUndefined({
    createSchema: options.adminCreateSchema,
    createDocs: docs.adminCreate,

    readSchema: options.adminReadSchema,
    readDocs: docs.adminRead,
    listDocs: docs.adminList,

    updateSchema: options.adminUpdateSchema,
    updateDocs: docs.adminUpdate,

    deleteSchema: options.adminDeleteSchema,
    deleteDocs: docs.adminDelete,
  });
  const admin = {
    ...server,
    ...adminOverrides,
  };

  return {
    client: client as any,
    server: server as any,
    admin: admin as any,

    hasCreate: !!admin.createSchema,
    hasRead: !!admin.readSchema,
    hasUpdate: !!admin.updateSchema,
    hasDelete: !!admin.deleteSchema,
  };
}

import.meta.vitest?.test("createCrud", ({ expect }) => {
  // Test with empty options
  const emptyCrud = createCrud({});
  expect(emptyCrud.hasCreate).toBe(false);
  expect(emptyCrud.hasRead).toBe(false);
  expect(emptyCrud.hasUpdate).toBe(false);
  expect(emptyCrud.hasDelete).toBe(false);
  expect(emptyCrud.client.createSchema).toBeUndefined();
  expect(emptyCrud.server.createSchema).toBeUndefined();
  expect(emptyCrud.admin.createSchema).toBeUndefined();

  // Test with client schemas only
  const mockSchema = yupObject().shape({
    name: yupString().defined(),
  });

  const clientOnlyCrud = createCrud({
    clientCreateSchema: mockSchema,
    clientReadSchema: mockSchema,
  });
  expect(clientOnlyCrud.hasCreate).toBe(true);
  expect(clientOnlyCrud.hasRead).toBe(true);
  expect(clientOnlyCrud.hasUpdate).toBe(false);
  expect(clientOnlyCrud.hasDelete).toBe(false);
  expect(clientOnlyCrud.client.createSchema).toBe(mockSchema);
  expect(clientOnlyCrud.server.createSchema).toBe(mockSchema);
  expect(clientOnlyCrud.admin.createSchema).toBe(mockSchema);

  // Test with server overrides
  const serverSchema = yupObject().shape({
    name: yupString().defined(),
    internalField: yupString().defined(),
  });

  const serverOverrideCrud = createCrud({
    clientCreateSchema: mockSchema,
    serverCreateSchema: serverSchema,
  });
  expect(serverOverrideCrud.hasCreate).toBe(true);
  expect(serverOverrideCrud.client.createSchema).toBe(mockSchema);
  expect(serverOverrideCrud.server.createSchema).toBe(serverSchema);
  expect(serverOverrideCrud.admin.createSchema).toBe(serverSchema);

  // Test with admin overrides
  const adminSchema = yupObject().shape({
    name: yupString().defined(),
    internalField: yupString().defined(),
    adminField: yupString().defined(),
  });

  const fullOverrideCrud = createCrud({
    clientCreateSchema: mockSchema,
    serverCreateSchema: serverSchema,
    adminCreateSchema: adminSchema,
  });
  expect(fullOverrideCrud.hasCreate).toBe(true);
  expect(fullOverrideCrud.client.createSchema).toBe(mockSchema);
  expect(fullOverrideCrud.server.createSchema).toBe(serverSchema);
  expect(fullOverrideCrud.admin.createSchema).toBe(adminSchema);

  // Test with documentation
  const crudWithDocs = createCrud({
    clientCreateSchema: mockSchema,
    docs: {
      clientCreate: {
        summary: "Create a resource",
        description: "Creates a new resource",
        tags: ["resources"],
      },
    },
  });
  expect(crudWithDocs.client.createDocs).toEqual({
    summary: "Create a resource",
    description: "Creates a new resource",
    tags: ["resources"],
  });
  expect(crudWithDocs.server.createDocs).toEqual({
    summary: "Create a resource",
    description: "Creates a new resource",
    tags: ["resources"],
  });
});
