# Item

A quantifiable item owned by a customer (user or team).
Used for tracking credits, feature flags, or any countable resource.


## Properties

displayName: string
  Human-readable name for the item.

quantity: number
  The quantity owned. May be negative (for debt/overdraft scenarios).

nonNegativeQuantity: number
  Convenience property equal to Math.max(0, quantity).
  Useful for displaying "available balance" that's never negative.


## Usage Examples

Items are commonly used for:

1. **Credits/Tokens**
   - Pre-paid API credits
   - AI tokens
   - Message allowances

2. **Feature Flags**
   - quantity > 0 means feature is enabled
   - quantity = 0 means feature is disabled

3. **Usage Limits**
   - Track remaining quota
   - Prevent overdraft with tryDecreaseQuantity


---

# ServerItem

Server-side item with methods to modify quantity.

Extends: Item


## Methods


### increaseQuantity(amount)

amount: number (positive)

POST /internal/items/quantity-changes {
  user_id | team_id | custom_customer_id,
  item_id,
  quantity: amount
} [server-only]

Increases the item quantity by the specified amount.

Does not error.


### decreaseQuantity(amount)

amount: number (positive)

POST /internal/items/quantity-changes {
  user_id | team_id | custom_customer_id,
  item_id,
  quantity: -amount
} [server-only]

Decreases the item quantity by the specified amount.
Note: The quantity CAN go negative. If you want to prevent this,
use tryDecreaseQuantity instead.

Does not error.


### tryDecreaseQuantity(amount)

amount: number (positive)

Returns: bool

POST /internal/items/try-decrease {
  user_id | team_id | custom_customer_id,
  item_id,
  amount
} [server-only]

Atomically tries to decrease the quantity:
- If current quantity >= amount: decreases and returns true
- If current quantity < amount: does nothing and returns false

This is race-condition safe and ideal for:
- Deducting pre-paid credits
- Consuming limited resources
- Any scenario where overdraft must be prevented

Does not error.


## Example Usage (pseudocode)

```
// Granting credits
item = server.getItem({ userId: "...", itemId: "api-credits" })
await item.increaseQuantity(100)

// Consuming credits (with overdraft protection)
success = await item.tryDecreaseQuantity(10)
if not success:
    throw InsufficientCredits("Not enough credits")

// Checking balance
item = user.getItem("api-credits")
print(f"Available: {item.nonNegativeQuantity}")
print(f"Actual balance: {item.quantity}")  // might be negative
```
