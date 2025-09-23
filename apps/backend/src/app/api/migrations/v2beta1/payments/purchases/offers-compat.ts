

export function normalizePurchaseBody(body: Record<string, any>): Record<string, any> {
  const productId = body.product_id ?? body.offer_id;
  const productInline = body.product_inline ?? body.offer_inline;
  const result: Record<string, any> = { ...body, product_id: productId, product_inline: productInline };
  delete result.offer_id;
  delete result.offer_inline;
  return result;
}

type ValidateCodeBody = {
  product: any,
  conflicting_group_products: Array<{ product_id: string, display_name: string }>,
};

export function addOfferAliasesToValidateCodeBody<T extends ValidateCodeBody & Record<string, any>>(body: T): T & {
  offer: T["product"],
  conflicting_group_offers: Array<{ offer_id: string, display_name: string }>,
} {
  return {
    ...body,
    offer: body.product,
    conflicting_group_offers: body.conflicting_group_products.map(({ product_id, display_name }) => ({
      offer_id: product_id,
      display_name,
    })),
  };
}


import.meta.vitest?.test("normalizePurchaseBody maps offer fields to product equivalents", ({ expect }) => {
  const legacyBody = { offer_id: "legacy_offer", offer_inline: { foo: "bar" } } as Record<string, any>;

  const normalized = normalizePurchaseBody(legacyBody);

  expect(normalized.product_id).toBe("legacy_offer");
  expect(normalized.product_inline).toBe(legacyBody.offer_inline);
  expect(normalized).not.toHaveProperty("offer_id");
  expect(normalized).not.toHaveProperty("offer_inline");
  expect(legacyBody).toEqual({ offer_id: "legacy_offer", offer_inline: { foo: "bar" } });
});

import.meta.vitest?.test("addOfferAliasesToValidateCodeBody adds offer aliases", ({ expect }) => {
  const body = {
    product: { id: "prod" },
    conflicting_group_products: [
      { product_id: "prodA", display_name: "Product A" },
      { product_id: "prodB", display_name: "Product B" },
    ],
  };

  const result = addOfferAliasesToValidateCodeBody({ ...body });

  expect(result.offer).toBe(body.product);
  expect(result.conflicting_group_offers).toEqual([
    { offer_id: "prodA", display_name: "Product A" },
    { offer_id: "prodB", display_name: "Product B" },
  ]);
  expect((result as any).conflicting_group_products).toEqual(body.conflicting_group_products);
});
