"use client";

import { SmartFormDialog } from "@/components/form-dialog";
import { SelectField } from "@/components/form-fields";
import { Button, FormControl, FormField, FormItem, FormLabel, FormMessage, toast } from "@stackframe/stack-ui";
import { PaymentOfferTable } from "@/components/data-table/payment-offer-table";
import { PaymentItemTable } from "@/components/data-table/payment-item-table";
import { useState } from "react";
import * as yup from "yup";
import { PageLayout } from "../page-layout";
import { useAdminApp } from "../use-admin-app";
import { branchPaymentsSchema } from "@stackframe/stack-shared/dist/config/schema";
import { offerPriceSchema, yupRecord } from "@stackframe/stack-shared/dist/schema-fields";
import { Control, FieldValues, Path } from "react-hook-form";
import { Trash2, Plus } from "lucide-react";

// Mock payments config based on the schema
const paymentsConfig: yup.InferType<typeof branchPaymentsSchema> = {
  stripeAccountId: "acct_test123",
  autoPay: {
    interval: [30, "day"],
  },
  exclusivityGroups: {
    "premium-group": {
      "premium-offer": true,
      "enterprise-offer": true,
    },
  },
  offers: {
    "basic-plan": {
      displayName: "Basic Plan",
      customerType: "user",
      freeTrial: [7, "day"],
      serverOnly: false,
      stackable: false,
      prices: {
        "basic-monthly": {
          USD: "999",
          interval: [30, "day"],
          serverOnly: false,
          freeTrial: [7, "day"],
        },
      },
      includedItems: {
        "api-calls": {
          quantity: 1000,
          repeat: [30, "day"],
          expires: "when-purchase-expires",
        },
      },
    },
    "pro-plan": {
      includedItems: {},
      prices: {
        "monthly": {
          USD: "999",
          interval: [30, "day"],
        },
      },
    },
  },
  items: {
    "api-calls": {
      displayName: "API Calls",
      customerType: "user",
      default: {
        quantity: 100,
        repeat: [30, "day"],
        expires: "never",
      },
    },
    "fast-api-calls": {
      default: {}
    },
  },
};

export default function PageClient() {
  const stackAdminApp = useAdminApp();
  const project = stackAdminApp.useProject();
  const stripeAccountId = project.config.payments.stripeAccountId;

  const [isCreateOfferOpen, setIsCreateOfferOpen] = useState(false);
  const [isCreateItemOpen, setIsCreateItemOpen] = useState(false);
  const [isCreatePurchaseOpen, setIsCreatePurchaseOpen] = useState(false);

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
        <Button onClick={() => setIsCreatePurchaseOpen(true)}>Create Purchase</Button>
        <Button onClick={setupPayments}>Setup</Button>
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
      />
      <CreateItemDialog
        open={isCreateItemOpen}
        onOpenChange={setIsCreateItemOpen}
      />
      <CreatePurchaseDialog
        open={isCreatePurchaseOpen}
        onOpenChange={setIsCreatePurchaseOpen}
      />
    </PageLayout >
  );
}

function PricesFormField<F extends FieldValues>(props: {
  control: Control<F>,
  name: Path<F>,
  label: React.ReactNode,
  required?: boolean,
}) {
  const intervalOptions = [
    { value: "1-week", label: "1 week" },
    { value: "1-month", label: "1 month" },
    { value: "1-year", label: "1 year" },
  ];

  const freeTrialOptions = [
    { value: "1-week", label: "1 week" },
    { value: "1-month", label: "1 month" },
    { value: "1-year", label: "1 year" },
  ];

  const parseInterval = (value: string) => {
    const [amount, unit] = value.split("-");
    return [parseInt(amount), unit] as [number, string];
  };

  const formatInterval = (interval: [number, string] | undefined) => {
    if (!interval) return "";
    const [amount, unit] = interval;
    return `${amount}-${unit}`;
  };

  return (
    <FormField
      control={props.control}
      name={props.name}
      render={({ field }) => {
        const prices: Record<string, any> = field.value || {};
        const priceIds = Object.keys(prices);

        const addPrice = () => {
          const newPriceId = `price-${Date.now()}`;
          const newPrices = {
            ...prices,
            [newPriceId]: {
              USD: "999",
              interval: [30, "day"] as [number, string],
              serverOnly: false,
              freeTrial: undefined,
            }
          };
          field.onChange(newPrices);
        };

        const removePrice = (priceId: string) => {
          const newPrices = { ...prices };
          delete newPrices[priceId];
          field.onChange(newPrices);
        };

        const updatePrice = (priceId: string, updates: Record<string, any>) => {
          const newPrices = {
            ...prices,
            [priceId]: {
              ...prices[priceId],
              ...updates,
            }
          };
          field.onChange(newPrices);
        };

        return (
          <FormItem>
            <FormLabel className="flex">
              {props.label}
              {props.required ? <span className="text-zinc-500">*</span> : null}
            </FormLabel>
            <FormControl>
              <div className="space-y-4">
                {priceIds.map((priceId) => {
                  const price = prices[priceId];
                  return (
                    <div key={priceId} className="border rounded-lg p-4 space-y-4">
                      <div className="flex justify-between items-center">
                        <h4 className="font-medium">Price: {priceId}</h4>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => removePrice(priceId)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="block text-sm font-medium mb-1">Price (USD)</label>
                          <input
                            type="number"
                            className="w-full px-3 py-2 border rounded-md"
                            value={price?.USD || ""}
                            onChange={(e) => updatePrice(priceId, { USD: e.target.value })}
                            placeholder="9"
                          />
                        </div>

                        <div>
                          <label className="block text-sm font-medium mb-1">Interval</label>
                          <select
                            className="w-full px-3 py-2 border rounded-md"
                            value={formatInterval(price?.interval)}
                            onChange={(e) => updatePrice(priceId, { interval: e.target.value ? parseInterval(e.target.value) : undefined })}
                          >
                            <option value="">No interval</option>
                            {intervalOptions.map(option => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div>
                          <label className="block text-sm font-medium mb-1">Free Trial</label>
                          <select
                            className="w-full px-3 py-2 border rounded-md"
                            value={formatInterval(price?.freeTrial)}
                            onChange={(e) => updatePrice(priceId, { freeTrial: e.target.value ? parseInterval(e.target.value) : undefined })}
                          >
                            <option value="">No free trial</option>
                            {freeTrialOptions.map(option => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div className="flex items-center">
                          <label className="flex items-center space-x-2">
                            <input
                              type="checkbox"
                              checked={price?.serverOnly || false}
                              onChange={(e) => updatePrice(priceId, { serverOnly: e.target.checked })}
                            />
                            <span className="text-sm font-medium">Server Only</span>
                          </label>
                        </div>
                      </div>
                    </div>
                  );
                })}

                <Button
                  type="button"
                  variant="outline"
                  onClick={addPrice}
                  className="w-full"
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Add Price
                </Button>
              </div>
            </FormControl>
            <FormMessage />
          </FormItem>
        );
      }}
    />
  );
}

function CreateOfferDialog({
  open, onOpenChange,
}: {
  open: boolean,
  onOpenChange: (open: boolean) => void,
}) {
  const offerSchema = yup.object({
    offerId: yup.string().defined().label("Offer ID"),
    displayName: yup.string().defined().label("Display Name"),
    customerType: yup.string().oneOf(["user", "team"]).defined().label("Customer Type").meta({
      stackFormFieldRender: (props) => (
        <SelectField {...props} options={[
          { value: "user", label: "User" },
          { value: "team", label: "Team" },
        ]} />
      ),
    }),
    prices: yupRecord(yup.string(), offerPriceSchema).defined().label("Prices").meta({
      stackFormFieldRender: (props) => (
        <PricesFormField {...props} />
      ),
    }),
    freeTrialDays: yup.number().min(0).optional().label("Free Trial (days)"),
    serverOnly: yup.boolean().default(false).label("Server Only"),
    stackable: yup.boolean().default(false).label("Stackable"),
  });

  return (
    <SmartFormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Create New Offer"
      formSchema={offerSchema}
      okButton={{ label: "Create Offer" }}
      cancelButton
      onSubmit={async (values) => {
        console.log("Creating offer:", values);
        // API call would go here
      }}
    />
  );
}


function CreateItemDialog({ open, onOpenChange }: { open: boolean, onOpenChange: (open: boolean) => void }) {
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
        console.log("Creating item:", values);
        // API call would go here
      }}
    />
  );
}


function CreatePurchaseDialog({ open, onOpenChange }: { open: boolean, onOpenChange: (open: boolean) => void }) {
  const stackAdminApp = useAdminApp();

  return (
    <SmartFormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Create New Purchase"
      formSchema={yup.object({
        customerId: yup.string().defined().label("Customer ID"),
        offerId: yup.string().defined().label("Offer ID"),
      })}
      cancelButton
      okButton={{ label: "Create Purchase URL" }}
      onSubmit={async (values) => {
        const url = await stackAdminApp.createPurchaseUrl({
          customerId: values.customerId,
          offerId: values.offerId,
        });
        await navigator.clipboard.writeText(url);
        toast({ title: "Purchase URL copied to clipboard" });
      }}
    />
  );
}
