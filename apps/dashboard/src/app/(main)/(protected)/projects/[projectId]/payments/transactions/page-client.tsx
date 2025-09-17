"use client";

import { Checkbox, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, Typography } from "@stackframe/stack-ui";
import { useEffect, useState } from "react";
import { PageLayout } from "../../page-layout";
import { useAdminApp } from "../../use-admin-app";

type AdminPurchase = {
  id: string,
  kind: 'subscription' | 'one_time' | 'item_quantity_change',
  createdAt: string,
  customerType: 'user' | 'team' | 'custom',
  customerId: string,
  quantity: number,
  testMode: boolean,
  offerId: string | null,
  offerDisplayName: string | null,
  price: null | { currency: string, unitAmount: number, interval: null | [number, 'day' | 'week' | 'month' | 'year'] },
  status: string | null,
  itemId?: string,
  description?: string | null,
  expiresAt?: string | null,
};

function formatPrice(p: AdminPurchase["price"]): string {
  if (!p) return "—";
  const amount = (p.unitAmount / 100).toFixed(2).replace(/\.00$/, "");
  return p.interval ? `$${amount} / ${p.interval[0]} ${p.interval[1]}` : `$${amount}`;
}

export default function PageClient() {
  const app = useAdminApp();
  const [rows, setRows] = useState<AdminPurchase[] | null>(null);

  useEffect(() => {
    (async () => {
      const res = await app.listTransactions();
      setRows(res.purchases);
    })();
  }, [app]);

  return (
    <PageLayout title="Purchases" description="Recent subscriptions, one-time purchases, and item quantity changes.">
      <div className="border rounded-md overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[140px]">Created</TableHead>
              <TableHead className="w-[140px]">Type</TableHead>
              <TableHead className="w-[140px]">Customer Type</TableHead>
              <TableHead className="w-[260px]">Customer ID</TableHead>
              <TableHead className="w-[240px]">Offer / Item</TableHead>
              <TableHead className="w-[160px]">Price</TableHead>
              <TableHead className="w-[120px]">Quantity</TableHead>
              <TableHead className="w-[120px]">Test Mode</TableHead>
              <TableHead className="w-[140px]">Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {!rows ? (
              <TableRow>
                <TableCell colSpan={9}>
                  <Typography variant="secondary">Loading…</Typography>
                </TableCell>
              </TableRow>
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9}>
                  <Typography variant="secondary">No purchases yet</Typography>
                </TableCell>
              </TableRow>
            ) : (
              rows.map((r) => (
                <TableRow key={`${r.kind}:${r.id}`}>
                  <TableCell>{new Date(r.createdAt).toLocaleString()}</TableCell>
                  <TableCell>{r.kind}</TableCell>
                  <TableCell>{r.customerType}</TableCell>
                  <TableCell className="font-mono text-xs">{r.customerId}</TableCell>
                  <TableCell>
                    {r.kind === 'item_quantity_change' ? (
                      <div className="font-mono text-xs">{r.itemId}</div>
                    ) : (
                      r.offerDisplayName || r.offerId || '—'
                    )}
                  </TableCell>
                  <TableCell>{formatPrice(r.price)}</TableCell>
                  <TableCell>{r.quantity}</TableCell>
                  <TableCell>
                    <Checkbox checked={r.testMode} readOnly />
                  </TableCell>
                  <TableCell>{r.status ?? '—'}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </PageLayout>
  );
}


