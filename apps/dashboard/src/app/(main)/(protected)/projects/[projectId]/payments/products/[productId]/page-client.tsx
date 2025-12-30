"use client";

import { EditableGrid, type EditableGridItem } from "@/components/editable-grid";
import { EditableInput } from "@/components/editable-input";
import { Link, StyledLink } from "@/components/link";
import { useRouter } from "@/components/router";
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
} from "@/components/ui";
import { useUpdateConfig } from "@/lib/config-update";
import { ArrowLeftIcon, ClockIcon, CopyIcon, CurrencyDollarIcon, DotsThreeIcon, FolderOpenIcon, GiftIcon, HardDriveIcon, PackageIcon, PencilSimpleIcon, PlusIcon, PuzzlePieceIcon, StackIcon, TagIcon, TrashIcon, UsersIcon, XIcon } from "@phosphor-icons/react";
import type { CompleteConfig } from "@stackframe/stack-shared/dist/config/schema";
import type { Transaction, TransactionEntry } from "@stackframe/stack-shared/dist/interface/crud/transactions";
import type { DayInterval } from "@stackframe/stack-shared/dist/utils/dates";
import { fromNow } from "@stackframe/stack-shared/dist/utils/dates";
import { prettyPrintWithMagnitudes } from "@stackframe/stack-shared/dist/utils/numbers";
import { typedEntries } from "@stackframe/stack-shared/dist/utils/objects";
import { Suspense, useMemo, useState } from "react";
import { PageLayout } from "../../../page-layout";
import { useAdminApp, useProjectId } from "../../../use-admin-app";
import { CreateCatalogDialog } from "../create-catalog-dialog";
import {
  createNewEditingPrice,
  editingPriceToPrice,
  PriceEditDialog,
  priceToEditingPrice,
  type EditingPrice,
} from "../price-edit-dialog";
import { DEFAULT_INTERVAL_UNITS, generateUniqueId, intervalLabel, shortIntervalLabel, type Price, type Product } from "../utils";

const CUSTOMER_TYPE_COLORS = {
  user: 'bg-blue-500/15 text-blue-600 dark:bg-blue-500/20 dark:text-blue-400 ring-blue-500/30',
  team: 'bg-emerald-500/15 text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-400 ring-emerald-500/30',
  custom: 'bg-amber-500/15 text-amber-600 dark:bg-amber-500/20 dark:text-amber-400 ring-amber-500/30',
} as const;

export default function PageClient({ productId }: { productId: string }) {
  const adminApp = useAdminApp();
  const project = adminApp.useProject();
  const config = project.useConfig();
  const updateConfig = useUpdateConfig();
  const product = config.payments.products[productId] as Product | undefined;

  if (product == null) {
    return (
      <PageLayout title="Product Not Found">
        <div className="flex flex-col items-center justify-center py-12 gap-4">
          <PackageIcon className="h-12 w-12 text-muted-foreground/50" />
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
  const router = useRouter();
  const catalogId = product.catalogId;
  const catalogName = catalogId && catalogId in config.payments.catalogs ? config.payments.catalogs[catalogId].displayName || catalogId : null;
  const canGoBack = typeof window !== 'undefined' && window.history.length > 1;

  return (
    <PageLayout>
      <div className="flex flex-col gap-6">
        {canGoBack && (
          <Button
            variant="ghost"
            size="sm"
            className="w-fit -ml-2 text-muted-foreground hover:text-foreground"
            onClick={() => router.back()}
          >
            <ArrowLeftIcon className="h-4 w-4 mr-1" />
            Back
          </Button>
        )}
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
  const updateConfig = useUpdateConfig();
  const router = useRouter();
  const displayName = product.displayName || productId;
  const isAddOn = product.isAddOnTo !== false && typeof product.isAddOnTo === 'object';

  // Find add-on parent products
  const addOnParents = useMemo(() => {
    if (product.isAddOnTo === false || typeof product.isAddOnTo !== 'object') return [];
    return Object.keys(product.isAddOnTo).map((parentId: string) => ({
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
          <PuzzlePieceIcon className="h-8 w-8 text-primary" />
        ) : (
          <PackageIcon className="h-8 w-8 text-primary" />
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
                await updateConfig({ adminApp, configUpdate: {
                  [`payments.products.${productId}.displayName`]: newName || null,
                }, pushable: true });
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
                <DotsThreeIcon className="h-5 w-5" />
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
            CUSTOMER_TYPE_COLORS[product.customerType as keyof typeof CUSTOMER_TYPE_COLORS]
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
                {addOnParents.map((p: { id: string, displayName: string }, i: number) => (
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
  const updateConfig = useUpdateConfig();

  // Dialog states
  const [addOnDialogOpen, setAddOnDialogOpen] = useState(false);
  const [freeTrialPopoverOpen, setFreeTrialPopoverOpen] = useState(false);
  const [createCatalogDialogOpen, setCreateCatalogDialogOpen] = useState(false);

  // Get all catalogs with their customer types
  const catalogOptions = useMemo(() => {
    const catalogs = Object.entries(config.payments.catalogs).map(([id, catalog]) => {
      // Determine customer type from existing products in this catalog
      const productsInCatalog = Object.values(config.payments.products).filter(p => (p as Product | undefined)?.catalogId === id);
      const catalogCustomerType = productsInCatalog[0]?.customerType as 'user' | 'team' | 'custom' | undefined;

      return {
        value: id,
        label: catalog.displayName || id,
        customerType: catalogCustomerType,
        disabled: catalogCustomerType != null && catalogCustomerType !== product.customerType,
        disabledReason: catalogCustomerType != null && catalogCustomerType !== product.customerType
          ? `This catalog is for ${catalogCustomerType} products`
          : undefined,
      };
    });

    // Also add "No catalog" option (using __none__ since Select.Item can't have empty string value)
    return [
      { value: '__none__', label: 'No catalog', disabled: false, disabledReason: undefined, customerType: undefined },
      ...catalogs,
    ];
  }, [config.payments.catalogs, config.payments.products, product.customerType]);

  // Add-on dialog state
  const [isAddOn, setIsAddOn] = useState(() => product.isAddOnTo !== false && typeof product.isAddOnTo === 'object');
  const [selectedAddOnProducts, setSelectedAddOnProducts] = useState<Set<string>>(() => {
    if (product.isAddOnTo === false || typeof product.isAddOnTo !== 'object') return new Set();
    return new Set(Object.keys(product.isAddOnTo));
  });

  // Free trial state
  const [freeTrialCount, setFreeTrialCount] = useState(7);
  const [freeTrialUnit, setFreeTrialUnit] = useState<DayInterval[1]>('day');

  // Get add-on parent products
  const addOnParents = useMemo(() => {
    if (product.isAddOnTo === false || typeof product.isAddOnTo !== 'object') return [];
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

  // Get product-level free trial
  const freeTrialInfo = product.freeTrial || null;

  const freeTrialDisplayText = useMemo(() => {
    if (!freeTrialInfo) return 'None';
    const [count, unit] = freeTrialInfo;
    return `${count} ${count === 1 ? unit : unit + 's'}`;
  }, [freeTrialInfo]);

  // Get product-level server-only status
  const isServerOnly = !!product.serverOnly;

  // Handlers
  const handleDisplayNameUpdate = async (value: string) => {
    await updateConfig({ adminApp, configUpdate: {
      [`payments.products.${productId}.displayName`]: value || null,
    }, pushable: true });
    toast({ title: "Display name updated" });
  };

  const handleCatalogUpdate = async (catalogId: string) => {
    const actualCatalogId = catalogId === '__none__' ? null : catalogId;
    await updateConfig({ adminApp, configUpdate: {
      [`payments.products.${productId}.catalogId`]: actualCatalogId,
    }, pushable: true });
    toast({ title: actualCatalogId ? "Product moved to catalog" : "Product removed from catalog" });
  };

  const handleCreateCatalog = async (catalog: { id: string, displayName: string }) => {
    // Create the catalog first
    await updateConfig({ adminApp, configUpdate: {
      [`payments.catalogs.${catalog.id}`]: { displayName: catalog.displayName || null },
    }, pushable: true });
    // Then update the product to use this catalog
    await updateConfig({ adminApp, configUpdate: {
      [`payments.products.${productId}.catalogId`]: catalog.id,
    }, pushable: true });
    setCreateCatalogDialogOpen(false);
    toast({ title: "Catalog created and product moved" });
  };

  const handleStackableUpdate = async (value: boolean) => {
    await updateConfig({ adminApp, configUpdate: {
      [`payments.products.${productId}.stackable`]: value || null,
    }, pushable: true });
    toast({ title: value ? "Product is now stackable" : "Product is no longer stackable" });
  };

  const handleServerOnlyUpdate = async (value: boolean) => {
    await updateConfig({ adminApp, configUpdate: {
      [`payments.products.${productId}.serverOnly`]: value || null,
    }, pushable: true });
    toast({ title: value ? "Product is now server only" : "Product is no longer server only" });
  };

  const handleAddOnSave = async () => {
    if (isAddOn && selectedAddOnProducts.size === 0) {
      toast({ title: "Please select at least one product", variant: "destructive" });
      return;
    }

    const addOnValue = isAddOn
      ? Object.fromEntries([...selectedAddOnProducts].map(id => [id, true]))
      : null;

    await updateConfig({ adminApp, configUpdate: {
      [`payments.products.${productId}.isAddOnTo`]: addOnValue,
    }, pushable: true });
    setAddOnDialogOpen(false);
    toast({ title: isAddOn ? "Add-on configuration updated" : "Product is no longer an add-on" });
  };

  const handleFreeTrialSave = async (count: number, unit: DayInterval[1]) => {
    await updateConfig({ adminApp, configUpdate: {
      [`payments.products.${productId}.freeTrial`]: [count, unit] as DayInterval,
    }, pushable: true });
    setFreeTrialPopoverOpen(false);
    toast({ title: "Free trial updated" });
  };

  const handleRemoveFreeTrial = async () => {
    await updateConfig({ adminApp, configUpdate: {
      [`payments.products.${productId}.freeTrial`]: null,
    }, pushable: true });
    setFreeTrialPopoverOpen(false);
    toast({ title: "Free trial removed" });
  };

  // Build grid items for EditableGrid
  const gridItems: EditableGridItem[] = [
    {
      type: 'text',
      icon: <TagIcon size={16} />,
      name: "Display Name",
      tooltip: "The name shown to customers. Leave empty to use the product ID.",
      value: product.displayName || '',
      placeholder: productId,
      onUpdate: handleDisplayNameUpdate,
    },
    {
      type: 'dropdown',
      icon: <FolderOpenIcon size={16} />,
      name: "Catalog",
      tooltip: "Catalogs group products together. Customers can only have one active product per catalog.",
      value: product.catalogId || '__none__',
      options: catalogOptions,
      onUpdate: handleCatalogUpdate,
      extraAction: {
        label: "+ Create new catalog",
        onClick: () => setCreateCatalogDialogOpen(true),
      },
    },
    {
      type: 'boolean',
      icon: <StackIcon size={16} />,
      name: "Stackable",
      tooltip: "Stackable products can be purchased multiple times by the same customer.",
      value: !!product.stackable,
      onUpdate: handleStackableUpdate,
    },
    {
      type: 'custom-button',
      icon: <PuzzlePieceIcon size={16} />,
      name: "Add-on",
      tooltip: "Add-ons are optional extras that can only be purchased alongside a parent product.",
      onClick: () => {
        // Reset dialog state when opening
        setIsAddOn(product.isAddOnTo !== false && typeof product.isAddOnTo === 'object');
        setSelectedAddOnProducts(
          product.isAddOnTo !== false && typeof product.isAddOnTo === 'object'
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
      icon: <ClockIcon size={16} />,
      name: "Free Trial",
      tooltip: "Free trial period before billing starts. Customers won't be charged during this period.",
      children: (
        <Popover open={freeTrialPopoverOpen} onOpenChange={setFreeTrialPopoverOpen}>
          <PopoverTrigger asChild>
            <button
              className={cn(
                "w-full px-1 py-0 h-[unset] border-transparent rounded text-left text-foreground",
                "hover:ring-1 hover:ring-slate-300 dark:hover:ring-gray-500 hover:bg-slate-50 dark:hover:bg-gray-800 hover:cursor-pointer",
                "focus:outline-none focus-visible:ring-1 focus-visible:ring-slate-500 dark:focus-visible:ring-gray-50",
                "transition-colors duration-150 hover:transition-none"
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
      icon: <HardDriveIcon size={16} />,
      name: "Server Only",
      tooltip: "Server-only products are only available through checkout sessions created by server-side APIs.",
      value: isServerOnly,
      onUpdate: handleServerOnlyUpdate,
    },
    {
      type: 'custom',
      icon: <CurrencyDollarIcon size={16} />,
      name: "Prices",
      tooltip: "Pricing options for this product. Multiple prices allow different billing intervals or pricing tiers.",
      children: <ProductPricesSection productId={productId} product={product} inline />,
    },
    {
      type: 'custom',
      icon: <PackageIcon size={16} />,
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

      {/* Create Catalog Dialog */}
      <CreateCatalogDialog
        open={createCatalogDialogOpen}
        onOpenChange={setCreateCatalogDialogOpen}
        onCreate={handleCreateCatalog}
      />
    </>
  );
}

type ProductPricesSectionProps = {
  productId: string,
  product: Product,
  inline?: boolean,
};

function ProductPricesSection({ productId, product, inline = false }: ProductPricesSectionProps) {
  const adminApp = useAdminApp();
  const project = adminApp.useProject();
  const updateConfig = useUpdateConfig();
  const prices = product.prices;
  const [editingPrice, setEditingPrice] = useState<EditingPrice | null>(null);
  const [isAddingPrice, setIsAddingPrice] = useState(false);
  const [deletingPriceIds, setDeletingPriceIds] = useState<Set<string>>(new Set());

  const handleSavePrice = async (editing: EditingPrice, isNew: boolean) => {
    const newPrice = editingPriceToPrice(editing);

    const currentPrices = prices === 'include-by-default' ? {} : prices;
    const updatedPrices = {
      ...currentPrices,
      [editing.priceId]: newPrice,
    };

    await updateConfig({ adminApp, configUpdate: {
      [`payments.products.${productId}.prices`]: updatedPrices,
    }, pushable: true });

    toast({ title: isNew ? "Price added" : "Price updated" });
    setEditingPrice(null);
    setIsAddingPrice(false);
  };

  const handleDeletePrice = async (priceId: string) => {
    setDeletingPriceIds(prev => new Set(prev).add(priceId));
    try {
      const currentPrices = prices === 'include-by-default' ? {} : prices;
      const { [priceId]: _, ...remainingPrices } = currentPrices as Record<string, Price>;

      await updateConfig({ adminApp, configUpdate: {
        [`payments.products.${productId}.prices`]: Object.keys(remainingPrices).length > 0 ? remainingPrices : {},
      }, pushable: true });

      toast({ title: "Price deleted" });
    } finally {
      setDeletingPriceIds(prev => {
        const next = new Set(prev);
        next.delete(priceId);
        return next;
      });
    }
  };


  const openEditDialog = (priceId: string, price: Price) => {
    setEditingPrice(priceToEditingPrice(priceId, price));
  };

  const openAddDialog = () => {
    const newId = generateUniqueId('price');
    setEditingPrice(createNewEditingPrice(newId));
    setIsAddingPrice(true);
  };

  const isIncludeByDefault = prices === 'include-by-default';
  const priceEntries = !isIncludeByDefault ? typedEntries(prices as Record<string, Price>) : [];
  // Check if the product has a single $0 price (free but not included by default)
  const isFreeNotIncluded = priceEntries.length === 1 && priceEntries[0][1].USD === '0' || priceEntries.length === 1 && priceEntries[0][1].USD === '0.00';
  const isFree = isIncludeByDefault || isFreeNotIncluded;
  const hasNoPrices = !isIncludeByDefault && priceEntries.length === 0;

  const handleAddPrices = async () => {
    // Convert from include-by-default to empty prices object, then open add dialog
    await updateConfig({ adminApp, configUpdate: {
      [`payments.products.${productId}.prices`]: {},
    }, pushable: true });
    openAddDialog();
  };

  const handleSetIncludeByDefault = async () => {
    await updateConfig({ adminApp, configUpdate: {
      [`payments.products.${productId}.prices`]: 'include-by-default',
    }, pushable: true });
    toast({ title: "Product is now included by default" });
  };

  const handleSetFreeNotIncluded = async () => {
    // Set a $0 price to make it free but not included by default
    const newPriceId = generateUniqueId('price');
    await updateConfig({ adminApp, configUpdate: {
      [`payments.products.${productId}.prices`]: {
        [newPriceId]: { USD: '0', serverOnly: false },
      },
    }, pushable: true });
    toast({ title: "Product is no longer included by default" });
  };

  const listContent = (
    <div className="pl-1">
      {isFree ? (
        // Free product - show "Free" with option to toggle include-by-default
        <div className="flex flex-col">
          <div className="flex items-center text-sm leading-6">
            <span className="font-semibold text-foreground">Free</span>
            <span className="text-muted-foreground mx-1.5">—</span>
            {isIncludeByDefault ? (
              <SimpleTooltip tooltip="This product will automatically be given to all new and existing customers">
                <span className="text-muted-foreground cursor-help border-b border-dotted border-muted-foreground/50">Included by default</span>
              </SimpleTooltip>
            ) : (
              <span className="text-muted-foreground">Not included by default</span>
            )}
          </div>
          <div className="flex items-center gap-2 mt-1">
            <Button
              variant="ghost"
              size="sm"
              className="w-fit h-6 px-1 text-xs text-muted-foreground hover:text-foreground"
              onClick={async () => {
                await updateConfig({ adminApp, configUpdate: {
                  [`payments.products.${productId}.prices`]: {},
                }, pushable: true });
                toast({ title: "Product is no longer free" });
              }}
            >
              <CurrencyDollarIcon className="h-3 w-3 mr-1" />
              Make paid
            </Button>
            {isIncludeByDefault ? (
              <Button
                variant="ghost"
                size="sm"
                className="w-fit h-6 px-1 text-xs text-muted-foreground hover:text-foreground"
                onClick={handleSetFreeNotIncluded}
              >
                <XIcon className="h-3 w-3 mr-1" />
                {"Don't include by default"}
              </Button>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                className="w-fit h-6 px-1 text-xs text-muted-foreground hover:text-foreground"
                onClick={handleSetIncludeByDefault}
              >
                <GiftIcon className="h-3 w-3 mr-1" />
                Include by default
              </Button>
            )}
          </div>
        </div>
      ) : hasNoPrices ? (
        // No prices configured - show error state
        <div className="flex flex-col">
          <p className="text-sm text-destructive leading-6">No prices configured</p>
          <div className="flex items-center gap-2 mt-1">
            <Button
              variant="ghost"
              size="sm"
              className="w-fit h-6 px-1 text-xs text-muted-foreground hover:text-foreground"
              onClick={openAddDialog}
            >
              <PlusIcon className="h-3 w-3 mr-1" />
              Add price option
            </Button>
            <span className="text-[10px] font-medium text-muted-foreground/60 uppercase tracking-wider">or</span>
            <Button
              variant="ghost"
              size="sm"
              className="w-fit h-6 px-1 text-xs text-muted-foreground hover:text-foreground"
              onClick={handleSetIncludeByDefault}
            >
              <GiftIcon className="h-3 w-3 mr-1" />
              Make free
            </Button>
          </div>
        </div>
      ) : (
        // Has prices - show them with both options
        <div className="flex flex-col">
          {priceEntries.map(([priceId, price]) => {
            const intervalText = price.interval ? intervalLabel(price.interval) : 'One-time';
            const isDeleting = deletingPriceIds.has(priceId);
            return (
              <div key={priceId} className={cn("group flex items-center text-sm leading-6", isDeleting && "opacity-50")}>
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
                <div className={cn("flex items-center ml-1", isDeleting ? "opacity-100" : "opacity-0 group-hover:opacity-100")}>
                  <SimpleTooltip tooltip="Edit">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-5 w-5 p-0"
                      onClick={() => openEditDialog(priceId, price)}
                      disabled={isDeleting}
                    >
                      <PencilSimpleIcon className="h-3 w-3" />
                    </Button>
                  </SimpleTooltip>
                  <SimpleTooltip tooltip="Delete">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-5 w-5 p-0 text-destructive hover:text-destructive"
                      onClick={() => handleDeletePrice(priceId)}
                      disabled={isDeleting}
                    >
                      <TrashIcon className={cn("h-3 w-3", isDeleting && "animate-pulse")} />
                    </Button>
                  </SimpleTooltip>
                </div>
              </div>
            );
          })}
          <div className="flex items-center gap-2 mt-1">
            <Button
              variant="ghost"
              size="sm"
              className="w-fit h-6 px-1 text-xs text-muted-foreground hover:text-foreground"
              onClick={openAddDialog}
            >
              <PlusIcon className="h-3 w-3 mr-1" />
              Add price option
            </Button>
            <span className="text-[10px] font-medium text-muted-foreground/60 uppercase tracking-wider">or</span>
            <Button
              variant="ghost"
              size="sm"
              className="w-fit h-6 px-1 text-xs text-muted-foreground hover:text-foreground"
              onClick={handleSetIncludeByDefault}
            >
              <GiftIcon className="h-3 w-3 mr-1" />
              Make free
            </Button>
          </div>
        </div>
      )}
    </div>
  );

  const priceDialog = (
    <PriceEditDialog
      open={!!editingPrice}
      onOpenChange={(open) => {
        if (!open) {
          setEditingPrice(null);
          setIsAddingPrice(false);
        }
      }}
      editingPrice={editingPrice}
      onEditingPriceChange={setEditingPrice}
      isAdding={isAddingPrice}
      onSave={handleSavePrice}
    />
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
  const updateConfig = useUpdateConfig();
  const items = product.includedItems;
  const [editingItem, setEditingItem] = useState<EditingItem | null>(null);
  const [isAddingItem, setIsAddingItem] = useState(false);
  const [selectedItemId, setSelectedItemId] = useState<string>('');
  const [deletingItemIds, setDeletingItemIds] = useState<Set<string>>(new Set());

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

    const updatedItems = {
      ...items,
      [editing.itemId]: newItem,
    };

    await updateConfig({ adminApp, configUpdate: {
      [`payments.products.${productId}.includedItems`]: updatedItems,
    }, pushable: true });

    toast({ title: isNew ? "Item added" : "Item updated" });
  setEditingItem(null);
  setIsAddingItem(false);
  setSelectedItemId('');
  };

  const handleDeleteItem = async (itemId: string) => {
    setDeletingItemIds(prev => new Set(prev).add(itemId));
    try {
      const { [itemId]: _, ...remainingItems } = items;

      await updateConfig({ adminApp, configUpdate: {
        [`payments.products.${productId}.includedItems`]: Object.keys(remainingItems).length > 0 ? remainingItems : null,
      }, pushable: true });

      toast({ title: "Item removed" });
    } finally {
      setDeletingItemIds(prev => {
        const next = new Set(prev);
        next.delete(itemId);
        return next;
      });
    }
  };

  const openEditDialog = (itemId: string, item: { quantity: number, repeat: DayInterval | 'once' | 'never' }) => {
    const isOnce = item.repeat === 'once' || item.repeat === 'never';
    const repeatInterval: DayInterval | undefined = isOnce ? undefined : (item.repeat as DayInterval);
    setEditingItem({
      itemId,
      quantity: item.quantity,
      repeatSelection: isOnce ? 'once' : (repeatInterval?.[0] === 1 ? repeatInterval[1] : 'custom') as EditingItem['repeatSelection'],
      repeatCount: repeatInterval?.[0] || 1,
      repeatUnit: repeatInterval?.[1] as DayInterval[1] | undefined,
    });
    setSelectedItemId(itemId);
  };

  const openAddDialog = () => {
    // Find first available item not already included
    const includedIds = new Set(Object.keys(items));
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
      // All items are already included, use the first one (will update existing)
      setEditingItem({
        itemId: availableItems[0].id,
        quantity: 1,
        repeatSelection: 'once',
        repeatCount: 1,
        repeatUnit: 'month',
      });
      setSelectedItemId(availableItems[0].id);
    } else {
      // No items available - still open the dialog to show empty state
      setEditingItem({
        itemId: '',
        quantity: 1,
        repeatSelection: 'once',
        repeatCount: 1,
        repeatUnit: 'month',
      });
      setSelectedItemId('');
    }
    setIsAddingItem(true);
  };

  const handleCopyPrompt = async (itemId: string, displayName: string) => {
    const prompt = `Check if the current user has the "${displayName}" (${itemId}) item.`;
    await navigator.clipboard.writeText(prompt);
    toast({ title: "Prompt copied to clipboard" });
  };

  const itemEntries = typedEntries(items) as [string, typeof items[keyof typeof items]][];

  const listContent = (
    <div className="pl-1">
      {itemEntries.length === 0 ? (
        <p className="text-sm text-muted-foreground">No items included</p>
      ) : (
        <div className="flex flex-col">
          {itemEntries.map(([itemId, item]) => {
            const itemConfig = config.payments.items[itemId];
            const displayName = itemConfig.displayName || itemId;
            const isDeleting = deletingItemIds.has(itemId);
            return (
              <div key={itemId} className={cn("group flex items-center text-sm leading-6", isDeleting && "opacity-50")}>
                <span className="font-semibold tabular-nums text-foreground">{prettyPrintWithMagnitudes(item.quantity)}×</span>
                <SimpleTooltip tooltip={`ID: ${itemId}`}>
                  <span className="ml-1.5 text-foreground cursor-help">{displayName}</span>
                </SimpleTooltip>
                <span className="text-muted-foreground ml-1.5">{shortIntervalLabel(item.repeat)}</span>
                <div className={cn("flex items-center ml-1", isDeleting ? "opacity-100" : "opacity-0 group-hover:opacity-100")}>
                  <SimpleTooltip tooltip="Copy prompt">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-5 w-5 p-0"
                      onClick={() => handleCopyPrompt(itemId, displayName)}
                      disabled={isDeleting}
                    >
                      <CopyIcon className="h-3 w-3" />
                    </Button>
                  </SimpleTooltip>
                  <SimpleTooltip tooltip="Edit">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-5 w-5 p-0"
                      onClick={() => openEditDialog(itemId, item)}
                      disabled={isDeleting}
                    >
                      <PencilSimpleIcon className="h-3 w-3" />
                    </Button>
                  </SimpleTooltip>
                  <SimpleTooltip tooltip="Delete">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-5 w-5 p-0 text-destructive hover:text-destructive"
                      onClick={() => handleDeleteItem(itemId)}
                      disabled={isDeleting}
                    >
                      <TrashIcon className={cn("h-3 w-3", isDeleting && "animate-pulse")} />
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
        >
          <PlusIcon className="h-3 w-3 mr-1" />
          Add included item
        </Button>
      </div>
    </div>
  );

  const itemDialog = (
    /* Item Edit Dialog */
    <Dialog open={!!editingItem} onOpenChange={(open) => {
      if (!open) {
        setEditingItem(null);
        setIsAddingItem(false);
        setSelectedItemId('');
      }
    }}>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>{isAddingItem ? "Add Included Item" : "Edit Included Item"}</DialogTitle>
          <DialogDescription>
            Configure how much of this item customers receive.
          </DialogDescription>
        </DialogHeader>
        {editingItem && availableItems.length === 0 && isAddingItem ? (
          <div className="flex flex-col items-center gap-3 py-8">
            <PackageIcon className="h-10 w-10 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground text-center">
              No items available for this customer type.
            </p>
            <p className="text-xs text-muted-foreground/70 text-center">
              Create items in the Items list first before adding them to a product.
            </p>
            <Button variant="outline" onClick={() => {
              setEditingItem(null);
              setIsAddingItem(false);
            }}>
              Close
            </Button>
          </div>
        ) : editingItem && (
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
          <Button variant="outline" onClick={() => {
            setEditingItem(null);
            setIsAddingItem(false);
            setSelectedItemId('');
          }}>
            Cancel
          </Button>
          <Button onClick={editingItem ? () => handleSaveItem(editingItem, isAddingItem) : undefined}>
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
    <div className="relative rounded-2xl bg-foreground/[0.04] ring-1 ring-foreground/[0.06]">
      <div className="px-5 pt-4 pb-3">
        <h3 className="text-base font-semibold">Customers</h3>
        <p className="text-sm text-muted-foreground">
          Customers who have purchased this product
        </p>
      </div>
      <div className="px-5 pb-5">
        <div className="rounded-xl overflow-hidden bg-background/50 ring-1 ring-foreground/[0.06]">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
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
      </div>
    </div>
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
    <div className="relative rounded-2xl bg-foreground/[0.04] ring-1 ring-foreground/[0.06]">
      <div className="px-5 pt-4 pb-3">
        <h3 className="text-base font-semibold">Customers</h3>
        <p className="text-sm text-muted-foreground">
          Customers who have purchased this product ({customersWithTransactions.length} found)
        </p>
      </div>
      <div className="px-5 pb-5">
        {customersWithTransactions.length === 0 ? (
          <div className="flex flex-col items-center gap-2 p-8 rounded-xl bg-foreground/[0.02]">
            <UsersIcon className="h-8 w-8 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground text-center">
              No customers have purchased this product yet
            </p>
          </div>
        ) : (
          <div className="rounded-xl overflow-hidden bg-background/50 ring-1 ring-foreground/[0.06]">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
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
      </div>
    </div>
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
          CUSTOMER_TYPE_COLORS[customerType as keyof typeof CUSTOMER_TYPE_COLORS]
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
