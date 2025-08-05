"use client";

import { SmartFormDialog } from "@/components/form-dialog";
import { SelectField } from "@/components/form-fields";
import {
  ActionDialog,
  Button,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  InlineCode,
  toast,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Label,
  Card,
  CardContent,
  CardHeader,
  CardTitle
} from "@stackframe/stack-ui";
import { PaymentOfferTable } from "@/components/data-table/payment-offer-table";
import { PaymentItemTable } from "@/components/data-table/payment-item-table";
import { useState } from "react";
import * as yup from "yup";
import { PageLayout } from "../page-layout";
import { useAdminApp } from "../use-admin-app";
import {
  offerPriceSchema,
  yupRecord
} from "@stackframe/stack-shared/dist/schema-fields";
import { Control, FieldValues, Path } from "react-hook-form";
import { Trash2, Plus } from "lucide-react";
import { AdminProject } from "@stackframe/stack";
import { KnownErrors } from "@stackframe/stack-shared";
import { Result } from "@stackframe/stack-shared/dist/utils/results";

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
        await project.updateConfig({
          [`payments.offers.${values.offerId}`]: {
            prices: values.prices,
            customerType: values.customerType,
            displayName: values.displayName,
            serverOnly: values.serverOnly,
            stackable: values.stackable,
            freeTrial: values.freeTrialDays ? [values.freeTrialDays, "day"] : undefined,
          },
        });
      }}
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
          const newPriceId = `price_${priceIds.length}`;
          const newPrices = {
            ...prices,
            [newPriceId]: {
              USD: "20",
              interval: [1, "month"] as [number, string],
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

        const updatePriceId = (oldPriceId: string, newPriceId: string) => {
          if (oldPriceId !== newPriceId && !prices[newPriceId]) {
            const newPrices = { ...prices };
            newPrices[newPriceId] = newPrices[oldPriceId];
            delete newPrices[oldPriceId];
            field.onChange(newPrices);
          }
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
                    <Card key={priceId}>
                      <CardHeader className="flex flex-row items-center justify-between space-y-0 p-4">
                        <CardTitle className="text-sm font-bold">Price Settings</CardTitle>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => removePrice(priceId)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </CardHeader>
                      <CardContent className="space-y-2 p-4 pt-0">
                        <div className="space-y-1">
                          <Label>Price ID</Label>
                          <Input
                            value={priceId}
                            onChange={(e) => updatePriceId(priceId, e.target.value)}
                            placeholder="Enter price ID"
                          />
                        </div>

                        <div className="space-y-1">
                          <Label>Price (USD)</Label>
                          <Input
                            type="number"
                            value={price?.USD || ""}
                            onChange={(e) => updatePrice(priceId, { USD: e.target.value })}
                            placeholder="9"
                          />
                        </div>

                        <div className="space-y-1">
                          <Label>Interval</Label>
                          <Select
                            value={formatInterval(price?.interval) || undefined}
                            onValueChange={(value) => updatePrice(priceId, { interval: value ? parseInterval(value) : undefined })}
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="No interval" />
                            </SelectTrigger>
                            <SelectContent>
                              {intervalOptions.map(option => (
                                <SelectItem key={option.value} value={option.value}>
                                  {option.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </CardContent>
                    </Card>
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
