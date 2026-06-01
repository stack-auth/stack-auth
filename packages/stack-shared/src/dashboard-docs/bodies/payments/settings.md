
The **Settings** page (`Payments -> Settings`) is where Payments is wired up — Stripe connection, test-mode behavior, accepted payment methods, and a kill switch for new purchases.

## Stripe connection

The **Stripe Connection** card at the top of the page reflects the current state of the underlying Stripe Connect account. It shows one of three states:

- **Not connected** *(red)* — no Stripe account is linked yet. A **Connect Stripe** button launches Stripe's hosted onboarding flow. After completing onboarding, you're redirected back to this page.
- **Setup incomplete** *(orange)* — Stripe started onboarding but hasn't finished. The card lists missing capabilities as badges (e.g. **Charge customers**, **Receive payouts**) and offers a **Continue setup** button that resumes the hosted flow.
- **Connected** *(green)* — Stripe is fully set up. The card lists the enabled capabilities as badges (typically **Charges enabled** and **Payouts enabled**).

The state is read live via `useStripeAccountInfo()`. Reconnecting or onboarding always pushes you out to Stripe's hosted flow; Hexclave never collects bank or identity information directly.

## Test mode

The **Test Mode** card has a single switch. Toggling it takes effect immediately for both the dashboard and SDKs.

When **Test mode is active**, the card turns blue and surfaces three badges describing the runtime behavior:

- **No credit card required**
- **Products granted instantly**
- **No Stripe transactions**

In test mode, every checkout URL short-circuits — the product is granted directly to the customer without a redirect to Stripe and without any real money moving. This is the recommended mode for local development, end-to-end tests, and demos.

<Info>
  Test mode is independent of Stripe's own test-mode flag. If you want to exercise the full Stripe checkout flow with test cards instead of bypassing checkout entirely, leave Stack's test mode off and use Stripe's [test card numbers](https://stripe.com/docs/testing) (e.g. `4242 4242 4242 4242`).
</Info>

## Payment methods

The **Payment Methods** card lets you choose which methods Stripe Checkout offers your customers, organized by category in an expandable accordion:

- **Cards** — credit and debit cards (Visa, Mastercard, Amex, etc.).
- **Wallets** — Apple Pay, Google Pay, Link, etc.
- **BNPL** — Klarna, Afterpay/Clearpay, Affirm.
- **Realtime** — instant bank transfers like Cash App Pay, WeChat Pay, Alipay.
- **Bank Debits** — ACH, SEPA, Bacs.
- **Bank Transfers** — wire-style transfers.
- **Vouchers** — Konbini, OXXO, Boleto, etc.
- **Other** — any method that doesn't fit the categories above.

Each category header shows the number of available methods. Inside a category, every method row has its brand logo (or a category-fallback icon), the method name, and a switch. Toggling a switch tags the row as **Modified** until you commit the changes with the **Save Changes** button in the card header (or discard them with **Cancel**).

Some methods have dependencies — Hexclave will refuse to save if you enable a method that requires a prerequisite (e.g. Link requires Cards) without also enabling the prerequisite. The dialog explains what's missing and asks you to either enable the prerequisite or disable the dependent method.

<Info>
  Many payment methods only appear at checkout for customers in specific regions, currencies, or transaction types — Stripe filters automatically based on the buyer's locale and the price's currency. Toggling a method on doesn't force it to appear; it just allows it.
</Info>

### Platform-managed methods

Some methods are controlled by Stripe at the platform level and cannot be customized from your project. They show up below the configurable section in a muted **Platform-Managed Methods** card with read-only switches. If your project relies on one of them, you'll see it listed there with its current enabled/disabled state for reference.

If Stripe hasn't finished onboarding yet, the card is replaced with: *"No payment methods are currently available. Complete Stripe onboarding to enable payment methods."*

## Checkout controls

The **Checkout Controls** card has a single toggle — **Block new purchases**.

When enabled:

- The card border turns orange to make the state highly visible.
- Every new checkout URL fails fast with a "checkout is paused" error.
- Existing subscriptions keep renewing and existing customers keep their entitlements — only *new* purchases are stopped.

This is the lever to flip if you need to pause sales during a billing migration, a price change rollout, or a customer-support incident. Subscription cancellations and refunds remain available throughout.

## SDK usage

Settings change how customer SDK calls behave:

- **Test mode** makes `createCheckoutUrl` grant products immediately instead of redirecting to Stripe Checkout.
- **Payment methods** determine which methods Stripe may offer inside Checkout or Stripe Elements.
- **Block new purchases** makes new checkout creation fail fast while leaving existing subscriptions and entitlements alone.

### Creating checkout URLs

```typescript
const checkoutUrl = await user.createCheckoutUrl({
  productId: "prod_premium_monthly",
  returnUrl: window.location.href,
});

window.location.href = checkoutUrl;
```

If **Block new purchases** is enabled, this call fails instead of creating a new checkout session. Existing subscriptions can still renew, cancel, or switch depending on the action.

### Saving payment methods

Customers can save a default payment method for future purchases and plan switches. This is built on Stripe SetupIntents:

```typescript
// Create a setup intent
const setupIntent = await user.createPaymentMethodSetupIntent();
// setupIntent.clientSecret - use with Stripe Elements to collect card details
// setupIntent.stripeAccountId - the connected Stripe account ID

// After the user completes Stripe's card form:
const paymentMethod = await user.setDefaultPaymentMethodFromSetupIntent(
  setupIntentId
);
// paymentMethod contains: id, brand, last4, exp_month, exp_year
```

To check whether a customer already has a payment method:

```typescript
// Client component (hook)
const billing = user.useBilling();

// Server component
const billing = await user.getBilling();

// billing.hasCustomer - whether a Stripe customer exists
// billing.defaultPaymentMethod - card details or null
```

<Info>
  Switching subscriptions requires the customer to have a default payment method saved. If you offer plan upgrades in-app, make sure you collect a payment method before calling `switchSubscription`.
</Info>
