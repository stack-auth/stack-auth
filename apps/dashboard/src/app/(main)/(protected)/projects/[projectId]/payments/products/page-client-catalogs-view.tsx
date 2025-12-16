"use client";

import { Link } from '@/components/link';
import { ItemDialog } from "@/components/payments/item-dialog";
import { cn } from "@/lib/utils";
import { CompleteConfig } from "@stackframe/stack-shared/dist/config/schema";
import type { DayInterval } from "@stackframe/stack-shared/dist/utils/dates";
import { prettyPrintWithMagnitudes } from "@stackframe/stack-shared/dist/utils/numbers";
import { typedEntries, typedFromEntries } from "@stackframe/stack-shared/dist/utils/objects";
import { stringCompare } from "@stackframe/stack-shared/dist/utils/strings";
import {
  ActionDialog,
  Button,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Input,
  Label,
  Popover,
  PopoverContent,
  PopoverTrigger,
  SimpleTooltip,
  toast
} from "@stackframe/stack-ui";
import { ChevronsUpDown, Code, Copy, FileText, Gift, Info, Layers, MoreVertical, Pencil, Plus, Puzzle, Server, Trash2, X } from "lucide-react";
import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useAdminApp } from "../../use-admin-app";
import { IntervalPopover, OrSeparator, SectionHeading } from "./components";
import { ProductDialog } from "./product-dialog";
import { ProductPriceRow } from "./product-price-row";
import {
  generateUniqueId,
  getPricesObject,
  intervalLabel,
  shortIntervalLabel,
  type Price,
  type PricesObject,
  type Product
} from "./utils";

// Custom error class to signal validation failures without closing edit mode
class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Generates a unique product/item ID
 */
function generateProductId(prefix: string): string {
  return generateUniqueId(prefix);
}

// ============================================================================
// Product Editable Input Component
// ============================================================================

type ProductEditableInputProps = {
  value: string,
  onUpdate?: (value: string) => void,
  readOnly?: boolean,
  placeholder?: string,
  inputClassName?: string,
  transform?: (value: string) => string,
};

function ProductEditableInput({
  value,
  onUpdate,
  readOnly,
  placeholder,
  inputClassName,
  transform,
}: ProductEditableInputProps) {
  const [isActive, setIsActive] = useState(false);

  if (readOnly) {
    return (
      <div
        className={cn(
          "w-full px-1 py-0 h-[unset] border-transparent bg-transparent cursor-default truncate",
          inputClassName,
          !value && "text-muted-foreground"
        )}
        aria-label={placeholder}
      >
        {value || placeholder}
      </div>
    );
  }

  return (
    <Input
      value={value}
      onChange={(event) => {
        const rawValue = event.target.value;
        const nextValue = transform ? transform(rawValue) : rawValue;
        onUpdate?.(nextValue);
      }}
      placeholder={placeholder}
      autoComplete="off"
      className={cn(
        "w-full px-1 py-0 h-[unset] border-transparent transition-colors focus-visible:ring-1 focus-visible:ring-ring focus-visible:border-transparent",
        isActive ? "bg-muted/60 dark:bg-muted/30 z-20" : "bg-transparent hover:bg-muted/40 dark:hover:bg-muted/20",
        inputClassName,
      )}
      onFocus={() => setIsActive(true)}
      onBlur={() => setIsActive(false)}
    />
  );
}

// ============================================================================
// Helper Components
// ============================================================================

/**
 * Label with optional info tooltip for technical terms
 */
function LabelWithInfo({ children, tooltip }: { children: React.ReactNode, tooltip?: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <Label className="text-[11px] font-medium uppercase tracking-[0.24em] text-muted-foreground">
        {children}
      </Label>
      {tooltip && (
        <SimpleTooltip tooltip={tooltip}>
          <Info className="h-3 w-3 text-muted-foreground/60 cursor-help" />
        </SimpleTooltip>
      )}
    </div>
  );
}

// ============================================================================
// Product Item Row Component
// ============================================================================

const EXPIRES_OPTIONS: Array<{ value: Product["includedItems"][string]["expires"], label: string, description: string }> = [
  {
    value: 'never' as const,
    label: 'Never',
    description: 'Customer keeps these items forever, even after subscription ends'
  },
  {
    value: 'when-purchase-expires' as const,
    label: 'With subscription',
    description: 'Items are removed when the subscription ends or is cancelled'
  },
  {
    value: 'when-repeated' as const,
    label: 'Until next renewal',
    description: 'Items reset each billing cycle (e.g., monthly credits that refresh)'
  }
];

function ProductItemRow({
  activeType,
  itemId,
  item,
  itemDisplayName,
  readOnly,
  startEditing,
  onSave,
  onRemove,
  allItems,
  existingIncludedItemIds,
  onChangeItemId,
  onCreateNewItem,
}: {
  activeType: 'user' | 'team' | 'custom',
  itemId: string,
  item: Product['includedItems'][string],
  itemDisplayName: string,
  readOnly?: boolean,
  startEditing?: boolean,
  onSave: (itemId: string, item: Product['includedItems'][string]) => void,
  onRemove?: () => void,
  allItems: Array<{ id: string, displayName: string, customerType: string }>,
  existingIncludedItemIds: string[],
  onChangeItemId: (newItemId: string) => void,
  onCreateNewItem: (customerType?: 'user' | 'team' | 'custom', onCreated?: (itemId: string) => void) => void,
}) {
  const [isEditing, setIsEditing] = useState<boolean>(false);
  const [quantity, setQuantity] = useState<string>(String(item.quantity));
  const [repeatUnit, setRepeatUnit] = useState<DayInterval[1] | undefined>(item.repeat !== 'never' ? item.repeat[1] : undefined);
  const [repeatCount, setRepeatCount] = useState<number>(item.repeat !== 'never' ? item.repeat[0] : 1);
  const [repeatSelection, setRepeatSelection] = useState<'one-time' | 'custom' | DayInterval[1]>(
    item.repeat !== 'never' ? (item.repeat[0] === 1 ? item.repeat[1] : 'custom') : 'one-time'
  );
  const [itemSelectOpen, setItemSelectOpen] = useState(false);

  useEffect(() => {
    setQuantity(String(item.quantity));
    setRepeatUnit(item.repeat !== 'never' ? item.repeat[1] : undefined);
    setRepeatCount(item.repeat !== 'never' ? item.repeat[0] : 1);
    setRepeatSelection(item.repeat !== 'never' ? (item.repeat[0] === 1 ? item.repeat[1] : 'custom') : 'one-time');
  }, [item]);

  useEffect(() => {
    if (!readOnly && startEditing) setIsEditing(true);
    if (readOnly) setIsEditing(false);
  }, [startEditing, readOnly]);


  const updateParent = (raw: string) => {
    const normalized = raw === '' ? 0 : parseInt(raw, 10);
    const updated: Product['includedItems'][string] = { ...item, quantity: Number.isNaN(normalized) ? 0 : normalized };
    onSave(itemId, updated);
  };

  const repeatText = item.repeat === 'never' ? null : intervalLabel(item.repeat);
  const shortRepeatText = shortIntervalLabel(item.repeat);

  // Consistent dropdown button styling
  const dropdownButtonClass = cn(
    "flex h-10 w-full items-center justify-between px-3 text-sm font-medium",
    "rounded-xl border border-border/60 dark:border-foreground/[0.1]",
    "bg-background dark:bg-[hsl(240,10%,10%)]",
    "transition-colors duration-150 hover:transition-none hover:bg-foreground/[0.03]"
  );

  if (isEditing) {
    return (
      <div className={cn(
        "relative rounded-2xl p-4",
        "border border-border/60 dark:border-foreground/[0.12]",
        "bg-background/60 dark:bg-[hsl(240,10%,7%)]"
      )}>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <LabelWithInfo tooltip="Select the type of resource or credit to grant when this product is purchased">
              Item Name
            </LabelWithInfo>
            <Popover open={itemSelectOpen} onOpenChange={setItemSelectOpen}>
              <PopoverTrigger asChild>
                <button className={dropdownButtonClass}>
                  <span className="truncate">{itemDisplayName}</span>
                  <ChevronsUpDown className="h-4 w-4 text-muted-foreground" />
                </button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-72 p-0 overflow-hidden">
                <div className="flex max-h-64 flex-col overflow-auto p-1">
                  {allItems.filter(opt => opt.customerType === activeType).map((opt) => {
                    const isSelected = opt.id === itemId;
                    const isUsed = existingIncludedItemIds.includes(opt.id) && !isSelected;
                    return (
                      <button
                        key={opt.id}
                        disabled={isUsed}
                        className={cn(
                          "flex flex-col items-start w-full px-3 py-2 rounded-lg text-left",
                          "transition-colors duration-150 hover:transition-none",
                          isSelected
                            ? "bg-foreground/[0.08] text-foreground"
                            : "hover:bg-foreground/[0.04] text-foreground",
                          isUsed && "opacity-40 cursor-not-allowed"
                        )}
                        onClick={() => {
                          if (isSelected || isUsed) {
                            setItemSelectOpen(false);
                            return;
                          }
                          onChangeItemId(opt.id);
                          setItemSelectOpen(false);
                        }}
                      >
                        <span className="font-medium">{opt.displayName || opt.id}</span>
                        <span className="text-xs text-muted-foreground">{opt.customerType.toUpperCase()} • {opt.id}</span>
                      </button>
                    );
                  })}
                </div>
                <div className="border-t border-border/30 p-1">
                  <button
                    className={cn(
                      "flex items-center w-full px-3 py-2 rounded-lg text-left text-sm font-medium",
                      "text-primary hover:bg-primary/[0.08]",
                      "transition-colors duration-150 hover:transition-none"
                    )}
                    onClick={() => {
                        setItemSelectOpen(false);
                      onCreateNewItem(activeType, (newItemId) => {
                        // Auto-select the newly created item
                        onChangeItemId(newItemId);
                      });
                    }}
                  >
                    <Plus className="mr-2 h-4 w-4" /> New Item
                  </button>
                </div>
              </PopoverContent>
            </Popover>
          </div>
          <div className="flex flex-col gap-1.5">
            <LabelWithInfo tooltip="Number of units to grant each time (e.g., 100 credits, 5 seats)">
              Quantity
            </LabelWithInfo>
            <Input
              className={cn(
                "h-10 w-full px-3 text-right tabular-nums",
                "rounded-xl border border-border/60 dark:border-foreground/[0.1]",
                "bg-background dark:bg-[hsl(240,10%,10%)]"
              )}
              inputMode="numeric"
              value={quantity}
              onChange={(e) => {
                const v = e.target.value;
                if (v === '' || /^\d*$/.test(v)) setQuantity(v);
                if (!readOnly && (v === '' || /^\d*$/.test(v))) updateParent(v);
              }}
            />
          </div>
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <LabelWithInfo tooltip="When should these items be removed from the customer?">
              Expires
            </LabelWithInfo>
            <Popover>
              <PopoverTrigger asChild>
                <button className={dropdownButtonClass}>
                  <span className="truncate">
                    {EXPIRES_OPTIONS.find(o => o.value === item.expires)?.label ?? 'Never'}
                  </span>
                  <ChevronsUpDown className="h-4 w-4 text-muted-foreground" />
                </button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-80 p-0 overflow-hidden">
                <div className="flex flex-col p-1">
                  {EXPIRES_OPTIONS.map((option) => {
                    const isSelected = item.expires === option.value;
                    return (
                      <button
                        key={option.value}
                        className={cn(
                          "flex flex-col items-start w-full px-3 py-2.5 rounded-lg text-left",
                          "transition-colors duration-150 hover:transition-none",
                          isSelected
                            ? "bg-foreground/[0.08] text-foreground"
                            : "hover:bg-foreground/[0.04] text-foreground"
                        )}
                        onClick={() => {
                          onSave(itemId, { ...item, expires: option.value });
                        }}
                      >
                        <span className="font-medium">{option.label}</span>
                        <span className="text-xs text-muted-foreground">{option.description}</span>
                      </button>
                    );
                  })}
                </div>
              </PopoverContent>
            </Popover>
          </div>
          <div className="flex flex-col gap-1.5">
            <LabelWithInfo tooltip="How often should these items be granted? (e.g., monthly credits)">
              Repeat
            </LabelWithInfo>
            <IntervalPopover
              readOnly={readOnly}
              intervalText={repeatText}
              intervalSelection={repeatSelection}
              unit={repeatUnit}
              count={repeatCount}
              setIntervalSelection={setRepeatSelection}
              setUnit={setRepeatUnit}
              setCount={setRepeatCount}
              noneLabel="One-time only"
              triggerClassName={dropdownButtonClass + " capitalize"}
              onChange={(interval) => {
                if (readOnly) return;
                const updated: Product['includedItems'][string] = {
                  ...item,
                  repeat: interval ? interval : 'never',
                };
                onSave(itemId, updated);
              }}
            />
          </div>
        </div>

        {onRemove && (
          <button
            className="absolute right-3 top-3 p-1 rounded-md text-muted-foreground transition-colors duration-150 hover:transition-none hover:text-foreground hover:bg-foreground/[0.05]"
            onClick={onRemove}
            aria-label="Remove item"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
    );
  } else {
    // Simplified view mode - just show the essential info
    return (
      <div className="flex items-center gap-3 py-1">
        <span className="text-sm text-foreground truncate">{itemDisplayName}</span>
        <div className="ml-auto flex items-center gap-1.5 shrink-0">
          <span className="text-sm text-muted-foreground tabular-nums">{prettyPrintWithMagnitudes(item.quantity)}</span>
          <span className="text-xs text-muted-foreground">{shortRepeatText}</span>
        </div>
      </div>
    );
  }
}


type ProductCardProps = {
  id: string,
  product: Product,
  allProducts: Array<{ id: string, product: Product }>,
  existingItems: Array<{ id: string, displayName: string, customerType: string }>,
  onSave: (id: string, product: Product) => Promise<void>,
  onDelete: (id: string) => Promise<void>,
  onDuplicate: (product: Product) => void,
  onCreateNewItem: (customerType?: 'user' | 'team' | 'custom') => void,
  onOpenDetails: (product: Product) => void,
  isDraft?: boolean,
  onCancelDraft?: () => void,
  // Table mode props - when part of a pricing table
  isColumnInTable?: boolean,
  isFirstColumn?: boolean,
  isLastColumn?: boolean,
};

// Customer type badge colors
const CUSTOMER_TYPE_COLORS = {
  user: 'bg-blue-500/15 text-blue-600 dark:bg-blue-500/20 dark:text-blue-400 ring-blue-500/30',
  team: 'bg-emerald-500/15 text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-400 ring-emerald-500/30',
  custom: 'bg-amber-500/15 text-amber-600 dark:bg-amber-500/20 dark:text-amber-400 ring-amber-500/30',
} as const;

function ProductCard({ id, product, allProducts, existingItems, onSave, onDelete, onDuplicate, onCreateNewItem, onOpenDetails, isDraft, onCancelDraft, isColumnInTable, isFirstColumn, isLastColumn }: ProductCardProps) {
  const customerType = product.customerType;
  const [isEditing, setIsEditing] = useState(!!isDraft);
  const [draft, setDraft] = useState<Product>(product);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [editingPriceId, setEditingPriceId] = useState<string | undefined>(undefined);
  const [editingPricesIsFreeMode, setEditingPricesIsFreeMode] = useState(false);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const [hasAutoScrolled, setHasAutoScrolled] = useState(false);
  const [localProductId, setLocalProductId] = useState<string>(id);
  const [currentHash, setCurrentHash] = useState<string | null>(null);
  const hashAnchor = `#product-${id}`;
  const isHashTarget = currentHash === hashAnchor;

  useEffect(() => {
    // Only sync draft with product prop when not actively editing
    // This prevents losing unsaved changes when other parts of the config update
    if (!isEditing) {
      setDraft(product);
      setLocalProductId(id);
    }
  }, [product, id, isEditing]);

  useEffect(() => {
    if (isDraft && !hasAutoScrolled && cardRef.current) {
      cardRef.current.scrollIntoView({ behavior: 'auto', block: 'nearest', inline: 'center' });
      setHasAutoScrolled(true);
    }
  }, [isDraft, hasAutoScrolled]);

  useEffect(() => {
    const updateFromHash = () => {
      const h = window.location.hash;
      if (h !== currentHash) setCurrentHash(h);
    };
    updateFromHash();
    window.addEventListener('hashchange', updateFromHash);

    const removeHashTarget = () => {
      if (isHashTarget && window.location.hash === hashAnchor) {
        window.history.replaceState(null, "", window.location.pathname + window.location.search);
      }
    };
    window.addEventListener("click", removeHashTarget, { capture: true });

    return () => {
      window.removeEventListener('hashchange', updateFromHash);
      window.removeEventListener("click", removeHashTarget, { capture: true });
    };
  }, [hashAnchor, isHashTarget, currentHash]);

  const pricesObject: PricesObject = getPricesObject(draft);
  const priceCount = Object.keys(pricesObject).length;
  const hasExistingPrices = priceCount > 0;

  useEffect(() => {
    setEditingPricesIsFreeMode(hasExistingPrices && (editingPricesIsFreeMode || draft.prices === 'include-by-default'));
  }, [editingPricesIsFreeMode, draft.prices, hasExistingPrices]);

  const canSaveProduct = draft.prices === 'include-by-default' || (typeof draft.prices === 'object' && hasExistingPrices);
  const saveDisabledReason = canSaveProduct ? undefined : "Add at least one price or set Include by default";

  const handleRemovePrice = (priceId: string) => {
    setDraft(prev => {
      const nextPrices: PricesObject = typeof prev.prices !== 'object' ? {} : { ...prev.prices };
      delete nextPrices[priceId];
      return { ...prev, prices: nextPrices };
    });
    if (editingPriceId === priceId) setEditingPriceId(undefined);
  };

  const handleAddOrEditIncludedItem = (itemId: string, item: Product['includedItems'][string]) => {
    setDraft(prev => ({
      ...prev,
      includedItems: {
        ...prev.includedItems,
        [itemId]: item,
      },
    }));
  };

  const handleRemoveIncludedItem = (itemId: string) => {
    setDraft(prev => {
      const next: Product['includedItems'] = { ...prev.includedItems };
      delete next[itemId];
      return { ...prev, includedItems: next };
    });
  };

  const generateComprehensivePrompt = (): string => {
    const pricesObj = getPricesObject(draft);
    const priceEntries = typedEntries(pricesObj);

    let prompt = `# Product Implementation Guide: ${draft.displayName || localProductId}\n\n`;

    prompt += `## Product Overview\n`;
    prompt += `- **Product ID**: \`${localProductId}\`\n`;
    prompt += `- **Display Name**: ${draft.displayName || 'Untitled Product'}\n`;
    prompt += `- **Customer Type**: ${draft.customerType}\n`;
    if (draft.freeTrial) {
      const [count, unit] = draft.freeTrial;
      prompt += `- **Free Trial**: ${count} ${count === 1 ? unit : unit + 's'}\n`;
    }
    prompt += `- **Server Only**: ${draft.serverOnly ? 'Yes' : 'No'}\n`;
    prompt += `- **Stackable**: ${draft.stackable ? 'Yes' : 'No'}\n`;
    if (draft.isAddOnTo && typeof draft.isAddOnTo === 'object') {
      const addOnProductIds = Object.keys(draft.isAddOnTo);
      prompt += `- **Add-on To**: ${addOnProductIds.join(', ')}\n`;
    }
    if (draft.catalogId) {
      prompt += `- **Catalog ID**: ${draft.catalogId}\n`;
    }
    prompt += `\n`;

    prompt += `## Pricing Structure\n`;
    if (draft.prices === 'include-by-default') {
      prompt += `This product is included by default (free).\n\n`;
    } else if (priceEntries.length === 0) {
      prompt += `No prices configured.\n\n`;
    } else {
      priceEntries.forEach(([priceId, price], index) => {
        prompt += `### Price Tier ${index + 1}${priceId !== 'free' ? ` (ID: \`${priceId}\`)` : ''}\n`;

        const currencyCodes = ['USD', 'EUR', 'GBP', 'JPY', 'AUD', 'CAD', 'CHF', 'CNY', 'SEK', 'NOK', 'DKK', 'PLN', 'BRL', 'MXN', 'INR', 'SGD', 'HKD', 'NZD', 'ZAR', 'KRW'] as const;
        const currencies = currencyCodes
          .map(code => ({ code, amount: (price as any)[code] }))
          .filter(({ amount }) => amount !== undefined && amount !== null);

        if (currencies.length > 0) {
          prompt += `**Pricing**:\n`;
          currencies.forEach(({ code, amount }) => {
            prompt += `- ${code}: $${amount}\n`;
          });
        }

        if (price.interval) {
          const [count, unit] = price.interval;
          prompt += `**Billing Interval**: ${intervalLabel(price.interval) || `${count} ${unit}${count !== 1 ? 's' : ''}`}\n`;
        } else {
          prompt += `**Billing**: One-time payment\n`;
        }

        if (price.freeTrial) {
          const [count, unit] = price.freeTrial;
          prompt += `**Free Trial**: ${count} ${count === 1 ? unit : unit + 's'}\n`;
        }

        if (price.serverOnly) {
          prompt += `**Note**: Server-side purchase only\n`;
        }

        prompt += `\n`;
      });
    }

    const itemsList = Object.entries(draft.includedItems);
    if (itemsList.length > 0) {
      prompt += `## Included Items\n`;
      itemsList.forEach(([itemId, item]) => {
        const itemMeta = existingItems.find(i => i.id === itemId);
        const itemLabel = itemMeta ? itemMeta.displayName : itemId;
        prompt += `### ${itemLabel} (\`${itemId}\`)\n`;
        prompt += `- **Quantity**: ${prettyPrintWithMagnitudes(item.quantity)}\n`;
        if (item.repeat) {
          if (item.repeat === 'never') {
            prompt += `- **Repeat**: Never (one-time grant)\n`;
          } else {
            const [count, unit] = item.repeat;
            prompt += `- **Repeat**: Every ${count} ${count === 1 ? unit : unit + 's'}\n`;
          }
        }
        if (item.expires) {
          prompt += `- **Expires**: ${item.expires === 'never' ? 'Never' : item.expires === 'when-purchase-expires' ? 'When purchase expires' : 'When repeated'}\n`;
        }
        prompt += `\n`;
      });
    } else {
      prompt += `## Included Items\n`;
      prompt += `No items included.\n\n`;
    }

    prompt += `## Implementation Code\n\n`;
    prompt += `To create a checkout URL for this product:\n\n`;
    prompt += `\`\`\`typescript\n`;
    prompt += `const url = await ${draft.customerType}.createCheckoutUrl({ productId: "${localProductId}" });\n`;
    prompt += `window.open(url, "_blank");\n`;
    prompt += `\`\`\`\n\n`;

    prompt += `## Implementation Notes\n\n`;
    if (draft.serverOnly) {
      prompt += `- This product can only be purchased from server-side code. Use \`stackServerApp\` instead of \`stackClientApp\`.\n`;
    }
    if (draft.stackable) {
      prompt += `- This product is stackable, meaning customers can purchase it multiple times and quantities will accumulate.\n`;
    }
    if (draft.isAddOnTo && typeof draft.isAddOnTo === 'object') {
      prompt += `- This is an add-on product. Customers must already have one of the base products to purchase this.\n`;
    }
    if (draft.freeTrial) {
      prompt += `- This product includes a free trial period. Customers will not be charged until the trial ends.\n`;
    }
    if (itemsList.length > 0) {
      prompt += `- When a customer purchases this product, they will automatically receive the included items listed above.\n`;
    }

    if (itemsList.length > 0) {
      prompt += `\n## Item Implementation Guide\n\n`;
      prompt += `Items are automatically granted to customers when they purchase this product. Here's how to work with items in your code:\n\n`;

      prompt += `### Getting Item Quantities\n\n`;
      prompt += `**Server-side (recommended)**:\n\n`;
      prompt += `\`\`\`typescript\n`;
      if (draft.customerType === 'user') {
        prompt += `// Get a user and their item\n`;
        prompt += `const user = await stackServerApp.getUser({ userId: "user_123" });\n`;
        prompt += `const item = await user.getItem("${itemsList[0][0]}");\n`;
        prompt += `console.log(\`Current quantity: \${item.quantity}\`);\n`;
        prompt += `console.log(\`Display name: \${item.displayName}\`);\n`;
      } else if (draft.customerType === 'team') {
        prompt += `// Get a team and their item\n`;
        prompt += `const team = await stackServerApp.getTeam({ teamId: "team_123" });\n`;
        prompt += `const item = await team.getItem("${itemsList[0][0]}");\n`;
        prompt += `console.log(\`Current quantity: \${item.quantity}\`);\n`;
        prompt += `console.log(\`Display name: \${item.displayName}\`);\n`;
      } else {
        prompt += `// Get a custom customer and their item\n`;
        prompt += `const customer = await stackServerApp.getCustomCustomer({ customCustomerId: "customer_123" });\n`;
        prompt += `const item = await customer.getItem("${itemsList[0][0]}");\n`;
        prompt += `console.log(\`Current quantity: \${item.quantity}\`);\n`;
        prompt += `console.log(\`Display name: \${item.displayName}\`);\n`;
      }
      prompt += `\`\`\`\n\n`;

      prompt += `**Client-side (React)**:\n\n`;
      prompt += `\`\`\`typescript\n`;
      if (draft.customerType === 'user') {
        prompt += `// In a React component\n`;
        prompt += `const user = useUser();\n`;
        prompt += `const item = user?.useItem("${itemsList[0][0]}");\n`;
        prompt += `if (item) {\n`;
        prompt += `  console.log(\`Current quantity: \${item.quantity}\`);\n`;
        prompt += `  // Use item.nonNegativeQuantity for display (clamps to 0)\n`;
        prompt += `  console.log(\`Available: \${item.nonNegativeQuantity}\`);\n`;
        prompt += `}\n`;
      } else if (draft.customerType === 'team') {
        prompt += `// In a React component with team context\n`;
        prompt += `const team = useTeam();\n`;
        prompt += `const item = team?.useItem("${itemsList[0][0]}");\n`;
        prompt += `if (item) {\n`;
        prompt += `  console.log(\`Current quantity: \${item.quantity}\`);\n`;
        prompt += `  console.log(\`Available: \${item.nonNegativeQuantity}\`);\n`;
        prompt += `}\n`;
      }
      prompt += `\`\`\`\n\n`;

      prompt += `### Modifying Item Quantities (Server-side only)\n\n`;
      prompt += `**Increase quantity** (add credits/resources):\n\n`;
      prompt += `\`\`\`typescript\n`;
      if (draft.customerType === 'user') {
        prompt += `const user = await stackServerApp.getUser({ userId: "user_123" });\n`;
        prompt += `const item = await user.getItem("${itemsList[0][0]}");\n`;
        prompt += `// Add 100 units\n`;
        prompt += `await item.increaseQuantity(100);\n`;
      } else if (draft.customerType === 'team') {
        prompt += `const team = await stackServerApp.getTeam({ teamId: "team_123" });\n`;
        prompt += `const item = await team.getItem("${itemsList[0][0]}");\n`;
        prompt += `// Add 100 units\n`;
        prompt += `await item.increaseQuantity(100);\n`;
      } else {
        prompt += `const customer = await stackServerApp.getCustomCustomer({ customCustomerId: "customer_123" });\n`;
        prompt += `const item = await customer.getItem("${itemsList[0][0]}");\n`;
        prompt += `// Add 100 units\n`;
        prompt += `await item.increaseQuantity(100);\n`;
      }
      prompt += `\`\`\`\n\n`;

      prompt += `**Decrease quantity** (consume credits/resources):\n\n`;
      prompt += `\`\`\`typescript\n`;
      if (draft.customerType === 'user') {
        prompt += `const user = await stackServerApp.getUser({ userId: "user_123" });\n`;
        prompt += `const item = await user.getItem("${itemsList[0][0]}");\n`;
        prompt += `// Consume 50 units (allows negative balance)\n`;
        prompt += `await item.decreaseQuantity(50);\n`;
        prompt += `\n`;
        prompt += `// Or use tryDecreaseQuantity to prevent going below 0\n`;
        prompt += `const success = await item.tryDecreaseQuantity(50);\n`;
        prompt += `if (!success) {\n`;
        prompt += `  // Insufficient quantity - handle accordingly\n`;
        prompt += `  throw new Error("Insufficient credits");\n`;
        prompt += `}\n`;
      } else if (draft.customerType === 'team') {
        prompt += `const team = await stackServerApp.getTeam({ teamId: "team_123" });\n`;
        prompt += `const item = await team.getItem("${itemsList[0][0]}");\n`;
        prompt += `// Consume 50 units\n`;
        prompt += `await item.decreaseQuantity(50);\n`;
        prompt += `\n`;
        prompt += `// Or use tryDecreaseQuantity to prevent going below 0\n`;
        prompt += `const success = await item.tryDecreaseQuantity(50);\n`;
        prompt += `if (!success) {\n`;
        prompt += `  throw new Error("Insufficient quantity");\n`;
        prompt += `}\n`;
      } else {
        prompt += `const customer = await stackServerApp.getCustomCustomer({ customCustomerId: "customer_123" });\n`;
        prompt += `const item = await customer.getItem("${itemsList[0][0]}");\n`;
        prompt += `// Consume 50 units\n`;
        prompt += `await item.decreaseQuantity(50);\n`;
        prompt += `\n`;
        prompt += `// Or use tryDecreaseQuantity to prevent going below 0\n`;
        prompt += `const success = await item.tryDecreaseQuantity(50);\n`;
        prompt += `if (!success) {\n`;
        prompt += `  throw new Error("Insufficient quantity");\n`;
        prompt += `}\n`;
      }
      prompt += `\`\`\`\n\n`;

      prompt += `### Item Properties\n\n`;
      prompt += `- \`quantity\`: The current quantity (can be negative)\n`;
      prompt += `- \`nonNegativeQuantity\`: Quantity clamped to minimum 0 (use for display)\n`;
      prompt += `- \`displayName\`: Human-readable name of the item\n`;
      prompt += `- \`increaseQuantity(amount)\`: Add to the quantity (server-side only)\n`;
      prompt += `- \`decreaseQuantity(amount)\`: Subtract from quantity, allows negative (server-side only)\n`;
      prompt += `- \`tryDecreaseQuantity(amount)\`: Subtract if sufficient, returns false if would go negative (server-side only)\n\n`;

      prompt += `### Important Notes\n\n`;
      prompt += `- Items are automatically granted when customers purchase this product based on the included items configuration.\n`;
      if (itemsList.some(([, item]) => item.repeat && item.repeat !== 'never')) {
        prompt += `- Some items repeat automatically based on their repeat interval configuration.\n`;
      }
      if (itemsList.some(([, item]) => item.expires && item.expires !== 'never')) {
        prompt += `- Some items expire based on their expiration rules (when purchase expires, when repeated, etc.).\n`;
      }
      prompt += `- Item quantity modifications are atomic and safe for concurrent use.\n`;
      prompt += `- Use \`tryDecreaseQuantity()\` for pre-paid credits to prevent overdrafts.\n`;
      prompt += `- Use \`nonNegativeQuantity\` when displaying quantities to users to avoid showing negative numbers.\n`;
    }

    return prompt;
  };

  const renderPrimaryPrices = (mode: 'editing' | 'view') => {
    const entries = Object.entries(pricesObject);
    if (entries.length === 0) {
      return null;
    }
    return (
      <div className={cn(
        "shrink-0",
        mode === 'view' ? "space-y-3 text-center" : "flex flex-col gap-3"
      )}>
        {entries.map(([pid, price], index) => (
          <Fragment key={pid}>
            <ProductPriceRow
              priceId={pid}
              price={price}
              isFree={editingPricesIsFreeMode}
              includeByDefault={draft.prices === 'include-by-default'}
              readOnly={mode !== 'editing'}
              startEditing={mode === 'editing'}
              existingPriceIds={entries.map(([k]) => k).filter(k => k !== pid)}
              onSave={(newId, newPrice) => {
                const finalId = newId || pid;
                setDraft(prev => {
                  if (newPrice === 'include-by-default') {
                    return { ...prev, prices: 'include-by-default' };
                  }
                  const prevPrices: PricesObject = getPricesObject(prev);
                  const nextPrices: PricesObject = { ...prevPrices };
                  if (newId && newId !== pid) {
                    if (Object.prototype.hasOwnProperty.call(nextPrices, newId)) {
                      toast({ title: "Price ID already exists" });
                      return prev; // Do not change state
                    }
                    delete nextPrices[pid];
                  }
                  nextPrices[finalId] = newPrice;
                  return { ...prev, prices: nextPrices };
                });
                if (editingPriceId && finalId === editingPriceId) {
                  setEditingPriceId(undefined);
                }
              }}
              onRemove={() => handleRemovePrice(pid)}
            />
            {((mode !== "view" && !editingPricesIsFreeMode) || index < entries.length - 1) && <OrSeparator />}
          </Fragment>
        ))}
      </div>
    );
  };

  const itemsList = Object.entries(draft.includedItems);

  const couldBeAddOnTo = allProducts.filter(o => o.product.catalogId === draft.catalogId && o.id !== id);
  const isAddOnTo = allProducts.filter(o => draft.isAddOnTo && o.id in draft.isAddOnTo);

  const PRODUCT_TOGGLE_OPTIONS = [{
    key: 'serverOnly' as const,
    label: 'Server only',
    shortLabel: 'Server only',
    description: "Restricts this product to only be purchased from server-side calls. Use this for backend-initiated purchases.",
    active: !!draft.serverOnly,
    visible: true,
    icon: <Server size={14} />,
    onToggle: () => setDraft(prev => ({ ...prev, serverOnly: !prev.serverOnly })),
    wrapButton: (button: ReactNode) => button,
  }, {
    key: 'stackable' as const,
    label: 'Stackable',
    shortLabel: 'Stackable',
    description: "Allows customers to purchase this product multiple times. Each purchase adds to their existing quantity.",
    active: !!draft.stackable,
    visible: true,
    icon: <Layers size={14} />,
    onToggle: () => setDraft(prev => ({ ...prev, stackable: !prev.stackable })),
    wrapButton: (button: ReactNode) => button,
  }, {
    key: 'addon' as const,
    label: 'Add-on',
    shortLabel: 'Add-on',
    description: "Makes this an optional extra that customers can purchase alongside a main product.",
    visible: draft.isAddOnTo !== false || couldBeAddOnTo.length > 0,
    active: draft.isAddOnTo !== false,
    icon: <Puzzle size={14} />,
    onToggle: isAddOnTo.length === 0 && draft.isAddOnTo !== false ? () => setDraft(prev => ({ ...prev, isAddOnTo: false })) : undefined,
    wrapButton: (button: ReactNode) => isAddOnTo.length === 0 && draft.isAddOnTo !== false ? button : (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          {button}
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          {couldBeAddOnTo.map(product => (
            <DropdownMenuCheckboxItem
              checked={isAddOnTo.some(o => o.id === product.id)}
              key={product.id}
              onCheckedChange={(checked) => setDraft(prev => {
                const newIsAddOnTo = { ...prev.isAddOnTo || {} };
                if (checked) {
                  newIsAddOnTo[product.id] = true;
                } else {
                  delete newIsAddOnTo[product.id];
                }
                return { ...prev, isAddOnTo: Object.keys(newIsAddOnTo).length > 0 ? newIsAddOnTo : false };
              })}
              className="cursor-pointer"
            >
              {product.product.displayName} ({product.id})
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    ),
  }] as const;

  const handleCancelEdit = () => {
    if (isDraft && onCancelDraft) {
      onCancelDraft();
      return;
    }
    setIsEditing(false);
    setDraft(product);
    setLocalProductId(id);
    setEditingPriceId(undefined);
  };

  const handleSaveEdit = async () => {
    const trimmed = localProductId.trim();
    const validId = trimmed && /^[a-z0-9-]+$/.test(trimmed) ? trimmed : id;
    try {
      if (validId !== id) {
        await onSave(validId, draft);
        await onDelete(id);
      } else {
        await onSave(id, draft);
      }
      setIsEditing(false);
      setEditingPriceId(undefined);
    } catch (e) {
      // Validation error - don't close edit mode
      if (e instanceof ValidationError) {
        return;
      }
      throw e;
    }
  };

  const renderToggleButtons = (mode: 'editing' | 'view') => {
    const getLabel = (b: typeof PRODUCT_TOGGLE_OPTIONS[number], editing: boolean) => {
      if (b.key === "addon" && isAddOnTo.length > 0) {
        return <span key={b.key}>
          Add-on to {isAddOnTo.map((o, i) => (
            <Fragment key={o.id}>
              {i > 0 && ", "}
              {editing ? o.product.displayName : (
                <Link className="underline hover:text-foreground transition-colors" href={`#product-${o.id}`}>
                  {o.product.displayName}
                </Link>
              )}
            </Fragment>
          ))}
        </span>;
      }
      return b.shortLabel;
    };
    return mode === 'editing' ? (
      PRODUCT_TOGGLE_OPTIONS
        .filter(b => b.visible !== false)
        .map((b) => {
          const wrap = b.wrapButton;
          return (
            <SimpleTooltip tooltip={b.description} key={b.key}>
              {wrap(
                <button
                  className={cn(
                    "flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors duration-150 hover:transition-none",
                    b.active
                      ? "border-primary/40 bg-primary/10 text-primary"
                      : "border-border bg-background/80 text-muted-foreground line-through"
                  )}
                  onClick={b.onToggle}
                >
                  {b.icon}
                  {getLabel(b, true)}
                </button>
              )}
            </SimpleTooltip>
          );
        })
    ) : (
      PRODUCT_TOGGLE_OPTIONS
        .filter(b => b.visible !== false)
        .filter(b => b.active)
        .map((b) => {
          return (
            <SimpleTooltip tooltip={b.description} key={b.key}>
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-help">
                {b.icon}
                {getLabel(b, false)}
              </span>
            </SimpleTooltip>
          );
        })
    );
  };

  const editingContent = (
    <div className={cn(
      "flex h-full flex-col rounded-2xl overflow-hidden",
      "bg-gray-200/80 dark:bg-[hsl(240,10%,5.5%)]",
      "border border-border/50 dark:border-foreground/[0.12]",
      "shadow-lg transition-colors duration-150",
      isHashTarget && "border-primary shadow-[0_0_0_1px_rgba(59,130,246,0.35)]"
    )}>
      {/* Header */}
      <div className="px-5 pt-5 pb-4 border-b border-border/20 dark:border-foreground/[0.06]">
        <h2 className="text-lg font-semibold tracking-tight text-center">
          {isDraft ? "New product" : "Edit product"}
        </h2>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        <div className="flex flex-col gap-5 p-5">
          {/* Name, ID & Type Fields */}
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="flex flex-col gap-1.5">
              <LabelWithInfo tooltip="The display name shown to customers on checkout pages and invoices">
                Offer Name
              </LabelWithInfo>
              <Input
                className="h-10 rounded-xl border border-border/60 dark:border-foreground/[0.1] bg-background dark:bg-[hsl(240,10%,8%)] px-3 text-sm"
                value={draft.displayName || ""}
                onChange={(event) => {
                  const value = event.target.value;
                  setDraft(prev => ({ ...prev, displayName: value }));
                }}
                placeholder="e.g., Pro Plan"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <LabelWithInfo tooltip="A unique identifier used in your code to reference this product. Use lowercase letters, numbers, and hyphens only.">
                Offer ID
              </LabelWithInfo>
              <SimpleTooltip tooltip={isDraft ? undefined : "Offer IDs cannot be changed after creation"}>
                <Input
                  className="h-10 rounded-xl border border-border/60 dark:border-foreground/[0.1] bg-background dark:bg-[hsl(240,10%,8%)] px-3 text-sm font-mono"
                  value={localProductId}
                  onChange={(event) => {
                    const value = event.target.value.toLowerCase().replace(/[^a-z0-9_\-]/g, '-');
                    setLocalProductId(value);
                  }}
                  placeholder="e.g., pro-plan"
                  disabled={!isDraft}
                />
              </SimpleTooltip>
            </div>
            <div className="flex flex-col gap-1.5">
              <LabelWithInfo tooltip="Who can purchase this product: individual users, teams, or custom customers managed via server-side code">
                Customer Type
              </LabelWithInfo>
              <Popover>
                <PopoverTrigger asChild>
                  <button className={cn(
                    "flex h-10 w-full items-center justify-between px-3 text-sm font-medium",
                    "rounded-xl border border-border/60 dark:border-foreground/[0.1]",
                    "bg-background dark:bg-[hsl(240,10%,8%)]",
                    "transition-colors duration-150 hover:transition-none hover:bg-foreground/[0.03]"
                  )}>
                    <span className={cn(
                      "inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wide ring-1",
                      CUSTOMER_TYPE_COLORS[draft.customerType]
                    )}>
                      {draft.customerType}
                    </span>
                    <ChevronsUpDown className="h-4 w-4 text-muted-foreground" />
                  </button>
                </PopoverTrigger>
                <PopoverContent align="start" className="w-64 p-0 overflow-hidden">
                  <div className="flex flex-col p-1">
                    {(['user', 'team', 'custom'] as const).map((type) => {
                      const isSelected = draft.customerType === type;
                      const descriptions = {
                        user: 'For individual users',
                        team: 'For teams or organizations',
                        custom: 'Server-side managed customers',
                      };
                      return (
                        <button
                          key={type}
                          className={cn(
                            "flex items-center gap-3 w-full px-3 py-2.5 rounded-lg text-left",
                            "transition-colors duration-150 hover:transition-none",
                            isSelected
                              ? "bg-foreground/[0.08] text-foreground"
                              : "hover:bg-foreground/[0.04] text-foreground"
                          )}
                          onClick={() => {
                            setDraft(prev => ({ ...prev, customerType: type, includedItems: {} }));
                          }}
                        >
                          <span className={cn(
                            "inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wide ring-1",
                            CUSTOMER_TYPE_COLORS[type]
                          )}>
                            {type}
                          </span>
                          <span className="text-xs text-muted-foreground">{descriptions[type]}</span>
                        </button>
                      );
                    })}
                  </div>
                </PopoverContent>
              </Popover>
            </div>
          </div>

          {/* Toggle Options */}
          <div className="flex flex-wrap gap-2">
            {renderToggleButtons('editing')}
          </div>

          {/* Prices Section */}
          <SectionHeading label="Prices" />
          <div className="flex flex-col gap-3">
            {renderPrimaryPrices('editing')}
            {!editingPricesIsFreeMode && (
              <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center">
                <Button
                  variant="outline"
                  className={cn(
                    "flex h-10 flex-1 items-center justify-center gap-2",
                    "rounded-xl border border-dashed border-foreground/[0.1]",
                    "bg-background/40 dark:bg-[hsl(240,10%,8%)]/50 hover:bg-foreground/[0.03]",
                    "text-sm font-medium text-muted-foreground hover:text-foreground",
                    "transition-all duration-150 hover:transition-none"
                  )}
                  onClick={() => {
                    const tempId = `price-${Date.now().toString(36).slice(2, 8)}`;
                    const newPrice: Price = { USD: '0.00', serverOnly: false };
                    setDraft(prev => {
                      const nextPrices: PricesObject = {
                        ...getPricesObject(prev),
                        [tempId]: newPrice,
                      };
                      return { ...prev, prices: nextPrices };
                    });
                    setEditingPriceId(tempId);
                  }}
                >
                  <Plus className="h-4 w-4" />
                  {hasExistingPrices ? "Add alternative price" : "Add price"}
                </Button>
                {!hasExistingPrices && (
                  <>
                    <span className="text-[10px] font-medium text-muted-foreground/60 uppercase tracking-wider text-center">or</span>
                    <Button
                      variant="outline"
                      className={cn(
                        "flex h-10 flex-1 items-center justify-center gap-2",
                        "rounded-xl border border-dashed border-foreground/[0.1]",
                        "bg-background/40 dark:bg-[hsl(240,10%,8%)]/50 hover:bg-foreground/[0.03]",
                        "text-sm font-medium text-muted-foreground hover:text-foreground",
                        "transition-all duration-150 hover:transition-none"
                      )}
                      onClick={() => {
                        setDraft(prev => ({ ...prev, prices: { free: { USD: '0.00', serverOnly: false } } }));
                        setEditingPricesIsFreeMode(true);
                      }}
                    >
                      <Gift className="h-4 w-4" />
                      Make free
                    </Button>
                  </>
                )}
              </div>
            )}
          </div>

          {/* Includes Section */}
          <SectionHeading label="Includes" />
          {itemsList.length === 0 ? (
            <div className={cn(
              "rounded-2xl border border-dashed border-foreground/[0.1]",
              "bg-background/40 dark:bg-[hsl(240,10%,8%)]/50",
              "py-8 text-center text-sm text-muted-foreground"
            )}>
              No items yet
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {itemsList.map(([itemId, item]) => {
                const itemMeta = existingItems.find(i => i.id === itemId);
                const itemLabel = itemMeta ? itemMeta.displayName : 'Select item';
                return (
                  <ProductItemRow
                    key={itemId}
                    activeType={customerType}
                    itemId={itemId}
                    item={item}
                    itemDisplayName={itemLabel}
                    allItems={existingItems}
                    existingIncludedItemIds={Object.keys(draft.includedItems).filter(id => id !== itemId)}
                    startEditing={true}
                    readOnly={false}
                    onSave={(id, updated) => handleAddOrEditIncludedItem(id, updated)}
                    onChangeItemId={(newItemId) => {
                      setDraft(prev => {
                        if (Object.prototype.hasOwnProperty.call(prev.includedItems, newItemId)) {
                          toast({ title: "Item already included" });
                          return prev;
                        }
                        const next: Product['includedItems'] = { ...prev.includedItems };
                        const value = next[itemId];
                        delete next[itemId];
                        next[newItemId] = value;
                        return { ...prev, includedItems: next };
                      });
                    }}
                    onRemove={() => handleRemoveIncludedItem(itemId)}
                    onCreateNewItem={onCreateNewItem}
                  />
                );
              })}
            </div>
          )}
          <Button
            variant="outline"
            className={cn(
              "flex h-10 w-full items-center justify-center gap-2",
              "rounded-xl border border-dashed border-foreground/[0.1]",
              "bg-background/40 dark:bg-[hsl(240,10%,8%)]/50 hover:bg-foreground/[0.03]",
              "text-sm font-medium text-muted-foreground hover:text-foreground",
              "transition-all duration-150 hover:transition-none"
            )}
            onClick={() => {
              const available = existingItems.find(i => !Object.prototype.hasOwnProperty.call(draft.includedItems, i.id));
              const newItemId = available?.id || `__new_item__${Date.now().toString(36).slice(2, 8)}`;
              const newItem: Product['includedItems'][string] = { quantity: 1, repeat: 'never', expires: 'never' };
              setDraft(prev => ({
                ...prev,
                includedItems: {
                  ...prev.includedItems,
                  [newItemId]: newItem,
                }
              }));
            }}
          >
            <Plus className="h-4 w-4" />
            Add Item
          </Button>
        </div>
      </div>

      {/* Footer */}
      <div className="px-5 py-4 border-t border-border/20 dark:border-foreground/[0.06] flex items-center justify-between gap-3">
        <button
          className="flex h-9 w-9 items-center justify-center rounded-lg text-destructive transition-colors duration-150 hover:transition-none hover:bg-destructive/10"
          onClick={() => {
            if (isDraft && onCancelDraft) {
              onCancelDraft();
            } else {
              setShowDeleteDialog(true);
            }
          }}
          aria-label="Delete offer"
        >
          <Trash2 className="h-4 w-4" />
        </button>
        <div className="ml-auto flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            className="rounded-lg px-4 text-muted-foreground hover:text-foreground"
            onClick={handleCancelEdit}
          >
            Cancel
          </Button>
          <SimpleTooltip tooltip={saveDisabledReason} disabled={canSaveProduct}>
            <Button
              size="sm"
              className="h-9 rounded-lg px-5 bg-foreground text-background hover:bg-foreground/90"
              disabled={!canSaveProduct}
              onClick={async () => { await handleSaveEdit(); }}
            >
              Save
            </Button>
          </SimpleTooltip>
        </div>
      </div>
    </div>
  );

  const viewingContent = (
    <div className={cn(
      "group relative flex flex-col h-full",
      // Card mode (standalone)
      !isColumnInTable && [
        "rounded-2xl overflow-hidden",
        "bg-gray-200/80 dark:bg-[hsl(240,10%,5.5%)]",
        "border border-border/50 dark:border-foreground/[0.12]",
        "shadow-sm hover:shadow-md transition-all duration-150 hover:transition-none",
      ],
      // Table column mode
      isColumnInTable && [
        !isFirstColumn && "border-l border-border/30 dark:border-foreground/[0.08]",
      ],
      isHashTarget && "border-primary shadow-[0_0_0_1px_rgba(59,130,246,0.35)]"
    )}>
      {/* Main content wrapper */}
      <div className="flex-1 flex flex-col">
        {/* Header section */}
        <div className="relative px-5 pt-5 pb-3">
          {/* Customer type badge and Product ID */}
          <div className="flex items-center justify-center gap-2 mb-2">
            <span className={cn(
              "inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wide ring-1",
              CUSTOMER_TYPE_COLORS[customerType]
            )}>
              {customerType}
            </span>
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-mono text-muted-foreground bg-foreground/[0.04] ring-1 ring-foreground/[0.06]">
              ID: {localProductId}
            </span>
          </div>
          {/* Product name */}
          <h3 className="text-lg font-semibold text-center tracking-tight flex items-center justify-center gap-1.5">
            {draft.isAddOnTo !== false && <Puzzle className="h-4 w-4 text-muted-foreground shrink-0" />}
            {draft.displayName || "Untitled Product"}
          </h3>

          {/* Action menu - appears on hover */}
          <div className="absolute right-3 top-3 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-hover:transition-none">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-foreground/[0.05] transition-colors duration-150 hover:transition-none" aria-label="Options">
                  <MoreVertical className="h-4 w-4" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem icon={<Pencil className="h-4 w-4" />} onClick={() => { setIsEditing(true); setDraft(product); }}>
                  Edit
                </DropdownMenuItem>
                <DropdownMenuItem icon={<Copy className="h-4 w-4" />} onClick={() => { onDuplicate(product); }}>
                  Duplicate
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  icon={<Trash2 className="h-4 w-4" />}
                  className="text-destructive focus:text-destructive"
                  onClick={() => { setShowDeleteDialog(true); }}
                >
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {/* Toggle badges */}
        {PRODUCT_TOGGLE_OPTIONS.some(b => b.visible !== false && b.active) && (
          <div className="flex flex-col items-center gap-1.5 px-4 pb-3">
            {renderToggleButtons('view')}
          </div>
        )}

        {/* Pricing section - grows if no items */}
        <div className={cn(
          "border-t border-border/20 dark:border-foreground/[0.06] px-5 py-4 dark:bg-[hsl(240,10%,6%)]",
          itemsList.length === 0 && "flex-1"
        )}>
          {renderPrimaryPrices('view')}
        </div>

        {/* Items section - grows to fill available space */}
        {itemsList.length > 0 && (
          <div className="flex-1 border-t border-border/20 dark:border-foreground/[0.06] px-5 py-3">
            <div className="space-y-1">
              {itemsList.map(([itemId, item]) => {
                const itemMeta = existingItems.find(i => i.id === itemId);
                const itemLabel = itemMeta ? itemMeta.displayName : itemId;
                return (
                  <div key={itemId} className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">{itemLabel}</span>
                    <span className="text-foreground tabular-nums">
                      {prettyPrintWithMagnitudes(item.quantity)}
                      <span className="text-muted-foreground text-xs ml-1">{shortIntervalLabel(item.repeat)}</span>
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Quick actions footer - stays at bottom */}
      {customerType !== "custom" && (
        <div className="border-t border-border/20 dark:border-foreground/[0.06] px-4 py-3 flex items-center justify-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className={cn(
              "h-8 px-3 text-xs gap-1.5 rounded-lg",
              "bg-background/60 dark:bg-foreground/[0.03]",
              "border-border/60 dark:border-foreground/[0.1]",
              "text-muted-foreground hover:text-foreground",
              "hover:bg-background dark:hover:bg-foreground/[0.06]",
              "transition-colors duration-150 hover:transition-none"
            )}
            onClick={() => {
              navigator.clipboard.writeText(`const url = await ${customerType}.createCheckoutUrl({ productId: "${id}" });\nwindow.open(url, "_blank");`);
              toast({ title: "Copied to clipboard" });
            }}
          >
            <Code className="h-3.5 w-3.5" />
            Copy code
          </Button>
          <Button
            variant="outline"
            size="sm"
            className={cn(
              "h-8 px-3 text-xs gap-1.5 rounded-lg",
              "bg-background/60 dark:bg-foreground/[0.03]",
              "border-border/60 dark:border-foreground/[0.1]",
              "text-muted-foreground hover:text-foreground",
              "hover:bg-background dark:hover:bg-foreground/[0.06]",
              "transition-colors duration-150 hover:transition-none"
            )}
            onClick={() => {
              const prompt = generateComprehensivePrompt();
              navigator.clipboard.writeText(prompt);
              toast({ title: "Prompt copied to clipboard" });
            }}
          >
            <FileText className="h-3.5 w-3.5" />
            Copy prompt
          </Button>
        </div>
      )}
    </div>
  );

  return (
    <div
      ref={cardRef}
      id={`product-${id}`}
      className={cn(
        "shrink-0 transition-all h-full",
        isColumnInTable
          ? (isEditing ? "w-[420px]" : "w-[260px]")
          : (isEditing ? "w-[420px]" : "w-[320px]")
      )}
    >
      {isEditing ? editingContent : viewingContent}

      <ActionDialog
        open={showDeleteDialog}
        onOpenChange={setShowDeleteDialog}
        title="Delete product"
        danger
        okButton={{
          label: "Delete",
          onClick: async () => {
            await onDelete(id);
            setIsEditing(false);
          }
        }}
        cancelButton
      >
        Are you sure you want to delete this product?
      </ActionDialog>
    </div >
  );
}

type CatalogViewProps = {
  groupedProducts: Map<string | undefined, Array<{ id: string, product: Product }>>,
  groups: Record<string, { displayName?: string }>,
  existingItems: Array<{ id: string, displayName: string, customerType: string }>,
  onSaveProduct: (id: string, product: Product) => Promise<void>,
  onDeleteProduct: (id: string) => Promise<void>,
  onCreateNewItem: (customerType?: 'user' | 'team' | 'custom', onCreated?: (itemId: string) => void) => void,
  onOpenProductDetails: (product: Product) => void,
  onSaveProductWithGroup: (catalogId: string, productId: string, product: Product) => Promise<void>,
  onCreateCatalog: (catalogId: string) => Promise<void>,
  createDraftRequestId?: string,
  draftCustomerType: 'user' | 'team' | 'custom',
  onDraftHandled?: () => void,
};

// Combined key for catalog + customer type grouping
type CatalogTypeKey = {
  catalogId: string | undefined,
  customerType: 'user' | 'team' | 'custom',
};

function catalogTypeKeyToString(key: CatalogTypeKey): string {
  return `${key.catalogId ?? '__none__'}::${key.customerType}`;
}

function CatalogView({ groupedProducts, groups, existingItems, onSaveProduct, onDeleteProduct, onCreateNewItem, onOpenProductDetails, onSaveProductWithGroup, onCreateCatalog, createDraftRequestId, draftCustomerType, onDraftHandled }: CatalogViewProps) {
  const [drafts, setDrafts] = useState<Array<{ key: string, catalogId: string | undefined, product: Product }>>([]);
  const [creatingGroupKey, setCreatingGroupKey] = useState<string | undefined>(undefined);
  const [newCatalogId, setNewCatalogId] = useState("");
  const [newCatalogCustomerType, setNewCatalogCustomerType] = useState<'user' | 'team' | 'custom'>('user');
  const newGroupInputRef = useRef<HTMLInputElement | null>(null);

  // Regroup products by both catalogId AND customerType
  const groupedByCatalogAndType = useMemo(() => {
    const result = new Map<string, { key: CatalogTypeKey, products: Array<{ id: string, product: Product }> }>();

    groupedProducts.forEach((products, _catalogId) => {
      products.forEach(({ id, product }) => {
        const key: CatalogTypeKey = { catalogId: product.catalogId, customerType: product.customerType };
        const keyStr = catalogTypeKeyToString(key);

        if (!result.has(keyStr)) {
          result.set(keyStr, { key, products: [] });
        }
        result.get(keyStr)!.products.push({ id, product });
      });
    });

    return result;
  }, [groupedProducts]);

  useEffect(() => {
    if (creatingGroupKey && newGroupInputRef.current) {
      newGroupInputRef.current.focus();
      newGroupInputRef.current.select();
    }
  }, [creatingGroupKey]);


  const usedIds = useMemo(() => {
    const all: string[] = [];
    groupedProducts.forEach(arr => arr.forEach(({ id }) => all.push(id)));
    drafts.forEach(d => all.push(d.key));
    return new Set(all);
  }, [groupedProducts, drafts]);
  const lastHandledDraftRequestRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (!createDraftRequestId) return;
    if (lastHandledDraftRequestRef.current === createDraftRequestId) return;

    lastHandledDraftRequestRef.current = createDraftRequestId;

    let candidate = "product";
    let counter = 2;
    while (usedIds.has(candidate)) {
      candidate = `product-${counter++}`;
    }

    const newProduct: Product = {
      displayName: 'New Product',
      customerType: draftCustomerType,
      catalogId: undefined,
      isAddOnTo: false,
      stackable: false,
      prices: {},
      includedItems: {},
      serverOnly: false,
      freeTrial: undefined,
    };

    setDrafts((prev) => [...prev, { key: candidate, catalogId: undefined, product: newProduct }]);
    onDraftHandled?.();
  }, [createDraftRequestId, draftCustomerType, onDraftHandled, usedIds]);

  const generateProductId = (base: string) => {
    let id = base;
    let i = 2;
    while (usedIds.has(id)) id = `${base}-${i++}`;
    return id;
  };

  // Build list of catalog+type combinations to render (only for named catalogs)
  const catalogTypeKeysToRender = useMemo(() => {
    const keys: CatalogTypeKey[] = [];
    const seenKeyStrings = new Set<string>();

    // Add keys from existing products (only named catalogs, not "No catalog")
    groupedByCatalogAndType.forEach(({ key }) => {
      if (key.catalogId === undefined) return; // Skip "No catalog" - handled separately
      const keyStr = catalogTypeKeyToString(key);
      if (!seenKeyStrings.has(keyStr)) {
        seenKeyStrings.add(keyStr);
        keys.push(key);
      }
    });

    // Add keys from drafts (only named catalogs)
    drafts.forEach(d => {
      if (d.catalogId === undefined) return; // Skip "No catalog" - handled separately
      const key: CatalogTypeKey = { catalogId: d.catalogId, customerType: d.product.customerType };
      const keyStr = catalogTypeKeyToString(key);
      if (!seenKeyStrings.has(keyStr)) {
        seenKeyStrings.add(keyStr);
        keys.push(key);
      }
    });

    // Sort: by customer type priority, then by catalog name
    const customerTypePriority = { user: 1, team: 2, custom: 3 };
    keys.sort((a, b) => {
      const priorityA = customerTypePriority[a.customerType];
      const priorityB = customerTypePriority[b.customerType];
      if (priorityA !== priorityB) return priorityA - priorityB;

      // Sort by catalog name
      const nameA = a.catalogId ? (groups[a.catalogId].displayName || a.catalogId) : '';
      const nameB = b.catalogId ? (groups[b.catalogId].displayName || b.catalogId) : '';
      return stringCompare(nameA, nameB);
    });

    return keys;
  }, [groupedByCatalogAndType, drafts, groups]);

  // Get all "No catalog" products (all customer types combined)
  const noCatalogProducts = useMemo(() => {
    const products: Array<{ id: string, product: Product }> = [];
    groupedByCatalogAndType.forEach(({ key, products: prods }) => {
      if (key.catalogId === undefined) {
        products.push(...prods);
      }
    });
    // Sort by customer type, then by ID
    const customerTypePriority = { user: 1, team: 2, custom: 3 };
    products.sort((a, b) => {
      const priorityA = customerTypePriority[a.product.customerType];
      const priorityB = customerTypePriority[b.product.customerType];
      if (priorityA !== priorityB) return priorityA - priorityB;
      return stringCompare(a.id, b.id);
    });
    return products;
  }, [groupedByCatalogAndType]);

  // Get drafts for "No catalog"
  const noCatalogDrafts = useMemo(() => {
    return drafts.filter(d => d.catalogId === undefined);
  }, [drafts]);

  return (
    <div className="space-y-8">
      {catalogTypeKeysToRender.map((catalogTypeKey) => {
        const keyStr = catalogTypeKeyToString(catalogTypeKey);
        const groupData = groupedByCatalogAndType.get(keyStr);
        const products = groupData?.products || [];
        const catalogId = catalogTypeKey.catalogId;
        const customerType = catalogTypeKey.customerType;
        const groupName = catalogId ? (groups[catalogId].displayName || catalogId) : 'No catalog';

        // Filter drafts for this catalog+type combination
        const matchingDrafts = drafts.filter(d =>
          d.catalogId === catalogId && d.product.customerType === customerType
        );

        // Separate non-add-on and add-on products for pricing table layout
        const nonAddOnProducts = products.filter(({ product }) => product.isAddOnTo === false);
        const addOnProducts = products.filter(({ product }) => product.isAddOnTo !== false);
        const nonAddOnDrafts = matchingDrafts.filter(d => d.product.isAddOnTo === false);
        const addOnDrafts = matchingDrafts.filter(d => d.product.isAddOnTo !== false);

        const hasNonAddOns = nonAddOnProducts.length > 0 || nonAddOnDrafts.length > 0;

        return (
          <div key={keyStr}>
            <div className="mb-3">
              <div className="flex items-center gap-2">
                <h3 className="text-base font-semibold text-foreground">{groupName}</h3>
                <span className={cn(
                  "inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wide ring-1",
                  CUSTOMER_TYPE_COLORS[customerType]
                )}>
                  {customerType}
                </span>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {catalogId
                  ? "Products in this catalog are mutually exclusive (except add-ons)"
                  : "Products that are not in a catalog are not mutually exclusive"}
              </p>
            </div>
            <div className="relative rounded-2xl bg-foreground/[0.04] ring-1 ring-foreground/[0.06]">
              <div className="flex gap-4 justify-start overflow-x-auto p-5 min-h-20 pr-16">
                <div className="flex max-w-max gap-4 items-stretch">
                  {/* Non-add-on products as a pricing table (single card, multiple columns) */}
                  {/* Only saved products go in the table - drafts are rendered separately since they're in edit mode */}
                  {nonAddOnProducts.length > 0 && (
                    <div className={cn(
                      "flex rounded-2xl overflow-hidden",
                      "bg-gray-200/80 dark:bg-[hsl(240,10%,5.5%)]",
                      "border border-border/50 dark:border-foreground/[0.12]",
                      "shadow-sm"
                    )}>
                      {nonAddOnProducts.map(({ id, product }, index) => (
                        <ProductCard
                          key={id}
                          id={id}
                          product={product}
                          allProducts={products}
                          existingItems={existingItems}
                          onSave={onSaveProduct}
                          onDelete={onDeleteProduct}
                          onDuplicate={(srcProduct) => {
                            const key = generateProductId("product");
                            const duplicated: Product = {
                              ...srcProduct,
                              displayName: `${srcProduct.displayName || id} Copy`,
                            };
                            setDrafts(prev => [...prev, { key, catalogId, product: duplicated }]);
                          }}
                          onCreateNewItem={onCreateNewItem}
                          onOpenDetails={(o) => onOpenProductDetails(o)}
                          isColumnInTable
                          isFirstColumn={index === 0}
                          isLastColumn={index === nonAddOnProducts.length - 1}
                        />
                      ))}
                    </div>
                  )}

                  {/* Non-add-on drafts as separate cards (since they're always in edit mode) */}
                  {nonAddOnDrafts.map((d) => (
                    <ProductCard
                      key={d.key}
                      id={d.key}
                      product={d.product}
                      allProducts={products}
                      existingItems={existingItems}
                      isDraft
                      onSave={async (specifiedId, product) => {
                        const newId = specifiedId && specifiedId.trim() && /^[a-z0-9-]+$/.test(specifiedId.trim()) && !usedIds.has(specifiedId.trim())
                          ? specifiedId.trim()
                          : generateProductId('product');
                        await onSaveProduct(newId, product);
                        setDrafts(prev => prev.filter(x => x.key !== d.key));
                      }}
                      onDelete={async () => {
                        setDrafts(prev => prev.filter(x => x.key !== d.key));
                      }}
                      onDuplicate={() => {
                        const cloneKey = `${d.key}-copy`;
                        setDrafts(prev => ([...prev, { key: cloneKey, catalogId: d.catalogId, product: { ...d.product, displayName: `${d.product.displayName} Copy` } }]));
                      }}
                      onCreateNewItem={onCreateNewItem}
                      onOpenDetails={(o) => onOpenProductDetails(o)}
                      onCancelDraft={() => {
                        setDrafts(prev => prev.filter(x => x.key !== d.key));
                      }}
                    />
                  ))}

                  {/* Add-on products as separate cards */}
                  {addOnProducts.map(({ id, product }) => (
                    <ProductCard
                      key={id}
                      id={id}
                      product={product}
                      allProducts={products}
                      existingItems={existingItems}
                      onSave={onSaveProduct}
                      onDelete={onDeleteProduct}
                      onDuplicate={(srcProduct) => {
                        const key = generateProductId("product");
                        const duplicated: Product = {
                          ...srcProduct,
                          displayName: `${srcProduct.displayName || id} Copy`,
                        };
                        setDrafts(prev => [...prev, { key, catalogId, product: duplicated }]);
                      }}
                      onCreateNewItem={onCreateNewItem}
                      onOpenDetails={(o) => onOpenProductDetails(o)}
                    />
                  ))}
                  {addOnDrafts.map((d) => (
                    <ProductCard
                      key={d.key}
                      id={d.key}
                      product={d.product}
                      allProducts={products}
                      existingItems={existingItems}
                      isDraft
                      onSave={async (specifiedId, product) => {
                        const newId = specifiedId && specifiedId.trim() && /^[a-z0-9-]+$/.test(specifiedId.trim()) && !usedIds.has(specifiedId.trim())
                          ? specifiedId.trim()
                          : generateProductId('product');
                        await onSaveProduct(newId, product);
                        setDrafts(prev => prev.filter(x => x.key !== d.key));
                      }}
                      onDelete={async () => {
                        setDrafts(prev => prev.filter(x => x.key !== d.key));
                      }}
                      onDuplicate={() => {
                        const cloneKey = `${d.key}-copy`;
                        setDrafts(prev => ([...prev, { key: cloneKey, catalogId: d.catalogId, product: { ...d.product, displayName: `${d.product.displayName} Copy` } }]));
                      }}
                      onCreateNewItem={onCreateNewItem}
                      onOpenDetails={(o) => onOpenProductDetails(o)}
                      onCancelDraft={() => {
                        setDrafts(prev => prev.filter(x => x.key !== d.key));
                      }}
                    />
                  ))}

                  {/* Add product button */}
                  <Button
                    variant="outline"
                    size="plain"
                    className={cn(
                      "h-full min-h-[200px] w-[320px] flex flex-col items-center justify-center",
                      "rounded-2xl border border-dashed border-foreground/[0.1]",
                      "bg-background/40 hover:bg-foreground/[0.03]",
                      "text-muted-foreground hover:text-foreground",
                      "transition-all duration-150 hover:transition-none"
                    )}
                    onClick={() => {
                      const key = generateProductId("product");
                      const newProduct: Product = {
                        displayName: 'New Product',
                        customerType: customerType,
                        catalogId: catalogId || undefined,
                        isAddOnTo: false,
                        stackable: false,
                        prices: {},
                        includedItems: {},
                        serverOnly: false,
                        freeTrial: undefined,
                      };
                      setDrafts(prev => [...prev, { key, catalogId, product: newProduct }]);
                    }}
                  >
                    <div className="flex flex-col items-center gap-2">
                      <Plus className="h-6 w-6" />
                      <span className="text-sm font-medium">Add product</span>
                    </div>
                  </Button>
                </div>
              </div>
            </div>
          </div>
        );
      })}

      {/* No catalog section - shows all products without a catalog, regardless of customer type */}
      <div>
        <div className="mb-3">
          <h3 className="text-base font-semibold text-foreground">No catalog</h3>
          <p className="text-xs text-muted-foreground mt-1">
            Products that are not in a catalog are not mutually exclusive
          </p>
        </div>
        <div className="relative rounded-2xl bg-foreground/[0.04] ring-1 ring-foreground/[0.06]">
          <div className="flex gap-4 justify-start overflow-x-auto p-5 min-h-20 pr-16">
            <div className="flex max-w-max gap-4 items-stretch">
              {noCatalogProducts.map(({ id, product }) => (
                <ProductCard
                  key={id}
                  id={id}
                  product={product}
                  allProducts={noCatalogProducts}
                  existingItems={existingItems}
                  onSave={onSaveProduct}
                  onDelete={onDeleteProduct}
                  onDuplicate={(srcProduct) => {
                    const key = generateProductId("product");
                    const duplicated: Product = {
                      ...srcProduct,
                      displayName: `${srcProduct.displayName || id} Copy`,
                    };
                    setDrafts(prev => [...prev, { key, catalogId: undefined, product: duplicated }]);
                  }}
                  onCreateNewItem={onCreateNewItem}
                  onOpenDetails={(o) => onOpenProductDetails(o)}
                />
              ))}
              {noCatalogDrafts.map((d) => (
                <ProductCard
                  key={d.key}
                  id={d.key}
                  product={d.product}
                  allProducts={noCatalogProducts}
                  existingItems={existingItems}
                  isDraft
                  onSave={async (specifiedId, product) => {
                    const newId = specifiedId && specifiedId.trim() && /^[a-z0-9-]+$/.test(specifiedId.trim()) && !usedIds.has(specifiedId.trim())
                      ? specifiedId.trim()
                      : generateProductId('product');
                    await onSaveProduct(newId, product);
                    setDrafts(prev => prev.filter(x => x.key !== d.key));
                  }}
                  onDelete={async () => {
                    setDrafts(prev => prev.filter(x => x.key !== d.key));
                  }}
                  onDuplicate={() => {
                    const cloneKey = `${d.key}-copy`;
                    setDrafts(prev => ([...prev, { key: cloneKey, catalogId: undefined, product: { ...d.product, displayName: `${d.product.displayName} Copy` } }]));
                  }}
                  onCreateNewItem={onCreateNewItem}
                  onOpenDetails={(o) => onOpenProductDetails(o)}
                  onCancelDraft={() => {
                    setDrafts(prev => prev.filter(x => x.key !== d.key));
                  }}
                />
              ))}
              <Button
                variant="outline"
                size="plain"
                className={cn(
                  "h-full min-h-[200px] w-[320px] flex flex-col items-center justify-center",
                  "rounded-2xl border border-dashed border-foreground/[0.1]",
                  "bg-background/40 hover:bg-foreground/[0.03]",
                  "text-muted-foreground hover:text-foreground",
                  "transition-all duration-150 hover:transition-none"
                )}
                onClick={() => {
                  const key = generateProductId("product");
                  const newProduct: Product = {
                    displayName: 'New Product',
                    customerType: 'user',
                    catalogId: undefined,
                    isAddOnTo: false,
                    stackable: false,
                    prices: {},
                    includedItems: {},
                    serverOnly: false,
                    freeTrial: undefined,
                  };
                  setDrafts(prev => [...prev, { key, catalogId: undefined, product: newProduct }]);
                }}
              >
                <div className="flex flex-col items-center gap-2">
                  <Plus className="h-6 w-6" />
                  <span className="text-sm font-medium">Add product</span>
                </div>
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* New catalog button with customer type selector */}
      <Popover>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            size="plain"
            className={cn(
              "w-full h-32 flex items-center justify-center",
              "rounded-2xl border border-dashed border-foreground/[0.1]",
              "bg-background/40 hover:bg-foreground/[0.03]",
              "text-muted-foreground hover:text-foreground",
              "transition-all duration-150 hover:transition-none"
            )}
          >
            <div className="flex flex-col items-center gap-2">
              <Plus className="h-6 w-6" />
              <span className="text-sm font-medium">New catalog</span>
            </div>
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-80 p-4">
          <div className="space-y-4">
            <div>
              <p className="text-xs text-muted-foreground mb-3">
                A catalog groups products that are mutually exclusive — besides add-ons, customers can only have one active product from each catalog at a time.
              </p>
            </div>
            <div>
              <Label className="text-xs font-medium text-muted-foreground mb-1.5 block">Catalog ID</Label>
              <Input
                ref={newGroupInputRef}
                value={newCatalogId}
                onChange={(e) => {
                  const value = e.target.value.toLowerCase().replace(/[^a-z0-9_\-]/g, '-');
                  setNewCatalogId(value);
                }}
                placeholder="e.g., pricing-plans"
                className="h-9"
              />
            </div>
            <div>
              <Label className="text-xs font-medium text-muted-foreground mb-1.5 block">Customer Type</Label>
              <div className="flex gap-1.5">
                {(['user', 'team', 'custom'] as const).map((type) => (
                  <button
                    key={type}
                    onClick={() => setNewCatalogCustomerType(type)}
                    className={cn(
                      "flex-1 px-2 py-1.5 rounded-lg text-xs font-medium capitalize",
                      "transition-colors duration-150 hover:transition-none",
                      newCatalogCustomerType === type
                        ? cn("ring-1", CUSTOMER_TYPE_COLORS[type])
                        : "bg-foreground/[0.04] text-muted-foreground hover:bg-foreground/[0.08]"
                    )}
                  >
                    {type}
                  </button>
                ))}
              </div>
            </div>
            <Button
              size="sm"
              className="w-full"
              disabled={!newCatalogId.trim()}
              onClick={async () => {
                const id = newCatalogId.trim();
                if (!id) return;
                if (!/^[a-z0-9-]+$/.test(id)) {
                  toast({ title: "Catalog ID must be lowercase letters, numbers, and hyphens", variant: "destructive" });
                  return;
                }
                if (Object.prototype.hasOwnProperty.call(groups, id)) {
                  toast({ title: "Catalog ID already exists", variant: "destructive" });
                  return;
                }

                // Create the catalog (no product yet)
                await onCreateCatalog(id);

                // Add a local draft so the "add product" form shows immediately
                const draftKey = generateProductId("product");
                const newProduct: Product = {
                  displayName: 'New Product',
                  customerType: newCatalogCustomerType,
                  catalogId: id,
                  isAddOnTo: false,
                  stackable: false,
                  prices: {},
                  includedItems: {},
                  serverOnly: false,
                  freeTrial: undefined,
                };
                setDrafts(prev => [...prev, { key: draftKey, catalogId: id, product: newProduct }]);
                setNewCatalogId("");
                toast({ title: "Catalog created" });
              }}
            >
              Create Catalog
            </Button>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}

type CatalogViewPageProps = {
  createDraftRequestId?: string,
  draftCustomerType?: 'user' | 'team' | 'custom',
  onDraftHandled?: () => void,
};

export default function PageClient({ createDraftRequestId, draftCustomerType = 'user', onDraftHandled }: CatalogViewPageProps) {
  const [showProductDialog, setShowProductDialog] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [showItemDialog, setShowItemDialog] = useState(false);
  const [editingItem, setEditingItem] = useState<{ id: string, displayName: string, customerType: 'user' | 'team' | 'custom' } | null>(null);
  const [newItemCustomerType, setNewItemCustomerType] = useState<'user' | 'team' | 'custom' | undefined>(undefined);
  const [refreshKey, setRefreshKey] = useState(0);
  const stackAdminApp = useAdminApp();
  const project = stackAdminApp.useProject();
  const config = project.useConfig();
  const paymentsConfig: CompleteConfig['payments'] = config.payments;

  // Use product IDs as a key to ensure re-render when products change
  // Filter out null/undefined products to ensure the dependency changes when products are deleted
  const productIds = Object.entries(paymentsConfig.products)
    .filter(([, product]) => product != null)
    .map(([id]) => id)
    .sort()
    .join(',');

  // Create a stable serialized representation of products to detect changes
  // This ensures React detects when products are deleted even if the object reference doesn't change
  const productsKey = useMemo(() => {
    return JSON.stringify(
      Object.entries(paymentsConfig.products)
        .filter(([, product]) => product != null)
        .map(([id]) => id)
        .sort()
    );
  }, [paymentsConfig.products]);

  // Watch for changes in products and force re-render if needed
  useEffect(() => {
    // This effect will run whenever paymentsConfig.products changes
    // The productsKey dependency in useMemo above should handle most cases,
    // but this ensures we catch any edge cases
  }, [productsKey]);

  // Group products by catalogId and sort by customer type priority
  const groupedProducts = useMemo(() => {
    const groups = new Map<string | undefined, Array<{ id: string, product: Product }>>();

    // Group products (filter out null/undefined products that may occur during deletion)
    for (const [id, product] of typedEntries(paymentsConfig.products)) {
      if (!product) continue; // Skip deleted/null products
      const catalogId = product.catalogId;
      if (!groups.has(catalogId)) {
        groups.set(catalogId, []);
      }
      groups.get(catalogId)!.push({ id, product });
    }

    // Sort products within each group by customer type, then by ID
    const customerTypePriority = { user: 1, team: 2, custom: 3 };
    groups.forEach((products) => {
      products.sort((a, b) => {
        const priorityA = customerTypePriority[a.product.customerType as keyof typeof customerTypePriority] || 4;
        const priorityB = customerTypePriority[b.product.customerType as keyof typeof customerTypePriority] || 4;
        if (priorityA !== priorityB) {
          return priorityA - priorityB;
        }
        // If same customer type, sort addons last
        if (a.product.isAddOnTo !== b.product.isAddOnTo) {
          return a.product.isAddOnTo ? 1 : -1;
        }
        // If same customer type and addons, sort by lowest price
        const getPricePriority = (product: Product) => {
          if (product.prices === 'include-by-default') return 0;
          if (typeof product.prices !== 'object') return 0;
          return Math.min(...Object.values(product.prices).map(price => +(price.USD ?? Infinity)));
        };
        const priceA = getPricePriority(a.product);
        const priceB = getPricePriority(b.product);
        if (priceA !== priceB) {
          return priceA - priceB;
        }
        // Otherwise, sort by ID
        return stringCompare(a.id, b.id);
      });
    });

    // Sort groups by their predominant customer type
    const sortedGroups = new Map<string | undefined, Array<{ id: string, product: Product }>>();

    // Helper to get group priority
    const getGroupPriority = (catalogId: string | undefined) => {
      if (!catalogId) return 999; // Ungrouped always last

      const products = groups.get(catalogId) || [];
      if (products.length === 0) return 999;

      // Get the most common customer type in the group
      const typeCounts = products.reduce((acc, { product }) => {
        const type = product.customerType;
        acc[type] = (acc[type] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);

      // Find predominant type
      const predominantType = Object.entries(typeCounts)
        .sort(([, a], [, b]) => b - a)[0]?.[0];

      return customerTypePriority[predominantType as keyof typeof customerTypePriority] || 4;
    };

    // Sort group entries
    const sortedEntries = Array.from(groups.entries()).sort(([aId], [bId]) => {
      const priorityA = getGroupPriority(aId);
      const priorityB = getGroupPriority(bId);
      return priorityA - priorityB;
    });

    // Rebuild map in sorted order
    sortedEntries.forEach(([catalogId, products]) => {
      sortedGroups.set(catalogId, products);
    });

    return sortedGroups;
  }, [productsKey, paymentsConfig.products]);

  // Callback to be called when a new item is created (for auto-selection)
  const [onItemCreatedCallback, setOnItemCreatedCallback] = useState<((itemId: string) => void) | undefined>(undefined);

  // Handler for create item button
  const handleCreateItem = (customerType?: 'user' | 'team' | 'custom', onCreated?: (itemId: string) => void) => {
    setNewItemCustomerType(customerType);
    setOnItemCreatedCallback(() => onCreated);
    setShowItemDialog(true);
  };

  // Handler for saving product
  const handleSaveProduct = async (productId: string, product: Product) => {
    await project.updateConfig({ [`payments.products.${productId}`]: product });
    setShowProductDialog(false);
    toast({ title: editingProduct ? "Product updated" : "Product created" });
  };

  // Handler for saving item
  const handleSaveItem = async (item: { id: string, displayName: string, customerType: 'user' | 'team' | 'custom' }) => {
    await project.updateConfig({ [`payments.items.${item.id}`]: { displayName: item.displayName, customerType: item.customerType } });
    setShowItemDialog(false);
    setEditingItem(null);
    toast({ title: editingItem ? "Item updated" : "Item created" });
    // Call the callback to auto-select the newly created item
    if (onItemCreatedCallback && !editingItem) {
      onItemCreatedCallback(item.id);
      setOnItemCreatedCallback(undefined);
    }
  };

  // Prepare data for product dialog - update when items change
  const existingProductsList = typedEntries(paymentsConfig.products)
    .filter(([, product]) => product != null)
    .map(([id, product]) => ({
      id,
      displayName: product.displayName,
      catalogId: product.catalogId,
      customerType: product.customerType
    }));

  const existingItemsList = typedEntries(paymentsConfig.items).map(([id, item]) => ({
    id,
    displayName: item.displayName,
    customerType: item.customerType
  }));

  const handleInlineSaveProduct = async (productId: string, product: Product) => {
    await project.updateConfig({ [`payments.products.${productId}`]: product });
    toast({ title: "Product updated" });
  };

  const handleDeleteProduct = async (productId: string) => {
    // Get the product's catalog before deleting
    const product = paymentsConfig.products[productId];
    const catalogId = product.catalogId;

    // Count products in the same catalog (before deletion)
    const productsInCatalog = catalogId
      ? Object.entries(paymentsConfig.products).filter(([id, p]) => p && p.catalogId === catalogId)
      : [];
    const isLastProductInCatalog = catalogId && productsInCatalog.length === 1;

    // Rebuild the products object without the deleted product
    // This is the correct way to delete - rebuild the object instead of setting to null
    const updatedProducts = typedFromEntries(
      typedEntries(paymentsConfig.products)
        .filter(([id]) => id !== productId)
    );

    // Delete the product (and catalog if it will be empty)
    if (isLastProductInCatalog) {
      // Also rebuild catalogs without the empty catalog
      const updatedCatalogs = typedFromEntries(
        typedEntries(paymentsConfig.catalogs)
          .filter(([id]) => id !== catalogId)
      );
      await project.updateConfig({
        "payments.products": updatedProducts,
        "payments.catalogs": updatedCatalogs,
      });
      toast({ title: "Product and empty catalog deleted" });
    } else {
      await project.updateConfig({ "payments.products": updatedProducts });
      toast({ title: "Product deleted" });
    }

    // Force a re-render by updating the refresh key
    setRefreshKey(prev => prev + 1);
  };

  const innerContent = (
    <div className="flex-1" key={`${productsKey}-${refreshKey}`}>
      <CatalogView
        groupedProducts={groupedProducts}
        groups={paymentsConfig.catalogs}
        existingItems={existingItemsList}
        onSaveProduct={handleInlineSaveProduct}
        onDeleteProduct={handleDeleteProduct}
        onCreateNewItem={handleCreateItem}
        onOpenProductDetails={(product) => {
          setEditingProduct(product);
          setShowProductDialog(true);
        }}
        onSaveProductWithGroup={async (catalogId, productId, product) => {
          await project.updateConfig({
            [`payments.catalogs.${catalogId}`]: {},
            [`payments.products.${productId}`]: product,
          });
          toast({ title: "Product created" });
        }}
        onCreateCatalog={async (catalogId) => {
          await project.updateConfig({
            [`payments.catalogs.${catalogId}`]: {},
          });
        }}
        createDraftRequestId={createDraftRequestId}
        draftCustomerType={draftCustomerType}
        onDraftHandled={onDraftHandled}
      />
    </div>
  );

  return (
    <>
      {innerContent}

      {/* Product Dialog */}
      <ProductDialog
        open={showProductDialog}
        onOpenChange={(open) => {
          setShowProductDialog(open);
          if (!open) {
            setEditingProduct(null);
          }
        }}
        onSave={async (productId, product) => await handleSaveProduct(productId, product)}
        editingProduct={editingProduct ?? undefined}
        existingProducts={existingProductsList}
        existingCatalogs={Object.fromEntries(Object.entries(paymentsConfig.catalogs).map(([id, g]) => [id, { displayName: g.displayName || id }]))}
        existingItems={existingItemsList}
        onCreateNewItem={handleCreateItem}
      />

      {/* Item Dialog */}
      <ItemDialog
        open={showItemDialog}
        onOpenChange={(open) => {
          setShowItemDialog(open);
          if (!open) {
            setEditingItem(null);
            setNewItemCustomerType(undefined);
            setOnItemCreatedCallback(undefined);
          }
        }}
        onSave={async (item) => await handleSaveItem(item)}
        editingItem={editingItem ?? undefined}
        existingItemIds={Object.keys(paymentsConfig.items)}
        forceCustomerType={newItemCustomerType}
      />
    </>
  );
}
