import { Suspense, useEffect, useMemo, useState } from "react"
import { createFileRoute } from "@tanstack/react-router"
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import { toast } from "sonner"
import {
  GiftIcon,
  MagnifyingGlassIcon,
  SlidersHorizontalIcon,
  UserCircleIcon,
  UsersThreeIcon,
  XIcon,
} from "@phosphor-icons/react"
import type { ServerTeam, ServerUser } from "@stackframe/tanstack-start"
import type { InfiniteData } from "@tanstack/react-query"

import { useAdminApp } from "@/lib/stack/admin-app"
import {
  useAdminProject,
  useLoadedAdminProjectConfig,
  useTeamsQuery,
} from "@/lib/stack/react-query"
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
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Textarea } from "@/components/ui/textarea"
import { ProjectPageMain } from "@/components/console/project-page"
import { cn } from "@/lib/utils"

export const Route = createFileRoute(
  "/_app/projects/$projectId/payments/customers"
)({
  component: CustomersPage,
})

// ──────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────

type CustomerType = "user" | "team" | "custom"

type SelectedCustomer =
  | { type: "user", id: string, displayName?: string }
  | { type: "team", id: string, displayName?: string }
  | { type: "custom", id: string }

type ItemConfig = {
  displayName: string,
  customerType: CustomerType,
}

type ProductConfig = {
  displayName: string,
  customerType: CustomerType,
  stackable?: boolean,
}

type PaymentsConfig = {
  payments?: {
    items?: Record<string, ItemConfig>,
    products?: Record<string, ProductConfig>,
  },
}

function customerToMutationOptions(c: SelectedCustomer) {
  if (c.type === "user") return { userId: c.id }
  if (c.type === "team") return { teamId: c.id }
  return { customCustomerId: c.id }
}

function customerLabel(c: SelectedCustomer): string {
  if (c.type === "custom") return c.id
  return c.displayName ?? c.id
}

function customerQueryKeyPart(c: SelectedCustomer): string {
  return `${c.type}:${c.id}`
}

// ──────────────────────────────────────────────────────────────────────────
// Page
// ──────────────────────────────────────────────────────────────────────────

function CustomersPage() {
  const project = useAdminProject()
  const config = useLoadedAdminProjectConfig(project) as PaymentsConfig

  const [customerType, setCustomerType] = useState<CustomerType>("user")
  const [selectedCustomer, setSelectedCustomer] =
    useState<SelectedCustomer | null>(null)
  const [grantOpen, setGrantOpen] = useState(false)

  const items = useMemo(
    () => Object.entries(config.payments?.items ?? {}),
    [config.payments?.items]
  )
  const products = useMemo(
    () => Object.entries(config.payments?.products ?? {}),
    [config.payments?.products]
  )

  const itemsForType = useMemo(
    () => items.filter(([, it]) => it.customerType === customerType),
    [items, customerType]
  )
  const productsForType = useMemo(
    () => products.filter(([, p]) => p.customerType === customerType),
    [products, customerType]
  )

  const handleSelectType = (next: CustomerType) => {
    setCustomerType(next)
    setSelectedCustomer(null)
  }

  useEffect(() => {
    if (!selectedCustomer && grantOpen) setGrantOpen(false)
  }, [selectedCustomer, grantOpen])

  const grantDisabled = !selectedCustomer

  return (
    <ProjectPageMain className="space-y-6 py-4">
      <section className="rounded-lg border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-4">
          <div className="min-w-0">
            <h2 className="font-heading text-sm font-semibold">
              Customer items
            </h2>
            <p className="text-xs text-muted-foreground">
              Inspect a customer&apos;s items, adjust quantities, or grant
              products.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              onClick={() => setGrantOpen(true)}
              disabled={grantDisabled}
              title={
                grantDisabled
                  ? "Select a customer to grant products."
                  : undefined
              }
            >
              <GiftIcon />
              Grant product
            </Button>
          </div>
        </div>

        <div className="space-y-5 px-5 py-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <Label className="text-xs font-medium">Customer type</Label>
              <Select
                value={customerType}
                onValueChange={(v) => handleSelectType(v as CustomerType)}
              >
                <SelectTrigger className="w-44">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="user">User</SelectItem>
                  <SelectItem value="team">Team</SelectItem>
                  <SelectItem value="custom">Custom</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {selectedCustomer ? (
              <div className="flex items-center gap-2">
                <span className="font-mono text-[10px] tracking-wider text-muted-foreground uppercase">
                  Selected
                </span>
                <Badge variant="secondary" className="gap-2">
                  <span className="font-medium">
                    {customerLabel(selectedCustomer)}
                  </span>
                  <span className="font-mono text-[10px] text-muted-foreground">
                    {selectedCustomer.id}
                  </span>
                </Badge>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => setSelectedCustomer(null)}
                  aria-label="Clear customer"
                >
                  <XIcon />
                </Button>
              </div>
            ) : null}
          </div>

          <CustomerPicker
            customerType={customerType}
            selected={selectedCustomer}
            onSelect={setSelectedCustomer}
          />
        </div>
      </section>

      <ItemsSection
        customer={selectedCustomer}
        customerType={customerType}
        items={itemsForType}
      />

      {selectedCustomer ? (
        <GrantProductDialog
          open={grantOpen}
          onOpenChange={setGrantOpen}
          customer={selectedCustomer}
          products={productsForType}
        />
      ) : null}
    </ProjectPageMain>
  )
}

// ──────────────────────────────────────────────────────────────────────────
// Customer picker
// ──────────────────────────────────────────────────────────────────────────

function CustomerPicker({
  customerType,
  selected,
  onSelect,
}: {
  customerType: CustomerType,
  selected: SelectedCustomer | null,
  onSelect: (c: SelectedCustomer | null) => void,
}) {
  if (customerType === "user") {
    return <UserPicker selected={selected} onSelect={onSelect} />
  }
  if (customerType === "team") {
    return <TeamPicker selected={selected} onSelect={onSelect} />
  }
  return <CustomCustomerPicker selected={selected} onSelect={onSelect} />
}

// ── User picker ───────────────────────────────────────────────────────────

const USER_PICKER_PAGE_SIZE = 20

type UsersInfinitePage = {
  items: Array<ServerUser>,
  nextCursor?: string | null,
}

function UserPicker({
  selected,
  onSelect,
}: {
  selected: SelectedCustomer | null,
  onSelect: (c: SelectedCustomer | null) => void,
}) {
  const adminApp = useAdminApp()
  const [query, setQuery] = useState("")
  const serverQuery = query.trim()

  const queryKey = useMemo(
    () => ["customers-user-picker", adminApp.projectId, serverQuery] as const,
    [adminApp.projectId, serverQuery]
  )

  const { data, isLoading, isFetchingNextPage, hasNextPage, fetchNextPage } =
    useInfiniteQuery<
      UsersInfinitePage,
      Error,
      InfiniteData<UsersInfinitePage, string | undefined>,
      typeof queryKey,
      string | undefined
    >({
      queryKey,
      queryFn: async ({ pageParam }) => {
        const page = await adminApp.listUsers({
          limit: USER_PICKER_PAGE_SIZE,
          cursor: pageParam,
          query: serverQuery === "" ? undefined : serverQuery,
          includeRestricted: true,
        })
        return { items: [...page], nextCursor: page.nextCursor }
      },
      initialPageParam: undefined,
      getNextPageParam: (last) => last.nextCursor ?? undefined,
    })

  const users = useMemo(
    () => data?.pages.flatMap((p) => p.items) ?? [],
    [data]
  )

  const selectedUserId =
    selected?.type === "user" ? selected.id : null

  return (
    <div className="space-y-3">
      <div className="relative">
        <MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search users by name or email"
          className="ps-8"
        />
      </div>

      <div className="max-h-72 overflow-y-auto rounded-md border">
        {isLoading ? (
          <div className="space-y-2 p-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-9 w-full" />
            ))}
          </div>
        ) : users.length === 0 ? (
          <p className="p-4 text-center text-xs text-muted-foreground">
            {serverQuery
              ? `No users match "${serverQuery}".`
              : "No users yet."}
          </p>
        ) : (
          <ul className="divide-y">
            {users.map((u) => {
              const active = u.id === selectedUserId
              return (
                <li key={u.id}>
                  <button
                    type="button"
                    onClick={() =>
                      onSelect({
                        type: "user",
                        id: u.id,
                        displayName:
                          u.displayName ?? u.primaryEmail ?? undefined,
                      })
                    }
                    className={cn(
                      "flex w-full items-center justify-between gap-3 px-3 py-2 text-left transition-colors hover:bg-muted/50",
                      active && "bg-muted"
                    )}
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">
                        {u.displayName ?? u.primaryEmail ?? "No name"}
                      </p>
                      <p className="font-mono text-[10px] tracking-wider text-muted-foreground uppercase">
                        {u.id}
                      </p>
                    </div>
                    {active ? (
                      <Badge variant="default">Selected</Badge>
                    ) : (
                      <span className="text-[11px] text-muted-foreground">
                        Select
                      </span>
                    )}
                  </button>
                </li>
              )
            })}
          </ul>
        )}
        {hasNextPage ? (
          <div className="border-t p-2">
            <Button
              variant="ghost"
              size="sm"
              className="w-full"
              disabled={isFetchingNextPage}
              onClick={() => {
                void fetchNextPage()
              }}
            >
              {isFetchingNextPage ? "Loading…" : "Load more"}
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  )
}

// ── Team picker ───────────────────────────────────────────────────────────

function TeamPicker({
  selected,
  onSelect,
}: {
  selected: SelectedCustomer | null,
  onSelect: (c: SelectedCustomer | null) => void,
}) {
  const adminApp = useAdminApp()
  const teamsQuery = useTeamsQuery(adminApp)
  const teams: Array<ServerTeam> = teamsQuery.data ?? []
  const [query, setQuery] = useState("")
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (q === "") return teams
    return teams.filter(
      (t) =>
        t.displayName.toLowerCase().includes(q) ||
        t.id.toLowerCase().includes(q)
    )
  }, [teams, query])

  const selectedTeamId =
    selected?.type === "team" ? selected.id : null

  return (
    <div className="space-y-3">
      <div className="relative">
        <MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search teams"
          className="ps-8"
        />
      </div>
      <div className="max-h-72 overflow-y-auto rounded-md border">
        {teamsQuery.isLoading ? (
          <div className="space-y-2 p-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-9 w-full" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <p className="p-4 text-center text-xs text-muted-foreground">
            {teams.length === 0
              ? "No teams yet."
              : `No teams match "${query}".`}
          </p>
        ) : (
          <ul className="divide-y">
            {filtered.map((t) => {
              const active = t.id === selectedTeamId
              return (
                <li key={t.id}>
                  <button
                    type="button"
                    onClick={() =>
                      onSelect({
                        type: "team",
                        id: t.id,
                        displayName: t.displayName,
                      })
                    }
                    className={cn(
                      "flex w-full items-center justify-between gap-3 px-3 py-2 text-left transition-colors hover:bg-muted/50",
                      active && "bg-muted"
                    )}
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">
                        {t.displayName}
                      </p>
                      <p className="font-mono text-[10px] tracking-wider text-muted-foreground uppercase">
                        {t.id}
                      </p>
                    </div>
                    {active ? (
                      <Badge variant="default">Selected</Badge>
                    ) : (
                      <span className="text-[11px] text-muted-foreground">
                        Select
                      </span>
                    )}
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}

// ── Custom customer picker ────────────────────────────────────────────────

function CustomCustomerPicker({
  selected,
  onSelect,
}: {
  selected: SelectedCustomer | null,
  onSelect: (c: SelectedCustomer | null) => void,
}) {
  const [draft, setDraft] = useState(
    selected?.type === "custom" ? selected.id : ""
  )

  useEffect(() => {
    if (selected?.type !== "custom") setDraft("")
  }, [selected])

  const handleApply = () => {
    const trimmed = draft.trim()
    if (!trimmed) {
      toast.error("Enter a custom customer id.")
      return
    }
    onSelect({ type: "custom", id: trimmed })
  }

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
      <Input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder="customer-123"
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault()
            handleApply()
          }
        }}
      />
      <Button onClick={handleApply} size="sm">
        Use customer
      </Button>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────────
// Items section
// ──────────────────────────────────────────────────────────────────────────

function ItemsSection({
  customer,
  customerType,
  items,
}: {
  customer: SelectedCustomer | null,
  customerType: CustomerType,
  items: Array<[string, ItemConfig]>,
}) {
  return (
    <section className="rounded-lg border bg-card">
      <div className="border-b px-5 py-4">
        <h2 className="font-heading text-sm font-semibold">Items</h2>
        <p className="text-xs text-muted-foreground">
          {customer
            ? `Showing items configured for ${customerType} customers.`
            : "Pick a customer to see their item balances."}
        </p>
      </div>
      <div className="px-5 py-5">
        {!customer ? (
          <CustomersEmptyState />
        ) : items.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No items configured for this customer type.
          </p>
        ) : (
          <ul className="divide-y rounded-md border">
            {items.map(([itemId, itemConfig]) => (
              <ItemRow
                key={itemId}
                itemId={itemId}
                itemConfig={itemConfig}
                customer={customer}
              />
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}

function CustomersEmptyState() {
  return (
    <div className="grid place-items-center py-8">
      <Empty className="max-w-md">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <UserCircleIcon />
          </EmptyMedia>
          <EmptyTitle>Select a customer</EmptyTitle>
          <EmptyDescription>
            Pick a user, team, or enter a custom customer id above to view and
            manage their items.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <div className="flex flex-wrap items-center justify-center gap-2 text-[11px] text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <UserCircleIcon className="size-3.5" /> User
            </span>
            <span>·</span>
            <span className="inline-flex items-center gap-1">
              <UsersThreeIcon className="size-3.5" /> Team
            </span>
            <span>·</span>
            <span>Custom id</span>
          </div>
        </EmptyContent>
      </Empty>
    </div>
  )
}

function ItemRow({
  itemId,
  itemConfig,
  customer,
}: {
  itemId: string,
  itemConfig: ItemConfig,
  customer: SelectedCustomer,
}) {
  const [adjustOpen, setAdjustOpen] = useState(false)
  return (
    <li className="flex items-center justify-between gap-4 px-3 py-3">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{itemConfig.displayName}</p>
        <p className="font-mono text-[10px] tracking-wider text-muted-foreground uppercase">
          {itemId}
        </p>
      </div>
      <div className="flex items-center gap-3">
        <Suspense fallback={<Skeleton className="h-5 w-12" />}>
          <ItemQuantity itemId={itemId} customer={customer} />
        </Suspense>
        <Button
          size="sm"
          variant="outline"
          onClick={() => setAdjustOpen(true)}
        >
          <SlidersHorizontalIcon />
          Adjust
        </Button>
      </div>
      <AdjustQuantityDialog
        open={adjustOpen}
        onOpenChange={setAdjustOpen}
        customer={customer}
        itemId={itemId}
        itemLabel={itemConfig.displayName}
      />
    </li>
  )
}

function ItemQuantity({
  itemId,
  customer,
}: {
  itemId: string,
  customer: SelectedCustomer,
}) {
  const adminApp = useAdminApp()
  const queryClient = useQueryClient()
  const queryKey = useMemo(
    () =>
      [
        "payments-item",
        adminApp.projectId,
        customerQueryKeyPart(customer),
        itemId,
      ] as const,
    [adminApp.projectId, customer, itemId]
  )

  const { data, isLoading, isError } = useQuery({
    queryKey,
    queryFn: async () => {
      const opts = customerToMutationOptions(customer)
      return await adminApp.getItem({ ...opts, itemId })
    },
  })

  // expose invalidator via a ref-like pattern: re-fetch is triggered via
  // queryClient.invalidateQueries by other components using the same key.
  void queryClient

  if (isLoading) return <Skeleton className="h-5 w-12" />
  if (isError || !data) {
    return (
      <span className="font-mono text-[10px] tracking-wider text-muted-foreground uppercase">
        n/a
      </span>
    )
  }
  return (
    <div className="flex items-baseline gap-1.5">
      <span className="text-sm font-semibold tabular-nums">
        {(data as { quantity: number }).quantity}
      </span>
      <span className="font-mono text-[10px] tracking-wider text-muted-foreground uppercase">
        in stock
      </span>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────────
// Adjust quantity dialog
// ──────────────────────────────────────────────────────────────────────────

function AdjustQuantityDialog({
  open,
  onOpenChange,
  customer,
  itemId,
  itemLabel,
}: {
  open: boolean,
  onOpenChange: (next: boolean) => void,
  customer: SelectedCustomer,
  itemId: string,
  itemLabel: string,
}) {
  const adminApp = useAdminApp()
  const queryClient = useQueryClient()
  const [quantity, setQuantity] = useState("")
  const [description, setDescription] = useState("")
  const [expiresAt, setExpiresAt] = useState("")
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (open) {
      setQuantity("")
      setDescription("")
      setExpiresAt("")
    }
  }, [open])

  const handleSubmit = async () => {
    const n = Number(quantity)
    if (!Number.isFinite(n) || !Number.isInteger(n) || n === 0) {
      toast.error("Quantity must be a non-zero integer.")
      return
    }
    setSubmitting(true)
    try {
      const opts = customerToMutationOptions(customer)
      const expires = expiresAt ? new Date(expiresAt) : undefined
      if (expires && Number.isNaN(expires.getTime())) {
        toast.error("Invalid expiration date.")
        return
      }
      await adminApp.createItemQuantityChange({
        ...opts,
        itemId,
        quantity: n,
        description: description.trim() ? description.trim() : undefined,
        expiresAt: expires ? expires.toISOString() : undefined,
      })
      try {
        const refreshOpts = customerToMutationOptions(customer)
        await adminApp.getItem({ ...refreshOpts, itemId })
      } catch {
        // best-effort refresh
      }
      await queryClient.invalidateQueries({
        queryKey: [
          "payments-item",
          adminApp.projectId,
          customerQueryKeyPart(customer),
          itemId,
        ],
      })
      toast.success("Item quantity updated.")
      onOpenChange(false)
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to update quantity."
      )
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Adjust &ldquo;{itemLabel}&rdquo;</DialogTitle>
          <DialogDescription>
            Apply a positive or negative delta to this customer&apos;s balance.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="adjust-quantity" className="text-xs font-medium">
              Quantity change
            </Label>
            <Input
              id="adjust-quantity"
              type="number"
              inputMode="numeric"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              placeholder="Eg. 5 or -3"
            />
            <p className="text-[11px] text-muted-foreground">
              Positive to grant, negative to deduct.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="adjust-description" className="text-xs font-medium">
              Description
            </Label>
            <Textarea
              id="adjust-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional note for your records"
              rows={3}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="adjust-expires" className="text-xs font-medium">
              Expires at
            </Label>
            <Input
              id="adjust-expires"
              type="date"
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
            />
            <p className="text-[11px] text-muted-foreground">
              Optional. If set, this delta automatically reverts after the
              date.
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={() => {
              void handleSubmit()
            }}
            disabled={submitting}
          >
            {submitting ? "Applying…" : "Apply change"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ──────────────────────────────────────────────────────────────────────────
// Grant product dialog
// ──────────────────────────────────────────────────────────────────────────

function GrantProductDialog({
  open,
  onOpenChange,
  customer,
  products,
}: {
  open: boolean,
  onOpenChange: (next: boolean) => void,
  customer: SelectedCustomer,
  products: Array<[string, ProductConfig]>,
}) {
  const adminApp = useAdminApp()
  const queryClient = useQueryClient()
  const [productId, setProductId] = useState<string>("")
  const [quantity, setQuantity] = useState<string>("1")
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (open) {
      setProductId(products[0]?.[0] ?? "")
      setQuantity("1")
    }
  }, [open, products])

  const selectedProduct = useMemo(
    () => products.find(([id]) => id === productId)?.[1],
    [products, productId]
  )
  const isStackable = Boolean(selectedProduct?.stackable)
  const hasProducts = products.length > 0

  const handleSubmit = async () => {
    if (!productId) {
      toast.error("Select a product.")
      return
    }
    let qty: number | undefined
    if (isStackable) {
      const n = Number(quantity)
      if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1) {
        toast.error("Quantity must be a positive integer.")
        return
      }
      qty = n
    }
    setSubmitting(true)
    try {
      const opts = customerToMutationOptions(customer)
      await adminApp.grantProduct({
        ...opts,
        productId,
        ...(qty != null ? { quantity: qty } : {}),
      })
      await queryClient.invalidateQueries({
        queryKey: [
          "payments-item",
          adminApp.projectId,
          customerQueryKeyPart(customer),
        ],
      })
      toast.success("Product granted.")
      onOpenChange(false)
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to grant product."
      )
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Grant product</DialogTitle>
          <DialogDescription>
            Grant a product to{" "}
            <span className="font-medium">{customerLabel(customer)}</span>.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          {!hasProducts ? (
            <p className="text-xs text-muted-foreground">
              No products are configured for this customer type yet.
            </p>
          ) : (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="grant-product" className="text-xs font-medium">
                  Product
                </Label>
                <Select value={productId} onValueChange={(v) => setProductId(v ?? "")}>
                  <SelectTrigger id="grant-product">
                    <SelectValue placeholder="Select a product" />
                  </SelectTrigger>
                  <SelectContent>
                    {products.map(([id, p]) => (
                      <SelectItem key={id} value={id}>
                        {p.displayName ? `${p.displayName} (${id})` : id}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {isStackable ? (
                <div className="space-y-1.5">
                  <Label
                    htmlFor="grant-quantity"
                    className="text-xs font-medium"
                  >
                    Quantity
                  </Label>
                  <Input
                    id="grant-quantity"
                    type="number"
                    inputMode="numeric"
                    min={1}
                    value={quantity}
                    onChange={(e) => setQuantity(e.target.value)}
                    placeholder="1"
                  />
                  <p className="text-[11px] text-muted-foreground">
                    This product is stackable; choose how many to grant.
                  </p>
                </div>
              ) : null}
            </>
          )}
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={() => {
              void handleSubmit()
            }}
            disabled={!hasProducts || submitting}
          >
            {submitting ? "Granting…" : "Grant product"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
