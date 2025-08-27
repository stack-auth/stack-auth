"use client";

import { cn } from "@/lib/utils";
import { CompleteConfig } from "@stackframe/stack-shared/dist/config/schema";
import { useHover } from "@stackframe/stack-shared/dist/hooks/use-hover";
import { DayInterval } from "@stackframe/stack-shared/dist/utils/dates";
import { prettyPrintWithMagnitudes } from "@stackframe/stack-shared/dist/utils/numbers";
import { stringCompare } from "@stackframe/stack-shared/dist/utils/strings";
import { Button, Card, CardContent, Checkbox, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger, Input, SimpleTooltip } from "@stackframe/stack-ui";
import { MoreVertical, Plus, Search } from "lucide-react";
import React, { ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { IllustratedInfo } from "../../../../../../components/illustrated-info";
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
  title: React.ReactNode,
  titleTooltip?: string,
  onAddClick?: () => void,
  children: ReactNode,
  hasTitleBorder?: boolean,
  searchValue?: string,
  onSearchChange?: (value: string) => void,
  searchPlaceholder?: string,
};

function ListSection({
  title,
  titleTooltip,
  onAddClick,
  children,
  hasTitleBorder = true,
  searchValue,
  onSearchChange,
  searchPlaceholder = "Search..."
}: ListSectionProps) {
  const [isSearchFocused, setIsSearchFocused] = useState(false);

  return (
    <div className="flex flex-col h-full">
      <div className={cn("sticky top-0 z-10")}>
        <div className="flex items-center justify-between pl-3 pr-1 py-1">
          <div className="flex items-center">
            <h2 className="font-medium">{title}</h2>
            {titleTooltip && (
              <SimpleTooltip
                tooltip={titleTooltip}
                type="info"
                inline
                className="ml-2 mb-[2px] translate-y-[-1px]"
                disabled={!titleTooltip}
              />
            )}
          </div>
          {onSearchChange && (
            <div>
              <div className={cn(
              "relative transition-all",
              isSearchFocused ? "max-w-[200px]" : "max-w-[140px]"
            )}>
                <Search className={cn(
                "absolute left-2.5 text-muted-foreground transition-all duration-200",
                isSearchFocused ? "top-[6px] h-4 w-4" : "top-[6px] h-3 w-3.5"
              )} />
                <Input
                  type="text"
                  placeholder={searchPlaceholder}
                  value={searchValue || ''}
                  onChange={(e) => onSearchChange(e.target.value)}
                  onFocus={() => setIsSearchFocused(true)}
                  onBlur={() => setIsSearchFocused(false)}
                  className={cn(
                  "pl-8 bg-secondary/30 border-transparent focus:bg-secondary/50 transition-all duration-200",
                  isSearchFocused ? "h-7 text-sm" : "h-6 text-xs"
                )}
                />
              </div>
            </div>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0"
            onClick={onAddClick}
          >
            <Plus className="h-4 w-4" />
          </Button>
        </div>
        {hasTitleBorder && <div className="border-b" />}
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
  const itemRefBackup = useRef<HTMLDivElement>(null);
  itemRef ??= itemRefBackup;
  const [isMenuHovered, setIsMenuHovered] = useState(false);
  const isHovered = useHover(itemRef);

  return (
    <div
      ref={itemRef}
      className={cn(
        "px-3 py-3 cursor-pointer relative duration-200 hover:duration-0 hover:bg-primary/10 transition-colors flex items-center justify-between group",
        isHovered && "duration-0",
        isHighlighted && "bg-primary/10",
        !isMenuHovered && isHovered && "bg-primary/10",
        isMenuHovered && isHovered && "bg-primary/5",
        isHighlighted && !isMenuHovered && isHovered && "hover:bg-primary/20"
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
    <div className="mb-6 relative">
      {title && (
        <div className="sticky top-0 bg-muted backdrop-blur-lg px-3 py-2 border-t z-[1]">
          <h3 className="text-sm font-medium text-muted-foreground">
            {title}
          </h3>
        </div>
      )}
      <div className="absolute top-2 left-2 w-3 h-full border-l border-b rounded-bl-md">

      </div>
      <div className="pl-4">
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
      const fromX = fromRect.right - containerRect.left - 6;
      const toY = toRect.top - containerRect.top + toRect.height / 2;
      const toX = toRect.left - containerRect.left + 6;

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
  const [searchQuery, setSearchQuery] = useState("");
  let globalIndex = 0;

  // Filter offers based on search query
  const filteredGroupedOffers = useMemo(() => {
    if (!searchQuery) return groupedOffers;

    const filtered = new Map<string | undefined, Array<{ id: string, offer: any }>>();

    groupedOffers.forEach((offers, groupId) => {
      const filteredOffers = offers.filter(({ id, offer }) => {
        const query = searchQuery.toLowerCase();
        return (
          id.toLowerCase().includes(query) ||
          offer.displayName?.toLowerCase().includes(query) ||
          offer.customerType?.toLowerCase().includes(query)
        );
      });

      if (filteredOffers.length > 0) {
        filtered.set(groupId, filteredOffers);
      }
    });

    return filtered;
  }, [groupedOffers, searchQuery]);

  return (
    <ListSection
      title={<>
        Offers
      </>}
      titleTooltip="Offers are the products, plans, or pricing tiers you sell to your customers. They are the columns in a pricing table."
      onAddClick={() => {}}
      hasTitleBorder={false}
      searchValue={searchQuery}
      onSearchChange={setSearchQuery}
      searchPlaceholder="Search offers..."
    >
      <GroupedList>
        {[...filteredGroupedOffers.entries()].map(([groupId, offers]) => {
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
  const [searchQuery, setSearchQuery] = useState("");

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

  // Filter items based on search query
  const filteredItems = useMemo(() => {
    if (!searchQuery) return sortedItems;

    const query = searchQuery.toLowerCase();
    return sortedItems.filter(([id, item]) => {
      return (
        id.toLowerCase().includes(query) ||
        (item.displayName && item.displayName.toLowerCase().includes(query)) ||
        item.customerType.toLowerCase().includes(query)
      );
    });
  }, [sortedItems, searchQuery]);

  return (
    <ListSection
      title="Items"
      titleTooltip="Items are the features or services that your customers will receive from you. They are the rows in a pricing table."
      onAddClick={() => {}}
      searchValue={searchQuery}
      onSearchChange={setSearchQuery}
      searchPlaceholder="Search items..."
    >
      <GroupedList>
        {filteredItems.map(([id, item]: [string, any], index) => {
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

  // Check if there are no offers and no items
  const hasNoOffersAndNoItems = Object.keys(paymentsConfig.offers).length === 0 && Object.keys(paymentsConfig.items).length === 0;

  // Handler for create offer button
  const handleCreateOffer = () => {
    // TODO: Implement offer creation
    console.log("Create offer clicked");
  };

  // If no offers and items, show welcome screen instead of everything
  if (hasNoOffersAndNoItems) {
    return <WelcomeScreen onCreateOffer={handleCreateOffer} />;
  }

  return (
    <PageLayout title="Payments" actions={process.env.NODE_ENV === "development" && (
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
      <div className="lg:hidden mb-4">
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
      <div className="flex gap-6 flex-1" style={{
        flexBasis: "0px",
        overflow: "scroll",
      }}>
        {/* Desktop two-column layout */}
        <Card className="hidden lg:flex w-full relative" ref={containerRef}>
          <CardContent className="flex w-full">
            <div className="flex-1">
              <OffersList
                groupedOffers={groupedOffers}
                paymentsGroups={paymentsConfig.groups}
                hoveredItemId={hoveredItemId}
                getConnectedOffers={getConnectedOffers}
                offerRefs={offerRefs}
                onOfferMouseEnter={setHoveredOfferId}
                onOfferMouseLeave={() => setHoveredOfferId(null)}
              />
            </div>
          </CardContent>
          <div className="border-l" />
          <CardContent className="flex gap-6 w-full">
            <div className="flex-1">
              <ItemsList
                items={paymentsConfig.items}
                hoveredOfferId={hoveredOfferId}
                getConnectedItems={getConnectedItems}
                itemRefs={itemRefs}
                onItemMouseEnter={setHoveredItemId}
                onItemMouseLeave={() => setHoveredItemId(null)}
              />
            </div>
          </CardContent>

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
        </Card>

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
