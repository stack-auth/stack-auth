"use client";

import { Stepper, StepperPage } from "@/components/stepper";
import { CompleteConfig } from "@stackframe/stack-shared/dist/config/schema";
import { Button, Card, CardDescription, CardHeader, CardTitle, Checkbox, Dialog, DialogContent, DialogFooter, DialogTitle, Input, Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Typography } from "@stackframe/stack-ui";
import { ArrowLeft, ArrowRight, CreditCard, Package, Plus, Repeat, Trash2 } from "lucide-react";
import { useState } from "react";
import { CreateGroupDialog } from "./create-group-dialog";
import { IncludedItemDialog } from "./included-item-dialog";
import { ListSection } from "./list-section";
import { PriceDialog } from "./price-dialog";

type Template = 'one-time' | 'subscription' | 'addon' | 'scratch';

type Offer = CompleteConfig['payments']['offers'][string];
type IncludedItem = Offer['includedItems'][string];
type Price = (Offer['prices'] & object)[string];

type OfferDialogProps = {
  open: boolean,
  onOpenChange: (open: boolean) => void,
  onSave: (offerId: string, offer: Offer) => Promise<void>,
  editingOfferId?: string,
  editingOffer?: Offer,
  existingOffers: Array<{ id: string, displayName: string, groupId?: string, customerType: string }>,
  existingGroups: Record<string, { displayName: string }>,
  existingItems: Array<{ id: string, displayName: string, customerType: string }>,
  onCreateNewItem?: () => void,
};

const TEMPLATE_CONFIGS: Record<Template, Partial<Offer>> = {
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

export function OfferDialog({
  open,
  onOpenChange,
  onSave,
  editingOfferId,
  editingOffer,
  existingOffers,
  existingGroups,
  existingItems,
  onCreateNewItem
}: OfferDialogProps) {
  const [currentStep, setCurrentStep] = useState(editingOffer ? 1 : 0);

  // Form state
  const [offerId, setOfferId] = useState(editingOfferId ?? "");
  const [displayName, setDisplayName] = useState(editingOffer?.displayName || "");
  const [customerType, setCustomerType] = useState<'user' | 'team' | 'custom'>(editingOffer?.customerType || 'user');
  const [groupId, setGroupId] = useState(editingOffer?.groupId || "");
  const [isAddOn, setIsAddOn] = useState(!!editingOffer?.isAddOnTo);
  const [isAddOnTo, setIsAddOnTo] = useState<string[]>(editingOffer?.isAddOnTo !== false ? Object.keys(editingOffer?.isAddOnTo || {}) : []);
  const [stackable, setStackable] = useState(editingOffer?.stackable || false);
  const [freeByDefault, setFreeByDefault] = useState(editingOffer?.prices === "include-by-default" || false);
  const [prices, setPrices] = useState<Record<string, Price>>(editingOffer?.prices === "include-by-default" ? {} : editingOffer?.prices || {});
  const [includedItems, setIncludedItems] = useState<Offer['includedItems']>(editingOffer?.includedItems || {});
  const [freeTrial, setFreeTrial] = useState<Offer['freeTrial']>(editingOffer?.freeTrial || undefined);
  const [serverOnly, setServerOnly] = useState(editingOffer?.serverOnly || false);

  // Dialog states
  const [showGroupDialog, setShowGroupDialog] = useState(false);
  const [showPriceDialog, setShowPriceDialog] = useState(false);
  const [editingPriceId, setEditingPriceId] = useState<string | undefined>();
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

    if (!offerId.trim()) {
      newErrors.offerId = "Offer ID is required";
    } else if (!/^[a-z0-9-]+$/.test(offerId)) {
      newErrors.offerId = "Offer ID must contain only lowercase letters, numbers, and hyphens";
    } else if (!editingOffer && existingOffers.some(o => o.id === offerId)) {
      newErrors.offerId = "This offer ID already exists";
    }

    if (!displayName.trim()) {
      newErrors.displayName = "Display name is required";
    }

    if (isAddOn && isAddOnTo.length === 0) {
      newErrors.isAddOnTo = "Please select at least one offer this is an add-on to";
    }

    if (isAddOn && isAddOnTo.length > 0) {
      const addOnGroups = new Set(
        isAddOnTo.map(offerId => existingOffers.find(o => o.id === offerId)?.groupId)
      );
      if (addOnGroups.size > 1) {
        newErrors.isAddOnTo = "All selected offers must be in the same group";
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
    setCurrentStep(prev => Math.max(prev - 1, editingOffer ? 1 : 0));
  };

  const handleSave = async () => {
    const offer: Offer = {
      displayName,
      customerType,
      groupId: groupId || undefined,
      isAddOnTo: isAddOn ? Object.fromEntries(isAddOnTo.map(id => [id, true])) : false,
      stackable,
      prices: freeByDefault ? "include-by-default" : prices,
      includedItems,
      serverOnly,
      freeTrial,
    };

    await onSave(offerId, offer);
    handleClose();
  };

  const handleClose = () => {
    // Reset form
    if (!editingOffer) {
      setCurrentStep(0);
      setOfferId("");
      setDisplayName("");
      setCustomerType('user');
      setGroupId("");
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

  const addPrice = (priceId: string, price: Price) => {
    setPrices(prev => ({
      ...prev,
      [priceId]: price,
    }));
  };

  const editPrice = (priceId: string, price: Price) => {
    setPrices(prev => ({
      ...prev,
      [priceId]: price,
    }));
  };

  const removePrice = (priceId: string) => {
    setPrices(prev => {
      const newPrices = { ...prev };
      delete newPrices[priceId];
      return newPrices;
    });
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

  const formatPriceDisplay = (price: Price) => {
    let display = `$${price.USD}`;
    if (price.interval) {
      const [count, unit] = price.interval;
      display += count === 1 ? ` / ${unit}` : ` / ${count} ${unit}s`;
    }
    if (price.freeTrial) {
      const [count, unit] = price.freeTrial;
      display += ` (${count} ${unit}${count > 1 ? 's' : ''} free)`;
    }
    return display;
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

  const isFirstOffer = existingOffers.length === 0;

  return (
    <>
      <Dialog open={open} onOpenChange={handleClose}>
        <DialogContent className="max-w-2xl">
          <Stepper currentStep={currentStep} onStepChange={setCurrentStep} className="min-h-[400px]">
            {/* Step 0: Template Selection (only for new offers) */}
            {!editingOffer && (
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
                      className="cursor-pointer hover:border-primary transition-colors"
                      onClick={() => applyTemplate('one-time')}
                    >
                      <CardHeader className="pb-3">
                        <div className="flex items-center gap-3">
                          <div className="p-2 rounded-lg bg-primary/10">
                            <CreditCard className="h-5 w-5 text-primary" />
                          </div>
                          <div>
                            <CardTitle className="text-base">One-time Purchase</CardTitle>
                            <CardDescription className="text-sm mt-1">
                              A single payment for lifetime access to features
                            </CardDescription>
                          </div>
                        </div>
                      </CardHeader>
                    </Card>

                    <Card
                      className="cursor-pointer hover:border-primary transition-colors"
                      onClick={() => applyTemplate('subscription')}
                    >
                      <CardHeader className="pb-3">
                        <div className="flex items-center gap-3">
                          <div className="p-2 rounded-lg bg-primary/10">
                            <Repeat className="h-5 w-5 text-primary" />
                          </div>
                          <div>
                            <CardTitle className="text-base">Subscription</CardTitle>
                            <CardDescription className="text-sm mt-1">
                              Recurring payments for continuous access
                            </CardDescription>
                          </div>
                        </div>
                      </CardHeader>
                    </Card>

                    {!isFirstOffer && <Card
                      className="cursor-pointer hover:border-primary transition-colors"
                      onClick={() => applyTemplate('addon')}
                    >
                      <CardHeader className="pb-3">
                        <div className="flex items-center gap-3">
                          <div className="p-2 rounded-lg bg-primary/10">
                            <Package className="h-5 w-5 text-primary" />
                          </div>
                          <div>
                            <CardTitle className="text-base">Add-on</CardTitle>
                            <CardDescription className="text-sm mt-1">
                              Additional features that complement existing offers
                            </CardDescription>
                          </div>
                        </div>
                      </CardHeader>
                    </Card>}

                    <Card
                      className="cursor-pointer hover:border-primary transition-colors border-dashed"
                      onClick={() => applyTemplate('scratch')}
                    >
                      <CardHeader className="pb-3">
                        <div className="flex items-center gap-3">
                          <div className="p-2 rounded-lg bg-muted">
                            <Plus className="h-5 w-5 text-muted-foreground" />
                          </div>
                          <div>
                            <CardTitle className="text-base">Create from Scratch</CardTitle>
                            <CardDescription className="text-sm mt-1">
                              Start with a blank offer and configure everything yourself
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
                    Configure the basic details of your offer
                  </Typography>
                </div>

                <div className="grid gap-4 mt-6">
                  {/* Offer ID */}
                  <div className="grid gap-2">
                    <Label htmlFor="offer-id">Offer ID</Label>
                    <Input
                      id="offer-id"
                      value={offerId}
                      onChange={(e) => {
                        setOfferId(e.target.value);
                        if (errors.offerId) {
                          setErrors(prev => {
                            const newErrors = { ...prev };
                            delete newErrors.offerId;
                            return newErrors;
                          });
                        }
                      }}
                      placeholder="e.g., pro-plan"
                      disabled={!!editingOffer}
                      className={errors.offerId ? "border-destructive" : ""}
                    />
                    {errors.offerId ? (
                      <Typography type="label" className="text-destructive">
                        {errors.offerId}
                      </Typography>
                    ) : (
                      <Typography type="label" className="text-muted-foreground">
                        Unique identifier used to reference this offer in code
                      </Typography>
                    )}
                  </div>

                  {/* Display Name */}
                  <div className="grid gap-2">
                    <Label htmlFor="display-name">Display Name</Label>
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
                      className={errors.displayName ? "border-destructive" : ""}
                    />
                    {errors.displayName ? (
                      <Typography type="label" className="text-destructive">
                        {errors.displayName}
                      </Typography>
                    ) : (
                      <Typography type="label" className="text-muted-foreground">
                        How this offer will be displayed to customers
                      </Typography>
                    )}
                  </div>

                  {/* Customer Type */}
                  <div className="grid gap-2">
                    <Label htmlFor="customer-type">Customer Type</Label>
                    <Select value={customerType} onValueChange={(value) => setCustomerType(value as typeof customerType)}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="user">User</SelectItem>
                        <SelectItem value="team">Team</SelectItem>
                        <SelectItem value="custom">Custom</SelectItem>
                      </SelectContent>
                    </Select>
                    <Typography type="label" className="text-muted-foreground">
                      The type of customer this offer is for
                    </Typography>
                  </div>

                  {/* Group */}
                  <div className="grid gap-2">
                    <Label htmlFor="group">Offer Group (Optional)</Label>
                    <Select
                      value={groupId || 'no-group'}
                      onValueChange={(value) => {
                        if (value === 'create-new') {
                          setShowGroupDialog(true);
                        } else if (value === 'no-group') {
                          setGroupId('');
                        } else {
                          setGroupId(value);
                        }
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="No group" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="no-group">No group</SelectItem>
                        {Object.entries(existingGroups).map(([id, group]) => (
                          <SelectItem key={id} value={id}>
                            {group.displayName || id}
                          </SelectItem>
                        ))}
                        <SelectItem value="create-new">
                          <span className="text-primary">+ Create new group</span>
                        </SelectItem>
                      </SelectContent>
                    </Select>
                    <Typography type="label" className="text-muted-foreground">
                      Customers can only have one active offer per group (except add-ons)
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
                    Allow customers to purchase this offer multiple times
                  </Typography>

                  {/* Add-on (only if not the first offer) */}
                  {!isFirstOffer && (
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
                          <Label>Add-on to offers</Label>
                          <div className="space-y-2 max-h-40 overflow-y-auto border rounded-lg p-2">
                            {existingOffers.filter(o => !o.id.startsWith('addon')).map(offer => (
                              <div key={offer.id} className="flex items-center space-x-2">
                                <Checkbox
                                  id={`addon-to-${offer.id}`}
                                  checked={isAddOnTo.includes(offer.id)}
                                  onCheckedChange={(checked) => {
                                    if (checked) {
                                      setIsAddOnTo(prev => [...prev, offer.id]);
                                    } else {
                                      setIsAddOnTo(prev => prev.filter(id => id !== offer.id));
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
                                <Label htmlFor={`addon-to-${offer.id}`} className="cursor-pointer text-sm">
                                  {offer.displayName} ({offer.id})
                                  {offer.groupId && (
                                    <span className="text-muted-foreground ml-1">
                                      • {existingGroups[offer.groupId].displayName || offer.groupId}
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
                            Customers must have one of these offers to purchase this add-on
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
                    Configure how customers will pay for this offer
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
                    This offer will be automatically included for all customers at no cost
                  </Typography>

                  {/* Prices list */}
                  {!freeByDefault && (
                    <div className="border rounded-lg">
                      <ListSection
                        title="Prices"
                        onAddClick={() => {
                          setEditingPriceId(undefined);
                          setShowPriceDialog(true);
                        }}
                      >
                        {Object.values(prices).length === 0 ? (
                          <div className="p-8 text-center text-muted-foreground">
                            <Typography type="p">No prices configured yet</Typography>
                            <Typography type="p" className="text-sm mt-1">
                              Click the + button to add your first price
                            </Typography>
                          </div>
                        ) : (
                          <div>
                            {Object.entries(prices).map(([id, price]) => (
                              <div
                                key={id}
                                className="px-3 py-3 hover:bg-muted/50 flex items-center justify-between group transition-colors"
                              >
                                <div>
                                  <div className="font-medium">{formatPriceDisplay(price)}</div>
                                  <div className="text-xs text-muted-foreground mt-1">
                                    ID: {id}
                                    {price.serverOnly && ' • Server-only'}
                                  </div>
                                </div>
                                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => {
                                      setEditingPriceId(id);
                                      setShowPriceDialog(true);
                                    }}
                                  >
                                    Edit
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => removePrice(id)}
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
                    Select which items customers receive with this offer
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
                          Click the + button to include items with this offer
                        </Typography>
                      </div>
                    ) : (
                      <div>
                        {Object.entries(includedItems).map(([itemId, item]) => (
                          <div
                            key={itemId}
                            className="px-3 py-3 hover:bg-muted/50 flex items-center justify-between group transition-colors"
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

          <DialogFooter className="flex justify-between">
            <div className="flex gap-2">
              {currentStep > (editingOffer ? 1 : 0) && (
                <Button variant="outline" onClick={handleBack}>
                  <ArrowLeft className="h-4 w-4 mr-2" />
                  Back
                </Button>
              )}
            </div>
            {currentStep > 0 && <div className="flex gap-2">
              <Button variant="outline" onClick={handleClose}>
                Cancel
              </Button>
              {currentStep < 3 ? (
                <Button onClick={handleNext}>
                  Next
                  <ArrowRight className="h-4 w-4 ml-2" />
                </Button>
              ) : (
                <Button onClick={handleSave}>
                  {editingOffer ? "Save Changes" : "Create Offer"}
                </Button>
              )}
            </div>}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Sub-dialogs */}
      <CreateGroupDialog
        open={showGroupDialog}
        onOpenChange={setShowGroupDialog}
        onCreate={(group) => {
          // In a real app, you'd save the group to the backend
          setGroupId(group.id);
          setShowGroupDialog(false);
        }}
      />

      <PriceDialog
        open={showPriceDialog}
        onOpenChange={setShowPriceDialog}
        onSave={(priceId, price) => {
          if (editingPriceId) {
            editPrice(editingPriceId, price);
          } else {
            addPrice(priceId, price);
          }
          setShowPriceDialog(false);
        }}
        editingPriceId={editingPriceId}
        editingPrice={editingPriceId ? prices[editingPriceId] : undefined}
        existingPriceIds={Object.keys(prices)}
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

