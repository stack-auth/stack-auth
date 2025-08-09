"use client";

import { PaymentItemTable } from "@/components/data-table/payment-item-table";
import { PaymentOfferTable } from "@/components/data-table/payment-offer-table";
import { SmartFormDialog } from "@/components/form-dialog";
import { SelectField } from "@/components/form-fields";
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
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  InlineCode,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  toast
} from "@stackframe/stack-ui";
import { Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Control, FieldValues, Path, useWatch } from "react-hook-form";
import * as yup from "yup";
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
          <>
            <CreatePurchaseDialog />
          </>
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
    prices: yupRecord(userSpecifiedIdSchema("priceId"), offerPriceSchema).defined().label("Prices").meta({
      stackFormFieldRender: (props) => (
        <PricesFormField {...props} />
      ),
    }).test("at-least-one-price", "At least one price is required", (value) => {
      return Object.keys(value).length > 0;
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


type PriceRow = { uid: string, priceId: string, price: Record<string, any> };

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

  const parseInterval = (value: string) => {
    const [amount, unit] = value.split("-");
    return [parseInt(amount), unit] as [number, string];
  };

  const formatInterval = (interval: [number, string] | undefined) => {
    if (!interval) return "";
    const [amount, unit] = interval;
    return `${amount}-${unit}`;
  };
  const fieldValue = useWatch({ control: props.control, name: props.name });
  const [rows, setRows] = useState<PriceRow[]>([]);

  useEffect(() => {
    const src = fieldValue || {};
    const oldMap = new Map(rows.map(r => [r.priceId, r.uid]));
    const createUid = () => Date.now().toString(36);
    const next = Object.entries(src).map(([priceId, price]) => ({ uid: oldMap.get(priceId) ?? createUid(), priceId, price: price as Record<string, any> }));
    const same = rows.length === next.length && rows.every((r, i) => r.priceId === next[i]?.priceId && JSON.stringify(r.price) === JSON.stringify(next[i]?.price) && r.uid === next[i]?.uid);
    if (!same) setRows(next);
  }, [fieldValue, rows]);

  return (
    <FormField
      control={props.control as any}
      name={props.name as any}
      render={({ field }) => {
        const sync = (newRows: PriceRow[]) => {
          setRows(newRows);
          const record = Object.fromEntries(newRows.map(r => [r.priceId, r.price]));
          field.onChange(record);
        };

        const addPrice = () => {
          const used = new Set(rows.map(r => r.priceId));
          let i = rows.length;
          let newPriceId = `price_${i}`;
          while (used.has(newPriceId)) {
            i += 1;
            newPriceId = `price_${i}`;
          }
          const newRow = {
            uid: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
            priceId: newPriceId,
            price: { USD: "20", interval: [1, "month"] as [number, string] },
          };
          sync([...rows, newRow]);
        };

        const removePrice = (uid: string) => {
          sync(rows.filter(r => r.uid !== uid));
        };

        const updatePrice = (uid: string, updates: Record<string, any>) => {
          const newRows = rows.map(r => r.uid === uid ? { ...r, price: { ...r.price, ...updates } } : r);
          sync(newRows);
        };

        const updatePriceId = (uid: string, newPriceId: string) => {
          if (rows.some(r => r.uid !== uid && r.priceId === newPriceId)) return;
          const newRows = rows.map(r => r.uid === uid ? { ...r, priceId: newPriceId } : r);
          sync(newRows);
        };

        return (
          <FormItem>
            <FormLabel className="flex">
              {props.label}
              {props.required ? <span className="text-zinc-500">*</span> : null}
            </FormLabel>
            <FormControl>
              <div className="space-y-4">
                {rows.map((row) => {
                  const price = row.price;
                  return (
                    <Card key={row.uid}>
                      <CardHeader className="flex flex-row items-center justify-between space-y-0 p-4">
                        <CardTitle className="text-sm font-bold">Price Settings</CardTitle>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => removePrice(row.uid)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </CardHeader>
                      <CardContent className="space-y-2 p-4 pt-0">
                        <div className="space-y-1">
                          <Label>Price ID</Label>
                          <Input
                            value={row.priceId}
                            onChange={(e) => updatePriceId(row.uid, e.target.value)}
                            placeholder="Enter price ID"
                          />
                        </div>

                        <div className="space-y-1">
                          <Label>Price (USD)</Label>
                          <Input
                            type="number"
                            value={price.USD || ""}
                            onChange={(e) => updatePrice(row.uid, { USD: e.target.value })}
                            placeholder="9"
                          />
                        </div>

                        <div className="space-y-1">
                          <Label>Interval</Label>
                          <Select
                            value={formatInterval(price.interval) || undefined}
                            onValueChange={(value) => updatePrice(row.uid, { interval: value ? parseInterval(value) : undefined })}
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
