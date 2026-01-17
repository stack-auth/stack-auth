# Customer

Interface for payment and billing operations. Implemented by CurrentUser and Team.


## Properties

id: string
  The customer identifier (user ID or team ID).


## Methods


### createCheckoutUrl(options)

options.productId: string - ID of the product to purchase
options.returnUrl: string? - URL to redirect after checkout

Returns: string (checkout URL)

POST /customers/{type}/{id}/checkout { product_id, return_url } [authenticated]
Route: apps/backend/src/app/api/latest/customers/[...]/checkout/route.ts

Returns a Stripe checkout URL for purchasing the product.

Does not error.


### getBilling()

Returns: CustomerBilling

GET /customers/{type}/{id}/billing [authenticated]
Route: apps/backend/src/app/api/latest/customers/[...]/billing/route.ts

CustomerBilling has:
  hasCustomer: bool - whether a Stripe customer exists
  defaultPaymentMethod: CustomerDefaultPaymentMethod | null

CustomerDefaultPaymentMethod has:
  id: string
  brand: string | null (e.g., "visa", "mastercard")
  last4: string | null
  exp_month: number | null
  exp_year: number | null

Does not error.


### createPaymentMethodSetupIntent()

Returns: CustomerPaymentMethodSetupIntent

POST /customers/{type}/{id}/payment-method-setup-intent [authenticated]

CustomerPaymentMethodSetupIntent has:
  clientSecret: string - for Stripe.js to confirm setup
  stripeAccountId: string - the connected Stripe account

Does not error.


### setDefaultPaymentMethodFromSetupIntent(setupIntentId)

setupIntentId: string

Returns: CustomerDefaultPaymentMethod

POST /customers/{type}/{id}/default-payment-method { setup_intent_id } [authenticated]

After user completes payment method setup via Stripe.js,
call this to set it as default.

Does not error.


### getItem(itemId)

itemId: string

Returns: Item

GET /customers/{type}/{id}/items/{itemId} [authenticated]

Item has:
  displayName: string
  quantity: number - may be negative
  nonNegativeQuantity: number - Math.max(0, quantity)

Does not error.


### listItems()

Returns: Item[]

GET /customers/{type}/{id}/items [authenticated]

Does not error.


### hasItem(itemId)

itemId: string

Returns: bool

Check if getItem(itemId).quantity > 0.

Does not error.


### getItemQuantity(itemId)

itemId: string

Returns: number

Get getItem(itemId).quantity.

Does not error.


### listProducts(options?)

options.cursor: string?
options.limit: number?

Returns: CustomerProductsList

GET /customers/{type}/{id}/products [authenticated]
Route: apps/backend/src/app/api/latest/customers/[...]/products/route.ts

CustomerProductsList is CustomerProduct[] with:
  nextCursor: string | null

Does not error.


### switchSubscription(options)

options.fromProductId: string - current subscription product ID
options.toProductId: string - target subscription product ID
options.priceId: string? - specific price of target product
options.quantity: number?

POST /customers/{type}/{id}/switch-subscription { from_product_id, to_product_id, price_id, quantity } [authenticated]

For switching between subscription plans.

Does not error.


---

# CustomerProduct

A product associated with a customer.


## Properties

id: string | null
  Product ID, or null for inline products.

quantity: number
  Quantity owned.

displayName: string
  Product display name.

customerType: "user" | "team" | "custom"
  Type of customer this product is for.

isServerOnly: bool
  Whether this product can only be granted server-side.

stackable: bool
  Whether multiple quantities can be owned.

type: "one_time" | "subscription"
  Product type.

subscription: SubscriptionInfo | null
  Subscription details if type is "subscription".

switchOptions: SwitchOption[]?
  Available products to switch to (for subscriptions).


## SubscriptionInfo

currentPeriodEnd: Date | null
  When current billing period ends.

cancelAtPeriodEnd: bool
  Whether subscription will cancel at period end.

isCancelable: bool
  Whether subscription can be canceled.


## SwitchOption

productId: string
displayName: string
prices: Price[]


---

# ServerItem (server-only)

Server-side item with modification methods.

Extends: Item


## Methods


### increaseQuantity(amount)

amount: number (positive)

POST /customers/{type}/{id}/items/{itemId}/quantity { change: amount } [server-only]

Does not error.


### decreaseQuantity(amount)

amount: number (positive)

POST /customers/{type}/{id}/items/{itemId}/quantity { change: -amount } [server-only]

Note: Quantity may go negative. Use tryDecreaseQuantity for atomic decrement-if-positive.

Does not error.


### tryDecreaseQuantity(amount)

amount: number (positive)

Returns: bool

POST /customers/{type}/{id}/items/{itemId}/try-decrease { amount } [server-only]

Returns true if quantity was >= amount and was decreased.
Returns false if quantity would go negative (no change made).

Useful for pre-paid credits to prevent overdraft.

Does not error.


---

# InlineProduct

For creating products on-the-fly without pre-defining them.


## Properties

displayName: string
type: "one_time" | "subscription"
isServerOnly: bool?
stackable: bool?
prices: InlinePrice[]


## InlinePrice

amount: number (in cents)
currency: string (e.g., "usd")
interval: "month" | "year"? (for subscriptions)
