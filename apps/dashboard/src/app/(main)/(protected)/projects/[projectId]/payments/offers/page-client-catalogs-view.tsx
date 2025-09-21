"use client";

import { CodeBlock } from '@/components/code-block';
import { EditableInput } from "@/components/editable-input";
import { cn } from "@/lib/utils";
import { CompleteConfig } from "@stackframe/stack-shared/dist/config/schema";
import type { DayInterval } from "@stackframe/stack-shared/dist/utils/dates";
import { prettyPrintWithMagnitudes } from "@stackframe/stack-shared/dist/utils/numbers";
import { typedEntries } from "@stackframe/stack-shared/dist/utils/objects";
import { stringCompare } from "@stackframe/stack-shared/dist/utils/strings";
import {
  ActionDialog,
  Button,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Separator,
  SimpleTooltip,
  Switch,
  toast
} from "@stackframe/stack-ui";
import { Check, ChevronDown, ChevronsUpDown, Layers, MoreVertical, Pencil, PencilIcon, Plus, Puzzle, Server, Trash2, X } from "lucide-react";
import { Fragment, useEffect, useId, useMemo, useRef, useState } from "react";
import { IllustratedInfo } from "../../../../../../../components/illustrated-info";
import { PageLayout } from "../../page-layout";
import { useAdminApp } from "../../use-admin-app";
import { DUMMY_PAYMENTS_CONFIG } from "./dummy-data";
import { ItemDialog } from "./item-dialog";
import { OfferDialog } from "./offer-dialog";

type Offer = CompleteConfig['payments']['offers'][keyof CompleteConfig['payments']['offers']];
type Price = (Offer['prices'] & object)[string];
type PricesObject = Exclude<Offer['prices'], 'include-by-default'>;


function intervalLabel(tuple: DayInterval | undefined): string | null {
  if (!tuple) return null;
  const [count, unit] = tuple;
  if (count === 1) {
    return unit === 'year' ? 'yearly' : unit === 'month' ? 'monthly' : unit === 'week' ? 'weekly' : 'daily';
  }
  const plural = unit + 's';
  return `/ ${count} ${plural}`;
}


function shortIntervalLabel(interval: DayInterval | 'never'): string {
  if (interval === 'never') return 'once';
  const [count, unit] = interval;
  const map: Record<DayInterval[1], string> = { day: 'd', week: 'wk', month: 'mo', year: 'yr' };
  const suffix = map[unit];
  return `/${count === 1 ? '' : count}${suffix}`;
}

function OrSeparator() {
  return (
    <div className="flex items-center justify-center stack-scope mx-2">
      <div className="flex-1">
        <Separator />
      </div>
      <div className="mx-2 text-sm text-zinc-500">OR</div>
      <div className="flex-1">
        <Separator />
      </div>
    </div>
  );
}


function IntervalPopover({
  readOnly,
  intervalText,
  intervalSelection,
  unit,
  count,
  setIntervalSelection,
  setUnit,
  setCount,
  onChange,
  noneLabel = 'one time',
}: {
  readOnly?: boolean,
  intervalText: string | null,
  intervalSelection: 'one-time' | 'custom' | DayInterval[1],
  unit: DayInterval[1] | undefined,
  count: number,
  setIntervalSelection: (s: 'one-time' | 'custom' | DayInterval[1]) => void,
  setUnit: (u: DayInterval[1] | undefined) => void,
  setCount: (n: number) => void,
  onChange: (interval: DayInterval | null) => void,
  noneLabel?: string,
}) {
  const [open, setOpen] = useState(false);

  const selectOneTime = () => {
    setIntervalSelection('one-time');
    setUnit(undefined);
    setCount(1);
    if (!readOnly) onChange(null);
    setOpen(false);
  };

  const selectFixed = (unit: DayInterval[1]) => {
    setIntervalSelection(unit);
    setUnit(unit);
    setCount(1);
    if (!readOnly) onChange([1, unit]);
    setOpen(false);
  };

  const applyCustom = (count: number, unit: DayInterval[1]) => {
    setIntervalSelection('custom');
    setUnit(unit);
    setCount(count);
    if (!readOnly) onChange([count, unit]);
  };

  const triggerLabel = intervalText || noneLabel;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger>
        <div className="text-xs px-2 py-0.5 rounded bg-muted text-muted-foreground cursor-pointer select-none flex items-center gap-1">
          {triggerLabel}
          <ChevronsUpDown className="h-4 w-4" />
        </div>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-60 p-2">
        <div className="flex flex-col gap-1">
          <Button
            variant={intervalSelection === 'one-time' ? 'secondary' : 'ghost'}
            size="sm"
            className="justify-start"
            onClick={selectOneTime}
          >
            {noneLabel}
          </Button>
          <Button
            variant={intervalSelection === 'day' ? 'secondary' : 'ghost'}
            size="sm"
            className="justify-start"
            onClick={() => selectFixed('day')}
          >
            daily
          </Button>
          <Button
            variant={intervalSelection === 'week' ? 'secondary' : 'ghost'}
            size="sm"
            className="justify-start"
            onClick={() => selectFixed('week')}
          >
            weekly
          </Button>
          <Button
            variant={intervalSelection === 'month' ? 'secondary' : 'ghost'}
            size="sm"
            className="justify-start"
            onClick={() => selectFixed('month')}
          >
            monthly
          </Button>
          <Button
            variant={intervalSelection === 'year' ? 'secondary' : 'ghost'}
            size="sm"
            className="justify-start"
            onClick={() => selectFixed('year')}
          >
            yearly
          </Button>

          <Button
            variant={intervalSelection === 'custom' ? 'secondary' : 'ghost'}
            size="sm"
            className="justify-start"
            onClick={() => {
              setIntervalSelection('custom');
              const nextUnit = (unit || 'month') as DayInterval[1];
              setUnit(nextUnit);
            }}
          >
            custom
          </Button>

          {intervalSelection === 'custom' && (
            <div className="mt-2 px-1">
              <div className="text-xs text-muted-foreground mb-1">Custom</div>
              <div className="flex items-center gap-2">
                <div className="text-xs">every</div>
                <div className="w-14">
                  <Input
                    className="h-8 w-full text-right bg-transparent shadow-none font-mono text-xs"
                    inputMode="numeric"
                    value={String(count)}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (!/^\d*$/.test(v)) return;
                      const n = v === '' ? 0 : parseInt(v, 10);
                      applyCustom(n, (unit || 'month') as DayInterval[1]);
                    }}
                  />
                </div>
                <div className="w-24">
                  <Select
                    value={(unit || 'month') as DayInterval[1]}
                    onValueChange={(u) => {
                      const newUnit = u as DayInterval[1];
                      applyCustom(count, newUnit);
                    }}
                  >
                    <SelectTrigger className="h-8 w-full bg-transparent shadow-none text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="day">day</SelectItem>
                      <SelectItem value="week">week</SelectItem>
                      <SelectItem value="month">month</SelectItem>
                      <SelectItem value="year">year</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}


function OfferPriceRow({
  priceId,
  price,
  readOnly,
  startEditing,
  onSave,
  onRemove,
  existingPriceIds,
}: {
  priceId: string,
  price: (Offer['prices'] & object)[string],
  readOnly?: boolean,
  startEditing?: boolean,
  onSave: (newId: string | undefined, price: (Offer['prices'] & object)[string]) => void,
  onRemove?: () => void,
  existingPriceIds: string[],
}) {
  const [isEditing, setIsEditing] = useState<boolean>(!!startEditing && !readOnly);
  const [amount, setAmount] = useState<string>(price.USD || '0.00');
  const [priceInterval, setPriceInterval] = useState<DayInterval[1] | undefined>(price.interval?.[1]);
  const [intervalCount, setIntervalCount] = useState<number>(price.interval?.[0] || 1);
  const [intervalSelection, setIntervalSelection] = useState<'one-time' | 'custom' | DayInterval[1]>(
    price.interval ? (price.interval[0] === 1 ? price.interval[1] : 'custom') : 'one-time'
  );

  const niceAmount = +amount;

  useEffect(() => {
    if (isEditing) return;
    setAmount(price.USD || '0.00');
    setPriceInterval(price.interval?.[1]);
    setIntervalCount(price.interval?.[0] || 1);
    setIntervalSelection(price.interval ? (price.interval[0] === 1 ? price.interval[1] : 'custom') : 'one-time');
  }, [price, isEditing]);


  useEffect(() => {
    if (!readOnly && startEditing) setIsEditing(true);
    if (readOnly) setIsEditing(false);
  }, [startEditing, readOnly]);


  const intervalText = intervalLabel(price.interval);

  return (
    <div className={cn("relative flex flex-col items-center rounded-md px-2 py-1")}>
      {isEditing ? (
        <>
          <div className="relative w-full pb-2">
            <span className="pointer-events-none font-semibold text-xl text-black absolute left-1.5 top-1/2 -translate-y-1/2 z-20">$</span>
            <Input
              className="h-8 !pl-[18px] w-full mr-3 text-xl font-semibold bg-transparent tabular-nums text-center"
              tabIndex={0}
              inputMode="decimal"
              value={amount}
              readOnly={false}
              placeholder="0.00"
              aria-label="Amount in USD"
              onChange={(e) => {
                const v = e.target.value;
                if (v === '' || /^\d*(?:\.?\d{0,2})?$/.test(v)) setAmount(v);
                if (!readOnly) {
                  const normalized = v === '' ? '0.00' : (Number.isNaN(parseFloat(v)) ? '0.00' : parseFloat(v).toFixed(2));
                  const intervalObj = intervalSelection === 'one-time' ? undefined : ([
                    intervalSelection === 'custom' ? intervalCount : 1,
                    (intervalSelection === 'custom' ? (priceInterval || 'month') : intervalSelection) as DayInterval[1]
                  ] as DayInterval);
                  const updated: Price = {
                    USD: normalized,
                    serverOnly: !!price.serverOnly,
                    ...(intervalObj ? { interval: intervalObj } : {}),
                  };
                  onSave(undefined, updated);
                }
              }}
            />
          </div>

          <div className="relative shrink-0">
            <IntervalPopover
              readOnly={readOnly}
              intervalText={intervalText}
              intervalSelection={intervalSelection}
              unit={priceInterval}
              count={intervalCount}
              setIntervalSelection={setIntervalSelection}
              setUnit={setPriceInterval}
              setCount={setIntervalCount}
              onChange={(interval) => {
                if (readOnly) return;
                const normalized = amount === '' ? '0.00' : (Number.isNaN(parseFloat(amount)) ? '0.00' : parseFloat(amount).toFixed(2));
                const updated: Price = {
                  USD: normalized,
                  serverOnly: !!price.serverOnly,
                  ...(interval ? { interval } : {}),
                };
                onSave(undefined, updated);
              }}
            />
          </div>

          {onRemove && (
            <button className="absolute right-1 top-1 text-muted-foreground hover:text-foreground" onClick={onRemove} aria-label="Remove price">
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </>
      ) : (
        <>
          <div className="text-xl text-center font-semibold tabular-nums">${niceAmount}</div>
          <div className="text-xs text-muted-foreground">{intervalText ?? 'one-time'}</div>
        </>
      )}
    </div>
  );
}

const EXPIRES_OPTIONS: Array<{ value: Offer["includedItems"][string]["expires"], label: string, description: string }> = [
  {
    value: 'never' as const,
    label: 'Never expires',
    description: 'Items granted remain with the customer'
  },
  {
    value: 'when-purchase-expires' as const,
    label: 'When purchase expires',
    description: 'items granted are removed when subscription ends'
  },
  {
    value: 'when-repeated' as const,
    label: 'When repeated',
    description: 'Items granted expire when they\'re granted again',
  }
];

function OfferItemRow({
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
  item: Offer['includedItems'][string],
  itemDisplayName: string,
  readOnly?: boolean,
  startEditing?: boolean,
  onSave: (itemId: string, item: Offer['includedItems'][string]) => void,
  onRemove?: () => void,
  allItems: Array<{ id: string, displayName: string, customerType: string }>,
  existingIncludedItemIds: string[],
  onChangeItemId: (newItemId: string) => void,
  onCreateNewItem: () => void,
}) {
  const [isEditing, setIsEditing] = useState<boolean>(false);
  const [isOpen, setIsOpen] = useState<boolean>(false);
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
    const updated: Offer['includedItems'][string] = { ...item, quantity: Number.isNaN(normalized) ? 0 : normalized };
    onSave(itemId, updated);
  };

  const repeatText = item.repeat === 'never' ? null : intervalLabel(item.repeat);
  const shortRepeatText = shortIntervalLabel(item.repeat);

  if (isEditing) {
    return (
      <div className="flex flex-col gap-1 mb-4">
        <div className="flex flex-row">
          <Popover open={itemSelectOpen} onOpenChange={setItemSelectOpen}>
            <PopoverTrigger>
              <div className="text-sm px-2 py-0.5 rounded bg-muted hover:bg-muted/70 cursor-pointer select-none flex items-center gap-1">
                {itemDisplayName}
                <ChevronsUpDown className="h-4 w-4" />
              </div>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-72 p-2">
              <div className="flex flex-col gap-1 max-h-64 overflow-auto">
                {allItems.map((opt) => {
                  const isSelected = opt.id === itemId;
                  const isUsed = existingIncludedItemIds.includes(opt.id) && !isSelected;
                  return (
                    <Button
                      key={opt.id}
                      variant={isSelected ? 'secondary' : 'ghost'}
                      size="sm"
                      className="justify-start"
                      disabled={isUsed}
                      onClick={() => {
                        if (isSelected) {
                          setItemSelectOpen(false);
                          return;
                        }
                        if (isUsed) {
                          toast({ title: 'Item already included' });
                          return;
                        }
                        onChangeItemId(opt.id);
                        setItemSelectOpen(false);
                      }}
                    >
                      <div className="flex flex-col items-start">
                        <span>{opt.displayName || opt.id}</span>
                        <span className="text-xs text-muted-foreground">{opt.customerType.toUpperCase()} • {opt.id}</span>
                      </div>
                    </Button>
                  );
                })}
                <div className="pt-1 mt-1 border-t">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="justify-start text-primary"
                    onClick={() => {
                      setItemSelectOpen(false);
                      onCreateNewItem();
                    }}
                  >
                    <Plus className="h-4 w-4 mr-2" /> New Item
                  </Button>
                </div>
              </div>
            </PopoverContent>
          </Popover>
          <Input
            className="ml-auto w-20 text-right tabular-nums mr-2"
            inputMode="numeric"
            value={quantity}
            onChange={(e) => {
              const v = e.target.value;
              if (v === '' || /^\d*$/.test(v)) setQuantity(v);
              if (!readOnly && (v === '' || /^\d*$/.test(v))) updateParent(v);
            }}
          />
          <IntervalPopover
            readOnly={readOnly}
            intervalText={repeatText}
            intervalSelection={repeatSelection}
            unit={repeatUnit}
            count={repeatCount}
            setIntervalSelection={setRepeatSelection}
            setUnit={setRepeatUnit}
            setCount={setRepeatCount}
            noneLabel="one time"
            onChange={(interval) => {
              if (readOnly) return;
              const updated: Offer['includedItems'][string] = {
                ...item,
                repeat: interval ? interval : 'never',
              };
              onSave(itemId, updated);
            }}
          />
          {onRemove && (
            <button className="ml-auto" onClick={onRemove} aria-label="Remove item">
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        <div className="flex flex-row items-center gap-2">
          <span className="text-xs text-muted-foreground">Expires:</span>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <div className="text-xs px-2 py-0.5 w-fit rounded bg-muted text-muted-foreground cursor-pointer select-none flex items-center gap-1">
                {item.expires === 'never' ? 'Never expires' : `${EXPIRES_OPTIONS.find(o => o.value === item.expires)?.label.toLowerCase()}`}
                <ChevronsUpDown className="h-4 w-4" />
              </div>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="p-2">
              <div className="flex flex-col gap-2">
                {EXPIRES_OPTIONS.map((option) => (
                  <DropdownMenuItem key={option.value}>
                    <Button
                      key={option.value}
                      variant="ghost"
                      size="sm"
                      className="flex flex-col items-start"
                      onClick={() => {
                        onSave(itemId, { ...item, expires: option.value });
                      }}>
                      {option.label}
                      <span className="text-xs text-muted-foreground">{option.description}</span>
                    </Button>
                  </DropdownMenuItem>
                ))}
              </div>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-row">
      <div className="flex items-center gap-2 w-full">
        <Collapsible open={isOpen} onOpenChange={setIsOpen} className="w-full">
          <div className="flex items-center gap-2 w-full">
            <CollapsibleTrigger asChild>
              <button className="h-5 w-5 inline-flex items-center justify-center rounded hover:bg-muted">
                <ChevronDown className={cn("h-4 w-4 transition-transform", isOpen ? "rotate-0" : "-rotate-90")} />
              </button>
            </CollapsibleTrigger >
            <div className="text-sm">{itemDisplayName}</div>
            <div className="ml-auto w-16 text-right text-sm text-muted-foreground tabular-nums">{prettyPrintWithMagnitudes(item.quantity)}</div>
            <div className="ml-2">
              <div className="text-xs px-2 py-0.5 rounded bg-muted text-muted-foreground">{shortRepeatText}</div>
            </div>
            {
              !readOnly && (
                <>
                  <button
                    className="ml-2 text-muted-foreground hover:text-foreground"
                    onClick={() => setIsEditing(true)}
                    aria-label="Edit item"
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                  {onRemove && (
                    <button className="text-destructive ml-1" onClick={onRemove} aria-label="Remove item">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </>
              )
            }
          </div >
          <CollapsibleContent>
            <div className="mt-2 space-y-2">
              <div className="text-xs pl-7 text-muted-foreground">{item.expires !== 'never' ? `Expires: ${String(item.expires).replace(/-/g, ' ')}` : 'Never expires'}</div>
              <div className="text-xs">
                <CodeBlock
                  language="typescript"
                  content={`const item = await ${activeType === "user" ? "user" : "team"}.getItem("${itemId}");\nconst count = item.quantity;\n`}
                  title="Example"
                  icon="code"
                  compact
                />
              </div>
            </div>
          </CollapsibleContent>
        </Collapsible >
      </div >
    </div >
  );
}


type OfferCardProps = {
  id: string,
  activeType: 'user' | 'team' | 'custom',
  offer: Offer,
  allOffers: Array<{ id: string, offer: Offer }>,
  existingItems: Array<{ id: string, displayName: string, customerType: string }>,
  onSave: (id: string, offer: Offer) => Promise<void>,
  onDelete: (id: string) => Promise<void>,
  onDuplicate: (offer: Offer) => void,
  onCreateNewItem: () => void,
  onOpenDetails: (offer: Offer) => void,
  isDraft?: boolean,
  onCancelDraft?: () => void,
};

function OfferCard({ id, activeType, offer, allOffers, existingItems, onSave, onDelete, onDuplicate, onCreateNewItem, onOpenDetails, isDraft, onCancelDraft }: OfferCardProps) {
  const [isEditing, setIsEditing] = useState(!!isDraft);
  const [draft, setDraft] = useState<Offer>(offer);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [editingPriceId, setEditingPriceId] = useState<string | undefined>(undefined);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const [hasAutoScrolled, setHasAutoScrolled] = useState(false);
  const [localOfferId, setLocalOfferId] = useState<string>(id);

  useEffect(() => {
    setDraft(offer);
    setLocalOfferId(id);
  }, [offer, id]);

  useEffect(() => {
    if (isDraft && !hasAutoScrolled && cardRef.current) {
      cardRef.current.scrollIntoView({ behavior: 'auto', block: 'nearest', inline: 'center' });
      setHasAutoScrolled(true);
    }
  }, [isDraft, hasAutoScrolled]);

  const pricesObject: PricesObject = typeof draft.prices === 'object' ? draft.prices : {};

  const canSaveOffer = draft.prices === 'include-by-default' || (typeof draft.prices === 'object' && Object.keys(pricesObject).length > 0);
  const saveDisabledReason = canSaveOffer ? undefined : "Add at least one price or set Include by default";

  const handleRemovePrice = (priceId: string) => {
    setDraft(prev => {
      if (typeof prev.prices !== 'object') return prev;
      const nextPrices: PricesObject = { ...prev.prices };
      delete nextPrices[priceId];
      return { ...prev, prices: nextPrices };
    });
    if (editingPriceId === priceId) setEditingPriceId(undefined);
  };

  const handleAddOrEditIncludedItem = (itemId: string, item: Offer['includedItems'][string]) => {
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
      const next: Offer['includedItems'] = { ...prev.includedItems };
      delete next[itemId];
      return { ...prev, includedItems: next };
    });
  };

  const renderPrimaryPrices = () => {
    if (draft.prices === 'include-by-default') {
      return (
        <div className="text-2xl text-center font-semibold">Free</div>
      );
    }
    const entries = Object.entries(pricesObject);
    if (entries.length === 0) {
      return null;
    }
    return (
      <div className="space-y-3 shrink-0">
        {entries.map(([pid, price], index) => (
          <Fragment key={pid}>
            <OfferPriceRow
              key={pid}
              priceId={pid}
              price={price}
              readOnly={!isEditing}
              startEditing={isEditing}
              existingPriceIds={entries.map(([k]) => k).filter(k => k !== pid)}
              onSave={(newId, newPrice) => {
                const finalId = newId || pid;
                setDraft(prev => {
                  const prevPrices: PricesObject = typeof prev.prices === 'object' ? prev.prices : {};
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
            {index < entries.length - 1 && <OrSeparator />}
          </Fragment>
        ))}
      </div>
    );
  };

  const itemsList = Object.entries(draft.includedItems);

  const couldBeAddOnTo = allOffers.filter(o => o.offer.groupId === draft.groupId && o.id !== id);
  const isAddOnTo = allOffers.filter(o => draft.isAddOnTo && o.id in draft.isAddOnTo);

  const OFFER_TOGGLE_OPTIONS = [{
    key: 'serverOnly' as const,
    label: 'Server only',
    description: "Restricts this offer to only be purchased from server-side calls",
    active: !!draft.serverOnly,
    visible: true,
    icon: <Server size={16} />,
    onToggle: () => setDraft(prev => ({ ...prev, serverOnly: !prev.serverOnly })),
    wrapButton: (button: React.ReactNode) => button,
  }, {
    key: 'stackable' as const,
    label: 'Stackable',
    description: "Allow customers to purchase this offer multiple times",
    active: !!draft.stackable,
    visible: true,
    icon: <Layers size={16} />,
    onToggle: () => setDraft(prev => ({ ...prev, stackable: !prev.stackable })),
    wrapButton: (button: React.ReactNode) => button,
  }, {
    key: 'addon' as const,
    label: 'Add-on',
    description: "Make this offer an add-on. An add-on can be purchased along with the offer(s) it is an add-on to.",
    visible: draft.isAddOnTo !== false || couldBeAddOnTo.length > 0,
    active: draft.isAddOnTo !== false,
    icon: <Puzzle size={16} />,
    onToggle: isAddOnTo.length === 0 && draft.isAddOnTo !== false ? () => setDraft(prev => ({ ...prev, isAddOnTo: false })) : undefined,
    wrapButton: (button: React.ReactNode) => isAddOnTo.length === 0 && draft.isAddOnTo !== false ? button : (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          {button}
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          {couldBeAddOnTo.map(offer => (
            <DropdownMenuCheckboxItem
              checked={isAddOnTo.some(o => o.id === offer.id)}
              key={offer.id}
              onCheckedChange={(checked) => setDraft(prev => {
                const newIsAddOnTo = { ...prev.isAddOnTo || {} };
                if (checked) {
                  newIsAddOnTo[offer.id] = true;
                } else {
                  delete newIsAddOnTo[offer.id];
                }
                return { ...prev, isAddOnTo: Object.keys(newIsAddOnTo).length > 0 ? newIsAddOnTo : false };
              })}
              className="cursor-pointer"
            >
              {offer.offer.displayName} ({offer.id})
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    ),
  }] as const;

  return (
    <div ref={cardRef} className={cn(
      "rounded-lg border bg-background w-[280px] flex flex-col relative group shrink-0 pb-4",
      isEditing && "border-foreground/60 dark:border-foreground/40"
    )}>
      <div className="pt-4 px-4 flex flex-col items-center justify-center">
        {isEditing && (
          <div className="flex flex-col gap-2 w-full">
            <div className="flex items-center gap-2">
              <div className="grow flex flex-row justify-end">
                <SimpleTooltip tooltip={saveDisabledReason} disabled={canSaveOffer}>
                  <Button size="icon" variant="ghost" onClick={async () => {
                    const trimmed = localOfferId.trim();
                    const validId = trimmed && /^[a-z0-9-]+$/.test(trimmed) ? trimmed : id;
                    if (validId !== id) {
                      await onSave(validId, draft);
                      await onDelete(id);
                    } else {
                      await onSave(id, draft);
                    }
                    setIsEditing(false);
                    setEditingPriceId(undefined);
                  }} disabled={!canSaveOffer}>
                    <Check className="text-green-500" />
                  </Button>
                </SimpleTooltip>
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => {
                    if (isDraft && onCancelDraft) {
                      onCancelDraft();
                      return;
                    }
                    setIsEditing(false);
                    setDraft(offer);
                    setEditingPriceId(undefined);
                  }}
                  aria-label="Cancel edit"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>
        )}
        <div className="flex justify-center flex-col items-center w-full">
          <EditableInput
            value={localOfferId}
            onUpdate={async (value) => setLocalOfferId(value)}
            readOnly={!isDraft || !isEditing}
            placeholder={"Offer ID"}
            inputClassName="text-xs font-mono text-center text-muted-foreground"
          />
          <EditableInput
            value={draft.displayName || ""}
            onUpdate={async (value) => setDraft(prev => ({ ...prev, displayName: value }))}
            readOnly={!isEditing}
            placeholder={"Offer display name"}
            inputClassName="text-lg font-bold text-center w-full"
          />
        </div>
        {!isEditing && (
          <div className="absolute top-4 right-4 opacity-0 group-hover:opacity-100 transition-opacity">
            <button className="h-7 w-7 inline-flex items-center justify-center rounded hover:bg-muted" aria-label="Edit offer" onClick={() => {
              setIsEditing(true);
              setDraft(offer);
            }}>
              <PencilIcon className="h-4 w-4" />
            </button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="h-7 w-7 inline-flex items-center justify-center rounded hover:bg-muted" aria-label="Open menu">
                  <MoreVertical className="h-4 w-4" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-[160px]">
                <DropdownMenuItem onClick={() => {
                  setIsEditing(true);
                  setDraft(offer);
                }}>
                  Edit
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => { onDuplicate(offer); }}>
                  Duplicate
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => { setShowDeleteDialog(true); }}>
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      </div>
      {/* Toggles row */}
      <div className="px-4 pb-3 pt-1 flex flex-wrap gap-2 justify-center text-muted-foreground">
        {OFFER_TOGGLE_OPTIONS.filter(b => b.visible !== false).filter(b => isEditing || b.active).map((b) => (
          <SimpleTooltip tooltip={b.description} key={b.key}>
            {(isEditing ? b.wrapButton : ((x: any) => x))(
              <button
                key={b.key}
                className={cn("text-xs px-2 py-0.5 flex items-center gap-1 rounded-full",
                  isEditing ? "border bg-muted/40 hover:bg-muted/60" : "bg-transparent",
                  !b.active && "line-through text-muted-foreground",
                )}
                onClick={isEditing ? b.onToggle : undefined}
              >
                {b.icon}
                {b.key === "addon" && isAddOnTo.length > 0 ? `Add-on to ${isAddOnTo.map(o => o.offer.displayName).join(", ")}` : b.label}
              </button>
            )}
          </SimpleTooltip>
        ))}
      </div>
      <div className="px-4 py-4 border-y border-border">
        {renderPrimaryPrices()}
        {isEditing && draft.prices !== 'include-by-default' && (
          <>
            {Object.keys(draft.prices).length > 0 && <OrSeparator />}
            <Button
              variant="outline"
              className="w-full h-20 border-dashed border"
              onClick={() => {
                const tempId = `price-${Date.now().toString(36).slice(2, 8)}`;
                const newPrice: Price = { USD: '0.00', serverOnly: false };
                setDraft(prev => {
                  const nextPrices: PricesObject = {
                    ...(typeof prev.prices === 'object' ? prev.prices : {}),
                    [tempId]: newPrice,
                  };
                  return { ...prev, prices: nextPrices };
                });
                setEditingPriceId(tempId);
              }}
            >
              + Add Price
            </Button>
          </>
        )}
      </div>

      <div className="px-4 py-3">
        {itemsList.length === 0 ? (
          <div className="text-sm text-muted-foreground text-center">No items yet</div>
        ) : (
          <div className="space-y-2">
            {itemsList.map(([itemId, item]) => {
              const itemMeta = existingItems.find(i => i.id === itemId);
              const itemLabel = itemMeta ? (itemMeta.displayName || itemMeta.id) : 'Select item';
              return (
                <OfferItemRow
                  key={itemId}
                  activeType={activeType}
                  itemId={itemId}
                  item={item}
                  itemDisplayName={itemLabel}
                  allItems={existingItems}
                  existingIncludedItemIds={Object.keys(draft.includedItems).filter(id => id !== itemId)}
                  startEditing={isEditing}
                  readOnly={!isEditing}
                  onSave={(id, updated) => handleAddOrEditIncludedItem(id, updated)}
                  onChangeItemId={(newItemId) => {
                    setDraft(prev => {
                      if (Object.prototype.hasOwnProperty.call(prev.includedItems, newItemId)) {
                        toast({ title: "Item already included" });
                        return prev;
                      }
                      const next: Offer['includedItems'] = { ...prev.includedItems };
                      const value = next[itemId];
                      delete next[itemId];
                      next[newItemId] = value;
                      return { ...prev, includedItems: next };
                    });
                  }}
                  onRemove={isEditing ? () => handleRemoveIncludedItem(itemId) : undefined}
                  onCreateNewItem={onCreateNewItem}
                />
              );
            })}
          </div>
        )}
      </div>
      {
        isEditing && (
          <div className="px-4 pb-4">
            <Button
              variant="outline"
              className="w-full h-14 border-dashed border"
              onClick={() => {
                const available = existingItems.find(i => !Object.prototype.hasOwnProperty.call(draft.includedItems, i.id));
                const newItemId = available?.id || `__new_item__${Date.now().toString(36).slice(2, 8)}`;
                const newItem: Offer['includedItems'][string] = { quantity: 1, repeat: 'never', expires: 'never' };
                setDraft(prev => ({
                  ...prev,
                  includedItems: {
                    ...prev.includedItems,
                    [newItemId]: newItem,
                  }
                }));
              }}>
              + Add Item
            </Button>
          </div>
        )
      }
      {!isEditing && activeType !== "custom" && (
        <div className="border-t p-4">
          <CodeBlock
            language="typescript"
            content={`const checkoutUrl = await ${activeType === "user" ? "user" : "team"}.createCheckoutUrl({ offerId: "${id}" });\nwindow.open(checkoutUrl, "_blank");`}
            title="Checkout"
            icon="code"
            compact
          />
        </div>
      )}

      <ActionDialog
        open={showDeleteDialog}
        onOpenChange={setShowDeleteDialog}
        title="Delete offer"
        danger
        okButton={{
          label: "Delete",
          onClick: async () => {
            await onDelete(id);
            setShowDeleteDialog(false);
          }
        }}
        cancelButton
      >
        Are you sure you want to delete this offer?
      </ActionDialog>
    </div >
  );
}

type CatalogViewProps = {
  groupedOffers: Map<string | undefined, Array<{ id: string, offer: Offer }>>,
  groups: Record<string, { displayName?: string }>,
  existingItems: Array<{ id: string, displayName: string, customerType: string }>,
  onSaveOffer: (id: string, offer: Offer) => Promise<void>,
  onDeleteOffer: (id: string) => Promise<void>,
  onCreateNewItem: () => void,
  onOpenOfferDetails: (offer: Offer) => void,
  onSaveOfferWithGroup: (groupId: string, offerId: string, offer: Offer) => Promise<void>,
};

function CatalogView({ groupedOffers, groups, existingItems, onSaveOffer, onDeleteOffer, onCreateNewItem, onOpenOfferDetails, onSaveOfferWithGroup }: CatalogViewProps) {
  const [activeType, setActiveType] = useState<'user' | 'team' | 'custom'>('user');
  const [drafts, setDrafts] = useState<Array<{ key: string, groupId: string | undefined, offer: Offer }>>([]);
  const [creatingGroupKey, setCreatingGroupKey] = useState<string | undefined>(undefined);
  const [newGroupId, setNewGroupId] = useState("");
  const newGroupInputRef = useRef<HTMLInputElement | null>(null);

  const filtered = useMemo(() => {
    const res = new Map<string | undefined, Array<{ id: string, offer: Offer }>>();
    groupedOffers.forEach((offers, gid) => {
      const f = offers.filter(o => o.offer.customerType === activeType);
      if (f.length) res.set(gid, f);
    });
    return res;
  }, [groupedOffers, activeType]);

  useEffect(() => {
    if (creatingGroupKey && newGroupInputRef.current) {
      newGroupInputRef.current.focus();
      newGroupInputRef.current.select();
    }
  }, [creatingGroupKey]);

  // If user switches tabs while creating a new catalog, remove the temporary group and its drafts
  const prevActiveTypeRef = useRef(activeType);
  useEffect(() => {
    const tabChanged = prevActiveTypeRef.current !== activeType;
    prevActiveTypeRef.current = activeType;
    if (!tabChanged) return;
    if (!creatingGroupKey) return;
    setDrafts(prev => prev.filter(d => d.groupId !== creatingGroupKey));
    setCreatingGroupKey(undefined);
    setNewGroupId("");
  }, [activeType, creatingGroupKey]);


  const usedIds = useMemo(() => {
    const all: string[] = [];
    groupedOffers.forEach(arr => arr.forEach(({ id }) => all.push(id)));
    drafts.forEach(d => all.push(d.key));
    return new Set(all);
  }, [groupedOffers, drafts]);

  const generateOfferId = (base: string) => {
    let id = base;
    let i = 2;
    while (usedIds.has(id)) id = `${base}-${i++}`;
    return id;
  };

  const groupIdsToRender = useMemo(() => {
    const s = new Set<string | undefined>();
    filtered.forEach((_offers, gid) => s.add(gid));
    const arr = Array.from(s.values());
    const withoutUndefined = arr.filter((gid): gid is string => gid !== undefined);
    const ordered: Array<string | undefined> = [...withoutUndefined, undefined];
    return creatingGroupKey ? [creatingGroupKey, ...ordered] : ordered;
  }, [filtered, creatingGroupKey]);

  return (
    <div className="space-y-10">
      <div className="flex items-center justify-center">
        <div className="inline-flex rounded-md bg-muted p-1">
          {(['user', 'team', 'custom'] as const).map(t => (
            <button
              key={t}
              onClick={() => setActiveType(t)}
              className={cn(
                "px-4 py-2 text-sm rounded-sm capitalize",
                activeType === t ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground"
              )}
            >
              {t} catalogs
            </button>
          ))}
        </div>
      </div>

      {groupIdsToRender.map((groupId) => {
        const isNewGroupPlaceholder = !!creatingGroupKey && groupId === creatingGroupKey;
        const offers = isNewGroupPlaceholder ? [] : (filtered.get(groupId) || []);
        const groupName = !isNewGroupPlaceholder ? (groupId ? ((groups[groupId].displayName || groupId)) : 'No catalog') : '';
        return (
          <div key={groupId || 'ungrouped'}>
            {isNewGroupPlaceholder ? (
              <div className="mb-3 flex items-center gap-2">
                <Input
                  ref={newGroupInputRef}
                  value={newGroupId}
                  onChange={(e) => setNewGroupId(e.target.value)}
                  placeholder="catalog-id"
                  className="w-56"
                />
                <button
                  className="h-8 w-8 inline-flex items-center justify-center rounded hover:bg-muted"
                  onClick={() => {
                    setCreatingGroupKey(undefined);
                    setNewGroupId("");
                    setDrafts(prev => prev.filter(d => d.groupId !== groupId));
                  }}
                  aria-label="Cancel new catalog"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <h3 className="text-lg font-semibold mb-3">{groupName}</h3>
            )}
            <div className="relative rounded-xl bg-slate-100 dark:bg-muted border-slate-100 dark:border-muted border-2">
              <div className="flex gap-4 justify-start overflow-x-auto p-4 min-h-20 pr-16">
                <div className="flex max-w-max gap-4 items-start">
                  {offers.map(({ id, offer }) => (
                    <OfferCard
                      key={id}
                      id={id}
                      activeType={activeType}
                      offer={offer}
                      allOffers={offers}
                      existingItems={existingItems}
                      onSave={onSaveOffer}
                      onDelete={onDeleteOffer}
                      onDuplicate={(srcOffer) => {
                        const key = generateOfferId("offer");
                        const duplicated: Offer = {
                          ...srcOffer,
                          displayName: `${srcOffer.displayName || id} Copy`,
                        };
                        setDrafts(prev => [...prev, { key, groupId, offer: duplicated }]);
                      }}
                      onCreateNewItem={onCreateNewItem}
                      onOpenDetails={(o) => onOpenOfferDetails(o)}
                    />
                  ))}
                  {drafts.filter(d => d.groupId === groupId && d.offer.customerType === activeType).map((d) => (
                    <OfferCard
                      key={d.key}
                      id={d.key}
                      activeType={activeType}
                      offer={d.offer}
                      allOffers={offers}
                      existingItems={existingItems}
                      isDraft
                      onSave={async (_ignoredId, offer) => {
                        const newId = generateOfferId('offer');
                        if (isNewGroupPlaceholder) {
                          const id = newGroupId.trim();
                          if (!id) {
                            alert("Catalog ID is required");
                            return;
                          }
                          if (!/^[a-z0-9-]+$/.test(id)) {
                            alert("Catalog ID must be lowercase letters, numbers, and hyphens");
                            return;
                          }
                          if (Object.prototype.hasOwnProperty.call(groups, id)) {
                            alert("Catalog ID already exists");
                            return;
                          }
                          const offerWithGroup: Offer = { ...offer, groupId: id };
                          await onSaveOfferWithGroup(id, newId, offerWithGroup);
                          setCreatingGroupKey(undefined);
                          setNewGroupId("");
                          setDrafts(prev => prev.filter(x => x.key !== d.key));
                          return;
                        }
                        await onSaveOffer(newId, offer);
                        setDrafts(prev => prev.filter(x => x.key !== d.key));
                      }}
                      onDelete={async () => {
                        setDrafts(prev => prev.filter(x => x.key !== d.key));
                        if (isNewGroupPlaceholder) {
                          setCreatingGroupKey(undefined);
                          setNewGroupId("");
                        }
                      }}
                      onDuplicate={() => {
                        const cloneKey = `${d.key}-copy`;
                        setDrafts(prev => ([...prev, { key: cloneKey, groupId: d.groupId, offer: { ...d.offer, displayName: `${d.offer.displayName} Copy` } }]));
                      }}
                      onCreateNewItem={onCreateNewItem}
                      onOpenDetails={(o) => onOpenOfferDetails(o)}
                      onCancelDraft={() => {
                        setDrafts(prev => prev.filter(x => x.key !== d.key));
                        if (isNewGroupPlaceholder) {
                          setCreatingGroupKey(undefined);
                          setNewGroupId("");
                        }
                      }}
                    />
                  ))}
                  {!isNewGroupPlaceholder && (
                    <div className="self-stretch border border-dashed rounded-lg w-[150px] py-8 flex flex-col items-center justify-center bg-background">
                      <div className="flex flex-col items-center gap-2">
                        <Button
                          variant="outline"
                          className="h-10 w-10 rounded-full p-0"
                          onClick={() => {
                            const key = generateOfferId("offer");
                            const newOffer: Offer = {
                              displayName: 'New Offer',
                              customerType: activeType,
                              groupId: groupId || undefined,
                              isAddOnTo: false,
                              stackable: false,
                              prices: {},
                              includedItems: {},
                              serverOnly: false,
                              freeTrial: undefined,
                            };
                            setDrafts(prev => [...prev, { key, groupId, offer: newOffer }]);
                          }}
                        >
                          <Plus className="h-8 w-8" />
                        </Button>
                        Create offer
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        );
      })}
      {/* TODO: Add new catalog is temporarily disabled, uncomment this to enable it
      <div className="w-full h-40 flex items-center justify-center border border-dashed rounded-lg">
        <div className="flex flex-col items-center gap-2">
          <Button
            variant="outline"
            className="h-10 w-10 rounded-full p-0"
            disabled={!!creatingGroupKey}
            onClick={() => {
              const tempKey = `__new_catalog__${Date.now().toString(36).slice(2, 8)}`;
              setCreatingGroupKey(tempKey);
              setNewGroupId("");
              const draftKey = generateOfferId("offer");
              const newOffer: Offer = {
                displayName: 'New Offer',
                customerType: activeType,
                groupId: tempKey,
                isAddOnTo: false,
                stackable: false,
                prices: {},
                includedItems: {},
                serverOnly: false,
                freeTrial: undefined,
              };
              setDrafts(prev => [...prev, { key: draftKey, groupId: tempKey, offer: newOffer }]);
            }}
          >
            <Plus className="h-8 w-8" />
          </Button>
          Create catalog
        </div>
      </div>
      */}
    </div>
  );
}

function WelcomeScreen({ onCreateOffer }: { onCreateOffer: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center h-full px-4 py-12 max-w-3xl mx-auto">
      <IllustratedInfo
        illustration={(
          <div className="grid grid-cols-3 gap-2">
            {/* Simple pricing table representation */}
            <div className="bg-background rounded p-3 shadow-sm">
              <div className="h-2 bg-muted rounded mb-2"></div>
              <div className="h-8 bg-primary/20 rounded mb-2"></div>
              <div className="space-y-1">
                <div className="h-1.5 bg-muted rounded"></div>
                <div className="h-1.5 bg-muted rounded"></div>
                <div className="h-1.5 bg-muted rounded"></div>
              </div>
            </div>
            <div className="bg-background rounded p-3 shadow-sm border-2 border-primary">
              <div className="h-2 bg-muted rounded mb-2"></div>
              <div className="h-8 bg-primary/40 rounded mb-2"></div>
              <div className="space-y-1">
                <div className="h-1.5 bg-muted rounded"></div>
                <div className="h-1.5 bg-muted rounded"></div>
                <div className="h-1.5 bg-muted rounded"></div>
              </div>
            </div>
            <div className="bg-background rounded p-3 shadow-sm">
              <div className="h-2 bg-muted rounded mb-2"></div>
              <div className="h-8 bg-primary/20 rounded mb-2"></div>
              <div className="space-y-1">
                <div className="h-1.5 bg-muted rounded"></div>
                <div className="h-1.5 bg-muted rounded"></div>
                <div className="h-1.5 bg-muted rounded"></div>
              </div>
            </div>
          </div>
        )}
        title="Welcome to Payments!"
        description={[
          <>Stack Auth Payments is built on two primitives: offers and items.</>,
          <>Offers are what customers buy — the columns of your pricing table. Each offer has one or more prices and may or may not include items.</>,
          <>Items are what customers receive — the rows of your pricing table. A user can hold multiple of the same item. Items are powerful; they can unlock feature access, raise limits, or meter consumption for usage-based billing.</>,
          <>Create your first offer to get started!</>,
        ]}
      />
      <Button onClick={onCreateOffer}>
        <Plus className="h-4 w-4 mr-2" />
        Create Your First Offer
      </Button>
    </div>
  );
}

export default function PageClient({ onViewChange }: { onViewChange: (view: "list" | "catalogs") => void }) {
  const [showOfferDialog, setShowOfferDialog] = useState(false);
  const [editingOffer, setEditingOffer] = useState<Offer | null>(null);
  const [showItemDialog, setShowItemDialog] = useState(false);
  const [editingItem, setEditingItem] = useState<{ id: string, displayName: string, customerType: 'user' | 'team' | 'custom' } | null>(null);
  const stackAdminApp = useAdminApp();
  const project = stackAdminApp.useProject();
  const config = project.useConfig();
  const [shouldUseDummyData, setShouldUseDummyData] = useState(false);
  const switchId = useId();
  const paymentsConfig: CompleteConfig['payments'] = shouldUseDummyData ? (DUMMY_PAYMENTS_CONFIG as CompleteConfig['payments']) : config.payments;


  // Group offers by groupId and sort by customer type priority
  const groupedOffers = useMemo(() => {
    const groups = new Map<string | undefined, Array<{ id: string, offer: Offer }>>();

    // Group offers
    for (const [id, offer] of typedEntries(paymentsConfig.offers)) {
      const groupId = offer.groupId;
      if (!groups.has(groupId)) {
        groups.set(groupId, []);
      }
      groups.get(groupId)!.push({ id, offer });
    }

    // Sort offers within each group by customer type, then by ID
    const customerTypePriority = { user: 1, team: 2, custom: 3 };
    groups.forEach((offers) => {
      offers.sort((a, b) => {
        const priorityA = customerTypePriority[a.offer.customerType as keyof typeof customerTypePriority] || 4;
        const priorityB = customerTypePriority[b.offer.customerType as keyof typeof customerTypePriority] || 4;
        if (priorityA !== priorityB) {
          return priorityA - priorityB;
        }
        // If same customer type, sort addons last
        if (a.offer.isAddOnTo !== b.offer.isAddOnTo) {
          return a.offer.isAddOnTo ? 1 : -1;
        }
        // If same customer type and addons, sort by lowest price
        const getPricePriority = (offer: Offer) => {
          if (offer.prices === 'include-by-default') return 0;
          if (typeof offer.prices !== 'object') return 0;
          return Math.min(...Object.values(offer.prices).map(price => +(price.USD ?? Infinity)));
        };
        const priceA = getPricePriority(a.offer);
        const priceB = getPricePriority(b.offer);
        if (priceA !== priceB) {
          return priceA - priceB;
        }
        // Otherwise, sort by ID
        return stringCompare(a.id, b.id);
      });
    });

    // Sort groups by their predominant customer type
    const sortedGroups = new Map<string | undefined, Array<{ id: string, offer: Offer }>>();

    // Helper to get group priority
    const getGroupPriority = (groupId: string | undefined) => {
      if (!groupId) return 999; // Ungrouped always last

      const offers = groups.get(groupId) || [];
      if (offers.length === 0) return 999;

      // Get the most common customer type in the group
      const typeCounts = offers.reduce((acc, { offer }) => {
        const type = offer.customerType;
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
    sortedEntries.forEach(([groupId, offers]) => {
      sortedGroups.set(groupId, offers);
    });

    return sortedGroups;
  }, [paymentsConfig]);


  // Check if there are no offers and no items
  const hasNoOffersAndNoItems = Object.keys(paymentsConfig.offers).length === 0 && Object.keys(paymentsConfig.items).length === 0;

  // Handler for create offer button
  const handleCreateOffer = () => {
    setShowOfferDialog(true);
  };

  // Handler for create item button
  const handleCreateItem = () => {
    setShowItemDialog(true);
  };

  // Handler for saving offer
  const handleSaveOffer = async (offerId: string, offer: Offer) => {
    await project.updateConfig({ [`payments.offers.${offerId}`]: offer });
    setShowOfferDialog(false);
    toast({ title: editingOffer ? "Offer updated" : "Offer created" });
  };

  // Handler for saving item
  const handleSaveItem = async (item: { id: string, displayName: string, customerType: 'user' | 'team' | 'custom' }) => {
    await project.updateConfig({ [`payments.items.${item.id}`]: { displayName: item.displayName, customerType: item.customerType } });
    setShowItemDialog(false);
    setEditingItem(null);
    toast({ title: editingItem ? "Item updated" : "Item created" });
  };

  // Prepare data for offer dialog - update when items change
  const existingOffersList = typedEntries(paymentsConfig.offers).map(([id, offer]) => ({
    id,
    displayName: offer.displayName,
    groupId: offer.groupId,
    customerType: offer.customerType
  }));

  const existingItemsList = typedEntries(paymentsConfig.items).map(([id, item]) => ({
    id,
    displayName: item.displayName,
    customerType: item.customerType
  }));

  const handleInlineSaveOffer = async (offerId: string, offer: Offer) => {
    await project.updateConfig({ [`payments.offers.${offerId}`]: offer });
    toast({ title: "Offer updated" });
  };

  const handleDeleteOffer = async (offerId: string) => {
    await project.updateConfig({ [`payments.offers.${offerId}`]: null });
    toast({ title: "Offer deleted" });
  };


  // If no offers and items, show welcome screen instead of everything
  const innerContent = (
    <PageLayout
      title='Offer'
      actions={
        <div className="flex items-center gap-2 self-center">
          <Label htmlFor={switchId}>Pricing table</Label>
          <Switch id={switchId} checked={false} onCheckedChange={() => onViewChange("list")} />
          <Label htmlFor={switchId}>List</Label>
        </div>
      }
    >
      <div className="flex-1">
        <CatalogView
          groupedOffers={groupedOffers}
          groups={paymentsConfig.groups}
          existingItems={existingItemsList}
          onSaveOffer={handleInlineSaveOffer}
          onDeleteOffer={handleDeleteOffer}
          onCreateNewItem={handleCreateItem}
          onOpenOfferDetails={(offer) => {
            setEditingOffer(offer);
            setShowOfferDialog(true);
          }}
          onSaveOfferWithGroup={async (groupId, offerId, offer) => {
            await project.updateConfig({
              [`payments.groups.${groupId}`]: {},
              [`payments.offers.${offerId}`]: offer,
            });
            toast({ title: "Offer created" });
          }}
        />
      </div>
    </PageLayout>
  );

  return (
    <>
      {innerContent}

      {/* Offer Dialog */}
      <OfferDialog
        open={showOfferDialog}
        onOpenChange={(open) => {
          setShowOfferDialog(open);
          if (!open) {
            setEditingOffer(null);
          }
        }}
        onSave={async (offerId, offer) => await handleSaveOffer(offerId, offer)}
        editingOffer={editingOffer ?? undefined}
        existingOffers={existingOffersList}
        existingGroups={Object.fromEntries(Object.entries(paymentsConfig.groups).map(([id, g]) => [id, { displayName: g.displayName || id }]))}
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
          }
        }}
        onSave={async (item) => await handleSaveItem(item)}
        editingItem={editingItem ?? undefined}
        existingItemIds={Object.keys(paymentsConfig.items)}
      />
    </>
  );
}
