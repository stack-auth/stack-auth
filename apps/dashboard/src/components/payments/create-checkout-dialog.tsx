"use client";

import { useAdminApp } from "@/app/(main)/(protected)/projects/[projectId]/use-admin-app";
import { StyledLink } from "@/components/link";
import {
  DesignAlert,
  DesignButton,
  DesignDialog,
  DesignDialogClose,
  DesignSelectorDropdown,
} from "@/components/design-components";
import { InlineCode, Label, toast } from "@/components/ui";
import { LinkIcon, ShoppingCartIcon } from "@phosphor-icons/react";
import { ServerUser, Team } from "@hexclave/next";
import { KnownErrors } from "@hexclave/shared";
import { urlString } from "@hexclave/shared/dist/utils/urls";
import { runAsynchronouslyWithAlert } from "@hexclave/shared/dist/utils/promises";
import { Result } from "@hexclave/shared/dist/utils/results";
import { useEffect, useMemo, useState } from "react";

type Props = {
  open: boolean,
  onOpenChange: (open: boolean) => void,
} & (
  {
    user: ServerUser,
    team?: undefined,
  } | {
    team: Team,
    user?: undefined,
  }
)

export function CreateCheckoutDialog(props: Props) {
  const hexclaveAdminApp = useAdminApp();
  const project = hexclaveAdminApp.useProject();
  const config = project.useConfig();
  const [checkoutUrl, setCheckoutUrl] = useState<string | null>(null);
  const [productId, setProductId] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const customer = props.user ?? props.team;
  const products = config.payments.products;
  const customerType = props.user ? "user" : "team";
  const createProductHref = urlString`/projects/${hexclaveAdminApp.projectId}/payments/products/new?customerType=${customerType}`;

  const productOptions = useMemo(() => {
    return Object.entries(products)
      .filter(([, product]) => product.customerType === customerType)
      .map(([id, product]) => ({
        value: id,
        label: product.displayName ? `${product.displayName} (${id})` : id,
      }));
  }, [products, customerType]);

  useEffect(() => {
    if (props.open) {
      setProductId("");
    }
  }, [props.open]);

  const createCheckoutUrl = async () => {
    if (!productId) {
      toast({ title: "Please select a product", variant: "destructive" });
      return;
    }

    setIsCreating(true);
    try {
      const result = await Result.fromPromise(customer.createCheckoutUrl({ productId }));
      if (result.status === "ok") {
        setCheckoutUrl(result.data);
        props.onOpenChange(false);
        return;
      }
      if (result.error instanceof KnownErrors.ProductDoesNotExist) {
        toast({ title: "Product with given productId does not exist", variant: "destructive" });
      } else if (result.error instanceof KnownErrors.ProductCustomerTypeDoesNotMatch) {
        toast({ title: "Customer type does not match expected type for this product", variant: "destructive" });
      } else if (result.error instanceof KnownErrors.CustomerDoesNotExist) {
        toast({ title: "Customer with given customerId does not exist", variant: "destructive" });
      } else if (result.error instanceof KnownErrors.ProductAlreadyGranted) {
        toast({ title: "This customer already owns the selected product", variant: "destructive" });
      } else {
        toast({ title: "An unknown error occurred", variant: "destructive" });
      }
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <>
      <DesignDialog
        open={props.open}
        onOpenChange={props.onOpenChange}
        size="md"
        icon={ShoppingCartIcon}
        title="Create Checkout URL"
        footer={(
          <>
            <DesignDialogClose asChild>
              <DesignButton variant="secondary" size="sm" type="button" disabled={isCreating}>
                Cancel
              </DesignButton>
            </DesignDialogClose>
            <DesignButton
              size="sm"
              type="button"
              disabled={isCreating || productOptions.length === 0}
              loading={isCreating}
              onClick={() => runAsynchronouslyWithAlert(createCheckoutUrl())}
            >
              Create
            </DesignButton>
          </>
        )}
      >
        <div className="grid gap-4">
          {productOptions.length === 0 ? (
            <DesignAlert
              variant="warning"
              title="No products available"
              description={(
                <>
                  No {customerType} products are configured for this project.{" "}
                  <StyledLink href={createProductHref}>Create one here</StyledLink>.
                </>
              )}
            />
          ) : (
            <div className="grid gap-2">
              <Label htmlFor="checkout-product" className="text-sm font-medium">
                Product
              </Label>
              <DesignSelectorDropdown
                value={productId}
                onValueChange={setProductId}
                options={productOptions}
                placeholder="Select a product"
                size="md"
                triggerId="checkout-product"
              />
            </div>
          )}
        </div>
      </DesignDialog>

      <DesignDialog
        open={checkoutUrl !== null}
        onOpenChange={(open) => {
          if (!open) {
            setCheckoutUrl(null);
          }
        }}
        size="md"
        icon={LinkIcon}
        title="Checkout URL"
        description="This is a temporary URL. It will expire in 24 hours."
        footer={(
          <DesignDialogClose asChild>
            <DesignButton variant="secondary" size="sm" type="button">
              Close
            </DesignButton>
          </DesignDialogClose>
        )}
      >
        <InlineCode className="block overflow-x-auto whitespace-nowrap">{checkoutUrl}</InlineCode>
      </DesignDialog>
    </>
  );
}
