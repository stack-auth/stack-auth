"use client";

import { Stepper, StepperPage } from "@/components/stepper";
import { cn } from "@/lib/utils";
import { CompleteConfig } from "@stackframe/stack-shared/dist/config/schema";
import { Button, Card, CardDescription, CardHeader, CardTitle, Checkbox, Dialog, DialogContent, DialogFooter, DialogTitle, Input, Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Typography } from "@/components/ui";
import { ArrowLeft, ArrowRight, CreditCard, Package, Plus, Repeat, Trash2 } from "lucide-react";
import { useState } from "react";
import { CreateCatalogDialog } from "./create-catalog-dialog";
import { IncludedItemDialog } from "./included-item-dialog";
import { ListSection } from "./list-section";
import { PricingSection } from "./pricing-section";
import { type Product, type Price } from "./utils";

type Template = 'one-time' | 'subscription' | 'addon' | 'scratch';

type IncludedItem = Product['includedItems'][string];

type ProductDialogProps = {
  open: boolean,
  onOpenChange: (open: boolean) => void,
  onSave: (productId: string, product: Product) => Promise<void>,
  editingProductId?: string,
  editingProduct?: Product,
  existingProducts: Array<{ id: string, displayName: string, catalogId?: string, customerType: string }>,
  existingCatalogs: Record<string, { displayName?: string }>,
  existingItems: Array<{ id: string, displayName: string, customerType: string }>,
  onCreateNewItem?: () => void,
};

const TEMPLATE_CONFIGS: Record<Template, Partial<Product>> = {
  'one-time': {
    displayName: 'One-Time Purchase',
    stackable: false,
  },
  'subscription': {
    displayName: 'Monthly Subscription',
    stackable: false,
  },
  'addon': {
    displayName: 'Add-on',
    isAddOnTo: {},
    stackable: true,
  },
  'scratch': {}
};

export function ProductDialog({
  open,
  onOpenChange,
  onSave,
  editingProductId,
  editingProduct,
  existingProducts,
  existingCatalogs,
  existingItems,
  onCreateNewItem
}: ProductDialogProps) {
  const [currentStep, setCurrentStep] = useState(editingProduct ? 1 : 0);

  // Form state
  const [productId, setProductId] = useState(editingProductId ?? "");
  const [displayName, setDisplayName] = useState(editingProduct?.displayName || "");
  const [customerType, setCustomerType] = useState<'user' | 'team' | 'custom'>(editingProduct?.customerType || 'user');
  const [catalogId, setCatalogId] = useState(editingProduct?.catalogId || "");
  const [isAddOn, setIsAddOn] = useState(!!editingProduct?.isAddOnTo);
  const [isAddOnTo, setIsAddOnTo] = useState<string[]>(editingProduct?.isAddOnTo !== false ? Object.keys(editingProduct?.isAddOnTo || {}) : []);
  const [stackable, setStackable] = useState(editingProduct?.stackable || false);
  const [freeByDefault, setFreeByDefault] = useState(editingProduct?.prices === "include-by-default" || false);
  const [prices, setPrices] = useState<Record<string, Price>>(editingProduct?.prices === "include-by-default" ? {} : editingProduct?.prices || {});
  const [includedItems, setIncludedItems] = useState<Product['includedItems']>(editingProduct?.includedItems || {});
  const [freeTrial, setFreeTrial] = useState<Product['freeTrial']>(editingProduct?.freeTrial || undefined);
  const [serverOnly, setServerOnly] = useState(editingProduct?.serverOnly || false);

  // Dialog states
  const [showCatalogDialog, setShowCatalogDialog] = useState(false);
  const [showItemDialog, setShowItemDialog] = useState(false);
  const [editingItemId, setEditingItemId] = useState<string | undefined>();

  // Validation errors
  const [errors, setErrors] = useState<Record<string, string>>({});

  const applyTemplate = (template: Template) => {
    const config = TEMPLATE_CONFIGS[template];
    if (config.displayName) setDisplayName(config.displayName);
    if (config.isAddOnTo !== undefined) setIsAddOn(config.isAddOnTo !== false);
    if (config.stackable !== undefined) setStackable(config.stackable);

    // Add template-specific prices
    if (template === 'one-time') {
      setPrices({
        'one-time': {
          USD: '99.00',
          serverOnly: false,
        }
      });
    } else if (template === 'subscription') {
      setPrices({
        'monthly': {
          USD: '9.99',
          interval: [1, 'month'],
          serverOnly: false,
        },
        'annual': {
          USD: '99.00',
          interval: [1, 'year'],
          serverOnly: false,
        }
      });
    }

    setCurrentStep(1);
  };

  const validateGeneralInfo = () => {
    const newErrors: Record<string, string> = {};

    if (!productId.trim()) {
      newErrors.productId = "Product ID is required";
    } else if (!/^[a-z0-9-]+$/.test(productId)) {
      newErrors.productId = "Product ID must contain only lowercase letters, numbers, and hyphens";
    } else if (!editingProduct && existingProducts.some(o => o.id === productId)) {
      newErrors.productId = "This product ID already exists";
    }

    if (!displayName.trim()) {
      newErrors.displayName = "Display name is required";
    }

    if (isAddOn && isAddOnTo.length === 0) {
      newErrors.isAddOnTo = "Please select at least one product this is an add-on to";
    }

    if (isAddOn && isAddOnTo.length > 0) {
      const addOnCatalogs = new Set(
        isAddOnTo.map(productId => existingProducts.find(o => o.id === productId)?.catalogId)
      );
      if (addOnCatalogs.size > 1) {
        newErrors.isAddOnTo = "All selected products must be in the same catalog";
      }
    }

    return newErrors;
  };

  const handleNext = () => {
    if (currentStep === 1) {
      const validationErrors = validateGeneralInfo();
      if (Object.keys(validationErrors).length > 0) {
        setErrors(validationErrors);
        return;
      }
    }

    setErrors({});
    setCurrentStep(prev => Math.min(prev + 1, 3));
  };

  const handleBack = () => {
    setCurrentStep(prev => Math.max(prev - 1, editingProduct ? 1 : 0));
  };

  const handleSave = async () => {
    const product: Product = {
      displayName,
      customerType,
      catalogId: catalogId || undefined,
      isAddOnTo: isAddOn ? Object.fromEntries(isAddOnTo.map(id => [id, true])) : false,
      stackable,
      prices: freeByDefault ? "include-by-default" : prices,
      includedItems,
      serverOnly,
      freeTrial,
    };

    await onSave(productId, product);
    handleClose();
  };

  const handleClose = () => {
    // Reset form
    if (!editingProduct) {
      setCurrentStep(0);
      setProductId("");
      setDisplayName("");
      setCustomerType('user');
      setCatalogId("");
      setIsAddOn(false);
      setIsAddOnTo([]);
      setStackable(false);
      setFreeByDefault(false);
      setPrices({});
      setIncludedItems({});
    }
    setErrors({});
    onOpenChange(false);
  };

  const addIncludedItem = (itemId: string, item: IncludedItem) => {
    setIncludedItems(prev => ({ ...prev, [itemId]: item }));
  };

  const editIncludedItem = (itemId: string, item: IncludedItem) => {
    setIncludedItems(prev => {
      const newItems = { ...prev };
      newItems[itemId] = item;
      return newItems;
    });
  };

  const removeIncludedItem = (itemId: string) => {
    setIncludedItems(prev => {
      const newItems = { ...prev };
      delete newItems[itemId];
      return newItems;
    });
  };

  const getItemDisplay = (itemId: string, item: IncludedItem) => {
    const itemData = existingItems.find(i => i.id === itemId);
    if (!itemData) return itemId;

    let display = `${item.quantity}× ${itemData.displayName || itemData.id}`;
    if (item.repeat !== 'never') {
      const [count, unit] = item.repeat;
      display += ` every ${count} ${unit}${count > 1 ? 's' : ''}`;
    }
    return display;
  };

  const isFirstProduct = existingProducts.length === 0;

  return (
    <>
      <Dialog open={open} onOpenChange={handleClose}>
        <DialogContent className={cn(
          "max-w-2xl rounded-2xl",
          "bg-background/95 backdrop-blur-xl",
          "border border-border/50 dark:border-foreground/[0.1]",
          "shadow-2xl"
        )}>
          <Stepper currentStep={currentStep} onStepChange={setCurrentStep} className="min-h-[400px]">
            {/* Step 0: Template Selection (only for new products) */}
            {!editingProduct && (
              <StepperPage>
                <div className="space-y-4">
                  <div>
                    <DialogTitle>Choose a starting template</DialogTitle>
                    <Typography type="p" className="text-muted-foreground mt-1">
                      Select a template to get started quickly, or create from scratch
                    </Typography>
                  </div>

                  <div className="grid gap-3 mt-6">
                    <Card
                      className={cn(
                        "cursor-pointer group",
                        "rounded-xl border border-border/50 dark:border-foreground/[0.1]",
                        "bg-foreground/[0.02] hover:bg-foreground/[0.04]",
                        "hover:border-cyan-500/40 hover:shadow-[0_0_12px_rgba(6,182,212,0.1)]",
                        "transition-all duration-150 hover:transition-none"
                      )}
                      onClick={() => applyTemplate('one-time')}
                    >
                      <CardHeader className="pb-3">
                        <div className="flex items-center gap-3">
                          <div className="p-2.5 rounded-xl bg-cyan-500/10 dark:bg-cyan-500/[0.15] group-hover:bg-cyan-500/20 transition-colors duration-150 group-hover:transition-none">
                            <CreditCard className="h-5 w-5 text-cyan-600 dark:text-cyan-400" />
                          </div>
                          <div>
                            <CardTitle className="text-base font-semibold">One-time Purchase</CardTitle>
                            <CardDescription className="text-sm mt-1 text-muted-foreground">
                              A single payment for lifetime access to features
                            </CardDescription>
                          </div>
                        </div>
                      </CardHeader>
                    </Card>

                    <Card
                      className={cn(
                        "cursor-pointer group",
                        "rounded-xl border border-border/50 dark:border-foreground/[0.1]",
                        "bg-foreground/[0.02] hover:bg-foreground/[0.04]",
                        "hover:border-purple-500/40 hover:shadow-[0_0_12px_rgba(168,85,247,0.1)]",
                        "transition-all duration-150 hover:transition-none"
                      )}
                      onClick={() => applyTemplate('subscription')}
                    >
                      <CardHeader className="pb-3">
                        <div className="flex items-center gap-3">
                          <div className="p-2.5 rounded-xl bg-purple-500/10 dark:bg-purple-500/[0.15] group-hover:bg-purple-500/20 transition-colors duration-150 group-hover:transition-none">
                            <Repeat className="h-5 w-5 text-purple-600 dark:text-purple-400" />
                          </div>
                          <div>
                            <CardTitle className="text-base font-semibold">Subscription</CardTitle>
                            <CardDescription className="text-sm mt-1 text-muted-foreground">
                              Recurring payments for continuous access
                            </CardDescription>
                          </div>
                        </div>
                      </CardHeader>
                    </Card>

                    {!isFirstProduct && <Card
                      className={cn(
                        "cursor-pointer group",
                        "rounded-xl border border-border/50 dark:border-foreground/[0.1]",
                        "bg-foreground/[0.02] hover:bg-foreground/[0.04]",
                        "hover:border-emerald-500/40 hover:shadow-[0_0_12px_rgba(16,185,129,0.1)]",
                        "transition-all duration-150 hover:transition-none"
                      )}
                      onClick={() => applyTemplate('addon')}
                    >
                      <CardHeader className="pb-3">
                        <div className="flex items-center gap-3">
                          <div className="p-2.5 rounded-xl bg-emerald-500/10 dark:bg-emerald-500/[0.15] group-hover:bg-emerald-500/20 transition-colors duration-150 group-hover:transition-none">
                            <Package className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
                          </div>
                          <div>
                            <CardTitle className="text-base font-semibold">Add-on</CardTitle>
                            <CardDescription className="text-sm mt-1 text-muted-foreground">
                              Additional features that complement existing products
                            </CardDescription>
                          </div>
                        </div>
                      </CardHeader>
                    </Card>}

                    <Card
                      className={cn(
                        "cursor-pointer group",
                        "rounded-xl border border-dashed border-border/60 dark:border-foreground/[0.15]",
                        "bg-transparent hover:bg-foreground/[0.02]",
                        "hover:border-foreground/30",
                        "transition-all duration-150 hover:transition-none"
                      )}
                      onClick={() => applyTemplate('scratch')}
                    >
                      <CardHeader className="pb-3">
                        <div className="flex items-center gap-3">
                          <div className="p-2.5 rounded-xl bg-foreground/[0.05] group-hover:bg-foreground/[0.08] transition-colors duration-150 group-hover:transition-none">
                            <Plus className="h-5 w-5 text-muted-foreground" />
                          </div>
                          <div>
                            <CardTitle className="text-base font-semibold">Create from Scratch</CardTitle>
                            <CardDescription className="text-sm mt-1 text-muted-foreground">
                              Start with a blank product and configure everything yourself
                            </CardDescription>
                          </div>
                        </div>
                      </CardHeader>
                    </Card>
                  </div>
                </div>
              </StepperPage>
            )}

            {/* Step 1: General Information */}
            <StepperPage>
              <div className="space-y-4">
                <div>
                  <DialogTitle>General Information</DialogTitle>
                  <Typography type="p" className="text-muted-foreground mt-1">
                    Configure the basic details of your product
                  </Typography>
                </div>

                <div className="grid gap-5 mt-6">
                  {/* Product ID */}
                  <div className="grid gap-2">
                    <Label htmlFor="product-id" className="text-sm font-medium">Product ID</Label>
                    <Input
                      id="product-id"
                      value={productId}
                      onChange={(e) => {
                        const nextValue = e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '');
                        setProductId(nextValue);
                        if (errors.productId) {
                          setErrors(prev => {
                            const newErrors = { ...prev };
                            delete newErrors.productId;
                            return newErrors;
                          });
                        }
                      }}
                      placeholder="e.g., pro-plan"
                      disabled={!!editingProduct}
                      className={cn(
                        "h-10 rounded-xl font-mono text-sm",
                        "bg-foreground/[0.03] border-border/50 dark:border-foreground/[0.1]",
                        "focus:ring-1 focus:ring-cyan-500/30 focus:border-cyan-500/50",
                        "transition-all duration-150 hover:transition-none",
                        errors.productId && "border-destructive focus:ring-destructive/30"
                      )}
                    />
                    {errors.productId ? (
                      <Typography type="label" className="text-destructive text-xs">
                        {errors.productId}
                      </Typography>
                    ) : (
                      <Typography type="label" className="text-muted-foreground text-xs">
                        Unique identifier used to reference this product in code
                      </Typography>
                    )}
                  </div>

                  {/* Display Name */}
                  <div className="grid gap-2">
                    <Label htmlFor="display-name" className="text-sm font-medium">Display Name</Label>
                    <Input
                      id="display-name"
                      value={displayName}
                      onChange={(e) => {
                        setDisplayName(e.target.value);
                        if (errors.displayName) {
                          setErrors(prev => {
                            const newErrors = { ...prev };
                            delete newErrors.displayName;
                            return newErrors;
                          });
                        }
                      }}
                      placeholder="e.g., Pro Plan"
                      className={cn(
                        "h-10 rounded-xl text-sm",
                        "bg-foreground/[0.03] border-border/50 dark:border-foreground/[0.1]",
                        "focus:ring-1 focus:ring-cyan-500/30 focus:border-cyan-500/50",
                        "transition-all duration-150 hover:transition-none",
                        errors.displayName && "border-destructive focus:ring-destructive/30"
                      )}
                    />
                    {errors.displayName ? (
                      <Typography type="label" className="text-destructive text-xs">
                        {errors.displayName}
                      </Typography>
                    ) : (
                      <Typography type="label" className="text-muted-foreground text-xs">
                        This will be displayed to customers
                      </Typography>
                    )}
                  </div>

                  {/* Customer Type */}
                  <div className="grid gap-2">
                    <Label htmlFor="customer-type" className="text-sm font-medium">Customer Type</Label>
                    <Select value={customerType} onValueChange={(value) => setCustomerType(value as typeof customerType)}>
                      <SelectTrigger className={cn(
                        "h-10 rounded-xl text-sm",
                        "bg-foreground/[0.03] border-border/50 dark:border-foreground/[0.1]",
                        "focus:ring-1 focus:ring-cyan-500/30 focus:border-cyan-500/50"
                      )}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="rounded-xl">
                        <SelectItem value="user" className="rounded-lg">User</SelectItem>
                        <SelectItem value="team" className="rounded-lg">Team</SelectItem>
                        <SelectItem value="custom" className="rounded-lg">Custom</SelectItem>
                      </SelectContent>
                    </Select>
                    <Typography type="label" className="text-muted-foreground text-xs">
                      The type of customer this product is for
                    </Typography>
                  </div>

                  {/* Catalog */}
                  <div className="grid gap-2">
                    <Label htmlFor="catalog">Product Catalog (Optional)</Label>
                    <Select
                      value={catalogId || 'no-catalog'}
                      onValueChange={(value) => {
                        if (value === 'create-new') {
                          setShowCatalogDialog(true);
                        } else if (value === 'no-catalog') {
                          setCatalogId('');
                        } else {
                          setCatalogId(value);
                        }
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="No catalog" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="no-catalog">No catalog</SelectItem>
                        {Object.entries(existingCatalogs).map(([id, catalog]) => (
                          <SelectItem key={id} value={id}>
                            {catalog.displayName || id}
                          </SelectItem>
                        ))}
                        <SelectItem value="create-new">
                          <span className="text-primary">+ Create new catalog</span>
                        </SelectItem>
                      </SelectContent>
                    </Select>
                    <Typography type="label" className="text-muted-foreground">
                      Customers can only have one active product per catalog (except add-ons)
                    </Typography>
                  </div>

                  {/* Stackable */}
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="stackable"
                      checked={stackable}
                      onCheckedChange={(checked) => setStackable(checked as boolean)}
                    />
                    <Label htmlFor="stackable" className="cursor-pointer">
                      Stackable
                    </Label>
                  </div>
                  <Typography type="label" className="text-muted-foreground -mt-2">
                    Allow customers to purchase this product multiple times
                  </Typography>

                  {/* Add-on (only if not the first product) */}
                  {!isFirstProduct && (
                    <>
                      <div className="flex items-center space-x-2">
                        <Checkbox
                          id="addon"
                          checked={isAddOn}
                          onCheckedChange={(checked) => {
                            setIsAddOn(checked as boolean);
                            if (!checked) {
                              setIsAddOnTo([]);
                              if (errors.isAddOnTo) {
                                setErrors(prev => {
                                  const newErrors = { ...prev };
                                  delete newErrors.isAddOnTo;
                                  return newErrors;
                                });
                              }
                            }
                          }}
                        />
                        <Label htmlFor="addon" className="cursor-pointer">
                          This is an add-on
                        </Label>
                      </div>

                      {isAddOn && (
                        <div className="grid gap-2">
                          <Label>Add-on to products</Label>
                          <div className="space-y-2 max-h-40 overflow-y-auto border rounded-lg p-2">
                            {existingProducts.filter(o => !o.id.startsWith('addon')).map(product => (
                              <div key={product.id} className="flex items-center space-x-2">
                                <Checkbox
                                  id={`addon-to-${product.id}`}
                                  checked={isAddOnTo.includes(product.id)}
                                  onCheckedChange={(checked) => {
                                    if (checked) {
                                      setIsAddOnTo(prev => [...prev, product.id]);
                                    } else {
                                      setIsAddOnTo(prev => prev.filter(id => id !== product.id));
                                    }
                                    if (errors.isAddOnTo) {
                                      setErrors(prev => {
                                        const newErrors = { ...prev };
                                        delete newErrors.isAddOnTo;
                                        return newErrors;
                                      });
                                    }
                                  }}
                                />
                                <Label htmlFor={`addon-to-${product.id}`} className="cursor-pointer text-sm">
                                  {product.displayName} ({product.id})
                                  {product.catalogId && (
                                    <span className="text-muted-foreground ml-1">
                                      • {existingCatalogs[product.catalogId].displayName || product.catalogId}
                                    </span>
                                  )}
                                </Label>
                              </div>
                            ))}
                          </div>
                          {errors.isAddOnTo && (
                            <Typography type="label" className="text-destructive">
                              {errors.isAddOnTo}
                            </Typography>
                          )}
                          <Typography type="label" className="text-muted-foreground">
                            Customers must have one of these products to purchase this add-on
                          </Typography>
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>
            </StepperPage>

            {/* Step 2: Prices */}
            <StepperPage>
              <div className="space-y-4">
                <div>
                  <DialogTitle>Pricing</DialogTitle>
                  <Typography type="p" className="text-muted-foreground mt-1">
                    Configure how customers will pay for this product
                  </Typography>
                </div>

                <div className="space-y-4 mt-6">
                  {/* Free by default */}
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="free-default"
                      checked={freeByDefault}
                      onCheckedChange={(checked) => {
                        setFreeByDefault(checked as boolean);
                        if (checked) {
                          setPrices({});
                        }
                      }}
                    />
                    <Label htmlFor="free-default" className="cursor-pointer">
                      Free & included by default
                    </Label>
                  </div>
                  <Typography type="label" className="text-muted-foreground -mt-2">
                    This product will be automatically included for all customers at no cost
                  </Typography>

                  {/* Prices list */}
                  {!freeByDefault && (
                    <div className="border rounded-lg">
                      <ListSection title="Prices">
                        <PricingSection
                          prices={prices}
                          onPricesChange={setPrices}
                          variant="dialog"
                        />
                      </ListSection>
                    </div>
                  )}
                </div>
              </div>
            </StepperPage>

            {/* Step 3: Included Items */}
            <StepperPage>
              <div className="space-y-4">
                <div>
                  <DialogTitle>Included Items</DialogTitle>
                  <Typography type="p" className="text-muted-foreground mt-1">
                    Select which items customers receive with this product
                  </Typography>
                </div>

                <div className="border rounded-lg mt-6">
                  <ListSection
                    title="Items"
                    onAddClick={() => {
                      setEditingItemId(undefined);
                      setShowItemDialog(true);
                    }}
                  >
                    {Object.keys(includedItems).length === 0 ? (
                      <div className="p-8 text-center text-muted-foreground">
                        <Typography type="p">No items included yet</Typography>
                        <Typography type="p" className="text-sm mt-1">
                          Click the + button to include items with this product
                        </Typography>
                      </div>
                    ) : (
                      <div>
                        {Object.entries(includedItems).map(([itemId, item]) => (
                          <div
                            key={itemId}
                            className="px-3 py-3 hover:bg-muted/50 flex items-center justify-between catalog transition-colors"
                          >
                            <div>
                              <div className="font-medium">{getItemDisplay(itemId, item)}</div>
                              <div className="text-xs text-muted-foreground mt-1">
                                {item.expires !== 'never' && `Expires: ${item.expires.replace('-', ' ')}`}
                              </div>
                            </div>
                            <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                  setEditingItemId(itemId);
                                  setShowItemDialog(true);
                                }}
                              >
                                Edit
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => removeIncludedItem(itemId)}
                              >
                                <Trash2 className="h-4 w-4 text-destructive" />
                              </Button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </ListSection>
                </div>
              </div>
            </StepperPage>
          </Stepper>

          <DialogFooter className="flex justify-between pt-4 border-t border-border/30 dark:border-foreground/[0.06]">
            <div className="flex gap-2">
              {currentStep > (editingProduct ? 1 : 0) && (
                <Button
                  variant="outline"
                  onClick={handleBack}
                  className={cn(
                    "rounded-xl px-4",
                    "border-border/50 dark:border-foreground/[0.1]",
                    "hover:bg-foreground/[0.03]",
                    "transition-all duration-150 hover:transition-none"
                  )}
                >
                  <ArrowLeft className="h-4 w-4 mr-2" />
                  Back
                </Button>
              )}
            </div>
            {currentStep > 0 && <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={handleClose}
                className={cn(
                  "rounded-xl px-5",
                  "border-border/50 dark:border-foreground/[0.1]",
                  "hover:bg-foreground/[0.03]",
                  "transition-all duration-150 hover:transition-none"
                )}
              >
                Cancel
              </Button>
              {currentStep < 3 ? (
                <Button
                  onClick={handleNext}
                  className={cn(
                    "rounded-xl px-5",
                    "bg-foreground text-background",
                    "hover:bg-foreground/90",
                    "transition-all duration-150 hover:transition-none"
                  )}
                >
                  Next
                  <ArrowRight className="h-4 w-4 ml-2" />
                </Button>
              ) : (
                <Button
                  onClick={handleSave}
                  className={cn(
                    "rounded-xl px-5",
                    "bg-foreground text-background",
                    "hover:bg-foreground/90",
                    "transition-all duration-150 hover:transition-none"
                  )}
                >
                  {editingProduct ? "Save Changes" : "Create Product"}
                </Button>
              )}
            </div>}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Sub-dialogs */}
      <CreateCatalogDialog
        open={showCatalogDialog}
        onOpenChange={setShowCatalogDialog}
        onCreate={(catalog) => {
          // In a real app, you'd save the catalog to the backend
          setCatalogId(catalog.id);
          setShowCatalogDialog(false);
        }}
      />

      <IncludedItemDialog
        open={showItemDialog}
        onOpenChange={setShowItemDialog}
        onSave={(itemId, item) => {
          if (editingItemId !== undefined) {
            editIncludedItem(editingItemId, item);
          } else {
            addIncludedItem(itemId, item);
          }
          setShowItemDialog(false);
        }}
        editingItemId={editingItemId}
        editingItem={editingItemId !== undefined ? includedItems[editingItemId] : undefined}
        existingItems={existingItems}
        existingIncludedItemIds={Object.keys(includedItems)}
        onCreateNewItem={() => {
          setShowItemDialog(false);
          onCreateNewItem?.();
        }}
      />
    </>
  );
}
