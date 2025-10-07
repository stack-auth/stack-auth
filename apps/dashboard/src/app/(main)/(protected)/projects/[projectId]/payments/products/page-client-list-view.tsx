"use client";

import { cn } from "@/lib/utils";
import { CompleteConfig } from "@stackframe/stack-shared/dist/config/schema";
import { useHover } from "@stackframe/stack-shared/dist/hooks/use-hover";
import { DayInterval } from "@stackframe/stack-shared/dist/utils/dates";
import { prettyPrintWithMagnitudes } from "@stackframe/stack-shared/dist/utils/numbers";
import { stringCompare } from "@stackframe/stack-shared/dist/utils/strings";
import { Button, Card, CardContent, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger, Label, Separator, Switch, toast } from "@stackframe/stack-ui";
import { Check, ChevronLeft, ChevronRight, Layers, MoreVertical, Package, Plus, Sparkles } from "lucide-react";
import React, { ReactNode, useEffect, useId, useMemo, useRef, useState } from "react";
import { IllustratedInfo } from "../../../../../../../components/illustrated-info";
import { PageLayout } from "../../page-layout";
import { useAdminApp } from "../../use-admin-app";
import { ItemDialog } from "./item-dialog";
import { ListSection } from "./list-section";
import { ProductDialog } from "./product-dialog";

type Product = CompleteConfig['payments']['products'][keyof CompleteConfig['payments']['products']];
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

function formatPrice(price: (Product['prices'] & object)[string]): string | null {
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

function formatProductPrices(prices: Product['prices']): string {
  if (prices === 'include-by-default') return 'Free';
  if (typeof prices !== 'object') return '';

  const formattedPrices = Object.values(prices)
    .map(formatPrice)
    .filter(Boolean)
    .slice(0, 4); // Show max 4 prices

  return formattedPrices.join(', ');
}

// ProductsList component with props
type ProductsListProps = {
  groupedProducts: Map<string | undefined, Array<{ id: string, product: any }>>,
  paymentsGroups: any,
  hoveredItemId: string | null,
  getConnectedProducts: (itemId: string) => string[],
  productRefs?: Record<string, React.RefObject<HTMLDivElement>>,
  onProductMouseEnter: (productId: string) => void,
  onProductMouseLeave: () => void,
  onProductAdd?: () => void,
  setEditingProduct: (product: any) => void,
  setShowProductDialog: (show: boolean) => void,
};

function ProductsList({
  groupedProducts,
  paymentsGroups,
  hoveredItemId,
  getConnectedProducts,
  productRefs,
  onProductMouseEnter,
  onProductMouseLeave,
  onProductAdd,
  setEditingProduct,
  setShowProductDialog,
}: ProductsListProps) {
  const stackAdminApp = useAdminApp();
  const project = stackAdminApp.useProject();
  const [searchQuery, setSearchQuery] = useState("");
  let globalIndex = 0;

  // Filter products based on search query
  const filteredGroupedProducts = useMemo(() => {
    if (!searchQuery) return groupedProducts;

    const filtered = new Map<string | undefined, Array<{ id: string, product: any }>>();

    groupedProducts.forEach((products, catalogId) => {
      const filteredProducts = products.filter(({ id, product }) => {
        const query = searchQuery.toLowerCase();
        return (
          id.toLowerCase().includes(query) ||
          product.displayName?.toLowerCase().includes(query) ||
          product.customerType?.toLowerCase().includes(query)
        );
      });

      if (filteredProducts.length > 0) {
        filtered.set(catalogId, filteredProducts);
      }
    });

    return filtered;
  }, [groupedProducts, searchQuery]);

  return (
    <ListSection
      title={<>
        Products
      </>}
      titleTooltip="Products are the products, plans, or pricing tiers you sell to your customers. They are the columns in a pricing table."
      onAddClick={() => onProductAdd?.()}
      hasTitleBorder={false}
      searchValue={searchQuery}
      onSearchChange={setSearchQuery}
      searchPlaceholder="Search products..."
    >
      <GroupedList>
        {[...filteredGroupedProducts.entries()].map(([catalogId, products]) => {
          const group = catalogId ? paymentsGroups[catalogId] : undefined;
          const groupName = group?.displayName;

          return (
            <ListGroup key={catalogId || 'ungrouped'} title={catalogId ? (groupName || catalogId) : "Other"}>
              {products.map(({ id, product }) => {
                const isEven = globalIndex % 2 === 0;
                globalIndex++;
                const connectedItems = hoveredItemId ? getConnectedProducts(hoveredItemId) : [];
                const isHighlighted = hoveredItemId ? connectedItems.includes(id) : false;

                return (
                  <ListItem
                    key={id}
                    id={id}
                    displayName={product.displayName}
                    customerType={product.customerType}
                    subtitle={formatProductPrices(product.prices)}
                    isEven={isEven}
                    isHighlighted={isHighlighted}
                    itemRef={productRefs?.[id]}
                    onMouseEnter={() => onProductMouseEnter(id)}
                    onMouseLeave={onProductMouseLeave}
                    actionItems={[
                      {
                        item: "Edit",
                        onClick: () => {
                          setEditingProduct(product);
                          setShowProductDialog(true);
                        },
                      },
                      '-',
                      {
                        item: "Delete",
                        onClick: async () => {
                          if (confirm(`Are you sure you want to delete the product "${product.displayName}"?`)) {
                            await project.updateConfig({ [`payments.products.${id}`]: null });
                            toast({ title: "Product deleted" });
                          }
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
  hoveredProductId: string | null,
  getConnectedItems: (productId: string) => string[],
  itemRefs?: Record<string, React.RefObject<HTMLDivElement>>,
  onItemMouseEnter: (itemId: string) => void,
  onItemMouseLeave: () => void,
  onItemAdd?: () => void,
  setEditingItem: (item: any) => void,
  setShowItemDialog: (show: boolean) => void,
};

function ItemsList({
  items,
  hoveredProductId,
  getConnectedItems,
  itemRefs,
  onItemMouseEnter,
  onItemMouseLeave,
  onItemAdd,
  setEditingItem,
  setShowItemDialog,
}: ItemsListProps) {
  const stackAdminApp = useAdminApp();
  const project = stackAdminApp.useProject();
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
      onAddClick={() => onItemAdd?.()}
      searchValue={searchQuery}
      onSearchChange={setSearchQuery}
      searchPlaceholder="Search items..."
    >
      <GroupedList>
        {filteredItems.map(([id, item]: [string, any], index) => {
          const connectedProducts = hoveredProductId ? getConnectedItems(hoveredProductId) : [];
          const isHighlighted = hoveredProductId ? connectedProducts.includes(id) : false;

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
                    setEditingItem({
                      id,
                      displayName: item.displayName,
                      customerType: item.customerType
                    });
                    setShowItemDialog(true);
                  },
                },
                '-',
                {
                  item: "Delete",
                  onClick: async () => {
                    if (confirm(`Are you sure you want to delete the item "${item.displayName}"?`)) {
                      await project.updateConfig({ [`payments.items.${id}`]: null });
                      toast({ title: "Item deleted" });
                    }
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

function WelcomeScreen({ onCreateProduct }: { onCreateProduct: () => void }) {
  const [currentStep, setCurrentStep] = useState(0);

  const tutorialSteps = [
    {
      title: "Welcome to Stack Auth Payments",
      content: (
        <div className="space-y-4">
          <p className="text-muted-foreground">
            Build powerful billing systems with our two core primitives: <strong>Products</strong> and <strong>Items</strong>.
          </p>
          <div className="grid grid-cols-2 gap-4">
            <div className="p-4 border rounded-lg bg-muted/20">
              <h4 className="font-semibold mb-2 flex items-center gap-2">
                <Package className="h-4 w-4" />
                Products
              </h4>
              <p className="text-sm text-muted-foreground">
                What customers buy - the columns of your pricing table
              </p>
            </div>
            <div className="p-4 border rounded-lg bg-muted/20">
              <h4 className="font-semibold mb-2 flex items-center gap-2">
                <Layers className="h-4 w-4" />
                Items
              </h4>
              <p className="text-sm text-muted-foreground">
                What customers receive - the rows of your pricing table
              </p>
            </div>
          </div>
        </div>
      )
    },
    {
      title: "Understanding Products",
      content: (
        <div className="space-y-4">
          <p className="text-muted-foreground">
            Products represent your pricing plans (Free, Pro, Enterprise). Each product can:
          </p>
          <ul className="space-y-2">
            <li className="flex items-start gap-2">
              <Check className="h-4 w-4 mt-0.5 text-green-500" />
              <span className="text-sm">Have multiple price points (monthly/yearly)</span>
            </li>
            <li className="flex items-start gap-2">
              <Check className="h-4 w-4 mt-0.5 text-green-500" />
              <span className="text-sm">Include specific items for buyers</span>
            </li>
            <li className="flex items-start gap-2">
              <Check className="h-4 w-4 mt-0.5 text-green-500" />
              <span className="text-sm">Be assigned to users or teams</span>
            </li>
            <li className="flex items-start gap-2">
              <Check className="h-4 w-4 mt-0.5 text-green-500" />
              <span className="text-sm">Support add-ons and upgrades</span>
            </li>
          </ul>
        </div>
      )
    },
    {
      title: "Understanding Items",
      content: (
        <div className="space-y-4">
          <p className="text-muted-foreground">
            Items are the features and limits your customers get. Use them to:
          </p>
          <ul className="space-y-2">
            <li className="flex items-start gap-2">
              <Sparkles className="h-4 w-4 mt-0.5 text-yellow-500" />
              <span className="text-sm">Unlock feature access (e.g., "Advanced Analytics")</span>
            </li>
            <li className="flex items-start gap-2">
              <Sparkles className="h-4 w-4 mt-0.5 text-yellow-500" />
              <span className="text-sm">Set usage limits (e.g., "100 API calls/month")</span>
            </li>
            <li className="flex items-start gap-2">
              <Sparkles className="h-4 w-4 mt-0.5 text-yellow-500" />
              <span className="text-sm">Track consumption for usage-based billing</span>
            </li>
            <li className="flex items-start gap-2">
              <Sparkles className="h-4 w-4 mt-0.5 text-yellow-500" />
              <span className="text-sm">Stack multiple quantities (e.g., extra seats)</span>
            </li>
          </ul>
        </div>
      )
    },
    {
      title: "Example: SaaS Pricing Table",
      content: (
        <div className="space-y-4">
          <p className="text-muted-foreground text-sm mb-4">
            Here's how products and items work together in a typical pricing table:
          </p>
          <div className="border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/30">
                <tr>
                  <th className="text-left p-3 font-medium">Features</th>
                  <th className="text-center p-3 font-medium">Free</th>
                  <th className="text-center p-3 font-medium bg-primary/10">Pro</th>
                  <th className="text-center p-3 font-medium">Enterprise</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-t">
                  <td className="p-3">API Calls</td>
                  <td className="text-center p-3 text-muted-foreground">100/mo</td>
                  <td className="text-center p-3 bg-primary/5">10,000/mo</td>
                  <td className="text-center p-3 text-muted-foreground">Unlimited</td>
                </tr>
                <tr className="border-t">
                  <td className="p-3">Team Members</td>
                  <td className="text-center p-3 text-muted-foreground">1</td>
                  <td className="text-center p-3 bg-primary/5">5</td>
                  <td className="text-center p-3 text-muted-foreground">Unlimited</td>
                </tr>
                <tr className="border-t">
                  <td className="p-3">Advanced Analytics</td>
                  <td className="text-center p-3 text-muted-foreground">-</td>
                  <td className="text-center p-3 bg-primary/5">✓</td>
                  <td className="text-center p-3 text-muted-foreground">✓</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="text-xs text-muted-foreground italic">
            Columns are products, rows are items
          </p>
        </div>
      )
    },
    {
      title: "Quick Start Guide",
      content: (
        <div className="space-y-4">
          <p className="text-muted-foreground">
            Follow these steps to set up your first pricing model:
          </p>
          <div className="space-y-3">
            <div className="flex gap-3">
              <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center text-sm font-semibold">
                1
              </div>
              <div>
                <p className="font-medium">Create your first product</p>
                <p className="text-sm text-muted-foreground">Start with a basic plan (e.g., "Free" or "Starter")</p>
              </div>
            </div>
            <div className="flex gap-3">
              <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center text-sm font-semibold">
                2
              </div>
              <div>
                <p className="font-medium">Define your items</p>
                <p className="text-sm text-muted-foreground">Add features and limits that products will include</p>
              </div>
            </div>
            <div className="flex gap-3">
              <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center text-sm font-semibold">
                3
              </div>
              <div>
                <p className="font-medium">Connect items to products</p>
                <p className="text-sm text-muted-foreground">Specify which items each product includes</p>
              </div>
            </div>
            <div className="flex gap-3">
              <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center text-sm font-semibold">
                4
              </div>
              <div>
                <p className="font-medium">Test and iterate</p>
                <p className="text-sm text-muted-foreground">Use test mode to verify your setup before going live</p>
              </div>
            </div>
          </div>
        </div>
      )
    }
  ];

  return (
    <div className="flex flex-col items-center justify-center h-full px-4 py-8 max-w-4xl mx-auto">
      {/* Progress indicator */}
      <div className="flex gap-2 mb-8">
        {tutorialSteps.map((_, index) => (
          <button
            key={index}
            onClick={() => setCurrentStep(index)}
            className={cn(
              "w-2 h-2 rounded-full transition-all",
              currentStep === index
                ? "w-8 bg-primary"
                : "bg-muted hover:bg-muted-foreground/30"
            )}
            aria-label={`Go to step ${index + 1}`}
          />
        ))}
      </div>

      {/* Tutorial content */}
      <div className="w-full max-w-2xl">
        <div className="text-center mb-6">
          <h2 className="text-2xl font-bold mb-2">
            {tutorialSteps[currentStep].title}
          </h2>
        </div>

        <div className="bg-background border rounded-lg p-6 shadow-sm">
          {tutorialSteps[currentStep].content}
        </div>

        {/* Navigation buttons */}
        <div className="flex justify-between items-center mt-6">
          <Button
            variant="outline"
            onClick={() => setCurrentStep(Math.max(0, currentStep - 1))}
            disabled={currentStep === 0}
          >
            <ChevronLeft className="h-4 w-4 mr-1" />
            Previous
          </Button>

          <span className="text-sm text-muted-foreground">
            Step {currentStep + 1} of {tutorialSteps.length}
          </span>

          {currentStep < tutorialSteps.length - 1 ? (
            <Button
              variant="outline"
              onClick={() => setCurrentStep(Math.min(tutorialSteps.length - 1, currentStep + 1))}
            >
              Next
              <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          ) : (
            <Button onClick={onCreateProduct}>
              <Plus className="h-4 w-4 mr-2" />
              Create Your First Product
            </Button>
          )}
        </div>
      </div>

      {/* Skip tutorial option */}
      <div className="mt-8">
        <Button
          variant="ghost"
          size="sm"
          onClick={onCreateProduct}
          className="text-muted-foreground hover:text-foreground"
        >
          Skip tutorial and create product
        </Button>
      </div>
    </div>
  );
}

export default function PageClient({ onViewChange }: { onViewChange: (view: "list" | "catalogs") => void }) {
  const [activeTab, setActiveTab] = useState<"products" | "items">("products");
  const [hoveredProductId, setHoveredProductId] = useState<string | null>(null);
  const [hoveredItemId, setHoveredItemId] = useState<string | null>(null);
  const [showProductDialog, setShowProductDialog] = useState(false);
  const [editingProduct, setEditingProduct] = useState<any>(null);
  const [showItemDialog, setShowItemDialog] = useState(false);
  const [editingItem, setEditingItem] = useState<any>(null);
  const stackAdminApp = useAdminApp();
  const project = stackAdminApp.useProject();
  const config = project.useConfig();
  const switchId = useId();
  const testModeSwitchId = useId();
  const [isUpdatingTestMode, setIsUpdatingTestMode] = useState(false);
  const paymentsConfig = config.payments;

  // Refs for products and items
  const containerRef = useRef<HTMLDivElement>(null);

  // Create refs for all products and items
  const productRefs = useMemo(() => {
    const refs = Object.fromEntries(
      Object.keys(paymentsConfig.products)
        .map(id => [id, React.createRef<HTMLDivElement>()])
    );
    return refs;
  }, [paymentsConfig.products]);

  const itemRefs = useMemo(() => {
    const refs = Object.fromEntries(
      Object.keys(paymentsConfig.items)
        .map(id => [id, React.createRef<HTMLDivElement>()])
    );
    return refs;
  }, [paymentsConfig.items]);

  // Group products by catalogId and sort by customer type priority
  const groupedProducts = useMemo(() => {
    const groups = new Map<string | undefined, Array<{ id: string, product: typeof paymentsConfig.products[keyof typeof paymentsConfig.products] }>>();

    // Group products
    Object.entries(paymentsConfig.products).forEach(([id, product]: [string, any]) => {
      const catalogId = product.catalogId;
      if (!groups.has(catalogId)) {
        groups.set(catalogId, []);
      }
      groups.get(catalogId)!.push({ id, product });
    });

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
  }, [paymentsConfig]);

  // Get connected items for an product
  const getConnectedItems = (productId: string) => {
    const product = paymentsConfig.products[productId];
    return Object.keys(product.includedItems);
  };

  // Get item quantity for an product
  const getItemQuantity = (productId: string, itemId: string) => {
    const product = paymentsConfig.products[productId];
    if (!(itemId in product.includedItems)) return 0;
    return product.includedItems[itemId].quantity;
  };

  // Get connected products for an item
  const getConnectedProducts = (itemId: string) => {
    return Object.entries(paymentsConfig.products)
      .filter(([_, product]: [string, any]) => itemId in product.includedItems)
      .map(([id]) => id);
  };

  // Check if there are no products and no items
  const hasNoProductsAndNoItems = Object.keys(paymentsConfig.products).length === 0 && Object.keys(paymentsConfig.items).length === 0;

  // Handler for create product button
  const handleCreateProduct = () => {
    setShowProductDialog(true);
  };

  // Handler for create item button
  const handleCreateItem = () => {
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
  };

  const handleToggleTestMode = async (enabled: boolean) => {
    setIsUpdatingTestMode(true);
    try {
      await project.updateConfig({ "payments.testMode": enabled });
      toast({ title: enabled ? "Test mode enabled" : "Test mode disabled" });
    } catch (_error) {
      toast({ title: "Failed to update test mode", variant: "destructive" });
    } finally {
      setIsUpdatingTestMode(false);
    }
  };

  // Prepare data for product dialog - update when items change
  const existingProductsList = Object.entries(paymentsConfig.products).map(([id, product]: [string, any]) => ({
    id,
    displayName: product.displayName,
    catalogId: product.catalogId,
    customerType: product.customerType
  }));

  const existingItemsList = Object.entries(paymentsConfig.items).map(([id, item]: [string, any]) => ({
    id,
    displayName: item.displayName,
    customerType: item.customerType
  }));

  // If no products and items, show welcome screen instead of everything
  let innerContent;
  if (hasNoProductsAndNoItems) {
    innerContent = <WelcomeScreen onCreateProduct={handleCreateProduct} />;
  } else {
    innerContent = (
      <PageLayout
        title="Products"
        actions={
          <div className="flex items-center gap-4 self-center">
            <div className="flex items-center gap-2">
              <Label htmlFor={switchId}>Pricing table</Label>
              <Switch id={switchId} checked={true} onCheckedChange={() => onViewChange("catalogs")} />
              <Label htmlFor={switchId}>List</Label>
            </div>
            <Separator orientation="vertical" className="h-6" />
            <div className="flex items-center gap-2">
              <Label htmlFor={testModeSwitchId}>Test mode</Label>
              <Switch
                id={testModeSwitchId}
                checked={paymentsConfig.testMode === true}
                disabled={isUpdatingTestMode}
                onCheckedChange={(checked) => void handleToggleTestMode(checked)}
              />
            </div>
          </div>
        }
      >
        {/* Mobile tabs */}
        < div className="lg:hidden mb-4" >
          <div className="flex space-x-1 bg-muted p-1 rounded-md">
            <button
              onClick={() => setActiveTab("products")}
              className={cn(
                "flex-1 px-3 py-2 rounded-sm text-sm font-medium transition-all",
                activeTab === "products"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              Products
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
        </div >

        {/* Content */}
        < div className="flex gap-6 flex-1" style={{
          flexBasis: "0px",
          overflow: "scroll",
        }
        }>
          {/* Desktop two-column layout */}
          < Card className="hidden lg:flex w-full relative" ref={containerRef} >
            <CardContent className="flex w-full">
              <div className="flex-1">
                <ProductsList
                  groupedProducts={groupedProducts}
                  paymentsGroups={paymentsConfig.catalogs}
                  hoveredItemId={hoveredItemId}
                  getConnectedProducts={getConnectedProducts}
                  productRefs={productRefs}
                  onProductMouseEnter={setHoveredProductId}
                  onProductMouseLeave={() => setHoveredProductId(null)}
                  onProductAdd={handleCreateProduct}
                  setEditingProduct={setEditingProduct}
                  setShowProductDialog={setShowProductDialog}
                />
              </div>
            </CardContent>
            <div className="border-l" />
            <CardContent className="flex gap-6 w-full">
              <div className="flex-1">
                <ItemsList
                  items={paymentsConfig.items}
                  hoveredProductId={hoveredProductId}
                  getConnectedItems={getConnectedItems}
                  itemRefs={itemRefs}
                  onItemMouseEnter={setHoveredItemId}
                  onItemMouseLeave={() => setHoveredItemId(null)}
                  onItemAdd={handleCreateItem}
                  setEditingItem={setEditingItem}
                  setShowItemDialog={setShowItemDialog}
                />
              </div>
            </CardContent>

            {/* Connection lines */}
            {
              hoveredProductId && getConnectedItems(hoveredProductId).map(itemId => (
                <ConnectionLine
                  key={`${hoveredProductId}-${itemId}`}
                  fromRef={productRefs[hoveredProductId]}
                  toRef={itemRefs[itemId]}
                  containerRef={containerRef}
                  quantity={getItemQuantity(hoveredProductId, itemId)}
                />
              ))
            }

            {
              hoveredItemId && getConnectedProducts(hoveredItemId).map(productId => (
                <ConnectionLine
                  key={`${productId}-${hoveredItemId}`}
                  fromRef={productRefs[productId]}
                  toRef={itemRefs[hoveredItemId]}
                  containerRef={containerRef}
                  quantity={getItemQuantity(productId, hoveredItemId)}
                />
              ))
            }
          </Card >

          {/* Mobile single column with tabs */}
          < div className="lg:hidden w-full" >
            {activeTab === "products" ? (
              <ProductsList
                groupedProducts={groupedProducts}
                paymentsGroups={paymentsConfig.catalogs}
                hoveredItemId={hoveredItemId}
                getConnectedProducts={getConnectedProducts}
                onProductMouseEnter={setHoveredProductId}
                onProductMouseLeave={() => setHoveredProductId(null)}
                onProductAdd={handleCreateProduct}
                setEditingProduct={setEditingProduct}
                setShowProductDialog={setShowProductDialog}
              />
            ) : (
              <ItemsList
                items={paymentsConfig.items}
                hoveredProductId={hoveredProductId}
                getConnectedItems={getConnectedItems}
                onItemMouseEnter={setHoveredItemId}
                onItemMouseLeave={() => setHoveredItemId(null)}
                onItemAdd={handleCreateItem}
                setEditingItem={setEditingItem}
                setShowItemDialog={setShowItemDialog}
              />
            )}
          </div >
        </div >
      </PageLayout >
    );
  }

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
        editingProduct={editingProduct}
        existingProducts={existingProductsList}
        existingCatalogs={paymentsConfig.catalogs}
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
        editingItem={editingItem}
        existingItemIds={Object.keys(paymentsConfig.items)}
      />
    </>
  );
}
