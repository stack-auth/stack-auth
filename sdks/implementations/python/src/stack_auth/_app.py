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
from stack_auth.models.api_keys import (
    TeamApiKey,
    TeamApiKeyFirstView,
    UserApiKey,
    UserApiKeyFirstView,
)
from stack_auth.models.contact_channels import ContactChannel
from stack_auth.models.oauth import OAuthProvider
from stack_auth.models.permissions import TeamPermission
from stack_auth.models.sessions import ActiveSession
from stack_auth.models.teams import ServerTeam, TeamInvitation, TeamMemberProfile
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

    # -- session management --------------------------------------------------

    def list_sessions(self, user_id: str) -> list[ActiveSession]:
        """List active sessions for a user.

        Args:
            user_id: The user whose sessions to list.

        Returns:
            A list of :class:`ActiveSession` objects.
        """
        data = self._client.request(
            "GET", "/auth/sessions", params={"user_id": user_id}
        )
        return [
            ActiveSession.model_validate(item)
            for item in (data or {}).get("items", [])
        ]

    def get_session(
        self, session_id: str, *, user_id: str
    ) -> ActiveSession | None:
        """Get a specific session by ID.

        Fetches all sessions for the user and filters by *session_id*.
        Returns ``None`` if the session is not found.
        """
        sessions = self.list_sessions(user_id)
        return next((s for s in sessions if s.id == session_id), None)

    def revoke_session(self, session_id: str, *, user_id: str) -> None:
        """Revoke (delete) a session.

        Args:
            session_id: The session to revoke.
            user_id: The user who owns the session.
        """
        self._client.request(
            "DELETE",
            f"/auth/sessions/{session_id}",
            params={"user_id": user_id},
        )

    # -- team CRUD -----------------------------------------------------------

    def get_team(self, team_id: str) -> ServerTeam | None:
        """Fetch a team by ID.

        Returns ``None`` if the team is not found.
        """
        try:
            data = self._client.request("GET", f"/teams/{team_id}")
        except NotFoundError:
            return None
        if data is None:
            return None
        return ServerTeam.model_validate(data)

    def list_teams(
        self, *, user_id: Optional[str] = None
    ) -> list[ServerTeam]:
        """List teams, optionally filtered by user membership.

        This endpoint does not support pagination.
        """
        params = _build_params(user_id=user_id)
        data = self._client.request("GET", "/teams", params=params)
        return [
            ServerTeam.model_validate(item)
            for item in (data or {}).get("items", [])
        ]

    def create_team(
        self,
        *,
        display_name: str,
        profile_image_url: Optional[str] = None,
        creator_user_id: Optional[str] = None,
    ) -> ServerTeam:
        """Create a new team."""
        body = _build_params(
            display_name=display_name,
            profile_image_url=profile_image_url,
            creator_user_id=creator_user_id,
        )
        data = self._client.request("POST", "/teams", body=body)
        return ServerTeam.model_validate(data)

    def update_team(
        self,
        team_id: str,
        *,
        display_name: Any = _UNSET,
        profile_image_url: Any = _UNSET,
        client_metadata: Any = _UNSET,
        client_read_only_metadata: Any = _UNSET,
        server_metadata: Any = _UNSET,
    ) -> ServerTeam:
        """Update a team. Only explicitly provided fields are sent.

        Pass ``None`` to clear a field. Omit a parameter to leave it unchanged.
        """
        fields = {
            "display_name": display_name,
            "profile_image_url": profile_image_url,
            "client_metadata": client_metadata,
            "client_read_only_metadata": client_read_only_metadata,
            "server_metadata": server_metadata,
        }
        body = {k: v for k, v in fields.items() if v is not _UNSET}
        data = self._client.request("PATCH", f"/teams/{team_id}", body=body)
        return ServerTeam.model_validate(data)

    def delete_team(self, team_id: str) -> None:
        """Delete a team by ID."""
        self._client.request("DELETE", f"/teams/{team_id}")

    def get_team_by_api_key(self, api_key: str) -> ServerTeam | None:
        """Look up a team by its API key.

        Performs a two-step lookup: first validates the key, then fetches the team.
        Returns ``None`` if the key is invalid or has no associated team.
        """
        try:
            data = self._client.request(
                "POST", "/api-keys/check", body={"api_key": api_key}
            )
        except (NotFoundError, ApiKeyError):
            return None
        if data is None or "team_id" not in data:
            return None
        return self.get_team(data["team_id"])

    # -- team membership -----------------------------------------------------

    def add_team_member(self, team_id: str, user_id: str) -> None:
        """Add a user to a team."""
        self._client.request(
            "POST", f"/team-memberships/{team_id}/{user_id}", body={}
        )

    def remove_team_member(self, team_id: str, user_id: str) -> None:
        """Remove a user from a team."""
        self._client.request(
            "DELETE", f"/team-memberships/{team_id}/{user_id}"
        )

    # -- team invitations ----------------------------------------------------

    def send_team_invitation(
        self,
        team_id: str,
        email: str,
        *,
        callback_url: Optional[str] = None,
    ) -> None:
        """Send an invitation email to join a team."""
        body = _build_params(
            email=email, team_id=team_id, callback_url=callback_url
        )
        self._client.request("POST", "/team-invitations/send-code", body=body)

    def list_team_invitations(self, team_id: str) -> list[TeamInvitation]:
        """List pending invitations for a team."""
        data = self._client.request(
            "GET", f"/teams/{team_id}/invitations"
        )
        return [
            TeamInvitation.model_validate(item)
            for item in (data or {}).get("items", [])
        ]

    def revoke_team_invitation(
        self, team_id: str, invitation_id: str
    ) -> None:
        """Revoke (delete) a team invitation."""
        self._client.request(
            "DELETE", f"/teams/{team_id}/invitations/{invitation_id}"
        )

    # -- team member profiles ------------------------------------------------

    def list_team_member_profiles(
        self, team_id: str
    ) -> list[TeamMemberProfile]:
        """List member profiles for a team."""
        data = self._client.request(
            "GET", "/team-member-profiles", params={"team_id": team_id}
        )
        return [
            TeamMemberProfile.model_validate(item)
            for item in (data or {}).get("items", [])
        ]

    def get_team_member_profile(
        self, team_id: str, user_id: str
    ) -> TeamMemberProfile | None:
        """Get a specific team member's profile.

        Fetches all member profiles for the team and filters by *user_id*.
        Returns ``None`` if no profile is found.
        """
        profiles = self.list_team_member_profiles(team_id)
        return next((p for p in profiles if p.user_id == user_id), None)

    # -- permissions ---------------------------------------------------------

    def grant_permission(
        self,
        user_id: str,
        permission_id: str,
        *,
        team_id: Optional[str] = None,
    ) -> None:
        """Grant a permission to a user.

        Args:
            user_id: The user to grant the permission to.
            permission_id: The permission to grant.
            team_id: If provided, grants at team scope; otherwise project scope.
        """
        body = _build_params(
            team_id=team_id, permission_id=permission_id
        )
        self._client.request(
            "POST", f"/users/{user_id}/permissions", body=body
        )

    def revoke_permission(
        self,
        user_id: str,
        permission_id: str,
        *,
        team_id: Optional[str] = None,
    ) -> None:
        """Revoke a permission from a user.

        Args:
            user_id: The user to revoke the permission from.
            permission_id: The permission to revoke.
            team_id: If provided, revokes at team scope; otherwise project scope.
        """
        params = _build_params(team_id=team_id)
        self._client.request(
            "DELETE",
            f"/users/{user_id}/permissions/{permission_id}",
            params=params,
        )

    def list_permissions(
        self,
        user_id: str,
        *,
        team_id: Optional[str] = None,
        direct: Optional[bool] = None,
    ) -> list[TeamPermission]:
        """List permissions for a user.

        Args:
            user_id: The user whose permissions to list.
            team_id: Filter by team scope.
            direct: If ``True``, only return directly assigned permissions.

        Returns:
            A list of :class:`TeamPermission` objects.
        """
        params = _build_params(team_id=team_id, direct=direct)
        data = self._client.request(
            "GET", f"/users/{user_id}/permissions", params=params
        )
        return [
            TeamPermission.model_validate(item)
            for item in (data or {}).get("items", [])
        ]

    def has_permission(
        self,
        user_id: str,
        permission_id: str,
        *,
        team_id: Optional[str] = None,
    ) -> bool:
        """Check if a user has a specific permission.

        Args:
            user_id: The user to check.
            permission_id: The permission to check for.
            team_id: Check at team scope if provided.

        Returns:
            ``True`` if the user has the permission, ``False`` otherwise.
        """
        params = _build_params(
            team_id=team_id, permission_id=permission_id
        )
        data = self._client.request(
            "GET", f"/users/{user_id}/permissions", params=params
        )
        return len((data or {}).get("items", [])) > 0

    def get_permission(
        self,
        user_id: str,
        permission_id: str,
        *,
        team_id: Optional[str] = None,
    ) -> TeamPermission | None:
        """Get a specific permission for a user.

        Args:
            user_id: The user to check.
            permission_id: The permission to look up.
            team_id: Check at team scope if provided.

        Returns:
            The :class:`TeamPermission` if found, or ``None``.
        """
        params = _build_params(
            team_id=team_id, permission_id=permission_id
        )
        data = self._client.request(
            "GET", f"/users/{user_id}/permissions", params=params
        )
        items = (data or {}).get("items", [])
        if not items:
            return None
        return TeamPermission.model_validate(items[0])

    # -- contact channels ----------------------------------------------------

    def list_contact_channels(self, user_id: str) -> list[ContactChannel]:
        """List contact channels for a user.

        Args:
            user_id: The user whose contact channels to list.

        Returns:
            A list of :class:`ContactChannel` objects.
        """
        data = self._client.request(
            "GET", "/contact-channels", params={"user_id": user_id}
        )
        return [
            ContactChannel.model_validate(item)
            for item in (data or {}).get("items", [])
        ]

    def create_contact_channel(
        self,
        user_id: str,
        *,
        value: str,
        type: str = "email",
        used_for_auth: bool,
        is_primary: Optional[bool] = None,
        is_verified: Optional[bool] = None,
    ) -> ContactChannel:
        """Create a new contact channel for a user.

        Args:
            user_id: The user to create the channel for.
            value: The channel value (e.g., email address).
            type: The channel type (default: ``"email"``).
            used_for_auth: Whether this channel is used for authentication.
            is_primary: Whether this is the primary channel.
            is_verified: Whether the channel is pre-verified.

        Returns:
            The created :class:`ContactChannel`.
        """
        body = _build_params(
            user_id=user_id,
            value=value,
            type=type,
            used_for_auth=used_for_auth,
            is_primary=is_primary,
            is_verified=is_verified,
        )
        data = self._client.request(
            "POST", "/contact-channels", body=body
        )
        return ContactChannel.model_validate(data)

    def send_verification_code(
        self,
        contact_channel_id: str,
        *,
        callback_url: Optional[str] = None,
    ) -> None:
        """Send a verification email for a contact channel.

        Args:
            contact_channel_id: The channel to send verification for.
            callback_url: Optional URL to redirect after verification.
        """
        body = _build_params(callback_url=callback_url)
        self._client.request(
            "POST",
            f"/contact-channels/{contact_channel_id}/send-verification-email",
            body=body,
        )

    def verify_contact_channel(self, code: str) -> None:
        """Verify a contact channel with a verification code.

        Args:
            code: The verification code received via email.
        """
        self._client.request(
            "POST", "/contact-channels/verify", body={"code": code}
        )

    # -- API keys ------------------------------------------------------------

    def create_user_api_key(
        self,
        user_id: str,
        *,
        description: str,
        expires_at_millis: Optional[int] = None,
        scope: Optional[str] = None,
        team_id: Optional[str] = None,
    ) -> UserApiKeyFirstView:
        """Create a user API key.

        Returns the key including the secret (only available at creation time).
        """
        body = _build_params(
            description=description,
            expires_at_millis=expires_at_millis,
            scope=scope,
            team_id=team_id,
        )
        data = self._client.request(
            "POST", f"/users/{user_id}/api-keys", body=body
        )
        return UserApiKeyFirstView.model_validate(data)

    def list_user_api_keys(self, user_id: str) -> list[UserApiKey]:
        """List API keys for a user."""
        data = self._client.request("GET", f"/users/{user_id}/api-keys")
        return [
            UserApiKey.model_validate(item)
            for item in (data or {}).get("items", [])
        ]

    def revoke_user_api_key(self, api_key_id: str) -> None:
        """Revoke (delete) a user API key."""
        self._client.request("DELETE", f"/api-keys/{api_key_id}")

    def create_team_api_key(
        self,
        team_id: str,
        *,
        description: str,
        expires_at_millis: Optional[int] = None,
        scope: Optional[str] = None,
    ) -> TeamApiKeyFirstView:
        """Create a team API key.

        Returns the key including the secret (only available at creation time).
        """
        body = _build_params(
            description=description,
            expires_at_millis=expires_at_millis,
            scope=scope,
        )
        data = self._client.request(
            "POST", f"/teams/{team_id}/api-keys", body=body
        )
        return TeamApiKeyFirstView.model_validate(data)

    def list_team_api_keys(self, team_id: str) -> list[TeamApiKey]:
        """List API keys for a team."""
        data = self._client.request("GET", f"/teams/{team_id}/api-keys")
        return [
            TeamApiKey.model_validate(item)
            for item in (data or {}).get("items", [])
        ]

    def revoke_team_api_key(self, api_key_id: str) -> None:
        """Revoke (delete) a team API key."""
        self._client.request("DELETE", f"/api-keys/{api_key_id}")

    def check_api_key(self, api_key: str) -> dict[str, Any] | None:
        """Validate an API key and return associated user/team info.

        Returns a dict with ``user_id`` and/or ``team_id``, or ``None``
        if the key is invalid.
        """
        try:
            data = self._client.request(
                "POST", "/api-keys/check", body={"api_key": api_key}
            )
        except (NotFoundError, ApiKeyError):
            return None
        if data is None:
            return None
        return data

    # -- OAuth providers -----------------------------------------------------

    def create_oauth_provider(
        self,
        user_id: str,
        *,
        account_id: str,
        provider_config_id: str,
        email: str,
        allow_sign_in: bool,
        allow_connected_accounts: bool,
    ) -> OAuthProvider:
        """Link an OAuth provider to a user."""
        body = _build_params(
            account_id=account_id,
            provider_config_id=provider_config_id,
            email=email,
            allow_sign_in=allow_sign_in,
            allow_connected_accounts=allow_connected_accounts,
        )
        data = self._client.request(
            "POST", f"/users/{user_id}/oauth-providers", body=body
        )
        return OAuthProvider.model_validate(data)

    def list_oauth_providers(self, user_id: str) -> list[OAuthProvider]:
        """List OAuth providers linked to a user."""
        data = self._client.request(
            "GET", f"/users/{user_id}/oauth-providers"
        )
        return [
            OAuthProvider.model_validate(item)
            for item in (data or {}).get("items", [])
        ]

    def get_oauth_provider(
        self, user_id: str, provider_id: str
    ) -> OAuthProvider | None:
        """Get a specific OAuth provider for a user.

        Fetches all providers and filters by *provider_id*.
        Returns ``None`` if not found.
        """
        providers = self.list_oauth_providers(user_id)
        return next((p for p in providers if p.id == provider_id), None)

    def list_connected_accounts(self, user_id: str) -> list[OAuthProvider]:
        """List connected accounts for a user.

        This is an alias for :meth:`list_oauth_providers`.
        """
        return self.list_oauth_providers(user_id)


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

    # -- session management --------------------------------------------------

    async def list_sessions(self, user_id: str) -> list[ActiveSession]:
        """List active sessions for a user.

        Args:
            user_id: The user whose sessions to list.

        Returns:
            A list of :class:`ActiveSession` objects.
        """
        data = await self._client.request(
            "GET", "/auth/sessions", params={"user_id": user_id}
        )
        return [
            ActiveSession.model_validate(item)
            for item in (data or {}).get("items", [])
        ]

    async def get_session(
        self, session_id: str, *, user_id: str
    ) -> ActiveSession | None:
        """Get a specific session by ID.

        Fetches all sessions for the user and filters by *session_id*.
        Returns ``None`` if the session is not found.
        """
        sessions = await self.list_sessions(user_id)
        return next((s for s in sessions if s.id == session_id), None)

    async def revoke_session(self, session_id: str, *, user_id: str) -> None:
        """Revoke (delete) a session.

        Args:
            session_id: The session to revoke.
            user_id: The user who owns the session.
        """
        await self._client.request(
            "DELETE",
            f"/auth/sessions/{session_id}",
            params={"user_id": user_id},
        )

    # -- team CRUD -----------------------------------------------------------

    async def get_team(self, team_id: str) -> ServerTeam | None:
        """Fetch a team by ID.

        Returns ``None`` if the team is not found.
        """
        try:
            data = await self._client.request("GET", f"/teams/{team_id}")
        except NotFoundError:
            return None
        if data is None:
            return None
        return ServerTeam.model_validate(data)

    async def list_teams(
        self, *, user_id: Optional[str] = None
    ) -> list[ServerTeam]:
        """List teams, optionally filtered by user membership.

        This endpoint does not support pagination.
        """
        params = _build_params(user_id=user_id)
        data = await self._client.request("GET", "/teams", params=params)
        return [
            ServerTeam.model_validate(item)
            for item in (data or {}).get("items", [])
        ]

    async def create_team(
        self,
        *,
        display_name: str,
        profile_image_url: Optional[str] = None,
        creator_user_id: Optional[str] = None,
    ) -> ServerTeam:
        """Create a new team."""
        body = _build_params(
            display_name=display_name,
            profile_image_url=profile_image_url,
            creator_user_id=creator_user_id,
        )
        data = await self._client.request("POST", "/teams", body=body)
        return ServerTeam.model_validate(data)

    async def update_team(
        self,
        team_id: str,
        *,
        display_name: Any = _UNSET,
        profile_image_url: Any = _UNSET,
        client_metadata: Any = _UNSET,
        client_read_only_metadata: Any = _UNSET,
        server_metadata: Any = _UNSET,
    ) -> ServerTeam:
        """Update a team. Only explicitly provided fields are sent.

        Pass ``None`` to clear a field. Omit a parameter to leave it unchanged.
        """
        fields = {
            "display_name": display_name,
            "profile_image_url": profile_image_url,
            "client_metadata": client_metadata,
            "client_read_only_metadata": client_read_only_metadata,
            "server_metadata": server_metadata,
        }
        body = {k: v for k, v in fields.items() if v is not _UNSET}
        data = await self._client.request(
            "PATCH", f"/teams/{team_id}", body=body
        )
        return ServerTeam.model_validate(data)

    async def delete_team(self, team_id: str) -> None:
        """Delete a team by ID."""
        await self._client.request("DELETE", f"/teams/{team_id}")

    async def get_team_by_api_key(self, api_key: str) -> ServerTeam | None:
        """Look up a team by its API key.

        Performs a two-step lookup: first validates the key, then fetches the team.
        Returns ``None`` if the key is invalid or has no associated team.
        """
        try:
            data = await self._client.request(
                "POST", "/api-keys/check", body={"api_key": api_key}
            )
        except (NotFoundError, ApiKeyError):
            return None
        if data is None or "team_id" not in data:
            return None
        return await self.get_team(data["team_id"])

    # -- team membership -----------------------------------------------------

    async def add_team_member(self, team_id: str, user_id: str) -> None:
        """Add a user to a team."""
        await self._client.request(
            "POST", f"/team-memberships/{team_id}/{user_id}", body={}
        )

    async def remove_team_member(self, team_id: str, user_id: str) -> None:
        """Remove a user from a team."""
        await self._client.request(
            "DELETE", f"/team-memberships/{team_id}/{user_id}"
        )

    # -- team invitations ----------------------------------------------------

    async def send_team_invitation(
        self,
        team_id: str,
        email: str,
        *,
        callback_url: Optional[str] = None,
    ) -> None:
        """Send an invitation email to join a team."""
        body = _build_params(
            email=email, team_id=team_id, callback_url=callback_url
        )
        await self._client.request(
            "POST", "/team-invitations/send-code", body=body
        )

    async def list_team_invitations(
        self, team_id: str
    ) -> list[TeamInvitation]:
        """List pending invitations for a team."""
        data = await self._client.request(
            "GET", f"/teams/{team_id}/invitations"
        )
        return [
            TeamInvitation.model_validate(item)
            for item in (data or {}).get("items", [])
        ]

    async def revoke_team_invitation(
        self, team_id: str, invitation_id: str
    ) -> None:
        """Revoke (delete) a team invitation."""
        await self._client.request(
            "DELETE", f"/teams/{team_id}/invitations/{invitation_id}"
        )

    # -- team member profiles ------------------------------------------------

    async def list_team_member_profiles(
        self, team_id: str
    ) -> list[TeamMemberProfile]:
        """List member profiles for a team."""
        data = await self._client.request(
            "GET", "/team-member-profiles", params={"team_id": team_id}
        )
        return [
            TeamMemberProfile.model_validate(item)
            for item in (data or {}).get("items", [])
        ]

    async def get_team_member_profile(
        self, team_id: str, user_id: str
    ) -> TeamMemberProfile | None:
        """Get a specific team member's profile.

        Fetches all member profiles for the team and filters by *user_id*.
        Returns ``None`` if no profile is found.
        """
        profiles = await self.list_team_member_profiles(team_id)
        return next((p for p in profiles if p.user_id == user_id), None)

    # -- permissions ---------------------------------------------------------

    async def grant_permission(
        self,
        user_id: str,
        permission_id: str,
        *,
        team_id: Optional[str] = None,
    ) -> None:
        """Grant a permission to a user."""
        body = _build_params(
            team_id=team_id, permission_id=permission_id
        )
        await self._client.request(
            "POST", f"/users/{user_id}/permissions", body=body
        )

    async def revoke_permission(
        self,
        user_id: str,
        permission_id: str,
        *,
        team_id: Optional[str] = None,
    ) -> None:
        """Revoke a permission from a user."""
        params = _build_params(team_id=team_id)
        await self._client.request(
            "DELETE",
            f"/users/{user_id}/permissions/{permission_id}",
            params=params,
        )

    async def list_permissions(
        self,
        user_id: str,
        *,
        team_id: Optional[str] = None,
        direct: Optional[bool] = None,
    ) -> list[TeamPermission]:
        """List permissions for a user."""
        params = _build_params(team_id=team_id, direct=direct)
        data = await self._client.request(
            "GET", f"/users/{user_id}/permissions", params=params
        )
        return [
            TeamPermission.model_validate(item)
            for item in (data or {}).get("items", [])
        ]

    async def has_permission(
        self,
        user_id: str,
        permission_id: str,
        *,
        team_id: Optional[str] = None,
    ) -> bool:
        """Check if a user has a specific permission."""
        params = _build_params(
            team_id=team_id, permission_id=permission_id
        )
        data = await self._client.request(
            "GET", f"/users/{user_id}/permissions", params=params
        )
        return len((data or {}).get("items", [])) > 0

    async def get_permission(
        self,
        user_id: str,
        permission_id: str,
        *,
        team_id: Optional[str] = None,
    ) -> TeamPermission | None:
        """Get a specific permission for a user."""
        params = _build_params(
            team_id=team_id, permission_id=permission_id
        )
        data = await self._client.request(
            "GET", f"/users/{user_id}/permissions", params=params
        )
        items = (data or {}).get("items", [])
        if not items:
            return None
        return TeamPermission.model_validate(items[0])

    # -- contact channels ----------------------------------------------------

    async def list_contact_channels(
        self, user_id: str
    ) -> list[ContactChannel]:
        """List contact channels for a user."""
        data = await self._client.request(
            "GET", "/contact-channels", params={"user_id": user_id}
        )
        return [
            ContactChannel.model_validate(item)
            for item in (data or {}).get("items", [])
        ]

    async def create_contact_channel(
        self,
        user_id: str,
        *,
        value: str,
        type: str = "email",
        used_for_auth: bool,
        is_primary: Optional[bool] = None,
        is_verified: Optional[bool] = None,
    ) -> ContactChannel:
        """Create a new contact channel for a user."""
        body = _build_params(
            user_id=user_id,
            value=value,
            type=type,
            used_for_auth=used_for_auth,
            is_primary=is_primary,
            is_verified=is_verified,
        )
        data = await self._client.request(
            "POST", "/contact-channels", body=body
        )
        return ContactChannel.model_validate(data)

    async def send_verification_code(
        self,
        contact_channel_id: str,
        *,
        callback_url: Optional[str] = None,
    ) -> None:
        """Send a verification email for a contact channel."""
        body = _build_params(callback_url=callback_url)
        await self._client.request(
            "POST",
            f"/contact-channels/{contact_channel_id}/send-verification-email",
            body=body,
        )

    async def verify_contact_channel(self, code: str) -> None:
        """Verify a contact channel with a verification code."""
        await self._client.request(
            "POST", "/contact-channels/verify", body={"code": code}
        )

    # -- API keys ------------------------------------------------------------

    async def create_user_api_key(
        self,
        user_id: str,
        *,
        description: str,
        expires_at_millis: Optional[int] = None,
        scope: Optional[str] = None,
        team_id: Optional[str] = None,
    ) -> UserApiKeyFirstView:
        """Create a user API key.

        Returns the key including the secret (only available at creation time).
        """
        body = _build_params(
            description=description,
            expires_at_millis=expires_at_millis,
            scope=scope,
            team_id=team_id,
        )
        data = await self._client.request(
            "POST", f"/users/{user_id}/api-keys", body=body
        )
        return UserApiKeyFirstView.model_validate(data)

    async def list_user_api_keys(self, user_id: str) -> list[UserApiKey]:
        """List API keys for a user."""
        data = await self._client.request(
            "GET", f"/users/{user_id}/api-keys"
        )
        return [
            UserApiKey.model_validate(item)
            for item in (data or {}).get("items", [])
        ]

    async def revoke_user_api_key(self, api_key_id: str) -> None:
        """Revoke (delete) a user API key."""
        await self._client.request("DELETE", f"/api-keys/{api_key_id}")

    async def create_team_api_key(
        self,
        team_id: str,
        *,
        description: str,
        expires_at_millis: Optional[int] = None,
        scope: Optional[str] = None,
    ) -> TeamApiKeyFirstView:
        """Create a team API key.

        Returns the key including the secret (only available at creation time).
        """
        body = _build_params(
            description=description,
            expires_at_millis=expires_at_millis,
            scope=scope,
        )
        data = await self._client.request(
            "POST", f"/teams/{team_id}/api-keys", body=body
        )
        return TeamApiKeyFirstView.model_validate(data)

    async def list_team_api_keys(self, team_id: str) -> list[TeamApiKey]:
        """List API keys for a team."""
        data = await self._client.request(
            "GET", f"/teams/{team_id}/api-keys"
        )
        return [
            TeamApiKey.model_validate(item)
            for item in (data or {}).get("items", [])
        ]

    async def revoke_team_api_key(self, api_key_id: str) -> None:
        """Revoke (delete) a team API key."""
        await self._client.request("DELETE", f"/api-keys/{api_key_id}")

    async def check_api_key(self, api_key: str) -> dict[str, Any] | None:
        """Validate an API key and return associated user/team info.

        Returns a dict with ``user_id`` and/or ``team_id``, or ``None``
        if the key is invalid.
        """
        try:
            data = await self._client.request(
                "POST", "/api-keys/check", body={"api_key": api_key}
            )
        except (NotFoundError, ApiKeyError):
            return None
        if data is None:
            return None
        return data

    # -- OAuth providers -----------------------------------------------------

    async def create_oauth_provider(
        self,
        user_id: str,
        *,
        account_id: str,
        provider_config_id: str,
        email: str,
        allow_sign_in: bool,
        allow_connected_accounts: bool,
    ) -> OAuthProvider:
        """Link an OAuth provider to a user."""
        body = _build_params(
            account_id=account_id,
            provider_config_id=provider_config_id,
            email=email,
            allow_sign_in=allow_sign_in,
            allow_connected_accounts=allow_connected_accounts,
        )
        data = await self._client.request(
            "POST", f"/users/{user_id}/oauth-providers", body=body
        )
        return OAuthProvider.model_validate(data)

    async def list_oauth_providers(
        self, user_id: str
    ) -> list[OAuthProvider]:
        """List OAuth providers linked to a user."""
        data = await self._client.request(
            "GET", f"/users/{user_id}/oauth-providers"
        )
        return [
            OAuthProvider.model_validate(item)
            for item in (data or {}).get("items", [])
        ]

    async def get_oauth_provider(
        self, user_id: str, provider_id: str
    ) -> OAuthProvider | None:
        """Get a specific OAuth provider for a user.

        Fetches all providers and filters by *provider_id*.
        Returns ``None`` if not found.
        """
        providers = await self.list_oauth_providers(user_id)
        return next((p for p in providers if p.id == provider_id), None)

    async def list_connected_accounts(
        self, user_id: str
    ) -> list[OAuthProvider]:
        """List connected accounts for a user.

        This is an alias for :meth:`list_oauth_providers`.
        """
        return await self.list_oauth_providers(user_id)
