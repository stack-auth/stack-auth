"use client";

import { ItemDialog } from "@/components/payments/item-dialog";
import { cn } from "@/lib/utils";
import { CompleteConfig } from "@stackframe/stack-shared/dist/config/schema";
import { useHover } from "@stackframe/stack-shared/dist/hooks/use-hover";
import { DayInterval } from "@stackframe/stack-shared/dist/utils/dates";
import { prettyPrintWithMagnitudes } from "@stackframe/stack-shared/dist/utils/numbers";
import { typedEntries, typedFromEntries } from "@stackframe/stack-shared/dist/utils/objects";
import { stringCompare } from "@stackframe/stack-shared/dist/utils/strings";
import { Button, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger, toast } from "@stackframe/stack-ui";
import { MoreVertical, Plus } from "lucide-react";
import React, { ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { IllustratedInfo } from "../../../../../../../components/illustrated-info";
import { useAdminApp } from "../../use-admin-app";
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
            "h-7 w-7 p-0 rounded-lg",
            "text-muted-foreground hover:text-foreground",
            "hover:bg-foreground/[0.05]",
            "transition-all duration-150 hover:transition-none",
            "opacity-0 group-hover:opacity-100",
            isOpen && "opacity-100 bg-foreground/[0.05]"
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
        "px-4 py-3.5 cursor-pointer relative rounded-xl mx-3 my-1",
        "flex items-center justify-between gap-3 group",
        "transition-all duration-150 hover:transition-none",
        "bg-background/50 dark:bg-foreground/[0.02]",
        "border border-transparent",
        isHighlighted
          ? "bg-cyan-500/[0.1] dark:bg-cyan-500/[0.08] border-cyan-500/30 shadow-sm"
          : "hover:bg-background dark:hover:bg-foreground/[0.04] hover:border-border/40 dark:hover:border-foreground/[0.08] hover:shadow-sm",
        isHighlighted && isHovered && "bg-cyan-500/[0.15] dark:bg-cyan-500/[0.12]"
      )}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <span className="uppercase font-semibold tracking-wide">{customerType}</span>
          <span className="text-muted-foreground/50">—</span>
          <span className="font-mono truncate">{id}</span>
        </div>
        <div className="font-semibold text-sm mt-1 text-foreground truncate">
          {displayName || id}
        </div>
        {subtitle && (
          <div className="text-xs text-muted-foreground mt-0.5 tabular-nums">
            {subtitle}
          </div>
        )}
      </div>
      {actionItems && (
        <div
          className="shrink-0"
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
    <div className="mb-2">
      {title && (
        <div className="sticky top-0 z-[1] px-4 py-2.5 bg-gray-100/90 dark:bg-foreground/[0.04] backdrop-blur-sm border-b border-border/30 dark:border-foreground/[0.06]">
          <h3 className="text-xs font-bold uppercase tracking-wider text-foreground/70">
            {title}
          </h3>
        </div>
      )}
      <div className="py-2">
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
      <defs>
        <linearGradient id="lineGradient" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="hsl(200, 91%, 70%)" stopOpacity="0.4" />
          <stop offset="100%" stopColor="hsl(200, 91%, 70%)" stopOpacity="0.4" />
        </linearGradient>
      </defs>
      <g>
        <path
          d={path}
          fill="none"
          stroke="url(#lineGradient)"
          strokeWidth="2"
          strokeDasharray="6 4"
          strokeLinecap="round"
        />
        {quantity && quantity > 0 && midpoint && (
          <>
            <circle
              cx={midpoint.x}
              cy={midpoint.y}
              r="14"
              className="fill-background"
              stroke="hsl(200, 91%, 70%)"
              strokeWidth="1"
              strokeOpacity="0.3"
            />
            <text
              x={midpoint.x}
              y={midpoint.y}
              textAnchor="middle"
              dominantBaseline="middle"
              className="text-[11px] font-semibold"
              fill="hsl(200, 91%, 70%)"
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
                            const config = project.useConfig();
                            const updatedProducts = typedFromEntries(
                              typedEntries(config.payments.products)
                                .filter(([productId]) => productId !== id)
                            );
                            await project.updateConfig({ "payments.products": updatedProducts });
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
          <>Stack Auth Payments is built on two primitives: products and items.</>,
          <>Products are what customers buy — the columns of your pricing table. Each product has one or more prices and may or may not include items.</>,
          <>Items are what customers receive — the rows of your pricing table. A user can hold multiple of the same item. Items are powerful; they can unlock feature access, raise limits, or meter consumption for usage-based billing.</>,
          <>Create your first product to get started!</>,
        ]}
      />
      <Button onClick={onCreateProduct}>
        <Plus className="h-4 w-4 mr-2" />
        Create Your First Product
      </Button>
    </div>
  );
}

export default function PageClient() {
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
  const paymentsConfig = config.payments;

  // Refs for products and items
  const containerRef = useRef<HTMLDivElement>(null);

  // Create refs for all products and items
  const productRefs = useMemo(() => {
    const refs = Object.fromEntries(
      Object.entries(paymentsConfig.products)
        .filter(([, product]) => product != null)
        .map(([id]) => [id, React.createRef<HTMLDivElement>()])
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

    // Group products (filter out null/undefined products that may occur during deletion)
    Object.entries(paymentsConfig.products).forEach(([id, product]: [string, any]) => {
      if (!product) return; // Skip deleted/null products
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

  const innerContent = (
    <>
      {/* Mobile tabs */}
      <div className="lg:hidden mb-4">
        <div className="inline-flex items-center gap-1 rounded-xl bg-foreground/[0.04] p-1 backdrop-blur-sm">
          <button
            onClick={() => setActiveTab("products")}
            className={cn(
              "px-4 py-2 text-sm font-medium rounded-lg transition-all duration-150 hover:transition-none",
              activeTab === "products"
                ? "bg-background text-foreground shadow-sm ring-1 ring-foreground/[0.06]"
                : "text-muted-foreground hover:text-foreground hover:bg-background/50"
            )}
          >
            Products
          </button>
          <button
            onClick={() => setActiveTab("items")}
            className={cn(
              "px-4 py-2 text-sm font-medium rounded-lg transition-all duration-150 hover:transition-none",
              activeTab === "items"
                ? "bg-background text-foreground shadow-sm ring-1 ring-foreground/[0.06]"
                : "text-muted-foreground hover:text-foreground hover:bg-background/50"
            )}
          >
            Items
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex gap-6 flex-1 min-h-0 overflow-auto">
        {/* Desktop two-column layout */}
        <div
          ref={containerRef}
          className={cn(
            "hidden lg:flex w-full relative rounded-2xl overflow-hidden",
            "bg-gray-100/80 dark:bg-foreground/[0.03]",
            "border border-border/40 dark:border-foreground/[0.08]",
            "shadow-sm backdrop-blur-xl"
          )}
        >
          <div className="flex-1 min-w-0">
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
          <div className="w-px bg-border/60 dark:bg-foreground/[0.1]" />
          <div className="flex-1 min-w-0">
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
        </div>

        {/* Mobile single column with tabs */}
        <div className={cn(
          "lg:hidden w-full rounded-2xl overflow-hidden",
          "bg-gray-100/80 dark:bg-foreground/[0.03]",
          "border border-border/40 dark:border-foreground/[0.08]",
          "shadow-sm backdrop-blur-xl"
        )}>
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
        </div>
      </div>
    </>
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
