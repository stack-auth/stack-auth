import * as React from "react"
import { useEffect, useMemo, useState } from "react"
import { createFileRoute } from "@tanstack/react-router"
import { toast } from "sonner"
import {
  CubeIcon,
  DotsThreeVerticalIcon,
  PackageIcon,
  PencilSimpleIcon,
  PlusIcon,
  StackIcon,
  TagIcon,
  TrashIcon,
  XIcon,
} from "@phosphor-icons/react"
import {
  getUserSpecifiedIdErrorMessage,
  isValidUserSpecifiedId,
  sanitizeUserSpecifiedId,
} from "@stackframe/stack-shared/dist/schema-fields"

import {
  useAdminProject,
  useLoadedAdminProjectConfig,
  useStackAuthQueryInvalidation,
} from "@/lib/stack/react-query"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { ProjectPageMain } from "@/components/console/project-page"
import { cn } from "@/lib/utils"

export const Route = createFileRoute("/_app/projects/$projectId/payments/products")({
  component: ProductsPage,
})

// ──────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────

type IntervalUnit = "day" | "week" | "month" | "year"
type CustomerType = "user" | "team" | "custom"

type Price = {
  USD: string,
  serverOnly?: boolean,
  interval?: [number, IntervalUnit],
  freeTrial?: [number, IntervalUnit],
}

type IncludedItem = {
  quantity: number,
  repeat: [number, IntervalUnit] | "never",
  expires: "never" | "when-purchase-expires" | "when-repeated",
}

type Product = {
  displayName: string,
  customerType: CustomerType,
  productLineId?: string,
  isAddOn?: boolean,
  isAddOnTo?: Record<string, true>,
  stackable?: boolean,
  serverOnly?: boolean,
  prices: "include-by-default" | Record<string, Price>,
  includedItems: Record<string, IncludedItem>,
  freeTrial?: [number, IntervalUnit],
}

type Item = {
  displayName: string,
  customerType: CustomerType,
}

type ProductLine = {
  displayName: string,
}

type PaymentsConfig = {
  products?: Record<string, Product>,
  items?: Record<string, Item>,
  productLines?: Record<string, ProductLine>,
}

const INTERVAL_UNITS: Array<IntervalUnit> = ["day", "week", "month", "year"]
const PRICE_INTERVAL_UNITS: Array<IntervalUnit> = ["week", "month", "year"]

const CUSTOMER_TYPES: Array<{ value: CustomerType, label: string }> = [
  { value: "user", label: "User" },
  { value: "team", label: "Team" },
  { value: "custom", label: "Custom" },
]

const EXPIRES_OPTIONS: Array<{ value: IncludedItem["expires"], label: string }> = [
  { value: "never", label: "Never expires" },
  { value: "when-purchase-expires", label: "When purchase expires" },
  { value: "when-repeated", label: "When repeated" },
]

// ──────────────────────────────────────────────────────────────────────────
// Formatting helpers (inlined from dashboard's products/utils.ts)
// ──────────────────────────────────────────────────────────────────────────

function intervalLabel(tuple: [number, IntervalUnit] | undefined): string | null {
  if (!tuple) return null
  const [count, unit] = tuple
  if (count === 1) {
    return unit === "year" ? "yearly" : unit === "month" ? "monthly" : unit === "week" ? "weekly" : "daily"
  }
  return `Every ${count} ${unit}s`
}

function shortIntervalLabel(interval: [number, IntervalUnit] | "never"): string {
  if (interval === "never") return "once"
  const [count, unit] = interval
  const map: Record<IntervalUnit, string> = { day: "d", week: "wk", month: "mo", year: "yr" }
  return `/${count === 1 ? "" : count}${map[unit]}`
}

function freeTrialLabel(tuple: [number, IntervalUnit] | undefined): string | null {
  if (!tuple) return null
  const [count, unit] = tuple
  return `${count} ${count === 1 ? unit : unit + "s"}`
}

function formatPriceDisplay(price: Price): string {
  let display = `$${price.USD}`
  if (price.interval) {
    const [count, unit] = price.interval
    display += count === 1 ? ` / ${unit}` : ` / ${count} ${unit}s`
  }
  if (price.freeTrial) {
    const [count, unit] = price.freeTrial
    display += ` (${count} ${unit}${count > 1 ? "s" : ""} free)`
  }
  return display
}

// ──────────────────────────────────────────────────────────────────────────
// Page
// ──────────────────────────────────────────────────────────────────────────

function ProductsPage() {
  const project = useAdminProject()
  const config = useLoadedAdminProjectConfig(project) as { payments?: PaymentsConfig }
  const payments: PaymentsConfig = config.payments ?? {}
  const products: Record<string, Product> = payments.products ?? {}
  const items: Record<string, Item> = payments.items ?? {}
  const productLines: Record<string, ProductLine> = payments.productLines ?? {}

  const [productDialog, setProductDialog] = useState<{ mode: "create" } | { mode: "edit", id: string } | null>(null)
  const [itemDialog, setItemDialog] = useState<{ mode: "create" } | { mode: "edit", id: string } | null>(null)
  const [productLineDialog, setProductLineDialog] = useState<boolean>(false)
  const [deleteProduct, setDeleteProduct] = useState<string | null>(null)
  const [deleteItem, setDeleteItem] = useState<string | null>(null)
  const [section, setSection] = useState<"products" | "items">("products")

  const productCount = Object.keys(products).length
  const itemCount = Object.keys(items).length
  const isEmpty = productCount === 0 && itemCount === 0

  const itemUsage = useMemo(() => {
    const usage: Record<string, number> = {}
    for (const product of Object.values(products)) {
      for (const itemId of Object.keys(product.includedItems ?? {})) {
        usage[itemId] = (usage[itemId] ?? 0) + 1
      }
    }
    return usage
  }, [products])

  return (
    <ProjectPageMain className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-heading text-base font-semibold">Products & items</h1>
          <p className="text-xs text-muted-foreground">
            Define what customers can buy and what each purchase grants.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => setItemDialog({ mode: "create" })}>
            <TagIcon /> Add item
          </Button>
          <Button size="sm" onClick={() => setProductDialog({ mode: "create" })}>
            <PlusIcon /> Add product
          </Button>
        </div>
      </div>

      {isEmpty ? (
        <EmptyState
          onAddProduct={() => setProductDialog({ mode: "create" })}
          onAddItem={() => setItemDialog({ mode: "create" })}
        />
      ) : (
        <section className="rounded-lg border bg-card">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-4">
            <div className="flex items-center gap-1 rounded-md bg-muted/40 p-0.5 ring-1 ring-foreground/10">
              <button
                type="button"
                onClick={() => setSection("products")}
                className={cn(
                  "rounded-sm px-3 py-1 text-xs font-medium transition-colors",
                  section === "products"
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                Products
                <span className="ms-2 font-mono text-[10px] tracking-wider text-muted-foreground uppercase">
                  {productCount}
                </span>
              </button>
              <button
                type="button"
                onClick={() => setSection("items")}
                className={cn(
                  "rounded-sm px-3 py-1 text-xs font-medium transition-colors",
                  section === "items"
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                Items
                <span className="ms-2 font-mono text-[10px] tracking-wider text-muted-foreground uppercase">
                  {itemCount}
                </span>
              </button>
            </div>
            <Button size="sm" variant="ghost" onClick={() => setProductLineDialog(true)}>
              <StackIcon /> New product line
            </Button>
          </div>

          {section === "products" ? (
            <ProductsList
              products={products}
              onEdit={(id) => setProductDialog({ mode: "edit", id })}
              onDelete={(id) => setDeleteProduct(id)}
              onCreate={() => setProductDialog({ mode: "create" })}
            />
          ) : (
            <ItemsList
              items={items}
              usage={itemUsage}
              onEdit={(id) => setItemDialog({ mode: "edit", id })}
              onDelete={(id) => setDeleteItem(id)}
              onCreate={() => setItemDialog({ mode: "create" })}
            />
          )}
        </section>
      )}

      {productDialog != null ? (
        <ProductDialog
          mode={productDialog.mode}
          productId={productDialog.mode === "edit" ? productDialog.id : undefined}
          existing={productDialog.mode === "edit" ? products[productDialog.id] : undefined}
          allItems={items}
          allProductLines={productLines}
          allProducts={products}
          onClose={() => setProductDialog(null)}
        />
      ) : null}

      {itemDialog != null ? (
        <ItemDialog
          mode={itemDialog.mode}
          itemId={itemDialog.mode === "edit" ? itemDialog.id : undefined}
          existing={itemDialog.mode === "edit" ? items[itemDialog.id] : undefined}
          onClose={() => setItemDialog(null)}
        />
      ) : null}

      {productLineDialog ? (
        <ProductLineDialog
          existingIds={Object.keys(productLines)}
          onClose={() => setProductLineDialog(false)}
        />
      ) : null}

      <AlertDialog
        open={deleteProduct != null}
        onOpenChange={(o) => {
          if (!o) setDeleteProduct(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete product?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteProduct != null ? (
                <>
                  The product <span className="font-mono">{deleteProduct}</span> will be removed. Existing
                  customer subscriptions will not be cancelled but cannot renew.
                </>
              ) : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={async () => {
                const id = deleteProduct
                setDeleteProduct(null)
                if (id != null) {
                  await deleteRecord(project, "products", id, "Product")
                }
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={deleteItem != null}
        onOpenChange={(o) => {
          if (!o) setDeleteItem(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete item?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteItem != null ? (
                <>
                  The item <span className="font-mono">{deleteItem}</span> will be removed. Products
                  including this item will keep references but the item won&apos;t be granted to customers.
                </>
              ) : null}
              {deleteItem != null && (itemUsage[deleteItem] ?? 0) > 0 ? (
                <>
                  {" "}
                  Currently used by {itemUsage[deleteItem]} product
                  {itemUsage[deleteItem] === 1 ? "" : "s"}.
                </>
              ) : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={async () => {
                const id = deleteItem
                setDeleteItem(null)
                if (id != null) {
                  await deleteRecord(project, "items", id, "Item")
                }
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </ProjectPageMain>
  )
}

// ──────────────────────────────────────────────────────────────────────────
// Empty state
// ──────────────────────────────────────────────────────────────────────────

function EmptyState({
  onAddProduct,
  onAddItem,
}: {
  onAddProduct: () => void,
  onAddItem: () => void,
}) {
  return (
    <section className="rounded-lg border bg-card">
      <div className="flex flex-col items-center gap-4 px-6 py-16 text-center">
        <span className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <PackageIcon className="size-6" />
        </span>
        <div className="space-y-1">
          <h2 className="font-heading text-sm font-semibold">No products or items yet</h2>
          <p className="max-w-md text-xs text-muted-foreground">
            Items represent the things customers can use (credits, seats, features). Products bundle items
            and prices together for purchase.
          </p>
        </div>
        <div className="flex flex-wrap justify-center gap-2">
          <Button size="sm" variant="outline" onClick={onAddItem}>
            <TagIcon /> Add item
          </Button>
          <Button size="sm" onClick={onAddProduct}>
            <PlusIcon /> Add product
          </Button>
        </div>
      </div>
    </section>
  )
}

// ──────────────────────────────────────────────────────────────────────────
// Products list
// ──────────────────────────────────────────────────────────────────────────

function ProductsList({
  products,
  onEdit,
  onDelete,
  onCreate,
}: {
  products: Record<string, Product>,
  onEdit: (id: string) => void,
  onDelete: (id: string) => void,
  onCreate: () => void,
}) {
  const entries = Object.entries(products)
  if (entries.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 px-5 py-12 text-center">
        <span className="flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <PackageIcon className="size-5" />
        </span>
        <p className="text-xs text-muted-foreground">No products yet.</p>
        <Button size="sm" onClick={onCreate}>
          <PlusIcon /> Add product
        </Button>
      </div>
    )
  }

  return (
    <ul className="divide-y">
      {entries.map(([id, product]) => (
        <ProductRow
          key={id}
          id={id}
          product={product}
          onEdit={() => onEdit(id)}
          onDelete={() => onDelete(id)}
        />
      ))}
    </ul>
  )
}

function ProductRow({
  id,
  product,
  onEdit,
  onDelete,
}: {
  id: string,
  product: Product,
  onEdit: () => void,
  onDelete: () => void,
}) {
  const pricesSummary = useMemo(() => summarizePrices(product), [product])
  const includedCount = Object.keys(product.includedItems ?? {}).length
  return (
    <li className="flex items-start justify-between gap-4 px-5 py-4">
      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">{product.displayName}</span>
          <span className="font-mono text-[10px] tracking-wider text-muted-foreground uppercase">
            {id}
          </span>
          <Badge variant="secondary">{customerTypeLabel(product.customerType)}</Badge>
          {product.isAddOn ? <Badge variant="outline">Add-on</Badge> : null}
          {product.stackable ? <Badge variant="outline">Stackable</Badge> : null}
          {product.serverOnly ? <Badge variant="outline">Server only</Badge> : null}
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span className="tabular-nums">{pricesSummary}</span>
          <span>
            {includedCount} included {includedCount === 1 ? "item" : "items"}
          </span>
          {product.productLineId ? (
            <span className="font-mono text-[10px] tracking-wider uppercase">
              line: {product.productLineId}
            </span>
          ) : null}
        </div>
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label="Actions" />}>
          <DotsThreeVerticalIcon />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={onEdit}>
            <PencilSimpleIcon /> Edit
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onDelete} variant="destructive">
            <TrashIcon /> Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  )
}

function summarizePrices(product: Product): string {
  if (product.prices === "include-by-default") return "Free (included by default)"
  const prices = Object.values(product.prices)
  if (prices.length === 0) return "No prices"
  return prices.map((p) => `$${p.USD}${p.interval ? shortIntervalLabel(p.interval) : ""}`).join(" · ")
}

function customerTypeLabel(t: CustomerType): string {
  return CUSTOMER_TYPES.find((c) => c.value === t)?.label ?? t
}

// ──────────────────────────────────────────────────────────────────────────
// Items list
// ──────────────────────────────────────────────────────────────────────────

function ItemsList({
  items,
  usage,
  onEdit,
  onDelete,
  onCreate,
}: {
  items: Record<string, Item>,
  usage: Record<string, number>,
  onEdit: (id: string) => void,
  onDelete: (id: string) => void,
  onCreate: () => void,
}) {
  const entries = Object.entries(items)
  if (entries.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 px-5 py-12 text-center">
        <span className="flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <TagIcon className="size-5" />
        </span>
        <p className="text-xs text-muted-foreground">No items yet.</p>
        <Button size="sm" onClick={onCreate}>
          <PlusIcon /> Add item
        </Button>
      </div>
    )
  }

  return (
    <ul className="divide-y">
      {entries.map(([id, item]) => {
        const used = usage[id] ?? 0
        return (
          <li key={id} className="flex items-start justify-between gap-4 px-5 py-4">
            <div className="min-w-0 flex-1 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">{item.displayName}</span>
                <span className="font-mono text-[10px] tracking-wider text-muted-foreground uppercase">
                  {id}
                </span>
                <Badge variant="secondary">{customerTypeLabel(item.customerType)}</Badge>
              </div>
              <p className="text-xs text-muted-foreground">
                Used by {used} product{used === 1 ? "" : "s"}
              </p>
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label="Actions" />}>
                <DotsThreeVerticalIcon />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => onEdit(id)}>
                  <PencilSimpleIcon /> Edit
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onDelete(id)} variant="destructive">
                  <TrashIcon /> Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </li>
        )
      })}
    </ul>
  )
}

// ──────────────────────────────────────────────────────────────────────────
// Mutation helpers
// ──────────────────────────────────────────────────────────────────────────

async function deleteRecord(
  project: ReturnType<typeof useAdminProject>,
  kind: "products" | "items" | "productLines",
  id: string,
  label: string,
) {
  try {
    await project.updateConfig({ [`payments.${kind}.${id}`]: null })
    toast.success(`${label} deleted.`)
  } catch (err) {
    toast.error(err instanceof Error ? err.message : `Failed to delete ${label.toLowerCase()}.`)
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Product dialog
// ──────────────────────────────────────────────────────────────────────────

function ProductDialog({
  mode,
  productId,
  existing,
  allItems,
  allProductLines,
  allProducts,
  onClose,
}: {
  mode: "create" | "edit",
  productId?: string,
  existing?: Product,
  allItems: Record<string, Item>,
  allProductLines: Record<string, ProductLine>,
  allProducts: Record<string, Product>,
  onClose: () => void,
}) {
  const project = useAdminProject()
  const { invalidateProjectConfig } = useStackAuthQueryInvalidation()

  const [id, setId] = useState<string>(productId ?? "")
  const [displayName, setDisplayName] = useState<string>(existing?.displayName ?? "")
  const [customerType, setCustomerType] = useState<CustomerType>(existing?.customerType ?? "user")
  const [productLineId, setProductLineId] = useState<string>(existing?.productLineId ?? "")
  const [isAddOn, setIsAddOn] = useState<boolean>(Boolean(existing?.isAddOn))
  const [stackable, setStackable] = useState<boolean>(Boolean(existing?.stackable))
  const [serverOnly, setServerOnly] = useState<boolean>(Boolean(existing?.serverOnly))
  const [includeByDefault, setIncludeByDefault] = useState<boolean>(existing?.prices === "include-by-default")
  const [prices, setPrices] = useState<Record<string, Price>>(() => {
    if (!existing || existing.prices === "include-by-default") return {}
    return { ...existing.prices }
  })
  const [includedItems, setIncludedItems] = useState<Record<string, IncludedItem>>(
    () => ({ ...(existing?.includedItems ?? {}) }),
  )
  const [saving, setSaving] = useState(false)

  const [priceDialog, setPriceDialog] = useState<{ priceId?: string } | null>(null)
  const [includedDialog, setIncludedDialog] = useState<{ itemId?: string } | null>(null)

  const idError = useMemo(() => {
    if (mode === "edit") return null
    if (id.trim() === "") return null
    if (!isValidUserSpecifiedId(id)) return getUserSpecifiedIdErrorMessage("productId")
    if (allProducts[id] != null) return "A product with this ID already exists."
    return null
  }, [id, mode, allProducts])

  const canSave =
    displayName.trim() !== "" &&
    (mode === "edit" || (id.trim() !== "" && idError == null && isValidUserSpecifiedId(id))) &&
    (includeByDefault || Object.keys(prices).length > 0)

  const handleSave = async () => {
    if (!canSave) return
    setSaving(true)
    try {
      const finalId = mode === "edit" ? (productId as string) : id.trim()
      const product: Product = {
        displayName: displayName.trim(),
        customerType,
        prices: includeByDefault ? "include-by-default" : prices,
        includedItems,
        ...(productLineId !== "" ? { productLineId } : {}),
        ...(isAddOn ? { isAddOn: true } : {}),
        ...(stackable ? { stackable: true } : {}),
        ...(serverOnly ? { serverOnly: true } : {}),
      }
      await project.updateConfig({ [`payments.products.${finalId}`]: product })
      await invalidateProjectConfig(project.id)
      toast.success(mode === "edit" ? "Product updated." : "Product created.")
      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save product.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
        <DialogContent className="flex max-h-[90vh] flex-col gap-0 p-0 sm:max-w-2xl">
          <DialogHeader className="border-b px-5 py-4">
            <DialogTitle>{mode === "edit" ? "Edit product" : "Create product"}</DialogTitle>
            <DialogDescription>
              Define what customers buy, how they pay, and what they get.
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 space-y-6 overflow-y-auto px-5 py-5">
            <DialogSection title="General" subtitle="Identifying information for the product.">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="product-display-name" className="text-xs font-medium">
                    Display name
                  </Label>
                  <Input
                    id="product-display-name"
                    value={displayName}
                    onChange={(e) => {
                      const v = e.target.value
                      setDisplayName(v)
                      if (mode === "create" && id === "") {
                        setId(sanitizeUserSpecifiedId(v))
                      }
                    }}
                    placeholder="Pro plan"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="product-id" className="text-xs font-medium">
                    Product ID
                  </Label>
                  <Input
                    id="product-id"
                    value={id}
                    onChange={(e) => setId(e.target.value)}
                    placeholder="pro-plan"
                    disabled={mode === "edit"}
                    className="font-mono"
                  />
                  {idError ? (
                    <p className="text-[11px] text-destructive">{idError}</p>
                  ) : (
                    <p className="text-[11px] text-muted-foreground">
                      Used in URLs and SDK calls. Cannot be changed after creation.
                    </p>
                  )}
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="product-customer-type" className="text-xs font-medium">
                    Customer type
                  </Label>
                  <Select
                    value={customerType}
                    onValueChange={(v) => {
                      if (typeof v === "string") setCustomerType(v)
                    }}
                  >
                    <SelectTrigger id="product-customer-type" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CUSTOMER_TYPES.map((c) => (
                        <SelectItem key={c.value} value={c.value}>
                          {c.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="product-line" className="text-xs font-medium">
                    Product line
                  </Label>
                  <Select
                    value={productLineId === "" ? "__none" : productLineId}
                    onValueChange={(v) => {
                      if (typeof v !== "string") return
                      setProductLineId(v === "__none" ? "" : v)
                    }}
                  >
                    <SelectTrigger id="product-line" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none">No product line</SelectItem>
                      {Object.entries(allProductLines).map(([lineId, line]) => (
                        <SelectItem key={lineId} value={lineId}>
                          {line.displayName}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2 rounded-md border bg-muted/20 p-3">
                <ToggleRow
                  label="Add-on"
                  description="This product is sold alongside another product, not standalone."
                  checked={isAddOn}
                  onCheckedChange={setIsAddOn}
                />
                <ToggleRow
                  label="Stackable"
                  description="Customers can purchase this product multiple times concurrently."
                  checked={stackable}
                  onCheckedChange={setStackable}
                />
                <ToggleRow
                  label="Server only"
                  description="Hide from public client SDKs. Only purchasable via server-side API."
                  checked={serverOnly}
                  onCheckedChange={setServerOnly}
                />
              </div>
            </DialogSection>

            <DialogSection
              title="Prices"
              subtitle="At least one price, or grant by default."
              action={
                !includeByDefault ? (
                  <Button size="sm" variant="outline" onClick={() => setPriceDialog({})}>
                    <PlusIcon /> Add price
                  </Button>
                ) : null
              }
            >
              <ToggleRow
                label="Include by default"
                description="No purchase required. Every customer of the configured type gets this product automatically."
                checked={includeByDefault}
                onCheckedChange={setIncludeByDefault}
              />
              {!includeByDefault ? (
                Object.keys(prices).length === 0 ? (
                  <p className="rounded-md border border-dashed px-4 py-6 text-center text-xs text-muted-foreground">
                    No prices yet. Add at least one to allow purchasing.
                  </p>
                ) : (
                  <ul className="divide-y rounded-md border">
                    {Object.entries(prices).map(([priceId, price]) => (
                      <li
                        key={priceId}
                        className="flex items-center justify-between gap-3 px-3 py-2"
                      >
                        <div className="min-w-0 space-y-0.5">
                          <p className="text-sm tabular-nums">{formatPriceDisplay(price)}</p>
                          <p className="font-mono text-[10px] tracking-wider text-muted-foreground uppercase">
                            {priceId}
                            {price.serverOnly ? " · server only" : ""}
                          </p>
                        </div>
                        <div className="flex gap-1">
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            aria-label="Edit price"
                            onClick={() => setPriceDialog({ priceId })}
                          >
                            <PencilSimpleIcon />
                          </Button>
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            aria-label="Remove price"
                            onClick={() => {
                              setPrices((prev) => {
                                const copy = { ...prev }
                                delete copy[priceId]
                                return copy
                              })
                            }}
                          >
                            <XIcon />
                          </Button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )
              ) : null}
            </DialogSection>

            <DialogSection
              title="Included items"
              subtitle="What customers receive when they purchase or are granted this product."
              action={
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setIncludedDialog({})}
                  disabled={Object.keys(allItems).length === 0}
                >
                  <PlusIcon /> Add item
                </Button>
              }
            >
              {Object.keys(allItems).length === 0 ? (
                <p className="rounded-md border border-dashed px-4 py-6 text-center text-xs text-muted-foreground">
                  Create an item first, then attach it here.
                </p>
              ) : Object.keys(includedItems).length === 0 ? (
                <p className="rounded-md border border-dashed px-4 py-6 text-center text-xs text-muted-foreground">
                  No included items yet.
                </p>
              ) : (
                <ul className="divide-y rounded-md border">
                  {Object.entries(includedItems).map(([itemId, included]) => {
                    const item = allItems[itemId]
                    return (
                      <li
                        key={itemId}
                        className="flex items-center justify-between gap-3 px-3 py-2"
                      >
                        <div className="min-w-0 space-y-0.5">
                          <p className="text-sm">
                            <span className="font-medium">{item?.displayName ?? itemId}</span>
                            <span className="ms-2 tabular-nums text-muted-foreground">
                              × {included.quantity}
                            </span>
                          </p>
                          <p className="font-mono text-[10px] tracking-wider text-muted-foreground uppercase">
                            {itemId} · repeat {included.repeat === "never" ? "never" : intervalLabel(included.repeat)} · {included.expires}
                          </p>
                        </div>
                        <div className="flex gap-1">
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            aria-label="Edit included item"
                            onClick={() => setIncludedDialog({ itemId })}
                          >
                            <PencilSimpleIcon />
                          </Button>
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            aria-label="Remove included item"
                            onClick={() => {
                              setIncludedItems((prev) => {
                                const copy = { ...prev }
                                delete copy[itemId]
                                return copy
                              })
                            }}
                          >
                            <XIcon />
                          </Button>
                        </div>
                      </li>
                    )
                  })}
                </ul>
              )}
            </DialogSection>
          </div>

          <DialogFooter className="border-t px-5 py-3">
            <Button variant="outline" size="sm" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button size="sm" onClick={handleSave} disabled={!canSave || saving}>
              {saving ? "Saving…" : mode === "edit" ? "Save changes" : "Create product"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {priceDialog != null ? (
        <PriceDialog
          existingId={priceDialog.priceId}
          existing={priceDialog.priceId ? prices[priceDialog.priceId] : undefined}
          existingIds={Object.keys(prices)}
          onClose={() => setPriceDialog(null)}
          onSave={(priceId, price) => {
            setPrices((prev) => {
              const copy = { ...prev }
              if (priceDialog.priceId && priceDialog.priceId !== priceId) {
                delete copy[priceDialog.priceId]
              }
              copy[priceId] = price
              return copy
            })
            setPriceDialog(null)
          }}
        />
      ) : null}

      {includedDialog != null ? (
        <IncludedItemDialog
          allItems={allItems}
          existingItemId={includedDialog.itemId}
          existing={includedDialog.itemId ? includedItems[includedDialog.itemId] : undefined}
          excludeIds={Object.keys(includedItems).filter((x) => x !== includedDialog.itemId)}
          onClose={() => setIncludedDialog(null)}
          onSave={(itemId, included) => {
            setIncludedItems((prev) => {
              const copy = { ...prev }
              if (includedDialog.itemId && includedDialog.itemId !== itemId) {
                delete copy[includedDialog.itemId]
              }
              copy[itemId] = included
              return copy
            })
            setIncludedDialog(null)
          }}
        />
      ) : null}
    </>
  )
}

function DialogSection({
  title,
  subtitle,
  action,
  children,
}: {
  title: string,
  subtitle?: string,
  action?: React.ReactNode,
  children: React.ReactNode,
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-heading text-sm font-semibold">{title}</h2>
          {subtitle ? <p className="text-xs text-muted-foreground">{subtitle}</p> : null}
        </div>
        {action}
      </div>
      <div className="space-y-3">{children}</div>
    </section>
  )
}

function ToggleRow({
  label,
  description,
  checked,
  onCheckedChange,
}: {
  label: string,
  description: string,
  checked: boolean,
  onCheckedChange: (next: boolean) => void,
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-1">
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="text-xs font-medium">{label}</p>
        <p className="text-[11px] text-muted-foreground">{description}</p>
      </div>
      <Switch checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────────
// Price dialog
// ──────────────────────────────────────────────────────────────────────────

function PriceDialog({
  existingId,
  existing,
  existingIds,
  onClose,
  onSave,
}: {
  existingId?: string,
  existing?: Price,
  existingIds: Array<string>,
  onClose: () => void,
  onSave: (priceId: string, price: Price) => void,
}) {
  const [priceId, setPriceId] = useState<string>(existingId ?? "")
  const [amount, setAmount] = useState<string>(existing?.USD ?? "")
  const [serverOnly, setServerOnly] = useState<boolean>(Boolean(existing?.serverOnly))

  const [intervalEnabled, setIntervalEnabled] = useState<boolean>(existing?.interval != null)
  const [intervalCount, setIntervalCount] = useState<number>(existing?.interval?.[0] ?? 1)
  const [intervalUnit, setIntervalUnit] = useState<IntervalUnit>(existing?.interval?.[1] ?? "month")

  const [trialEnabled, setTrialEnabled] = useState<boolean>(existing?.freeTrial != null)
  const [trialCount, setTrialCount] = useState<number>(existing?.freeTrial?.[0] ?? 7)
  const [trialUnit, setTrialUnit] = useState<IntervalUnit>(existing?.freeTrial?.[1] ?? "day")

  const idError = useMemo(() => {
    if (priceId.trim() === "") return "ID is required."
    if (!isValidUserSpecifiedId(priceId)) return getUserSpecifiedIdErrorMessage("priceId")
    if (priceId !== existingId && existingIds.includes(priceId)) {
      return "A price with this ID already exists."
    }
    return null
  }, [priceId, existingId, existingIds])

  const amountError = useMemo(() => {
    if (amount.trim() === "") return "Amount is required."
    const num = parseFloat(amount)
    if (Number.isNaN(num) || num < 0) return "Amount must be a non-negative number."
    return null
  }, [amount])

  const canSave = idError == null && amountError == null

  const handleSave = () => {
    if (!canSave) return
    const num = parseFloat(amount)
    const price: Price = {
      USD: num.toFixed(2),
      ...(serverOnly ? { serverOnly: true } : {}),
      ...(intervalEnabled && intervalCount > 0
        ? { interval: [intervalCount, intervalUnit] as [number, IntervalUnit] }
        : {}),
      ...(trialEnabled && trialCount > 0
        ? { freeTrial: [trialCount, trialUnit] as [number, IntervalUnit] }
        : {}),
    }
    onSave(priceId.trim(), price)
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{existingId ? "Edit price" : "Add price"}</DialogTitle>
          <DialogDescription>
            All amounts are in USD. Recurring intervals create subscriptions.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="price-id" className="text-xs font-medium">Price ID</Label>
              <Input
                id="price-id"
                value={priceId}
                onChange={(e) => setPriceId(e.target.value)}
                placeholder="monthly"
                className="font-mono"
              />
              {idError && priceId !== "" ? (
                <p className="text-[11px] text-destructive">{idError}</p>
              ) : null}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="price-amount" className="text-xs font-medium">Amount (USD)</Label>
              <Input
                id="price-amount"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="9.99"
                inputMode="decimal"
                className="tabular-nums"
              />
              {amountError && amount !== "" ? (
                <p className="text-[11px] text-destructive">{amountError}</p>
              ) : null}
            </div>
          </div>

          <ToggleRow
            label="Server only"
            description="Only chargeable via server-side API. Hidden from client SDKs."
            checked={serverOnly}
            onCheckedChange={setServerOnly}
          />

          <div className="rounded-md border p-3">
            <ToggleRow
              label="Recurring"
              description="Charge on a recurring schedule."
              checked={intervalEnabled}
              onCheckedChange={setIntervalEnabled}
            />
            {intervalEnabled ? (
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="price-interval-count" className="text-xs font-medium">Every</Label>
                  <Input
                    id="price-interval-count"
                    type="number"
                    min={1}
                    value={intervalCount}
                    onChange={(e) => setIntervalCount(Math.max(1, parseInt(e.target.value || "1", 10)))}
                    className="tabular-nums"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="price-interval-unit" className="text-xs font-medium">Unit</Label>
                  <Select
                    value={intervalUnit}
                    onValueChange={(v) => {
                      if (typeof v === "string") setIntervalUnit(v)
                    }}
                  >
                    <SelectTrigger id="price-interval-unit" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PRICE_INTERVAL_UNITS.map((u) => (
                        <SelectItem key={u} value={u}>
                          {u}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            ) : null}
          </div>

          <div className="rounded-md border p-3">
            <ToggleRow
              label="Free trial"
              description="Customers are not charged until the trial ends."
              checked={trialEnabled}
              onCheckedChange={setTrialEnabled}
            />
            {trialEnabled ? (
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="trial-count" className="text-xs font-medium">Length</Label>
                  <Input
                    id="trial-count"
                    type="number"
                    min={1}
                    value={trialCount}
                    onChange={(e) => setTrialCount(Math.max(1, parseInt(e.target.value || "1", 10)))}
                    className="tabular-nums"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="trial-unit" className="text-xs font-medium">Unit</Label>
                  <Select
                    value={trialUnit}
                    onValueChange={(v) => {
                      if (typeof v === "string") setTrialUnit(v)
                    }}
                  >
                    <SelectTrigger id="trial-unit" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {INTERVAL_UNITS.map((u) => (
                        <SelectItem key={u} value={u}>
                          {u}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            ) : null}
            {trialEnabled ? (
              <p className="mt-2 text-[11px] text-muted-foreground">
                Trial: {freeTrialLabel([trialCount, trialUnit])}
              </p>
            ) : null}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" onClick={handleSave} disabled={!canSave}>
            {existingId ? "Save price" : "Add price"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ──────────────────────────────────────────────────────────────────────────
// Included item dialog
// ──────────────────────────────────────────────────────────────────────────

function IncludedItemDialog({
  allItems,
  existingItemId,
  existing,
  excludeIds,
  onClose,
  onSave,
}: {
  allItems: Record<string, Item>,
  existingItemId?: string,
  existing?: IncludedItem,
  excludeIds: Array<string>,
  onClose: () => void,
  onSave: (itemId: string, included: IncludedItem) => void,
}) {
  const availableItems = useMemo(
    () => Object.entries(allItems).filter(([id]) => !excludeIds.includes(id)),
    [allItems, excludeIds],
  )

  const [itemId, setItemId] = useState<string>(existingItemId ?? availableItems[0]?.[0] ?? "")
  const [quantity, setQuantity] = useState<number>(existing?.quantity ?? 1)
  const [repeatEnabled, setRepeatEnabled] = useState<boolean>(
    existing != null && existing.repeat !== "never",
  )
  const initialRepeat = existing?.repeat !== "never" && existing?.repeat ? existing.repeat : null
  const [repeatCount, setRepeatCount] = useState<number>(initialRepeat?.[0] ?? 1)
  const [repeatUnit, setRepeatUnit] = useState<IntervalUnit>(initialRepeat?.[1] ?? "month")
  const [expires, setExpires] = useState<IncludedItem["expires"]>(existing?.expires ?? "never")

  useEffect(() => {
    if (itemId === "" && availableItems.length > 0) setItemId(availableItems[0][0])
  }, [itemId, availableItems])

  const canSave = itemId !== "" && quantity > 0

  const handleSave = () => {
    if (!canSave) return
    const included: IncludedItem = {
      quantity,
      repeat: repeatEnabled
        ? ([repeatCount, repeatUnit] as [number, IntervalUnit])
        : "never",
      expires,
    }
    onSave(itemId, included)
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{existingItemId ? "Edit included item" : "Add included item"}</DialogTitle>
          <DialogDescription>
            Choose an item and how much of it is granted with this product.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="included-item-id" className="text-xs font-medium">Item</Label>
            <Select
              value={itemId}
              onValueChange={(v) => {
                if (typeof v === "string") setItemId(v)
              }}
            >
              <SelectTrigger id="included-item-id" className="w-full">
                <SelectValue placeholder="Select an item" />
              </SelectTrigger>
              <SelectContent>
                {existingItemId && allItems[existingItemId] ? (
                  <SelectItem value={existingItemId}>
                    {allItems[existingItemId].displayName}
                  </SelectItem>
                ) : null}
                {availableItems.map(([id, item]) => (
                  <SelectItem key={id} value={id}>
                    {item.displayName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="included-quantity" className="text-xs font-medium">Quantity</Label>
            <Input
              id="included-quantity"
              type="number"
              min={1}
              value={quantity}
              onChange={(e) => setQuantity(Math.max(1, parseInt(e.target.value || "1", 10)))}
              className="tabular-nums"
            />
          </div>

          <div className="rounded-md border p-3">
            <ToggleRow
              label="Repeat grant"
              description="Re-grant the quantity on a recurring schedule (e.g. monthly credits)."
              checked={repeatEnabled}
              onCheckedChange={setRepeatEnabled}
            />
            {repeatEnabled ? (
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="repeat-count" className="text-xs font-medium">Every</Label>
                  <Input
                    id="repeat-count"
                    type="number"
                    min={1}
                    value={repeatCount}
                    onChange={(e) => setRepeatCount(Math.max(1, parseInt(e.target.value || "1", 10)))}
                    className="tabular-nums"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="repeat-unit" className="text-xs font-medium">Unit</Label>
                  <Select
                    value={repeatUnit}
                    onValueChange={(v) => {
                      if (typeof v === "string") setRepeatUnit(v)
                    }}
                  >
                    <SelectTrigger id="repeat-unit" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {INTERVAL_UNITS.map((u) => (
                        <SelectItem key={u} value={u}>
                          {u}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            ) : null}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="included-expires" className="text-xs font-medium">Expiration</Label>
            <Select
              value={expires}
              onValueChange={(v) => {
                if (typeof v === "string") setExpires(v)
              }}
            >
              <SelectTrigger id="included-expires" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {EXPIRES_OPTIONS.map((e) => (
                  <SelectItem key={e.value} value={e.value}>
                    {e.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" onClick={handleSave} disabled={!canSave}>
            {existingItemId ? "Save" : "Add"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ──────────────────────────────────────────────────────────────────────────
// Item dialog
// ──────────────────────────────────────────────────────────────────────────

function ItemDialog({
  mode,
  itemId,
  existing,
  onClose,
}: {
  mode: "create" | "edit",
  itemId?: string,
  existing?: Item,
  onClose: () => void,
}) {
  const project = useAdminProject()
  const config = useLoadedAdminProjectConfig(project) as { payments?: PaymentsConfig }
  const allItems: Record<string, Item> = config.payments?.items ?? {}
  const { invalidateProjectConfig } = useStackAuthQueryInvalidation()

  const [id, setId] = useState<string>(itemId ?? "")
  const [displayName, setDisplayName] = useState<string>(existing?.displayName ?? "")
  const [customerType, setCustomerType] = useState<CustomerType>(existing?.customerType ?? "user")
  const [saving, setSaving] = useState(false)

  const idError = useMemo(() => {
    if (mode === "edit") return null
    if (id.trim() === "") return null
    if (!isValidUserSpecifiedId(id)) return getUserSpecifiedIdErrorMessage("itemId")
    if (allItems[id] != null) return "An item with this ID already exists."
    return null
  }, [id, mode, allItems])

  const canSave =
    displayName.trim() !== "" &&
    (mode === "edit" || (id.trim() !== "" && idError == null && isValidUserSpecifiedId(id)))

  const handleSave = async () => {
    if (!canSave) return
    setSaving(true)
    try {
      const finalId = mode === "edit" ? (itemId as string) : id.trim()
      await project.updateConfig({
        [`payments.items.${finalId}`]: {
          displayName: displayName.trim(),
          customerType,
        } satisfies Item,
      })
      await invalidateProjectConfig(project.id)
      toast.success(mode === "edit" ? "Item updated." : "Item created.")
      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save item.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CubeIcon /> {mode === "edit" ? "Edit item" : "Create item"}
          </DialogTitle>
          <DialogDescription>
            Items represent things customers consume — credits, seats, feature flags.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="item-display-name" className="text-xs font-medium">Display name</Label>
            <Input
              id="item-display-name"
              value={displayName}
              onChange={(e) => {
                const v = e.target.value
                setDisplayName(v)
                if (mode === "create" && id === "") setId(sanitizeUserSpecifiedId(v))
              }}
              placeholder="API credits"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="item-id" className="text-xs font-medium">Item ID</Label>
            <Input
              id="item-id"
              value={id}
              onChange={(e) => setId(e.target.value)}
              placeholder="api-credits"
              disabled={mode === "edit"}
              className="font-mono"
            />
            {idError ? (
              <p className="text-[11px] text-destructive">{idError}</p>
            ) : (
              <p className="text-[11px] text-muted-foreground">
                Cannot be changed after creation.
              </p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="item-customer-type" className="text-xs font-medium">Customer type</Label>
            <Select
              value={customerType}
              onValueChange={(v) => {
                if (typeof v === "string") setCustomerType(v)
              }}
            >
              <SelectTrigger id="item-customer-type" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CUSTOMER_TYPES.map((c) => (
                  <SelectItem key={c.value} value={c.value}>
                    {c.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button size="sm" onClick={handleSave} disabled={!canSave || saving}>
            {saving ? "Saving…" : mode === "edit" ? "Save changes" : "Create item"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ──────────────────────────────────────────────────────────────────────────
// Product line dialog
// ──────────────────────────────────────────────────────────────────────────

function ProductLineDialog({
  existingIds,
  onClose,
}: {
  existingIds: Array<string>,
  onClose: () => void,
}) {
  const project = useAdminProject()
  const { invalidateProjectConfig } = useStackAuthQueryInvalidation()

  const [id, setId] = useState<string>("")
  const [displayName, setDisplayName] = useState<string>("")
  const [saving, setSaving] = useState(false)

  const idError = useMemo(() => {
    if (id.trim() === "") return null
    if (!isValidUserSpecifiedId(id)) return getUserSpecifiedIdErrorMessage("productLineId")
    if (existingIds.includes(id)) return "A product line with this ID already exists."
    return null
  }, [id, existingIds])

  const canSave =
    displayName.trim() !== "" &&
    id.trim() !== "" &&
    idError == null &&
    isValidUserSpecifiedId(id)

  const handleSave = async () => {
    if (!canSave) return
    setSaving(true)
    try {
      await project.updateConfig({
        [`payments.productLines.${id.trim()}`]: {
          displayName: displayName.trim(),
        } satisfies ProductLine,
      })
      await invalidateProjectConfig(project.id)
      toast.success("Product line created.")
      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create product line.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <StackIcon /> Create product line
          </DialogTitle>
          <DialogDescription>
            Product lines group related products together for organization.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="line-display-name" className="text-xs font-medium">Display name</Label>
            <Input
              id="line-display-name"
              value={displayName}
              onChange={(e) => {
                const v = e.target.value
                setDisplayName(v)
                if (id === "") setId(sanitizeUserSpecifiedId(v))
              }}
              placeholder="Pro tier"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="line-id" className="text-xs font-medium">Product line ID</Label>
            <Input
              id="line-id"
              value={id}
              onChange={(e) => setId(e.target.value)}
              placeholder="pro-tier"
              className="font-mono"
            />
            {idError ? (
              <p className="text-[11px] text-destructive">{idError}</p>
            ) : null}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button size="sm" onClick={handleSave} disabled={!canSave || saving}>
            {saving ? "Saving…" : "Create line"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
