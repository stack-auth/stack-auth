"use client";

import { cn } from "@/lib/utils";
import { CompleteConfig } from "@stackframe/stack-shared/dist/config/schema";
import { DayInterval } from "@stackframe/stack-shared/dist/utils/dates";
import { prettyPrintWithMagnitudes } from "@stackframe/stack-shared/dist/utils/numbers";
import { stringCompare } from "@stackframe/stack-shared/dist/utils/strings";
import { Button, Card, Checkbox, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@stackframe/stack-ui";
import { MoreVertical, Plus } from "lucide-react";
import React, { ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { PageLayout } from "../page-layout";
import { useAdminApp } from "../use-admin-app";
import { DUMMY_PAYMENTS_CONFIG } from "./dummy-data";

type Offer = CompleteConfig['payments']['offers'][keyof CompleteConfig['payments']['offers']];
type Item = CompleteConfig['payments']['items'][keyof CompleteConfig['payments']['items']];

// Custom action menu component
type ActionMenuItem = '-' | { item: React.ReactNode, onClick: () => void | Promise<void>, danger?: boolean };

function ActionMenu({ items }: { items: ActionMenuItem[] }) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <DropdownMenu open={isOpen} onOpenChange={setIsOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          className={cn(
            "h-8 w-8 p-0 relative",
            "hover:bg-secondary/80",
            isOpen && "bg-secondary/80"
          )}
        >
          <MoreVertical className="h-4 w-4" />
          <span className="sr-only">Open menu</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[150px]">
        {items.map((item, index) => {
          if (item === '-') {
            return <DropdownMenuSeparator key={index} />;
          }

          return (
            <DropdownMenuItem
              key={index}
              onClick={item.onClick}
              className={cn(item.danger && "text-destructive focus:text-destructive")}
            >
              {item.item}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

type ListSectionProps = {
  title: string,
  onAddClick?: () => void,
  children: ReactNode,
  hasTitleBorder?: boolean,
};

function ListSection({ title, onAddClick, children, hasTitleBorder = true }: ListSectionProps) {
  return (
    <div className="flex flex-col h-full">
      <div className={cn("sticky top-0 z-10 py-1", hasTitleBorder && "border-b")}>
        <div className="flex items-center justify-between pl-3 pr-1">
          <h2 className="font-medium">{title}</h2>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0"
            onClick={onAddClick}
          >
            <Plus className="h-4 w-4" />
          </Button>
        </div>
      </div>
      <div className="flex-1 overflow-auto">
        {children}
      </div>
    </div>
  );
}

type ListItemProps = {
  id: string,
  displayName?: string,
  customerType: string,
  subtitle?: ReactNode,
  onClick?: () => void,
  onMouseEnter?: () => void,
  onMouseLeave?: () => void,
  isEven?: boolean,
  isHighlighted?: boolean,
  itemRef?: React.RefObject<HTMLDivElement>,
  actionItems?: ActionMenuItem[],
};

function ListItem({
  id,
  displayName,
  customerType,
  subtitle,
  onClick,
  onMouseEnter,
  onMouseLeave,
  isEven,
  isHighlighted,
  itemRef,
  actionItems
}: ListItemProps) {
  const [isMenuHovered, setIsMenuHovered] = useState(false);

  return (
    <div
      ref={itemRef}
      className={cn(
        "px-3 py-3 cursor-pointer relative duration-200 hover:duration-0 transition-colors flex items-center justify-between group",
        isHighlighted && "bg-primary/10",
        !isMenuHovered && "hover:bg-primary/15",
        isMenuHovered && "hover:bg-primary/5",
        isHighlighted && !isMenuHovered && "hover:bg-primary/25"
      )}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <div className="flex-1">
        <div className="text-xs text-muted-foreground">
          <span className="uppercase font-medium">{customerType}</span>
          <span className="mx-1">—</span>
          <span className="font-mono">{id}</span>
        </div>
        <div className="font-medium text-sm mt-1">
          {displayName || id}
        </div>
        {subtitle && (
          <div className="text-xs text-muted-foreground mt-1">
            {subtitle}
          </div>
        )}
      </div>
      {actionItems && (
        <div
          onClick={(e) => e.stopPropagation()}
          onMouseEnter={() => setIsMenuHovered(true)}
          onMouseLeave={() => setIsMenuHovered(false)}
        >
          <ActionMenu items={actionItems} />
        </div>
      )}
    </div>
  );
}

type GroupedListProps = {
  children: ReactNode,
};

function GroupedList({ children }: GroupedListProps) {
  return <div>{children}</div>;
}

type ListGroupProps = {
  title?: string,
  children: ReactNode,
};

function ListGroup({ title, children }: ListGroupProps) {
  return (
    <div className="mb-4">
      {title && (
        <div className="sticky top-0 bg-muted/50 backdrop-blur px-3 py-2 border-t">
          <h3 className="text-sm font-medium text-muted-foreground">
            {title}
          </h3>
        </div>
      )}
      <div>
        {children}
      </div>
    </div>
  );
}

// Connection line component
type ConnectionLineProps = {
  fromRef: React.RefObject<HTMLDivElement>,
  toRef: React.RefObject<HTMLDivElement>,
  containerRef: React.RefObject<HTMLDivElement>,
  quantity?: number,
};

function ConnectionLine({ fromRef, toRef, containerRef, quantity }: ConnectionLineProps) {
  const [path, setPath] = useState<string>("");
  const [midpoint, setMidpoint] = useState<{ x: number, y: number } | null>(null);

  useEffect(() => {
    if (!fromRef.current || !toRef.current || !containerRef.current) return;

    const updatePath = () => {
      const container = containerRef.current;
      const from = fromRef.current;
      const to = toRef.current;

      if (!container || !from || !to) return;

      const containerRect = container.getBoundingClientRect();
      const fromRect = from.getBoundingClientRect();
      const toRect = to.getBoundingClientRect();

      // Calculate positions relative to container
      const fromY = fromRect.top - containerRect.top + fromRect.height / 2;
      const fromX = fromRect.right - containerRect.left;
      const toY = toRect.top - containerRect.top + toRect.height / 2;
      const toX = toRect.left - containerRect.left;

      // Create a curved path
      const midX = (fromX + toX) / 2;
      const midY = (fromY + toY) / 2;
      const pathStr = `M ${fromX} ${fromY} C ${midX} ${fromY}, ${midX} ${toY}, ${toX} ${toY}`;

      setPath(pathStr);
      setMidpoint({ x: midX, y: midY });
    };

    updatePath();
    window.addEventListener('resize', updatePath);
    window.addEventListener('scroll', updatePath, true);

    return () => {
      window.removeEventListener('resize', updatePath);
      window.removeEventListener('scroll', updatePath, true);
    };
  }, [fromRef, toRef, containerRef]);

  if (!path) return null;

  return (
    <svg
      className="absolute inset-0 pointer-events-none z-20"
      style={{ width: '100%', height: '100%' }}
    >
      <g>
        <path
          d={path}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className="text-primary/30"
          strokeDasharray="5 5"
        />
        {quantity && quantity > 0 && midpoint && (
          <>
            <circle
              cx={midpoint.x}
              cy={midpoint.y}
              r="12"
              className="fill-background"
              strokeWidth="0"
            />
            <text
              x={midpoint.x}
              y={midpoint.y}
              textAnchor="middle"
              dominantBaseline="middle"
              className="text-xs font-medium fill-primary/50"
            >
              ×{prettyPrintWithMagnitudes(quantity)}
            </text>
          </>
        )}
      </g>
    </svg>
  );
}

// Price formatting utilities
function formatInterval(interval: DayInterval): string {
  const [count, unit] = interval;
  const unitShort = unit === 'month' ? 'mo' : unit === 'year' ? 'yr' : unit === 'week' ? 'wk' : unit;
  return count > 1 ? `${count}${unitShort}` : unitShort;
}

function formatPrice(price: (Offer['prices'] & object)[string]): string | null {
  if (typeof price === 'string') return null;

  const amounts = [];
  const interval = price.interval;

  // Check for USD amounts
  if (price.USD) {
    const amount = `$${(+price.USD).toFixed(2).replace(/\.00$/, '')}`;
    if (interval) {
      amounts.push(`${amount}/${formatInterval(interval)}`);
    } else {
      amounts.push(amount);
    }
  }

  return amounts.join(', ') || null;
}

function formatOfferPrices(prices: Offer['prices']): string {
  if (prices === 'include-by-default') return 'Free';
  if (typeof prices !== 'object') return '';

  const formattedPrices = Object.values(prices)
    .map(formatPrice)
    .filter(Boolean)
    .slice(0, 4); // Show max 4 prices

  return formattedPrices.join(', ');
}

// OffersList component with props
type OffersListProps = {
  groupedOffers: Map<string | undefined, Array<{ id: string, offer: any }>>,
  paymentsGroups: any,
  hoveredItemId: string | null,
  getConnectedOffers: (itemId: string) => string[],
  offerRefs?: Record<string, React.RefObject<HTMLDivElement>>,
  onOfferMouseEnter: (offerId: string) => void,
  onOfferMouseLeave: () => void,
};

function OffersList({
  groupedOffers,
  paymentsGroups,
  hoveredItemId,
  getConnectedOffers,
  offerRefs,
  onOfferMouseEnter,
  onOfferMouseLeave,
}: OffersListProps) {
  let globalIndex = 0;

  return (
    <ListSection title="Offers" onAddClick={() => {}} hasTitleBorder={false}>
      <GroupedList>
        {[...groupedOffers.entries()].map(([groupId, offers]) => {
          const group = groupId ? paymentsGroups[groupId] : undefined;
          const groupName = group?.displayName;

          return (
            <ListGroup key={groupId || 'ungrouped'} title={groupId ? (groupName || groupId) : "Other"}>
              {offers.map(({ id, offer }) => {
                const isEven = globalIndex % 2 === 0;
                globalIndex++;
                const connectedItems = hoveredItemId ? getConnectedOffers(hoveredItemId) : [];
                const isHighlighted = hoveredItemId ? connectedItems.includes(id) : false;

                return (
                  <ListItem
                    key={id}
                    id={id}
                    displayName={offer.displayName}
                    customerType={offer.customerType}
                    subtitle={formatOfferPrices(offer.prices)}
                    isEven={isEven}
                    isHighlighted={isHighlighted}
                    itemRef={offerRefs?.[id]}
                    onMouseEnter={() => onOfferMouseEnter(id)}
                    onMouseLeave={onOfferMouseLeave}
                    actionItems={[
                      {
                        item: "Edit",
                        onClick: () => {
                          console.log("Edit offer", id);
                        },
                      },
                      {
                        item: "Duplicate",
                        onClick: () => {
                          console.log("Duplicate offer", id);
                        },
                      },
                      '-',
                      {
                        item: "Delete",
                        onClick: () => {
                          console.log("Delete offer", id);
                        },
                        danger: true,
                      },
                    ]}
                  />
                );
              })}
            </ListGroup>
          );
        })}
      </GroupedList>
    </ListSection>
  );
}

// ItemsList component with props
type ItemsListProps = {
  items: CompleteConfig['payments']['items'],
  hoveredOfferId: string | null,
  getConnectedItems: (offerId: string) => string[],
  itemRefs?: Record<string, React.RefObject<HTMLDivElement>>,
  onItemMouseEnter: (itemId: string) => void,
  onItemMouseLeave: () => void,
};

function ItemsList({
  items,
  hoveredOfferId,
  getConnectedItems,
  itemRefs,
  onItemMouseEnter,
  onItemMouseLeave,
}: ItemsListProps) {
  // Sort items by customer type, then by ID
  const sortedItems = useMemo(() => {
    const customerTypePriority = { user: 1, team: 2, custom: 3 };
    return Object.entries(items).sort(([aId, aItem]: [string, any], [bId, bItem]: [string, any]) => {
      const priorityA = customerTypePriority[aItem.customerType as keyof typeof customerTypePriority] || 4;
      const priorityB = customerTypePriority[bItem.customerType as keyof typeof customerTypePriority] || 4;
      if (priorityA !== priorityB) {
        return priorityA - priorityB;
      }
      // If same customer type, sort by ID
      return stringCompare(aId, bId);
    });
  }, [items]);

  return (
    <ListSection title="Items" onAddClick={() => {}}>
      <GroupedList>
        {sortedItems.map(([id, item]: [string, any], index) => {
          const connectedOffers = hoveredOfferId ? getConnectedItems(hoveredOfferId) : [];
          const isHighlighted = hoveredOfferId ? connectedOffers.includes(id) : false;

          return (
            <ListItem
              key={id}
              id={id}
              displayName={item.displayName}
              customerType={item.customerType}
              isEven={index % 2 === 0}
              isHighlighted={isHighlighted}
              itemRef={itemRefs?.[id]}
              onMouseEnter={() => onItemMouseEnter(id)}
              onMouseLeave={onItemMouseLeave}
              actionItems={[
                {
                  item: "Edit",
                  onClick: () => {
                    console.log("Edit item", id);
                  },
                },
                {
                  item: "Duplicate",
                  onClick: () => {
                    console.log("Duplicate item", id);
                  },
                },
                '-',
                {
                  item: "Delete",
                  onClick: () => {
                    console.log("Delete item", id);
                  },
                  danger: true,
                },
              ]}
            />
          );
        })}
      </GroupedList>
    </ListSection>
  );
}

export default function PageClient() {
  const [activeTab, setActiveTab] = useState<"offers" | "items">("offers");
  const [hoveredOfferId, setHoveredOfferId] = useState<string | null>(null);
  const [hoveredItemId, setHoveredItemId] = useState<string | null>(null);
  const stackAdminApp = useAdminApp();
  const project = stackAdminApp.useProject();
  const config = project.useConfig();
  const [shouldUseDummyData, setShouldUseDummyData] = useState(false);

  const paymentsConfig = shouldUseDummyData ? DUMMY_PAYMENTS_CONFIG : config.payments;

  // Refs for offers and items
  const containerRef = useRef<HTMLDivElement>(null);

  // Create refs for all offers and items
  const offerRefs = useMemo(() => {
    const refs = Object.fromEntries(
      Object.keys(paymentsConfig.offers)
        .map(id => [id, React.createRef<HTMLDivElement>()])
    );
    return refs;
  }, [paymentsConfig.offers]);

  const itemRefs = useMemo(() => {
    const refs = Object.fromEntries(
      Object.keys(paymentsConfig.items)
        .map(id => [id, React.createRef<HTMLDivElement>()])
    );
    return refs;
  }, [paymentsConfig.items]);

  // Group offers by groupId and sort by customer type priority
  const groupedOffers = useMemo(() => {
    const groups = new Map<string | undefined, Array<{ id: string, offer: typeof paymentsConfig.offers[keyof typeof paymentsConfig.offers] }>>();

    // Group offers
    Object.entries(paymentsConfig.offers).forEach(([id, offer]: [string, any]) => {
      const groupId = offer.groupId;
      if (!groups.has(groupId)) {
        groups.set(groupId, []);
      }
      groups.get(groupId)!.push({ id, offer });
    });

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

  // Get connected items for an offer
  const getConnectedItems = (offerId: string) => {
    const offer = paymentsConfig.offers[offerId];
    return Object.keys(offer.includedItems);
  };

  // Get item quantity for an offer
  const getItemQuantity = (offerId: string, itemId: string) => {
    const offer = paymentsConfig.offers[offerId];
    if (!(itemId in offer.includedItems)) return 0;
    return offer.includedItems[itemId].quantity;
  };

  // Get connected offers for an item
  const getConnectedOffers = (itemId: string) => {
    return Object.entries(paymentsConfig.offers)
      .filter(([_, offer]: [string, any]) => itemId in offer.includedItems)
      .map(([id]) => id);
  };

  console.log(groupedOffers);

  return (
    <PageLayout title="Payments" actions={(
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
      {/* Mobile tabs */}
      <div className="md:hidden mb-4">
        <div className="flex space-x-1 bg-muted p-1 rounded-md">
          <button
            onClick={() => setActiveTab("offers")}
            className={cn(
              "flex-1 px-3 py-2 rounded-sm text-sm font-medium transition-all",
              activeTab === "offers"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            Offers
          </button>
          <button
            onClick={() => setActiveTab("items")}
            className={cn(
              "flex-1 px-3 py-2 rounded-sm text-sm font-medium transition-all",
              activeTab === "items"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            Items
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex gap-6 flex-1">
        {/* Desktop two-column layout */}
        <div className="hidden lg:flex lg:gap-24 w-full relative" ref={containerRef}>
          <Card className="flex-1">
            <OffersList
              groupedOffers={groupedOffers}
              paymentsGroups={paymentsConfig.groups}
              hoveredItemId={hoveredItemId}
              getConnectedOffers={getConnectedOffers}
              offerRefs={offerRefs}
              onOfferMouseEnter={setHoveredOfferId}
              onOfferMouseLeave={() => setHoveredOfferId(null)}
            />
          </Card>
          <Card className="flex-1">
            <ItemsList
              items={paymentsConfig.items}
              hoveredOfferId={hoveredOfferId}
              getConnectedItems={getConnectedItems}
              itemRefs={itemRefs}
              onItemMouseEnter={setHoveredItemId}
              onItemMouseLeave={() => setHoveredItemId(null)}
            />
          </Card>

          {/* Connection lines */}
          {hoveredOfferId && getConnectedItems(hoveredOfferId).map(itemId => (
            <ConnectionLine
              key={`${hoveredOfferId}-${itemId}`}
              fromRef={offerRefs[hoveredOfferId]}
              toRef={itemRefs[itemId]}
              containerRef={containerRef}
              quantity={getItemQuantity(hoveredOfferId, itemId)}
            />
          ))}

          {hoveredItemId && getConnectedOffers(hoveredItemId).map(offerId => (
            <ConnectionLine
              key={`${offerId}-${hoveredItemId}`}
              fromRef={offerRefs[offerId]}
              toRef={itemRefs[hoveredItemId]}
              containerRef={containerRef}
              quantity={getItemQuantity(offerId, hoveredItemId)}
            />
          ))}
        </div>

        {/* Mobile single column with tabs */}
        <div className="lg:hidden w-full">
          {activeTab === "offers" ? (
            <OffersList
              groupedOffers={groupedOffers}
              paymentsGroups={paymentsConfig.groups}
              hoveredItemId={hoveredItemId}
              getConnectedOffers={getConnectedOffers}
              onOfferMouseEnter={setHoveredOfferId}
              onOfferMouseLeave={() => setHoveredOfferId(null)}
            />
          ) : (
            <ItemsList
              items={paymentsConfig.items}
              hoveredOfferId={hoveredOfferId}
              getConnectedItems={getConnectedItems}
              onItemMouseEnter={setHoveredItemId}
              onItemMouseLeave={() => setHoveredItemId(null)}
            />
          )}
        </div>
      </div>
    </PageLayout>
  );
}
