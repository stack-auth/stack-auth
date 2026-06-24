"use client";

import { Button } from "@/components/ui";
import { CustomerPaymentsSection } from "@/components/payments/customer-payments-section";
import { CreateCheckoutDialog } from "@/components/payments/create-checkout-dialog";
import { ShoppingCartIcon } from "@phosphor-icons/react";
import type { ServerTeam } from "@hexclave/next";
import { useState } from "react";

export function TeamPaymentsSection({ team }: { team: ServerTeam }) {
  const [isCheckoutOpen, setIsCheckoutOpen] = useState(false);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <Button variant="outline" size="sm" onClick={() => setIsCheckoutOpen(true)}>
          <ShoppingCartIcon className="h-4 w-4 mr-1.5" />
          Create checkout
        </Button>
      </div>
      <CustomerPaymentsSection customerType="team" customerId={team.id} />
      <CreateCheckoutDialog
        open={isCheckoutOpen}
        onOpenChange={setIsCheckoutOpen}
        customer={{ type: "team", id: team.id, label: team.displayName || team.id }}
      />
    </div>
  );
}
