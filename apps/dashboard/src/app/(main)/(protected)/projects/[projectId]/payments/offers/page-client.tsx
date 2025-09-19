"use client";

import { cn } from "@/lib/utils";
import { CompleteConfig } from "@stackframe/stack-shared/dist/config/schema";
import { userSpecifiedIdSchema } from "@stackframe/stack-shared/dist/schema-fields";
import type { DayInterval } from "@stackframe/stack-shared/dist/utils/dates";
import { prettyPrintWithMagnitudes } from "@stackframe/stack-shared/dist/utils/numbers";
import { typedEntries } from "@stackframe/stack-shared/dist/utils/objects";
import { stringCompare } from "@stackframe/stack-shared/dist/utils/strings";
import {
  ActionDialog,
  Button,
  Checkbox,
  Input,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SimpleTooltip,
  toast
} from "@stackframe/stack-ui";
import { Copy, Pencil, Plus, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
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
        <div className="text-xs px-2 py-0.5 rounded bg-muted text-muted-foreground cursor-pointer select-none">
          {triggerLabel}
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
  const [localPriceId, setLocalPriceId] = useState<string>(priceId);
  const [intervalSelection, setIntervalSelection] = useState<'one-time' | 'custom' | DayInterval[1]>(
    price.interval ? (price.interval[0] === 1 ? price.interval[1] : 'custom') : 'one-time'
  );

  useEffect(() => {
    if (isEditing) return;
    setAmount(price.USD || '0.00');
    setPriceInterval(price.interval?.[1]);
    setIntervalCount(price.interval?.[0] || 1);
    setIntervalSelection(price.interval ? (price.interval[0] === 1 ? price.interval[1] : 'custom') : 'one-time');
  }, [price, isEditing]);

  useEffect(() => {
    setLocalPriceId(priceId);
  }, [priceId]);

  useEffect(() => {
    if (!readOnly && startEditing) setIsEditing(true);
    if (readOnly) setIsEditing(false);
  }, [startEditing, readOnly]);


  const intervalText = intervalLabel(price.interval);

  return (
    <div className={cn("flex items-center gap-2 rounded-md px-2 py-1")}>
      {isEditing ? (
        <>
          <div className="relative w-20 shrink-0">
            <span className="pointer-events-none absolute left-1.5 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
            <Input
              className="h-8 pl-4 w-full text-sm bg-transparent tabular-nums"
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

          <div className="relative w-24 shrink-0">
            <Input
              className="h-8 w-full text-right bg-transparent shadow-none font-mono text-xs"
              tabIndex={0}
              value={localPriceId}
              readOnly={false}
              placeholder="price-id"
              aria-label="Price ID"
              onChange={(e) => {
                const v = e.target.value;
                if (!readOnly && (v === '' || userSpecifiedIdSchema('priceId').isValidSync(v))) setLocalPriceId(v);
              }}
              onBlur={() => {
                if (readOnly) return;
                const trimmed = localPriceId.trim();
                if (trimmed === '' || trimmed === priceId) {
                  setLocalPriceId(priceId);
                  return;
                }
                if (existingPriceIds.includes(trimmed)) {
                  toast({ title: "Price ID already exists" });
                  setLocalPriceId(priceId);
                  return;
                }
                if (/^[a-z0-9-]+$/.test(trimmed)) {
                  onSave(trimmed, price);
                } else {
                  setLocalPriceId(priceId);
                }
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  (e.target as HTMLInputElement).blur();
                } else if (e.key === 'Escape') {
                  setLocalPriceId(priceId);
                  (e.target as HTMLInputElement).blur();
                }
              }}
            />
          </div>

          {onRemove && (
            <button className="text-destructive ml-1" onClick={onRemove} aria-label="Remove price">
              <Trash2 className="h-4 w-4" />
            </button>
          )}
        </>
      ) : (
        <>
          <div className="flex items-baseline gap-2">
            <div className="text-xl font-semibold tabular-nums">${amount || '0.00'}</div>
            {intervalText && (
              <div className="text-xs px-2 py-0.5 rounded bg-muted text-muted-foreground">{intervalText}</div>
            )}
          </div>

          <div className="ml-auto text-xs text-muted-foreground font-mono">{localPriceId}</div>
        </>
      )}
    </div>
  );
}

function OfferItemRow({
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

  return (
    <div className="flex items-center justify-center">
      {isEditing ? (
        <Popover open={itemSelectOpen} onOpenChange={setItemSelectOpen}>
          <PopoverTrigger>
            <div className="text-sm px-2 py-0.5 rounded bg-muted hover:bg-muted/70 cursor-pointer select-none">
              {itemDisplayName}
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
      ) : (
        <div className="text-sm">{itemDisplayName}</div>
      )}
      {isEditing ? (
        <>
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
            <button className="text-destructive ml-auto" onClick={onRemove} aria-label="Remove item">
              <Trash2 className="h-4 w-4" />
            </button>
          )}
        </>
      ) : (
        <>
          <div className="ml-auto w-16 text-right text-sm text-muted-foreground tabular-nums">{prettyPrintWithMagnitudes(item.quantity)}</div>
          <div className="ml-2">
            {repeatText && (
              <div className="text-xs px-2 py-0.5 rounded bg-muted text-muted-foreground">{repeatText}</div>
            )}
          </div>
          {!readOnly && (
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
          )}
        </>
      )}
    </div>
  );
}


type OfferCardProps = {
  id: string,
  offer: Offer,
  existingItems: Array<{ id: string, displayName: string, customerType: string }>,
  onSave: (id: string, offer: Offer) => Promise<void>,
  onDelete: (id: string) => Promise<void>,
  onDuplicate: (offer: Offer) => void,
  onCreateNewItem: () => void,
  onOpenDetails: (offer: Offer) => void,
  isDraft?: boolean,
  onCancelDraft?: () => void,
};

function OfferCard({ id, offer, existingItems, onSave, onDelete, onDuplicate, onCreateNewItem, onOpenDetails, isDraft, onCancelDraft }: OfferCardProps) {
  const [isEditing, setIsEditing] = useState(!!isDraft);
  const [draft, setDraft] = useState<Offer>(offer);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [editingPriceId, setEditingPriceId] = useState<string | undefined>(undefined);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const [hasAutoScrolled, setHasAutoScrolled] = useState(false);

  useEffect(() => {
    setDraft(offer);
  }, [offer]);

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
        <div className="text-2xl font-semibold">Free</div>
      );
    }
    const entries = Object.entries(pricesObject);
    if (entries.length === 0) {
      return (
        <div className="text-muted-foreground">No prices yet</div>
      );
    }
    return (
      <div className="space-y-2 shrink-0">
        {entries.map(([pid, price]) => (
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
        ))}
      </div>
    );
  };

  const itemsList = Object.entries(draft.includedItems);

  return (
    <div ref={cardRef} className={cn(
      "rounded-lg border bg-background w-[320px] flex flex-col relative group shrink-0 pb-4",
      isEditing && "border-foreground/60 dark:border-foreground/40"
    )}>
      <div className="p-4 flex items-start justify-between">
        <div>
          {isEditing ? (
            <Input
              className="h-8 text-sm font-semibold"
              value={draft.displayName || ""}
              onChange={(e) => setDraft(prev => ({ ...prev, displayName: e.target.value }))}
              placeholder={id}
            />
          ) : (
            <div className="text-sm font-semibold">{offer.displayName || id}</div>
          )}
        </div>
        <div className="flex items-center gap-2 min-w-[124px] justify-end">
          {isEditing ? (
            <>
              <SimpleTooltip tooltip={saveDisabledReason} disabled={canSaveOffer}>
                <Button size="sm" variant="outline" onClick={async () => {
                  await onSave(id, draft);
                  setIsEditing(false);
                  setEditingPriceId(undefined);
                }} disabled={!canSaveOffer}>
                  Save
                </Button>
              </SimpleTooltip>
              <button
                className="h-7 w-7 inline-flex items-center justify-center rounded hover:bg-muted"
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
              </button>
            </>
          ) : (
            <div className="h-8" />
          )}
        </div>
        {!isEditing && (
          <div className="absolute top-4 right-4 opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1">
            <button
              className="h-7 w-7 inline-flex items-center justify-center rounded hover:bg-muted"
              onClick={() => { onDuplicate(offer); }}
              aria-label="Duplicate"
            >
              <Copy className="h-4 w-4" />
            </button>
            <button
              className="h-7 w-7 inline-flex items-center justify-center rounded hover:bg-muted"
              onClick={() => {
                setIsEditing(true);
                setDraft(offer);
              }}
              aria-label="Edit"
            >
              <Pencil className="h-4 w-4" />
            </button>
            <button
              className="h-7 w-7 inline-flex items-center justify-center rounded hover:bg-muted text-destructive"
              onClick={() => { setShowDeleteDialog(true); }}
              aria-label="Delete"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>
      <div className="px-4 pb-2">
        {renderPrimaryPrices()}
      </div>
      {isEditing && (
        <div className="px-4 pb-2">
          {Object.keys(pricesObject).length === 0 && (
            <div className="mb-2 flex items-center gap-2">
              <Checkbox
                id={`include-by-default-${id}`}
                checked={draft.prices === 'include-by-default'}
                onClick={() => {
                  setDraft(prev => ({
                    ...prev,
                    prices: prev.prices === 'include-by-default' ? {} : 'include-by-default',
                  }));
                }}
              />
              <label htmlFor={`include-by-default-${id}`} className="text-sm">Include by default</label>
            </div>
          )}
          <Button
            variant="outline"
            size="sm"
            disabled={draft.prices === 'include-by-default'}
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
        </div>
      )}
      <div className="px-4 py-3">
        {itemsList.length === 0 ? (
          <div className="text-sm text-muted-foreground">No items yet</div>
        ) : (
          <div className="space-y-2">
            {itemsList.map(([itemId, item]) => {
              const itemMeta = existingItems.find(i => i.id === itemId);
              const itemLabel = itemMeta ? (itemMeta.displayName || itemMeta.id) : 'Select item';
              return (
                <OfferItemRow
                  key={itemId}
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
      {isEditing && (
        <div className="px-4 pb-4">
          <Button variant="outline" size="sm" onClick={() => {
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
    </div>
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
    return new Set(all);
  }, [groupedOffers]);

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
      <div className="flex items-center justify-between">
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
              {t}
            </button>
          ))}
        </div>
        <div className="flex items-center justify-end">
          <Button
            variant="outline"
            size="sm"
            disabled={!!creatingGroupKey}
            onClick={() => {
              const tempKey = `__new_catalog__${Date.now().toString(36).slice(2, 8)}`;
              setCreatingGroupKey(tempKey);
              setNewGroupId("");
              const draftKey = `__draft__${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
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
            <Plus className="h-4 w-4 mr-2" /> New Catalog
          </Button>
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
            <div className="relative rounded-xl bg-muted/70">
              <div className="flex gap-4 justify-start overflow-x-auto p-4 min-h-20 pr-16">
                <div className="flex max-w-max mx-auto gap-4">
                  {offers.map(({ id, offer }) => (
                    <OfferCard
                      key={id}
                      id={id}
                      offer={offer}
                      existingItems={existingItems}
                      onSave={onSaveOffer}
                      onDelete={onDeleteOffer}
                      onDuplicate={(srcOffer) => {
                        const key = `__draft__${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
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
                      offer={d.offer}
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
                    <button
                      className="rounded-full h-9 w-9 flex items-center justify-center absolute right-4 top-1/2 -translate-y-1/2 bg-background border hover:bg-muted"
                      onClick={() => {
                        const key = `__draft__${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
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
                      aria-label="Add offer"
                    >
                      <Plus className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        );
      })}
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

export default function PageClient() {
  const [showOfferDialog, setShowOfferDialog] = useState(false);
  const [editingOffer, setEditingOffer] = useState<Offer | null>(null);
  const [showItemDialog, setShowItemDialog] = useState(false);
  const [editingItem, setEditingItem] = useState<{ id: string, displayName: string, customerType: 'user' | 'team' | 'custom' } | null>(null);
  const stackAdminApp = useAdminApp();
  const project = stackAdminApp.useProject();
  const config = project.useConfig();
  const [shouldUseDummyData, setShouldUseDummyData] = useState(false);

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
    <PageLayout actions={process.env.NODE_ENV === "development" && (
      <div className="flex items-center gap-2">
        <Checkbox
          checked={shouldUseDummyData}
          onClick={() => setShouldUseDummyData(s => !s)}
          id="use-dummy-data"
        />
        <label htmlFor="use-dummy-data">
          [DEV] Use dummy data
        </label>
      </div>
    )}>
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
