"use client";

import { Button } from "@/components/ui";
import { CustomerPaymentsSection } from "@/components/payments/customer-payments-section";
import { CreateCheckoutDialog } from "@/components/payments/create-checkout-dialog";
import { ShoppingCartIcon } from "@phosphor-icons/react";
import type { ServerUser } from "@hexclave/next";
import { useState } from "react";

export function UserPaymentsSection({ user }: { user: ServerUser }) {
  const [isCheckoutOpen, setIsCheckoutOpen] = useState(false);
  const label = user.displayName ?? user.primaryEmail ?? user.id;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <Button variant="outline" size="sm" onClick={() => setIsCheckoutOpen(true)}>
          <ShoppingCartIcon className="h-4 w-4 mr-1.5" />
          Create checkout
        </Button>
      </div>
      <CustomerPaymentsSection customerType="user" customerId={user.id} />
      <CreateCheckoutDialog
        open={isCheckoutOpen}
        onOpenChange={setIsCheckoutOpen}
        customer={{ type: "user", id: user.id, label }}
      />
    </div>
  );
}
