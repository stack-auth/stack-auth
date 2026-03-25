"""StackServerApp and AsyncStackServerApp facade classes.

These are the primary entry points for the Stack Auth Python SDK.
Developers instantiate one of these classes and call methods like
``get_user``, ``list_users``, ``create_user``, etc.

Both classes compose an HTTP client from :mod:`stack_auth._client` and
delegate response parsing to Pydantic models.
"""

from __future__ import annotations

from typing import Any, Optional

from stack_auth._client import AsyncAPIClient, SyncAPIClient
from stack_auth._constants import DEFAULT_BASE_URL
from stack_auth._pagination import PaginatedResult, _PaginationMeta
from stack_auth._token_store import TokenStore, TokenStoreInit, resolve_token_store
from stack_auth.errors import ApiKeyError, NotFoundError
from stack_auth.models.users import ServerUser

# Sentinel object to distinguish "not provided" from "explicitly None".
_UNSET = object()


def _build_params(**kwargs: Any) -> dict[str, Any]:
    """Build a dict from keyword arguments, omitting any whose value is None."""
    return {k: v for k, v in kwargs.items() if v is not None}


# ---------------------------------------------------------------------------
# StackServerApp (sync)
# ---------------------------------------------------------------------------


class StackServerApp:
    """Synchronous facade for the Stack Auth API.

    Usage::

        app = StackServerApp(project_id="...", secret_server_key="...")
        user = app.get_user("user-123")
    """

    def __init__(
        self,
        *,
        project_id: str,
        secret_server_key: str,
        base_url: str = DEFAULT_BASE_URL,
        token_store: TokenStoreInit | None = None,
    ) -> None:
        self._project_id = project_id
        self._client = SyncAPIClient(
            project_id=project_id,
            secret_server_key=secret_server_key,
            base_url=base_url,
        )
        self._token_store: TokenStore | None = None
        if token_store is not None:
            self._token_store = resolve_token_store(token_store, project_id)

    # -- lifecycle -----------------------------------------------------------

    def close(self) -> None:
        """Close the underlying HTTP client."""
        self._client.close()

    def __enter__(self) -> StackServerApp:
        return self

    def __exit__(self, *_: Any) -> None:
        self.close()

    # -- user CRUD -----------------------------------------------------------

    def get_user(self, user_id: str) -> ServerUser | None:
        """Fetch a user by ID.

        Returns ``None`` if the user is not found.
        """
        try:
            data = self._client.request("GET", f"/users/{user_id}")
        except NotFoundError:
            return None
        if data is None:
            return None
        return ServerUser.model_validate(data)

    def list_users(
        self,
        *,
        cursor: Optional[str] = None,
        limit: Optional[int] = None,
        order_by: Optional[str] = None,
        desc: Optional[bool] = None,
        query: Optional[str] = None,
        include_restricted: Optional[bool] = None,
        include_anonymous: Optional[bool] = None,
    ) -> PaginatedResult[ServerUser]:
        """List users with optional filtering and pagination."""
        params = _build_params(
            cursor=cursor,
            limit=limit,
            order_by=order_by,
            desc=desc,
            query=query,
            include_restricted=include_restricted,
            include_anonymous=include_anonymous,
        )
        data = self._client.request("GET", "/users", params=params)
        if data is None:
            return PaginatedResult(items=[])
        items = [ServerUser.model_validate(i) for i in data.get("items", [])]
        pagination = _PaginationMeta(**(data.get("pagination") or {}))
        return PaginatedResult(items=items, pagination=pagination)

    def create_user(
        self,
        *,
        primary_email: Optional[str] = None,
        primary_email_auth_enabled: Optional[bool] = None,
        password: Optional[str] = None,
        otp_auth_enabled: Optional[bool] = None,
        display_name: Optional[str] = None,
        primary_email_verified: Optional[bool] = None,
        client_metadata: Optional[dict[str, Any]] = None,
        client_read_only_metadata: Optional[dict[str, Any]] = None,
        server_metadata: Optional[dict[str, Any]] = None,
    ) -> ServerUser:
        """Create a new user. Only non-None fields are sent."""
        body = _build_params(
            primary_email=primary_email,
            primary_email_auth_enabled=primary_email_auth_enabled,
            password=password,
            otp_auth_enabled=otp_auth_enabled,
            display_name=display_name,
            primary_email_verified=primary_email_verified,
            client_metadata=client_metadata,
            client_read_only_metadata=client_read_only_metadata,
            server_metadata=server_metadata,
        )
        data = self._client.request("POST", "/users", body=body)
        return ServerUser.model_validate(data)

    def update_user(
        self,
        user_id: str,
        *,
        display_name: Any = _UNSET,
        client_metadata: Any = _UNSET,
        client_read_only_metadata: Any = _UNSET,
        server_metadata: Any = _UNSET,
        primary_email: Any = _UNSET,
        primary_email_verified: Any = _UNSET,
        primary_email_auth_enabled: Any = _UNSET,
        password: Any = _UNSET,
        otp_auth_enabled: Any = _UNSET,
        profile_image_url: Any = _UNSET,
        selected_team_id: Any = _UNSET,
    ) -> ServerUser:
        """Update a user. Only explicitly provided fields are sent.

        Pass ``None`` to clear a field. Omit a parameter to leave it unchanged.
        """
        fields = {
            "display_name": display_name,
            "client_metadata": client_metadata,
            "client_read_only_metadata": client_read_only_metadata,
            "server_metadata": server_metadata,
            "primary_email": primary_email,
            "primary_email_verified": primary_email_verified,
            "primary_email_auth_enabled": primary_email_auth_enabled,
            "password": password,
            "otp_auth_enabled": otp_auth_enabled,
            "profile_image_url": profile_image_url,
            "selected_team_id": selected_team_id,
        }
        body = {k: v for k, v in fields.items() if v is not _UNSET}
        data = self._client.request("PATCH", f"/users/{user_id}", body=body)
        return ServerUser.model_validate(data)

    def delete_user(self, user_id: str) -> None:
        """Delete a user by ID."""
        self._client.request("DELETE", f"/users/{user_id}")

    def get_user_by_api_key(self, api_key: str) -> ServerUser | None:
        """Look up a user by their API key.

        Performs a two-step lookup: first validates the key, then fetches the user.
        Returns ``None`` if the key is invalid or has no associated user.
        """
        try:
            data = self._client.request(
                "POST", "/api-keys/check", body={"api_key": api_key}
            )
        except (NotFoundError, ApiKeyError):
            return None
        if data is None or "user_id" not in data:
            return None
        return self.get_user(data["user_id"])


# ---------------------------------------------------------------------------
# AsyncStackServerApp (async)
# ---------------------------------------------------------------------------


class AsyncStackServerApp:
    """Asynchronous facade for the Stack Auth API.

    Usage::

        async with AsyncStackServerApp(project_id="...", secret_server_key="...") as app:
            user = await app.get_user("user-123")
    """

    def __init__(
        self,
        *,
        project_id: str,
        secret_server_key: str,
        base_url: str = DEFAULT_BASE_URL,
        token_store: TokenStoreInit | None = None,
    ) -> None:
        self._project_id = project_id
        self._client = AsyncAPIClient(
            project_id=project_id,
            secret_server_key=secret_server_key,
            base_url=base_url,
        )
        self._token_store: TokenStore | None = None
        if token_store is not None:
            self._token_store = resolve_token_store(token_store, project_id)

    # -- lifecycle -----------------------------------------------------------

    async def aclose(self) -> None:
        """Close the underlying HTTP client."""
        await self._client.aclose()

    async def __aenter__(self) -> AsyncStackServerApp:
        return self

    async def __aexit__(self, *_: Any) -> None:
        await self.aclose()

    # -- user CRUD -----------------------------------------------------------

    async def get_user(self, user_id: str) -> ServerUser | None:
        """Fetch a user by ID.

        Returns ``None`` if the user is not found.
        """
        try:
            data = await self._client.request("GET", f"/users/{user_id}")
        except NotFoundError:
            return None
        if data is None:
            return None
        return ServerUser.model_validate(data)

    async def list_users(
        self,
        *,
        cursor: Optional[str] = None,
        limit: Optional[int] = None,
        order_by: Optional[str] = None,
        desc: Optional[bool] = None,
        query: Optional[str] = None,
        include_restricted: Optional[bool] = None,
        include_anonymous: Optional[bool] = None,
    ) -> PaginatedResult[ServerUser]:
        """List users with optional filtering and pagination."""
        params = _build_params(
            cursor=cursor,
            limit=limit,
            order_by=order_by,
            desc=desc,
            query=query,
            include_restricted=include_restricted,
            include_anonymous=include_anonymous,
        )
        data = await self._client.request("GET", "/users", params=params)
        if data is None:
            return PaginatedResult(items=[])
        items = [ServerUser.model_validate(i) for i in data.get("items", [])]
        pagination = _PaginationMeta(**(data.get("pagination") or {}))
        return PaginatedResult(items=items, pagination=pagination)

    async def create_user(
        self,
        *,
        primary_email: Optional[str] = None,
        primary_email_auth_enabled: Optional[bool] = None,
        password: Optional[str] = None,
        otp_auth_enabled: Optional[bool] = None,
        display_name: Optional[str] = None,
        primary_email_verified: Optional[bool] = None,
        client_metadata: Optional[dict[str, Any]] = None,
        client_read_only_metadata: Optional[dict[str, Any]] = None,
        server_metadata: Optional[dict[str, Any]] = None,
    ) -> ServerUser:
        """Create a new user. Only non-None fields are sent."""
        body = _build_params(
            primary_email=primary_email,
            primary_email_auth_enabled=primary_email_auth_enabled,
            password=password,
            otp_auth_enabled=otp_auth_enabled,
            display_name=display_name,
            primary_email_verified=primary_email_verified,
            client_metadata=client_metadata,
            client_read_only_metadata=client_read_only_metadata,
            server_metadata=server_metadata,
        )
        data = await self._client.request("POST", "/users", body=body)
        return ServerUser.model_validate(data)

    async def update_user(
        self,
        user_id: str,
        *,
        display_name: Any = _UNSET,
        client_metadata: Any = _UNSET,
        client_read_only_metadata: Any = _UNSET,
        server_metadata: Any = _UNSET,
        primary_email: Any = _UNSET,
        primary_email_verified: Any = _UNSET,
        primary_email_auth_enabled: Any = _UNSET,
        password: Any = _UNSET,
        otp_auth_enabled: Any = _UNSET,
        profile_image_url: Any = _UNSET,
        selected_team_id: Any = _UNSET,
    ) -> ServerUser:
        """Update a user. Only explicitly provided fields are sent.

        Pass ``None`` to clear a field. Omit a parameter to leave it unchanged.
        """
        fields = {
            "display_name": display_name,
            "client_metadata": client_metadata,
            "client_read_only_metadata": client_read_only_metadata,
            "server_metadata": server_metadata,
            "primary_email": primary_email,
            "primary_email_verified": primary_email_verified,
            "primary_email_auth_enabled": primary_email_auth_enabled,
            "password": password,
            "otp_auth_enabled": otp_auth_enabled,
            "profile_image_url": profile_image_url,
            "selected_team_id": selected_team_id,
        }
        body = {k: v for k, v in fields.items() if v is not _UNSET}
        data = await self._client.request("PATCH", f"/users/{user_id}", body=body)
        return ServerUser.model_validate(data)

    async def delete_user(self, user_id: str) -> None:
        """Delete a user by ID."""
        await self._client.request("DELETE", f"/users/{user_id}")

    async def get_user_by_api_key(self, api_key: str) -> ServerUser | None:
        """Look up a user by their API key.

        Performs a two-step lookup: first validates the key, then fetches the user.
        Returns ``None`` if the key is invalid or has no associated user.
        """
        try:
            data = await self._client.request(
                "POST", "/api-keys/check", body={"api_key": api_key}
            )
        except (NotFoundError, ApiKeyError):
            return None
        if data is None or "user_id" not in data:
            return None
        return await self.get_user(data["user_id"])
