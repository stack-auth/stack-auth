import { prismaClient } from "@/prisma-client";
import { createCrudHandlers } from "@/route-handlers/crud-handler";
import { SmartRequestAuth } from "@/route-handlers/smart-request";
import { Product } from "@prisma/client";
import { internalPaymentsProductsCrud } from "@stackframe/stack-shared/dist/interface/crud/internal-payments-products";
import { yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { throwErr } from "@stackframe/stack-shared/dist/utils/errors";
import { createLazyProxy } from "@stackframe/stack-shared/dist/utils/proxies";

// Define the expected return type using the schema
type ProductReadType = {
  id: string,
  name: string,
  stripe_product_id: string | null,
  associated_permission_id: string | null,
  created_at_millis: string,
  project_id: string,
};

// Define params type
type ProductParams = {
  productId?: string,
};

function prismaModelToCrud(prismaModel: Product): ProductReadType {
  return {
    id: prismaModel.id,
    name: prismaModel.name,
    stripe_product_id: prismaModel.stripeProductId,
    associated_permission_id: prismaModel.associatedPermissionId,
    created_at_millis: prismaModel.createdAt.getTime().toString(),
    project_id: prismaModel.projectId,
  };
}

export const internalPaymentsProductsCrudHandlers = createLazyProxy(() => createCrudHandlers(internalPaymentsProductsCrud, {
  paramsSchema: yupObject({
    productId: yupString().uuid().defined(),
  }),
  onCreate: async ({ auth, data }) => {
    const product = await prismaClient.product.create({
      data: {
        name: data.name,
        stripeProductId: data.stripe_product_id,
        associatedPermissionId: data.associated_permission_id,
        projectId: auth.project.id,
      },
    });

    return prismaModelToCrud(product);
  },
  onRead: async ({ params, auth }) => {
    const product = await prismaClient.product.findUnique({
      where: {
        projectId: auth.project.id,
        id: params.productId,
      },
    });

    if (!product) {
      throwErr(`Product with ID ${params.productId} not found`);
    }

    return prismaModelToCrud(product);
  },
  onList: async ({ auth }) => {
    const products = await prismaClient.product.findMany({
      orderBy: {
        createdAt: "desc",
      },
    });

    return {
      items: products.map(prismaModelToCrud),
      is_paginated: false,
    };
  },
  onUpdate: async ({ params, auth, data }) => {
    const updatedProduct = await prismaClient.product.update({
      where: {
        projectId: auth.project.id,
        id: params.productId,
      },
      data: {
        name: data.name,
        stripeProductId: data.stripe_product_id,
        associatedPermissionId: data.associated_permission_id,
      },
    });

    return prismaModelToCrud(updatedProduct);
  },
  onDelete: async ({ params, auth }) => {
    await prismaClient.product.delete({
      where: {
        projectId: auth.project.id,
        id: params.productId,
      },
    });
  },
}));
