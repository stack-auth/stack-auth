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
import { wait } from "@stackframe/stack-shared/dist/utils/promises";
import { Result } from "@stackframe/stack-shared/dist/utils/results";
import {
  ActionDialog,
  Button,
  Card,
  CardContent,
  InlineCode,
  Typography,
  toast
} from "@stackframe/stack-ui";
import { ArrowRight, BarChart3, Repeat, Shield, Wallet, Webhook } from "lucide-react";
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
    await wait(2000);
  };

  if (!stripeAccountId) {
    return (
      <div className="mx-auto max-w-sm h-full flex items-center">
        <Card className="w-full">
          <CardContent className="p-8 text-center">
            <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-full bg-primary/10 text-primary">
              <Wallet className="h-6 w-6" />
            </div>
            <Typography type="h3" className="mb-4">Setup Payments</Typography>
            <Typography type="p" variant="secondary" className="mt-2">
              Let your users pay seamlessly and securely.
            </Typography>
            <ul className="mt-6 grid gap-3 text-left text-sm text-muted-foreground">
              <li className="flex items-center gap-2">
                <Webhook className="h-4 w-4 text-primary" />
                <span>No webhooks or syncing</span>
              </li>
              <li className="flex items-center gap-2">
                <Repeat className="h-4 w-4 text-primary" />
                <span>One-time and recurring</span>
              </li>
              <li className="flex items-center gap-2">
                <BarChart3 className="h-4 w-4 text-primary" />
                <span>Usage-based billing</span>
              </li>
            </ul>
            <div className="mt-8 flex justify-center">
              <SetupPaymentsButton setupPayments={setupPayments} />
            </div>
            <div className="mt-4 flex items-center justify-center gap-2 text-xs text-muted-foreground">
              <Shield className="h-3.5 w-3.5" />
              <span>Powered by Stripe</span>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <PageLayout
      title="Payments"
      description="Manage your payment offers and items"
      actions={<div className="flex gap-2">
        {!paymentsConfig.stripeAccountSetupComplete && (
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

function SetupPaymentsButton({ setupPayments }: { setupPayments: () => Promise<void> }) {
  return (
    <SmartFormDialog
      title="Set up payments"
      formSchema={yup.object({
        country: yup.string().oneOf(["US", "OTHER"]).defined().label("Country of residence").meta({
          stackFormFieldRender: (props: any) => (
            <SelectField
              {...props}
              label="Country of residence"
              required
              options={[
                { value: "US", label: "United States" },
                { value: "OTHER", label: "Other" },
              ]}
            />
          ),
        }),
      })}
      cancelButton
      okButton={{ label: "Continue" }}
      trigger={
        <Button className="group">
          <span className="inline-flex items-center gap-2">
            Start Setup
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
          </span>
        </Button>
      }
      onSubmit={async (values) => {
        if (values.country !== "US") {
          toast({ title: "Payments is currently only available in the United States", variant: "destructive" });
          return "prevent-close";
        }
        await setupPayments();
      }}
    />
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
