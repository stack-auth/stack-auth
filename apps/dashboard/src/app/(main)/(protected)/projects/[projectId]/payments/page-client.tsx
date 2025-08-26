"use client";

import { cn } from "@/lib/utils";
import { Button } from "@stackframe/stack-ui";
import { Plus } from "lucide-react";
import React, { ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { PageLayout } from "../page-layout";
import { useAdminApp } from "../use-admin-app";

type Interval = [number, 'day' | 'week' | 'month' | 'year'];

type ListSectionProps = {
  title: string,
  onAddClick?: () => void,
  children: ReactNode,
};

function ListSection({ title, onAddClick, children }: ListSectionProps) {
  return (
    <div className="flex flex-col h-full">
      <div className="sticky top-0 z-10 py-1 border-b">
        <div className="flex items-center justify-between text-muted-foreground pl-3 pr-1">
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
  itemRef
}: ListItemProps) {
  return (
    <div
      ref={itemRef}
      className={cn(
        "px-3 py-3 cursor-pointer hover:bg-muted/50 relative transition-colors duration-150",
        isHighlighted && "bg-primary/10 hover:bg-primary/20"
      )}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
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
    <div>
      {title && (
        <div className="sticky top-0 bg-muted/50 backdrop-blur px-3 py-2">
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
          className="text-primary/50"
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
              {quantity}x
            </text>
          </>
        )}
      </g>
    </svg>
  );
}

// Price formatting utilities
function formatInterval(interval: Interval): string {
  const [count, unit] = interval;
  const unitShort = unit === 'month' ? 'mo' : unit === 'year' ? 'yr' : unit === 'week' ? 'wk' : unit;
  return count > 1 ? `${count}${unitShort}` : unitShort;
}

function formatPrice(price: any): string | null {
  if (!price || typeof price === 'string') return null;

  const amounts = [];
  const interval = price.interval;

  // Check for USD amounts
  if (price.usd) {
    const amount = `$${(price.usd / 100).toFixed(2).replace(/\.00$/, '')}`;
    if (interval) {
      amounts.push(`${amount}/${formatInterval(interval)}`);
    } else {
      amounts.push(amount);
    }
  }

  return amounts.join(', ') || null;
}

function formatOfferPrices(prices: any): string {
  if (prices === 'include-by-default') return 'Free';
  if (!prices || typeof prices !== 'object') return '';

  const formattedPrices = Object.values(prices)
    .map(formatPrice)
    .filter(Boolean)
    .slice(0, 4); // Show max 4 prices

  return formattedPrices.join(', ');
}

export default function PageClient() {
  const [activeTab, setActiveTab] = useState<"offers" | "items">("offers");
  const [hoveredOfferId, setHoveredOfferId] = useState<string | null>(null);
  const [hoveredItemId, setHoveredItemId] = useState<string | null>(null);
  const stackAdminApp = useAdminApp();
  const project = stackAdminApp.useProject();
  const config = project.useConfig();
  const paymentsConfig = config.payments;

  // Refs for offers and items
  const containerRef = useRef<HTMLDivElement>(null);

  // Create refs for all offers and items
  const offerRefs = useMemo(() => {
    const refs: Record<string, React.RefObject<HTMLDivElement>> = {};
    Object.keys(paymentsConfig.offers).forEach(id => {
      refs[id] = React.createRef<HTMLDivElement>();
    });
    return refs;
  }, [paymentsConfig.offers]);

  const itemRefs = useMemo(() => {
    const refs: Record<string, React.RefObject<HTMLDivElement>> = {};
    Object.keys(paymentsConfig.items).forEach(id => {
      refs[id] = React.createRef<HTMLDivElement>();
    });
    return refs;
  }, [paymentsConfig.items]);

  // Group offers by groupId
  const groupedOffers = useMemo(() => {
    const groups = new Map<string | undefined, Array<{ id: string, offer: typeof paymentsConfig.offers[string] }>>();

    Object.entries(paymentsConfig.offers).forEach(([id, offer]) => {
      const groupId = offer.groupId;
      if (!groups.has(groupId)) {
        groups.set(groupId, []);
      }
      groups.get(groupId)!.push({ id, offer });
    });

    return groups;
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
      .filter(([_, offer]) => itemId in offer.includedItems)
      .map(([id]) => id);
  };

  const OffersList = () => {
    let globalIndex = 0;

    return (
      <ListSection title="Offers" onAddClick={() => {}}>
        <GroupedList>
          {Array.from(groupedOffers.entries()).map(([groupId, offers]) => {
            const group = groupId ? paymentsConfig.groups[groupId] : undefined;
            const groupName = group?.displayName;

            return (
              <ListGroup key={groupId || 'ungrouped'} title={groupId ? (groupName || groupId) : undefined}>
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
                      itemRef={offerRefs[id]}
                      onMouseEnter={() => setHoveredOfferId(id)}
                      onMouseLeave={() => setHoveredOfferId(null)}
                    />
                  );
                })}
              </ListGroup>
            );
          })}
        </GroupedList>
      </ListSection>
    );
  };

  const ItemsList = () => (
    <ListSection title="Items" onAddClick={() => {}}>
      <GroupedList>
        {Object.entries(paymentsConfig.items).map(([id, item], index) => {
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
              itemRef={itemRefs[id]}
              onMouseEnter={() => setHoveredItemId(id)}
              onMouseLeave={() => setHoveredItemId(null)}
            />
          );
        })}
      </GroupedList>
    </ListSection>
  );

  return (
    <PageLayout title="Payments">
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
        <div className="hidden md:flex md:gap-24 w-full relative border rounded-lg" ref={containerRef}>
          <div className="flex-1 border-r">
            <OffersList />
          </div>
          <div className="flex-1 border-l">
            <ItemsList />
          </div>

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
        <div className="md:hidden w-full">
          {activeTab === "offers" ? <OffersList /> : <ItemsList />}
        </div>
      </div>
    </PageLayout>
  );
}
