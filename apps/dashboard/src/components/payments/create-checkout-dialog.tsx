import { Team, ServerUser } from "@stackframe/stack";
import { KnownErrors } from "@stackframe/stack-shared";
import { Result } from "@stackframe/stack-shared/dist/utils/results";
import { useState } from "react";
import { ActionDialog, InlineCode, toast, Typography } from "@stackframe/stack-ui";
import { FormDialog } from "../form-dialog";
import { useAdminApp } from "@/app/(main)/(protected)/projects/[projectId]/use-admin-app";
import { SelectField } from "../form-fields";
import * as yup from "yup";

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
  const offers = config.payments.offers;
  const shownOffers = Object.keys(offers).filter(id => offers[id].customerType === (props.user ? "user" : "team"));

  const createCheckoutUrl = async (data: { offerId: string }) => {
    const result = await Result.fromPromise(customer.createCheckoutUrl({ offerId: data.offerId }));
    if (result.status === "ok") {
      setCheckoutUrl(result.data);
      return;
    }
    if (result.error instanceof KnownErrors.OfferDoesNotExist) {
      toast({ title: "Offer with given offerId does not exist", variant: "destructive" });
    } else if (result.error instanceof KnownErrors.OfferCustomerTypeDoesNotMatch) {
      toast({ title: "Customer type does not match expected type for this offer", variant: "destructive" });
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
          offerId: yup.string().defined().label("Offer ID"),
        })}
        cancelButton
        okButton={{ label: "Create" }}
        onSubmit={values => createCheckoutUrl(values)}
        render={form => <SelectField
          control={form.control}
          name="offerId"
          label="Offer"
          options={shownOffers.map(id => ({ value: id, label: id }))}
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
