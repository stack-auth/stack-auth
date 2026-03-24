"""Payment models for Stack Auth."""

from __future__ import annotations

from pydantic import Field

from stack_auth.models._base import StackAuthModel


class Item(StackAuthModel):
    """A quantifiable item owned by a customer (user or team)."""

    display_name: str = Field(alias="displayName")
    quantity: int = 0
    non_negative_quantity: int = Field(0, alias="nonNegativeQuantity")


class Product(StackAuthModel):
    """A product associated with a customer."""

    id: str | None = None
    quantity: int = 0
    display_name: str = Field(alias="displayName")
    customer_type: str = Field(alias="customerType")
    is_server_only: bool = Field(False, alias="isServerOnly")
    stackable: bool = False
    type: str = "one_time"
