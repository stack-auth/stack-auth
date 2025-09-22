import ReturnClient from "./page-client";
export const dynamic = "force-dynamic";

type Props = {
  searchParams: Promise<{
    redirect_status?: string,
    payment_intent?: string,
    payment_intent_client_secret?: string,
    stripe_account_id?: string,
    purchase_full_code?: string,
    bypass?: string,
  }>,
};

export default async function Page({ searchParams }: Props) {
  const params = await searchParams;
  return (
    <ReturnClient
      redirectStatus={params.redirect_status}
      paymentIntentId={params.payment_intent}
      clientSecret={params.payment_intent_client_secret}
      stripeAccountId={params.stripe_account_id}
      purchaseFullCode={params.purchase_full_code}
      bypass={params.bypass}
    />
  );
}
