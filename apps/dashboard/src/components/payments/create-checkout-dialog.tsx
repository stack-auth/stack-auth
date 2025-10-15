import { useAdminApp } from "@/app/(main)/(protected)/projects/[projectId]/use-admin-app";
import { ServerUser, Team } from "@stackframe/stack";
import { KnownErrors } from "@stackframe/stack-shared";
import { Result } from "@stackframe/stack-shared/dist/utils/results";
import { ActionDialog, InlineCode, Typography, toast } from "@stackframe/stack-ui";
import { useState } from "react";
import * as yup from "yup";
import { FormDialog } from "../form-dialog";
import { SelectField } from "../form-fields";

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
  const stackAdminApp = useAdminApp();
  const project = stackAdminApp.useProject();
  const config = project.useConfig();
  const [checkoutUrl, setCheckoutUrl] = useState<string | null>(null);
  const customer = props.user ?? props.team;
  const products = config.payments.products;
  const shownProducts = Object.keys(products).filter(id => products[id].customerType === (props.user ? "user" : "team"));

  const createCheckoutUrl = async (data: { productId: string }) => {
    const result = await Result.fromPromise(customer.createCheckoutUrl({ productId: data.productId }));
    if (result.status === "ok") {
      setCheckoutUrl(result.data);
      return;
    }
    if (result.error instanceof KnownErrors.ProductDoesNotExist) {
      toast({ title: "Product with given productId does not exist", variant: "destructive" });
    } else if (result.error instanceof KnownErrors.ProductCustomerTypeDoesNotMatch) {
      toast({ title: "Customer type does not match expected type for this product", variant: "destructive" });
    } else if (result.error instanceof KnownErrors.CustomerDoesNotExist) {
      toast({ title: "Customer with given customerId does not exist", variant: "destructive" });
    } else {
      toast({ title: "An unknown error occurred", variant: "destructive" });
    }
    return "prevent-close";
  };

  return (
    <>
      <FormDialog
        open={props.open}
        onOpenChange={props.onOpenChange}
        title="Create Checkout URL"
        formSchema={yup.object({
          productId: yup.string().defined().label("Product ID"),
        })}
        cancelButton
        okButton={{ label: "Create" }}
        onSubmit={values => createCheckoutUrl(values)}
        render={form => <SelectField
          control={form.control}
          name="productId"
          label="Product"
          options={shownProducts.map(id => ({ value: id, label: id }))}
        />}
      />
      <ActionDialog
        open={checkoutUrl !== null}
        onOpenChange={() => setCheckoutUrl(null)}
        title="Checkout URL"
        okButton
      >
        <Typography className="mb-2">This is a temporary URL. It will expire in 24 hours.</Typography>
        <InlineCode className="whitespace-nowrap overflow-x-auto block">{checkoutUrl}</InlineCode>
      </ActionDialog>
    </>
  );
}
