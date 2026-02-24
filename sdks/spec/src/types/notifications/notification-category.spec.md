# NotificationCategory

A category of notifications that users can subscribe to or unsubscribe from.


## Properties

id: string
  Unique category identifier (e.g., "marketing", "product_updates", "security").

displayName: string
  Human-readable name for the category.

description: string | null
  Description of what notifications this category includes.

isSubscribedByDefault: bool
  Whether users are subscribed to this category by default.

isUserSubscribed: bool
  Whether the current user is subscribed to this category.


## Methods


### subscribe()

POST /api/v1/notification-preferences { category_id, subscribed: true } [authenticated]

Subscribes the user to this notification category.

Does not error.


### unsubscribe()

POST /api/v1/notification-preferences { category_id, subscribed: false } [authenticated]

Unsubscribes the user from this notification category.

Does not error.
