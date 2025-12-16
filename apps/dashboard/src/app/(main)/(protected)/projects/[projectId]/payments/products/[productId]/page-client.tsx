"use client";

import { EditableGrid, type EditableGridItem } from "@/components/editable-grid";
import { EditableInput } from "@/components/editable-input";
import { StyledLink } from "@/components/link";
import { SettingCard } from "@/components/settings";
import { CompleteConfig, Product } from "@stackframe/stack-shared/dist/config/schema";
import type { Transaction, TransactionEntry } from "@stackframe/stack-shared/dist/interface/crud/transactions";
import type { DayInterval } from "@stackframe/stack-shared/dist/utils/dates";
import { fromNow } from "@stackframe/stack-shared/dist/utils/dates";
import { prettyPrintWithMagnitudes } from "@stackframe/stack-shared/dist/utils/numbers";
import { typedEntries } from "@stackframe/stack-shared/dist/utils/objects";
import {
  ActionCell,
  AvatarCell,
  Badge,
  Button,
  Checkbox,
  cn,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Input,
  Label,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Separator,
  SimpleTooltip,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  toast,
  Typography,
} from "@stackframe/stack-ui";
import { Calendar, Clock, Copy, DollarSign, Gift, Hash, Layers, MoreHorizontal, Package, Pencil, Plus, Puzzle, Server, Trash2, Users } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Suspense, useMemo, useState } from "react";
import { PageLayout } from "../../../page-layout";
import { useAdminApp, useProjectId } from "../../../use-admin-app";
import { IntervalPopover } from "../components";
import { DEFAULT_INTERVAL_UNITS, generateUniqueId, intervalLabel, PRICE_INTERVAL_UNITS, shortIntervalLabel, type Price } from "../utils";

const CUSTOMER_TYPE_COLORS = {
  user: 'bg-blue-500/15 text-blue-600 dark:bg-blue-500/20 dark:text-blue-400 ring-blue-500/30',
  team: 'bg-emerald-500/15 text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-400 ring-emerald-500/30',
  custom: 'bg-amber-500/15 text-amber-600 dark:bg-amber-500/20 dark:text-amber-400 ring-amber-500/30',
} as const;

export default function PageClient({ productId }: { productId: string }) {
  const adminApp = useAdminApp();
  const project = adminApp.useProject();
  const config = project.useConfig();
  const product = config.payments.products[productId];

  if (!product) {
    return (
      <PageLayout title="Product Not Found">
        <div className="flex flex-col items-center justify-center py-12 gap-4">
          <Package className="h-12 w-12 text-muted-foreground/50" />
          <Typography className="text-muted-foreground">Product not found</Typography>
          <Button variant="outline" asChild>
            <Link href={`/projects/${adminApp.projectId}/payments/products`}>
              Back to Products
            </Link>
          </Button>
        </div>
      </PageLayout>
    );
  }

  return <ProductPage productId={productId} product={product} config={config} />;
}

type ProductPageProps = {
  productId: string,
  product: Product,
  config: CompleteConfig,
};

function ProductPage({ productId, product, config }: ProductPageProps) {
  const catalogId = product.catalogId;
  const catalogName = catalogId ? config.payments.catalogs[catalogId].displayName || catalogId : null;

  return (
    <PageLayout>
      <div className="flex flex-col gap-6">
        <ProductHeader productId={productId} product={product} catalogName={catalogName} />
        <Separator />
        <ProductDetailsSection productId={productId} product={product} config={config} />
        <Separator />
        <Suspense fallback={<CustomersSkeleton />}>
          <ProductCustomersSection productId={productId} product={product} />
        </Suspense>
      </div>
    </PageLayout>
  );
}

type ProductHeaderProps = {
  productId: string,
  product: Product,
  catalogName: string | null,
};

function ProductHeader({ productId, product, catalogName }: ProductHeaderProps) {
  const projectId = useProjectId();
  const adminApp = useAdminApp();
  const project = adminApp.useProject();
  const config = project.useConfig();
  const router = useRouter();
  const displayName = product.displayName || productId;
  const isAddOn = !!product.isAddOnTo?.length;

  // Find add-on parent products
  const addOnParents = useMemo(() => {
    if (!product.isAddOnTo?.length) return [];
    return product.isAddOnTo.map(parentId => ({
      id: parentId,
      displayName: config.payments.products[parentId].displayName || parentId,
    }));
  }, [product.isAddOnTo, config.payments.products]);

  return (
    <div className="flex gap-4 items-start">
      <div className={cn(
        "flex h-16 w-16 items-center justify-center rounded-xl shrink-0",
        "bg-gradient-to-br from-primary/20 to-primary/5",
        "border border-primary/20"
      )}>
        {isAddOn ? (
          <Puzzle className="h-8 w-8 text-primary" />
        ) : (
          <Package className="h-8 w-8 text-primary" />
        )}
      </div>
      <div className="flex-grow min-w-0 flex flex-col">
        <div className="flex items-center gap-2">
          <div className="flex-1 min-w-0">
            <EditableInput
              value={displayName}
              initialEditValue={product.displayName || ""}
              placeholder={productId}
              shiftTextToLeft
              inputClassName="text-2xl font-semibold tracking-tight w-full"
              onUpdate={async (newName) => {
                await project.updateConfig({
                  [`payments.products.${productId}.displayName`]: newName || null,
                });
                toast({ title: "Product name updated" });
              }}
            />
          </div>
          {isAddOn && (
            <Badge variant="outline" className="text-xs shrink-0">Add-on</Badge>
          )}
          {product.stackable && (
            <Badge variant="outline" className="text-xs shrink-0">Stackable</Badge>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="shrink-0">
                <MoreHorizontal className="h-5 w-5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => router.push(`/projects/${projectId}/payments/catalogs#product-${productId}`)}>
                View in Catalogs
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <div className="flex items-center gap-2 mt-1 text-sm text-muted-foreground flex-wrap">
          <span className={cn(
            "inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wide ring-1",
            CUSTOMER_TYPE_COLORS[product.customerType]
          )}>
            {product.customerType}
          </span>
          <span className="font-mono text-xs bg-muted px-2 py-0.5 rounded">ID: {productId}</span>
          {catalogName && (
            <>
              <span>•</span>
              <span>Catalog: {catalogName}</span>
            </>
          )}
          {addOnParents.length > 0 && (
            <>
              <span>•</span>
              <span className="flex items-center gap-1">
                Add-on to{' '}
                {addOnParents.map((p, i) => (
                  <span key={p.id}>
                    {i > 0 && ", "}
                    <StyledLink href={`/projects/${adminApp.projectId}/payments/products/${p.id}`}>
                      {p.displayName}
                    </StyledLink>
                  </span>
                ))}
              </span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

type ProductDetailsSectionProps = {
  productId: string,
  product: Product,
  config: CompleteConfig,
};

function ProductDetailsSection({ productId, product, config }: ProductDetailsSectionProps) {
  const adminApp = useAdminApp();
  const project = adminApp.useProject();

  // Dialog states
  const [addOnDialogOpen, setAddOnDialogOpen] = useState(false);
  const [freeTrialPopoverOpen, setFreeTrialPopoverOpen] = useState(false);

  // Add-on dialog state
  const [isAddOn, setIsAddOn] = useState(() => !!product.isAddOnTo && product.isAddOnTo !== false);
  const [selectedAddOnProducts, setSelectedAddOnProducts] = useState<Set<string>>(() => {
    if (!product.isAddOnTo || product.isAddOnTo === false) return new Set();
    return new Set(Object.keys(product.isAddOnTo));
  });

  // Free trial state
  const [freeTrialCount, setFreeTrialCount] = useState(7);
  const [freeTrialUnit, setFreeTrialUnit] = useState<DayInterval[1]>('day');

  // Get add-on parent products
  const addOnParents = useMemo(() => {
    if (!product.isAddOnTo || product.isAddOnTo === false) return [];
    return Object.keys(product.isAddOnTo).map((parentId: string) => ({
      id: parentId,
      displayName: config.payments.products[parentId].displayName || parentId,
    }));
  }, [product.isAddOnTo, config.payments.products]);

  // Get all available products for add-on selection (same customer type and catalog, excluding this product)
  const availableProducts = useMemo(() => {
    return Object.entries(config.payments.products)
      .filter(([id, p]) =>
        id !== productId &&
        p.customerType === product.customerType &&
        p.catalogId === product.catalogId
      )
      .map(([id, p]) => ({
        id,
        displayName: p.displayName || id,
      }));
  }, [config.payments.products, productId, product.customerType, product.catalogId]);

  // Check if any price has a free trial
  const freeTrialInfo = useMemo(() => {
    if (product.prices === 'include-by-default' || typeof product.prices !== 'object') return null;
    for (const [, price] of typedEntries(product.prices as Record<string, Price>)) {
      if (price.freeTrial) {
        return price.freeTrial;
      }
    }
    return null;
  }, [product.prices]);

  const freeTrialDisplayText = useMemo(() => {
    if (!freeTrialInfo) return 'None';
    const [count, unit] = freeTrialInfo;
    return `${count} ${count === 1 ? unit : unit + 's'}`;
  }, [freeTrialInfo]);

  // Check if any price is server-only
  const hasServerOnlyPrice = useMemo(() => {
    if (product.prices === 'include-by-default' || typeof product.prices !== 'object') return false;
    return Object.values(product.prices as Record<string, Price>).some(price => price.serverOnly);
  }, [product.prices]);

  // Handlers
  const handleStackableUpdate = async (value: boolean) => {
    await project.updateConfig({
      [`payments.products.${productId}.stackable`]: value || null,
    });
    toast({ title: value ? "Product is now stackable" : "Product is no longer stackable" });
  };

  const handleServerOnlyUpdate = async (value: boolean) => {
    // Update all prices to have the new serverOnly value
    if (product.prices === 'include-by-default' || typeof product.prices !== 'object') return;

    const updatedPrices: Record<string, object> = {};
    for (const [priceId, price] of typedEntries(product.prices as Record<string, Price>)) {
      updatedPrices[priceId] = {
        ...price,
        serverOnly: value,
      };
    }

    await project.updateConfig({
      [`payments.products.${productId}.prices`]: updatedPrices,
    });
    toast({ title: value ? "All prices are now server only" : "Prices are no longer server only" });
  };

  const handleAddOnSave = async () => {
    if (isAddOn && selectedAddOnProducts.size === 0) {
      toast({ title: "Please select at least one product", variant: "destructive" });
      return;
    }

    const addOnValue = isAddOn
      ? Object.fromEntries([...selectedAddOnProducts].map(id => [id, true]))
      : null;

    await project.updateConfig({
      [`payments.products.${productId}.isAddOnTo`]: addOnValue,
    });
    setAddOnDialogOpen(false);
    toast({ title: isAddOn ? "Add-on configuration updated" : "Product is no longer an add-on" });
  };

  const handleFreeTrialSave = async (count: number, unit: DayInterval[1]) => {
    // Update all prices to have the new free trial
    if (product.prices === 'include-by-default' || typeof product.prices !== 'object') return;

    const updatedPrices: Record<string, object> = {};
    for (const [priceId, price] of typedEntries(product.prices as Record<string, Price>)) {
      // Only add free trial to recurring prices
      if (price.interval) {
        updatedPrices[priceId] = {
          ...price,
          freeTrial: [count, unit] as DayInterval,
        };
      } else {
        updatedPrices[priceId] = price;
      }
    }

    await project.updateConfig({
      [`payments.products.${productId}.prices`]: updatedPrices,
    });
    setFreeTrialPopoverOpen(false);
    toast({ title: "Free trial updated" });
  };

  const handleRemoveFreeTrial = async () => {
    if (product.prices === 'include-by-default' || typeof product.prices !== 'object') return;

    const updatedPrices: Record<string, object> = {};
    for (const [priceId, price] of typedEntries(product.prices as Record<string, Price>)) {
      const { freeTrial: _, ...rest } = price;
      updatedPrices[priceId] = rest;
    }

    await project.updateConfig({
      [`payments.products.${productId}.prices`]: updatedPrices,
    });
    setFreeTrialPopoverOpen(false);
    toast({ title: "Free trial removed" });
  };

  // Check if product has recurring prices (for free trial availability)
  const hasRecurringPrices = useMemo(() => {
    if (product.prices === 'include-by-default' || typeof product.prices !== 'object') return false;
    return Object.values(product.prices as Record<string, Price>).some(price => price.interval);
  }, [product.prices]);

  // Build grid items for EditableGrid
  const gridItems: EditableGridItem[] = [
    {
      type: 'text',
      icon: <Hash size={16} />,
      name: "Product ID",
      tooltip: "The unique identifier for this product. Used in API calls and code.",
      value: productId,
      readOnly: true,
    },
    {
      type: 'boolean',
      icon: <Layers size={16} />,
      name: "Stackable",
      tooltip: "Stackable products can be purchased multiple times by the same customer.",
      value: !!product.stackable,
      onUpdate: handleStackableUpdate,
    },
    {
      type: 'custom-button',
      icon: <Puzzle size={16} />,
      name: "Add-on",
      tooltip: "Add-ons are optional extras that can only be purchased alongside a parent product.",
      onClick: () => {
        // Reset dialog state when opening
        setIsAddOn(!!product.isAddOnTo && product.isAddOnTo !== false);
        setSelectedAddOnProducts(
          product.isAddOnTo && product.isAddOnTo !== false
            ? new Set(Object.keys(product.isAddOnTo))
            : new Set()
        );
        setAddOnDialogOpen(true);
      },
      children: addOnParents.length > 0 ? (
        <span>
          To{' '}
          {addOnParents.map((p, i) => (
            <span key={p.id}>
              {i > 0 && ', '}
              {p.displayName}
            </span>
          ))}
        </span>
      ) : 'No',
    },
    {
      type: 'custom',
      icon: <Clock size={16} />,
      name: "Free Trial",
      tooltip: "Free trial period for recurring subscriptions. Customers won't be charged during this period.",
      children: (
        <Popover open={freeTrialPopoverOpen} onOpenChange={setFreeTrialPopoverOpen}>
          <PopoverTrigger asChild>
            <button
              disabled={!hasRecurringPrices}
              className={cn(
                "w-full px-1 py-0 h-[unset] border-transparent rounded text-left text-foreground",
                hasRecurringPrices && "hover:ring-1 hover:ring-slate-300 dark:hover:ring-gray-500 hover:bg-slate-50 dark:hover:bg-gray-800 hover:cursor-pointer",
                "focus:outline-none focus-visible:ring-1 focus-visible:ring-slate-500 dark:focus-visible:ring-gray-50",
                "transition-colors duration-150 hover:transition-none",
                !hasRecurringPrices && "opacity-50 cursor-not-allowed"
              )}
            >
              {freeTrialDisplayText}
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-64 p-3">
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Input
                  className="w-20"
                  type="number"
                  min={1}
                  value={freeTrialCount}
                  onChange={(e) => setFreeTrialCount(parseInt(e.target.value) || 1)}
                />
                <Select value={freeTrialUnit} onValueChange={(v) => setFreeTrialUnit(v as DayInterval[1])}>
                  <SelectTrigger className="w-24">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DEFAULT_INTERVAL_UNITS.map((unit) => (
                      <SelectItem key={unit} value={unit}>
                        {unit}{freeTrialCount !== 1 ? 's' : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  className="flex-1"
                  onClick={() => handleFreeTrialSave(freeTrialCount, freeTrialUnit)}
                >
                  Save
                </Button>
                {freeTrialInfo && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleRemoveFreeTrial}
                  >
                    Remove
                  </Button>
                )}
              </div>
            </div>
          </PopoverContent>
        </Popover>
      ),
    },
    {
      type: 'boolean',
      icon: <Server size={16} />,
      name: "Server Only",
      tooltip: "Server-only prices can only be assigned through server-side API calls, not by customers directly.",
      value: hasServerOnlyPrice,
      onUpdate: handleServerOnlyUpdate,
    },
    {
      type: 'text',
      icon: <Calendar size={16} />,
      name: "Customer Type",
      tooltip: "Determines whether this product is for individual users, teams, or custom entities.",
      value: product.customerType,
      readOnly: true,
    },
    {
      type: 'custom',
      icon: <DollarSign size={16} />,
      name: "Prices",
      tooltip: "Pricing options for this product. Multiple prices allow different billing intervals or pricing tiers.",
      children: <ProductPricesSection productId={productId} product={product} inline />,
    },
    {
      type: 'custom',
      icon: <Package size={16} />,
      name: "Included Items",
      tooltip: "Items that customers receive when they purchase this product.",
      children: <ProductItemsSection productId={productId} product={product} config={config} inline />,
    },
  ];

  return (
    <>
      <EditableGrid items={gridItems} columns={2} />

      {/* Add-on Configuration Dialog */}
      <Dialog open={addOnDialogOpen} onOpenChange={setAddOnDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add-on Configuration</DialogTitle>
            <DialogDescription>
              Add-ons are optional products that can only be purchased when a customer already owns one of the parent products. They&apos;re great for extras like additional seats, premium features, or one-time upgrades. A product can only be an add-on to products with the same customer type and in the same catalog.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="flex items-center gap-2">
              <Checkbox
                id="is-addon"
                checked={isAddOn}
                onCheckedChange={(checked) => {
                  setIsAddOn(!!checked);
                  if (!checked) setSelectedAddOnProducts(new Set());
                }}
              />
              <Label htmlFor="is-addon" className="cursor-pointer">
                This product is an add-on
              </Label>
            </div>

            {isAddOn && (
              <div className="space-y-2">
                <Label className="text-sm font-medium">
                  Select parent products (at least one required):
                </Label>
                <div className="max-h-48 overflow-y-auto space-y-2 rounded-md border p-3">
                  {availableProducts.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No other products with the same customer type and catalog</p>
                  ) : (
                    availableProducts.map((p) => (
                      <div key={p.id} className="flex items-center gap-2">
                        <Checkbox
                          id={`addon-${p.id}`}
                          checked={selectedAddOnProducts.has(p.id)}
                          onCheckedChange={(checked) => {
                            const newSet = new Set(selectedAddOnProducts);
                            if (checked) {
                              newSet.add(p.id);
                            } else {
                              newSet.delete(p.id);
                            }
                            setSelectedAddOnProducts(newSet);
                          }}
                        />
                        <Label htmlFor={`addon-${p.id}`} className="cursor-pointer text-sm">
                          {p.displayName}
                        </Label>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOnDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleAddOnSave}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

type ProductPricesSectionProps = {
  productId: string,
  product: Product,
  inline?: boolean,
};

type EditingPrice = {
  priceId: string,
  amount: string,
  intervalSelection: 'one-time' | 'custom' | DayInterval[1],
  intervalCount: number,
  priceInterval: DayInterval[1] | undefined,
  freeTrialEnabled: boolean,
  freeTrialCount: number,
  freeTrialUnit: DayInterval[1],
  serverOnly: boolean,
};

function ProductPricesSection({ productId, product, inline = false }: ProductPricesSectionProps) {
  const adminApp = useAdminApp();
  const project = adminApp.useProject();
  const prices = product.prices;
  const [editingPrice, setEditingPrice] = useState<EditingPrice | null>(null);
  const [isAddingPrice, setIsAddingPrice] = useState(false);

  const handleSavePrice = async (editing: EditingPrice, isNew: boolean) => {
    const interval: DayInterval | undefined = editing.intervalSelection === 'one-time'
      ? undefined
      : [editing.intervalCount, editing.priceInterval || 'month'];

    const freeTrial: DayInterval | undefined = editing.freeTrialEnabled && interval
      ? [editing.freeTrialCount, editing.freeTrialUnit]
      : undefined;

    const newPrice: Price = {
      USD: editing.amount,
      ...(interval && { interval }),
      ...(freeTrial && { freeTrial }),
      ...(editing.serverOnly && { serverOnly: true }),
    };

    const currentPrices = typeof prices === 'object' && prices !== null ? prices : {};
    const updatedPrices = {
      ...currentPrices,
      [editing.priceId]: newPrice,
    };

    await project.updateConfig({
      [`payments.products.${productId}.prices`]: updatedPrices,
    });

    toast({ title: isNew ? "Price added" : "Price updated" });
    setEditingPrice(null);
    setIsAddingPrice(false);
  };

  const handleDeletePrice = async (priceId: string) => {
    const currentPrices = typeof prices === 'object' && prices !== null ? prices : {};
    const { [priceId]: _, ...remainingPrices } = currentPrices as Record<string, Price>;

    await project.updateConfig({
      [`payments.products.${productId}.prices`]: Object.keys(remainingPrices).length > 0 ? remainingPrices : null,
    });

    toast({ title: "Price deleted" });
  };

  const handleMakeFree = async () => {
    await project.updateConfig({
      [`payments.products.${productId}.prices`]: 'include-by-default',
    });

    toast({ title: "Product is now free" });
  };

  const openEditDialog = (priceId: string, price: Price) => {
    setEditingPrice({
      priceId,
      amount: price.USD || '0.00',
      intervalSelection: price.interval ? (price.interval[0] === 1 ? price.interval[1] : 'custom') : 'one-time',
      intervalCount: price.interval?.[0] || 1,
      priceInterval: price.interval?.[1],
      freeTrialEnabled: !!price.freeTrial,
      freeTrialCount: price.freeTrial?.[0] || 7,
      freeTrialUnit: price.freeTrial?.[1] || 'day',
      serverOnly: !!price.serverOnly,
    });
  };

  const openAddDialog = () => {
    const newId = generateUniqueId('price');
    setEditingPrice({
      priceId: newId,
      amount: '9.99',
      intervalSelection: 'month',
      intervalCount: 1,
      priceInterval: 'month',
      freeTrialEnabled: false,
      freeTrialCount: 7,
      freeTrialUnit: 'day',
      serverOnly: false,
    });
    setIsAddingPrice(true);
  };

  // Handle "include-by-default" string value (free product)
  if (prices === 'include-by-default') {
    const content = (
      <div className="flex items-center gap-2 text-sm pl-1">
        <span className="font-semibold text-foreground">Free</span>
        <span className="text-muted-foreground">— Included by default</span>
      </div>
    );
    if (inline) return content;
    return (
      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Prices</h3>
        {content}
      </div>
    );
  }

  const priceEntries = prices && typeof prices === 'object' ? typedEntries(prices as Record<string, Price>) : [];

  const listContent = (
    <div className="pl-1">
      {priceEntries.length === 0 ? (
        <p className="text-sm text-muted-foreground">No prices configured</p>
      ) : (
        <div className="flex flex-col">
          {priceEntries.map(([priceId, price]) => {
            const intervalText = price.interval ? intervalLabel(price.interval) : 'One-time';
            return (
              <div key={priceId} className="group flex items-center text-sm leading-6">
                <span className="font-semibold text-foreground">${price.USD}</span>
                <span className="text-muted-foreground ml-1.5">{intervalText}</span>
                {price.freeTrial && (
                  <Badge variant="outline" className="text-[10px] ml-1.5 h-4 py-0 leading-none">
                    {price.freeTrial[0]} {price.freeTrial[1]} trial
                  </Badge>
                )}
                {price.serverOnly && (
                  <Badge variant="outline" className="text-[10px] ml-1.5 h-4 py-0 leading-none">Server only</Badge>
                )}
                <div className="opacity-0 group-hover:opacity-100 flex items-center ml-1">
                  <SimpleTooltip tooltip="Edit">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-5 w-5 p-0"
                      onClick={() => openEditDialog(priceId, price)}
                    >
                      <Pencil className="h-3 w-3" />
                    </Button>
                  </SimpleTooltip>
                  <SimpleTooltip tooltip="Delete">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-5 w-5 p-0 text-destructive hover:text-destructive"
                      onClick={() => handleDeletePrice(priceId)}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </SimpleTooltip>
                </div>
              </div>
            );
          })}
        </div>
      )}
      <div className="flex items-center gap-2 mt-1">
        <Button
          variant="ghost"
          size="sm"
          className="w-fit h-6 px-1 text-xs text-muted-foreground hover:text-foreground"
          onClick={openAddDialog}
        >
          <Plus className="h-3 w-3 mr-1" />
          Add price option
        </Button>
        {priceEntries.length === 0 && (
          <>
            <span className="text-[10px] font-medium text-muted-foreground/60 uppercase tracking-wider">or</span>
            <Button
              variant="ghost"
              size="sm"
              className="w-fit h-6 px-1 text-xs text-muted-foreground hover:text-foreground"
              onClick={handleMakeFree}
            >
              <Gift className="h-3 w-3 mr-1" />
              Make free
            </Button>
          </>
        )}
      </div>
    </div>
  );

  const priceDialog = (
    /* Price Edit Dialog */
    <Dialog open={!!editingPrice} onOpenChange={(open) => { if (!open) { setEditingPrice(null); setIsAddingPrice(false); } }}>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>{isAddingPrice ? "Add Price" : "Edit Price"}</DialogTitle>
          <DialogDescription>
            Configure the pricing option for this product.
          </DialogDescription>
        </DialogHeader>
        {editingPrice && (
          <div className="grid gap-4 py-4">
            {/* Amount */}
            <div className="grid gap-2">
              <Label>Amount (USD)</Label>
              <div className="relative">
                <Input
                  className="pl-6"
                  value={editingPrice.amount}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v === '' || /^\d*(?:\.?\d{0,2})?$/.test(v)) {
                      setEditingPrice({ ...editingPrice, amount: v });
                    }
                  }}
                  placeholder="9.99"
                />
                <span className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
              </div>
            </div>

            {/* Billing Frequency */}
            <div className="grid gap-2">
              <Label>Billing Frequency</Label>
              <IntervalPopover
                intervalText={intervalLabel(
                  editingPrice.intervalSelection === 'one-time'
                    ? undefined
                    : [editingPrice.intervalCount, editingPrice.priceInterval || 'month']
                )}
                intervalSelection={editingPrice.intervalSelection}
                unit={editingPrice.priceInterval}
                count={editingPrice.intervalCount}
                setIntervalSelection={(v) => setEditingPrice({ ...editingPrice, intervalSelection: v })}
                setUnit={(v) => setEditingPrice({ ...editingPrice, priceInterval: v })}
                setCount={(v) => setEditingPrice({ ...editingPrice, intervalCount: v })}
                allowedUnits={PRICE_INTERVAL_UNITS}
                triggerClassName="h-10 w-full justify-between rounded-md border border-input bg-background px-3 py-2 text-sm"
                onChange={(interval) => {
                  if (interval) {
                    setEditingPrice({
                      ...editingPrice,
                      intervalSelection: interval[0] === 1 ? interval[1] : 'custom',
                      intervalCount: interval[0],
                      priceInterval: interval[1],
                    });
                  } else {
                    setEditingPrice({
                      ...editingPrice,
                      intervalSelection: 'one-time',
                      intervalCount: 1,
                      priceInterval: undefined,
                      freeTrialEnabled: false,
                    });
                  }
                }}
              />
            </div>

            {/* Free Trial (only for recurring) */}
            {editingPrice.intervalSelection !== 'one-time' && (
              <div className="grid gap-2">
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="free-trial"
                    checked={editingPrice.freeTrialEnabled}
                    onCheckedChange={(checked) => setEditingPrice({ ...editingPrice, freeTrialEnabled: !!checked })}
                  />
                  <Label htmlFor="free-trial" className="cursor-pointer">Free trial</Label>
                </div>
                {editingPrice.freeTrialEnabled && (
                  <div className="flex items-center gap-2 ml-6">
                    <Input
                      className="w-20"
                      type="number"
                      min={1}
                      value={editingPrice.freeTrialCount}
                      onChange={(e) => setEditingPrice({ ...editingPrice, freeTrialCount: parseInt(e.target.value) || 1 })}
                    />
                    <Select
                      value={editingPrice.freeTrialUnit}
                      onValueChange={(v) => setEditingPrice({ ...editingPrice, freeTrialUnit: v as DayInterval[1] })}
                    >
                      <SelectTrigger className="w-24">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {DEFAULT_INTERVAL_UNITS.map((unit) => (
                          <SelectItem key={unit} value={unit}>
                            {unit}{editingPrice.freeTrialCount !== 1 ? 's' : ''}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>
            )}

            {/* Server Only */}
            <div className="flex items-center gap-2">
              <Checkbox
                id="server-only"
                checked={editingPrice.serverOnly}
                onCheckedChange={(checked) => setEditingPrice({ ...editingPrice, serverOnly: !!checked })}
              />
              <Label htmlFor="server-only" className="cursor-pointer">Server only</Label>
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => { setEditingPrice(null); setIsAddingPrice(false); }}>
            Cancel
          </Button>
          <Button onClick={() => editingPrice && handleSavePrice(editingPrice, isAddingPrice)}>
            {isAddingPrice ? "Add Price" : "Save Changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  if (inline) {
    return (
      <>
        {listContent}
        {priceDialog}
      </>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Prices</h3>
      {listContent}
      {priceDialog}
    </div>
  );
}

type ProductItemsSectionProps = {
  productId: string,
  product: Product,
  config: CompleteConfig,
  inline?: boolean,
};

type EditingItem = {
  itemId: string,
  quantity: number,
  repeatSelection: 'once' | 'custom' | DayInterval[1],
  repeatCount: number,
  repeatUnit: DayInterval[1] | undefined,
};

function ProductItemsSection({ productId, product, config, inline = false }: ProductItemsSectionProps) {
  const adminApp = useAdminApp();
  const project = adminApp.useProject();
  const items = product.includedItems;
  const [editingItem, setEditingItem] = useState<EditingItem | null>(null);
  const [isAddingItem, setIsAddingItem] = useState(false);
  const [selectedItemId, setSelectedItemId] = useState<string>('');

  // Get all available items for this customer type
  const availableItems = useMemo(() => {
    return typedEntries(config.payments.items)
      .filter(([_, item]) => item.customerType === product.customerType)
      .map(([id, item]) => ({ id, displayName: item.displayName || id }));
  }, [config.payments.items, product.customerType]);

  const handleSaveItem = async (editing: EditingItem, isNew: boolean) => {
    const repeat: DayInterval | 'once' = editing.repeatSelection === 'once'
      ? 'once'
      : [editing.repeatCount, editing.repeatUnit || 'month'];

    const newItem = {
      quantity: editing.quantity,
      repeat,
    };

    const currentItems = items || {};
    const updatedItems = {
      ...currentItems,
      [editing.itemId]: newItem,
    };

    await project.updateConfig({
      [`payments.products.${productId}.includedItems`]: updatedItems,
    });

    toast({ title: isNew ? "Item added" : "Item updated" });
  setEditingItem(null);
  setIsAddingItem(false);
  setSelectedItemId('');
  };

  const handleDeleteItem = async (itemId: string) => {
    const currentItems = items || {};
    const { [itemId]: _, ...remainingItems } = currentItems;

    await project.updateConfig({
      [`payments.products.${productId}.includedItems`]: Object.keys(remainingItems).length > 0 ? remainingItems : null,
    });

    toast({ title: "Item removed" });
  };

  const openEditDialog = (itemId: string, item: { quantity: number, repeat: DayInterval | 'once' }) => {
    const repeatInterval = item.repeat === 'once' ? undefined : item.repeat;
    setEditingItem({
      itemId,
      quantity: item.quantity,
      repeatSelection: item.repeat === 'once' ? 'once' : (repeatInterval?.[0] === 1 ? repeatInterval[1] : 'custom'),
      repeatCount: repeatInterval?.[0] || 1,
      repeatUnit: repeatInterval?.[1],
    });
    setSelectedItemId(itemId);
  };

  const openAddDialog = () => {
    // Find first available item not already included
    const includedIds = new Set(Object.keys(items || {}));
    const firstAvailable = availableItems.find(i => !includedIds.has(i.id));
    if (firstAvailable) {
      setEditingItem({
        itemId: firstAvailable.id,
        quantity: 1,
        repeatSelection: 'once',
        repeatCount: 1,
        repeatUnit: 'month',
      });
      setSelectedItemId(firstAvailable.id);
    } else if (availableItems.length > 0) {
      setEditingItem({
        itemId: availableItems[0].id,
        quantity: 1,
        repeatSelection: 'once',
        repeatCount: 1,
        repeatUnit: 'month',
      });
      setSelectedItemId(availableItems[0].id);
    }
    setIsAddingItem(true);
  };

  const handleCopyPrompt = (itemId: string, displayName: string) => {
    const prompt = `Check if the current user has the "${displayName}" (${itemId}) item.`;
    navigator.clipboard.writeText(prompt);
    toast({ title: "Prompt copied to clipboard" });
  };

  const itemEntries = items ? typedEntries(items) : [];

  const listContent = (
    <div className="pl-1">
      {itemEntries.length === 0 ? (
        <p className="text-sm text-muted-foreground">No items included</p>
      ) : (
        <div className="flex flex-col">
          {itemEntries.map(([itemId, item]) => {
            const itemConfig = config.payments.items[itemId];
            const displayName = itemConfig.displayName || itemId;
            return (
              <div key={itemId} className="group flex items-center text-sm leading-6">
                <span className="font-semibold tabular-nums text-foreground">{prettyPrintWithMagnitudes(item.quantity)}×</span>
                <span className="ml-1.5 text-foreground">{displayName}</span>
                <span className="text-muted-foreground ml-1.5">{shortIntervalLabel(item.repeat)}</span>
                <div className="opacity-0 group-hover:opacity-100 flex items-center ml-1">
                  <SimpleTooltip tooltip="Copy prompt">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-5 w-5 p-0"
                      onClick={() => handleCopyPrompt(itemId, displayName)}
                    >
                      <Copy className="h-3 w-3" />
                    </Button>
                  </SimpleTooltip>
                  <SimpleTooltip tooltip="Edit">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-5 w-5 p-0"
                      onClick={() => openEditDialog(itemId, item)}
                    >
                      <Pencil className="h-3 w-3" />
                    </Button>
                  </SimpleTooltip>
                  <SimpleTooltip tooltip="Delete">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-5 w-5 p-0 text-destructive hover:text-destructive"
                      onClick={() => handleDeleteItem(itemId)}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </SimpleTooltip>
                </div>
              </div>
            );
          })}
        </div>
      )}
      <div className="mt-1">
        <Button
          variant="ghost"
          size="sm"
          className="w-fit h-6 px-1 text-xs text-muted-foreground hover:text-foreground"
          onClick={openAddDialog}
          disabled={availableItems.length === 0}
        >
          <Plus className="h-3 w-3 mr-1" />
          Add included item
        </Button>
      </div>
    </div>
  );

  const itemDialog = (
    /* Item Edit Dialog */
    <Dialog open={!!editingItem} onOpenChange={(open) => { if (!open) { setEditingItem(null); setIsAddingItem(false); setSelectedItemId(''); } }}>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>{isAddingItem ? "Add Included Item" : "Edit Included Item"}</DialogTitle>
          <DialogDescription>
            Configure how much of this item customers receive.
          </DialogDescription>
        </DialogHeader>
        {editingItem && (
          <div className="grid gap-4 py-4">
            {/* Item Selection (only for adding) */}
            {isAddingItem && (
              <div className="grid gap-2">
                <Label>Item</Label>
                <Select
                  value={selectedItemId}
                  onValueChange={(v) => {
                    setSelectedItemId(v);
                    setEditingItem({ ...editingItem, itemId: v });
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select an item" />
                  </SelectTrigger>
                  <SelectContent>
                    {availableItems.map((item) => (
                      <SelectItem key={item.id} value={item.id}>
                        {item.displayName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Quantity */}
            <div className="grid gap-2">
              <Label>Quantity</Label>
              <Input
                type="number"
                min={1}
                value={editingItem.quantity}
                onChange={(e) => setEditingItem({ ...editingItem, quantity: parseInt(e.target.value) || 1 })}
              />
            </div>

            {/* Repeat */}
            <div className="grid gap-2">
              <Label>Repeat</Label>
              <Select
                value={editingItem.repeatSelection}
                onValueChange={(v) => {
                  const selection = v as 'once' | 'custom' | DayInterval[1];
                  if (selection === 'once') {
                    setEditingItem({ ...editingItem, repeatSelection: 'once', repeatUnit: undefined });
                  } else if (selection === 'custom') {
                    setEditingItem({ ...editingItem, repeatSelection: 'custom', repeatUnit: 'month' });
                  } else {
                    setEditingItem({ ...editingItem, repeatSelection: selection, repeatCount: 1, repeatUnit: selection });
                  }
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="once">Once (on purchase)</SelectItem>
                  <SelectItem value="day">Daily</SelectItem>
                  <SelectItem value="week">Weekly</SelectItem>
                  <SelectItem value="month">Monthly</SelectItem>
                  <SelectItem value="year">Yearly</SelectItem>
                  <SelectItem value="custom">Custom interval</SelectItem>
                </SelectContent>
              </Select>
              {editingItem.repeatSelection === 'custom' && (
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">Every</span>
                  <Input
                    className="w-20"
                    type="number"
                    min={1}
                    value={editingItem.repeatCount}
                    onChange={(e) => setEditingItem({ ...editingItem, repeatCount: parseInt(e.target.value) || 1 })}
                  />
                  <Select
                    value={editingItem.repeatUnit || 'month'}
                    onValueChange={(v) => setEditingItem({ ...editingItem, repeatUnit: v as DayInterval[1] })}
                  >
                    <SelectTrigger className="w-24">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {DEFAULT_INTERVAL_UNITS.map((unit) => (
                        <SelectItem key={unit} value={unit}>
                          {unit}{editingItem.repeatCount !== 1 ? 's' : ''}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => { setEditingItem(null); setIsAddingItem(false); setSelectedItemId(''); }}>
            Cancel
          </Button>
          <Button onClick={() => editingItem && handleSaveItem(editingItem, isAddingItem)}>
            {isAddingItem ? "Add Item" : "Save Changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  if (inline) {
    return (
      <>
        {listContent}
        {itemDialog}
      </>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Included Items</h3>
      {listContent}
      {itemDialog}
    </div>
  );
}

function CustomersSkeleton() {
  return (
    <SettingCard
      title="Customers"
      description="Customers who have purchased this product"
    >
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Customer</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Purchased</TableHead>
              <TableHead className="w-[80px]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {Array.from({ length: 3 }).map((_, i) => (
              <TableRow key={i}>
                <TableCell><Skeleton className="h-8 w-32" /></TableCell>
                <TableCell><Skeleton className="h-4 w-16" /></TableCell>
                <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                <TableCell><Skeleton className="h-8 w-8" /></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </SettingCard>
  );
}

type ProductCustomersSectionProps = {
  productId: string,
  product: Product,
};

function isProductGrantEntry(entry: TransactionEntry): entry is Extract<TransactionEntry, { type: 'product_grant' }> {
  return entry.type === 'product_grant';
}

function ProductCustomersSection({ productId, product }: ProductCustomersSectionProps) {
  const adminApp = useAdminApp();
  // Get transactions filtered by this product
  const { transactions } = adminApp.useTransactions({ limit: 100 });

  // Filter transactions for this product and extract unique customers
  const customersWithTransactions = useMemo(() => {
    const customerMap = new Map<string, {
      customerType: string,
      customerId: string,
      latestTransaction: Transaction,
    }>();

    for (const transaction of transactions) {
      // Only consider purchase transactions
      if (transaction.type !== 'purchase') continue;

      const productGrant = transaction.entries.find(isProductGrantEntry);
      if (!productGrant || productGrant.product_id !== productId) continue;

      const customerEntry = transaction.entries.find(e => 'customer_type' in e && 'customer_id' in e) as { customer_type: string, customer_id: string } | undefined;
      if (!customerEntry) continue;

      const key = `${customerEntry.customer_type}:${customerEntry.customer_id}`;
      const existing = customerMap.get(key);

      // Keep the latest transaction for each customer
      if (!existing || transaction.created_at_millis > existing.latestTransaction.created_at_millis) {
        customerMap.set(key, {
          customerType: customerEntry.customer_type,
          customerId: customerEntry.customer_id,
          latestTransaction: transaction,
        });
      }
    }

    return Array.from(customerMap.values()).sort(
      (a, b) => b.latestTransaction.created_at_millis - a.latestTransaction.created_at_millis
    );
  }, [transactions, productId]);

  return (
    <SettingCard
      title="Customers"
      description={`Customers who have purchased this product (${customersWithTransactions.length} found)`}
    >
      {customersWithTransactions.length === 0 ? (
        <div className="flex flex-col items-center gap-2 p-8 border rounded-md bg-muted/10">
          <Users className="h-8 w-8 text-muted-foreground/50" />
          <p className="text-sm text-muted-foreground text-center">
            No customers have purchased this product yet
          </p>
        </div>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Customer</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Purchased</TableHead>
                <TableHead className="w-[80px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {customersWithTransactions.map(({ customerType, customerId, latestTransaction }) => (
                <CustomerRow
                  key={`${customerType}:${customerId}`}
                  customerType={customerType}
                  customerId={customerId}
                  purchasedAt={new Date(latestTransaction.created_at_millis)}
                />
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </SettingCard>
  );
}

type CustomerRowProps = {
  customerType: string,
  customerId: string,
  purchasedAt: Date,
};

function CustomerRow({ customerType, customerId, purchasedAt }: CustomerRowProps) {
  const adminApp = useAdminApp();

  return (
    <TableRow>
      <TableCell>
        {customerType === 'user' ? (
          <UserCell userId={customerId} />
        ) : customerType === 'team' ? (
          <TeamCell teamId={customerId} />
        ) : (
          <div className="flex items-center gap-2">
            <AvatarCell fallback="?" />
            <span className="font-mono text-xs">{customerId}</span>
          </div>
        )}
      </TableCell>
      <TableCell>
        <span className={cn(
          "inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wide ring-1",
          CUSTOMER_TYPE_COLORS[customerType as keyof typeof CUSTOMER_TYPE_COLORS] || CUSTOMER_TYPE_COLORS.custom
        )}>
          {customerType}
        </span>
      </TableCell>
      <TableCell className="text-muted-foreground">
        {fromNow(purchasedAt)}
      </TableCell>
      <TableCell>
        <ActionCell
          items={[
            ...(customerType === 'user' ? [{
              item: "View User",
              onClick: () => {
                window.open(`/projects/${adminApp.projectId}/users/${customerId}`, '_blank', 'noopener');
              },
            }] : []),
            ...(customerType === 'team' ? [{
              item: "View Team",
              onClick: () => {
                window.open(`/projects/${adminApp.projectId}/teams/${customerId}`, '_blank', 'noopener');
              },
            }] : []),
          ]}
        />
      </TableCell>
    </TableRow>
  );
}

function UserCell({ userId }: { userId: string }) {
  const adminApp = useAdminApp();
  const user = adminApp.useUser(userId);

  if (!user) {
    return (
      <div className="flex items-center gap-2">
        <AvatarCell fallback="?" />
        <span className="font-mono text-xs text-muted-foreground">{userId}</span>
      </div>
    );
  }

  return (
    <Link href={`/projects/${adminApp.projectId}/users/${userId}`}>
      <div className="flex items-center gap-2 hover:text-primary transition-colors">
        <AvatarCell
          src={user.profileImageUrl ?? undefined}
          fallback={user.displayName?.charAt(0) ?? user.primaryEmail?.charAt(0) ?? '?'}
        />
        <span className="truncate max-w-[150px]">
          {user.displayName ?? user.primaryEmail ?? userId}
        </span>
      </div>
    </Link>
  );
}

function TeamCell({ teamId }: { teamId: string }) {
  const adminApp = useAdminApp();
  const team = adminApp.useTeam(teamId);

  if (!team) {
    return (
      <div className="flex items-center gap-2">
        <AvatarCell fallback="?" />
        <span className="font-mono text-xs text-muted-foreground">{teamId}</span>
      </div>
    );
  }

  return (
    <Link href={`/projects/${adminApp.projectId}/teams/${teamId}`}>
      <div className="flex items-center gap-2 hover:text-primary transition-colors">
        <AvatarCell
          src={team.profileImageUrl ?? undefined}
          fallback={team.displayName.charAt(0)}
        />
        <span className="truncate max-w-[150px]">
          {team.displayName}
        </span>
      </div>
    </Link>
  );
}
