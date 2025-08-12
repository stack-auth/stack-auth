"use client";

import * as yup from "yup";
import { useState } from "react";
import { PaymentItemTable } from "@/components/data-table/payment-item-table";
import { PaymentOfferTable } from "@/components/data-table/payment-offer-table";
import { FormDialog, SmartFormDialog } from "@/components/form-dialog";
import { InputField, SelectField, SwitchField } from "@/components/form-fields";
import { IncludedItemEditorField } from "@/components/payments/included-item-editor";
import { PriceEditorField } from "@/components/payments/price-editor";
import { AdminProject } from "@stackframe/stack";
import { KnownErrors } from "@stackframe/stack-shared";
import {
  offerPriceSchema,
  userSpecifiedIdSchema,
  yupRecord
} from "@stackframe/stack-shared/dist/schema-fields";
import { Result } from "@stackframe/stack-shared/dist/utils/results";
import {
  ActionDialog,
  Button,
  InlineCode,
  toast
} from "@stackframe/stack-ui";
import { PageLayout } from "../page-layout";
import { useAdminApp } from "../use-admin-app";

export default function PageClient() {
  const stackAdminApp = useAdminApp();
  const project = stackAdminApp.useProject();
  const config = project.useConfig();
  const stripeAccountId = config.payments.stripeAccountId;
  const paymentsConfig = config.payments;

  const [isCreateOfferOpen, setIsCreateOfferOpen] = useState(false);
  const [isCreateItemOpen, setIsCreateItemOpen] = useState(false);

  const setupPayments = async () => {
    const { url } = await stackAdminApp.setupPayments();
    window.location.href = url;
  };

  if (!stripeAccountId) {
    return (
      <PageLayout
        title="Payments"
        description="Manage your payments"
      >
        <div className="flex flex-col gap-2 items-center">
          <Button onClick={setupPayments}>Setup</Button>
        </div>
      </PageLayout>
    );
  }

  return (
    <PageLayout
      title="Payments"
      description="Manage your payment offers and items"
      actions={<div className="flex gap-2">
        {paymentsConfig.stripeAccountSetupComplete ? (
          <CreatePurchaseDialog />
        ) : (
          <Button onClick={setupPayments}>Complete Setup</Button>
        )}
      </div>}
    >
      <PaymentOfferTable
        offers={paymentsConfig.offers}
        toolbarRender={() => <Button onClick={() => setIsCreateOfferOpen(true)}>New Offer</Button>}
      />
      <PaymentItemTable
        items={paymentsConfig.items}
        toolbarRender={() => <Button onClick={() => setIsCreateItemOpen(true)}>New Item</Button>}
      />
      <CreateOfferDialog
        open={isCreateOfferOpen}
        onOpenChange={setIsCreateOfferOpen}
        project={project}
      />
      <CreateItemDialog
        open={isCreateItemOpen}
        onOpenChange={setIsCreateItemOpen}
        project={project}
      />
    </PageLayout >
  );
}


function CreateOfferDialog({
  open,
  onOpenChange,
  project,
}: {
  open: boolean,
  project: AdminProject,
  onOpenChange: (open: boolean) => void,
}) {
  const config = project.useConfig();

  const offerSchema = yup.object({
    offerId: yup.string().defined().label("Offer ID"),
    displayName: yup.string().defined().label("Display Name"),
    customerType: yup.string().oneOf(["user", "team"]).defined().label("Customer Type"),
    prices: yupRecord(userSpecifiedIdSchema("priceId"), offerPriceSchema).defined().label("Prices").test("at-least-one-price", "At least one price is required", (value) => {
      return Object.keys(value).length > 0;
    }),
    includedItems: yupRecord(userSpecifiedIdSchema("itemId"), yup.object({
      quantity: yup.number().defined(),
      repeat: yup.mixed().optional(),
      expires: yup.string().oneOf(["never", "when-purchase-expires", "when-repeated"]).optional(),
    })).default({}).label("Included Items"),
    freeTrialDays: yup.number().min(0).optional().label("Free Trial (days)"),
    serverOnly: yup.boolean().default(false).label("Server Only"),
    stackable: yup.boolean().default(false).label("Stackable"),
  });

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Create New Offer"
      formSchema={offerSchema}
      okButton={{ label: "Create Offer" }}
      cancelButton
      onSubmit={async (values: yup.InferType<typeof offerSchema>) => {
        await project.updateConfig({
          [`payments.offers.${values.offerId}`]: {
            prices: values.prices,
            includedItems: values.includedItems,
            customerType: values.customerType,
            displayName: values.displayName,
            serverOnly: values.serverOnly,
            stackable: values.stackable,
            freeTrial: values.freeTrialDays ? [values.freeTrialDays, "day"] : undefined,
          },
        });
      }}
      render={(form) => (
        <div className="space-y-4">
          <InputField control={form.control} name={"offerId"} label="Offer ID" required />
          <InputField control={form.control} name={"displayName"} label="Display Name" required />
          <SelectField control={form.control} name={"customerType"} label="Customer Type" required options={[
            { value: "user", label: "User" },
            { value: "team", label: "Team" },
          ]} />

          <PriceEditorField control={form.control} name={"prices"} label="Prices" required />
          <IncludedItemEditorField itemIds={Object.keys(config.payments.items)} control={form.control} name={"includedItems"} label="Included Items" />

          {/* <NumberField control={form.control} name={"freeTrialDays"} label="Free Trial (days)" /> */}
          <SwitchField control={form.control} name={"serverOnly"} label="Server Only" />
          <SwitchField control={form.control} name={"stackable"} label="Stackable" />
        </div>
      )}
    />
  );
}


function CreateItemDialog({ open, onOpenChange, project }: { open: boolean, onOpenChange: (open: boolean) => void, project: AdminProject }) {
  const itemSchema = yup.object({
    itemId: yup.string().defined().label("Item ID"),
    displayName: yup.string().optional().label("Display Name"),
    customerType: yup.string().oneOf(["user", "team"]).defined().label("Customer Type").meta({
      stackFormFieldRender: (props) => (
        <SelectField {...props} options={[
          { value: "user", label: "User" },
          { value: "team", label: "Team" },
        ]} />
      ),
    }),
    defaultQuantity: yup.number().min(0).default(0).label("Default Quantity"),
    defaultRepeatDays: yup.number().min(1).optional().label("Default Repeat (days)"),
    defaultExpires: yup.string().oneOf(["never", "when-repeated"]).optional().label("Default Expires").meta({
      stackFormFieldRender: (props) => (
        <SelectField {...props} options={[
          { value: "never", label: "Never" },
          { value: "when-repeated", label: "When Repeated" },
        ]} />
      ),
    }),
  });

  return (
    <SmartFormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Create New Item"
      formSchema={itemSchema}
      okButton={{ label: "Create Item" }}
      cancelButton
      onSubmit={async (values) => {
        await project.updateConfig({
          [`payments.items.${values.itemId}`]: {
            displayName: values.displayName,
            customerType: values.customerType,
            default: {
              quantity: values.defaultQuantity,
              repeat: values.defaultRepeatDays ? [values.defaultRepeatDays, "day"] : undefined,
              expires: values.defaultExpires,
            },
          },
        });
      }}
    />
  );
}


function CreatePurchaseDialog() {
  const stackAdminApp = useAdminApp();
  const [purchaseUrl, setPurchaseUrl] = useState<string | null>(null);

  const createPurchaseUrl = async (data: { customerId: string, offerId: string }) => {
    const result = await Result.fromPromise(stackAdminApp.createPurchaseUrl(data));
    if (result.status === "ok") {
      setPurchaseUrl(result.data);
      return;
    }
    if (result.error instanceof KnownErrors.OfferDoesNotExist) {
      toast({ title: "Offer with given offerId does not exist", variant: "destructive" });
    } else if (result.error instanceof KnownErrors.OfferCustomerTypeDoesNotMatch) {
      toast({ title: "Customer type does not match expected type for this offer", variant: "destructive" });
    } else if (result.error instanceof KnownErrors.CustomerDoesNotExist) {
      toast({ title: "Customer with given customerId does not exist", variant: "destructive" });
    } else {
      throw result.error;
    }
    return "prevent-close";
  };

  return (
    <>
      <SmartFormDialog
        trigger={<Button>Create Purchase URL</Button>}
        title="Create New Purchase"
        formSchema={yup.object({
          customerId: yup.string().uuid().defined().label("Customer ID"),
          offerId: yup.string().defined().label("Offer ID"),
        })}
        cancelButton
        okButton={{ label: "Create Purchase URL" }}
        onSubmit={values => createPurchaseUrl(values)}
      />
      <ActionDialog
        open={purchaseUrl !== null}
        onOpenChange={() => setPurchaseUrl(null)}
        title="Purchase URL"
        okButton
      >
        <InlineCode>{purchaseUrl}</InlineCode>
      </ActionDialog>
    </>
  );
}
