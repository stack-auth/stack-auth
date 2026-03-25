"""Tests for StackServerApp and AsyncStackServerApp facade classes."""

from __future__ import annotations

import asyncio

import httpx
import pytest
import respx

from stack_auth._app import AsyncStackServerApp, StackServerApp


# ---------------------------------------------------------------------------
# Fixtures / helpers
# ---------------------------------------------------------------------------

USER_JSON = {
    "id": "user-123",
    "displayName": "Alice",
    "primaryEmail": "alice@example.com",
    "primaryEmailVerified": True,
    "profileImageUrl": None,
    "signedUpAtMillis": 1700000000000,
    "lastActiveAtMillis": 1700001000000,
    "clientMetadata": {},
    "clientReadOnlyMetadata": {},
    "serverMetadata": {"role": "admin"},
    "hasPassword": True,
    "otpAuthEnabled": False,
    "passkeyAuthEnabled": False,
    "isMultiFactorRequired": False,
    "isAnonymous": False,
    "isRestricted": False,
    "restrictedReason": None,
}

USERS_LIST_JSON = {
    "items": [USER_JSON],
    "pagination": {"next_cursor": "cursor-abc"},
}


BASE_URL = "https://api.stack-auth.com"
API_PREFIX = f"{BASE_URL}/api/v1"


# ---------------------------------------------------------------------------
# StackServerApp - Construction
# ---------------------------------------------------------------------------


class TestStackServerAppConstruction:
    def test_constructs_with_required_params(self) -> None:
        app = StackServerApp(project_id="proj", secret_server_key="sk")
        assert app is not None

    def test_constructs_with_optional_params(self) -> None:
        app = StackServerApp(
            project_id="proj",
            secret_server_key="sk",
            base_url="https://custom.example.com",
            token_store="memory",
        )
        assert app is not None

    def test_context_manager(self) -> None:
        with StackServerApp(project_id="proj", secret_server_key="sk") as app:
            assert app is not None


# ---------------------------------------------------------------------------
# StackServerApp - get_user
# ---------------------------------------------------------------------------


class TestGetUser:
    @respx.mock
    def test_get_user_success(self) -> None:
        respx.get(f"{API_PREFIX}/users/user-123").mock(
            return_value=httpx.Response(200, json=USER_JSON)
        )
        app = StackServerApp(project_id="proj", secret_server_key="sk")
        user = app.get_user("user-123")
        assert user is not None
        assert user.id == "user-123"
        assert user.display_name == "Alice"
        assert user.server_metadata == {"role": "admin"}

    @respx.mock
    def test_get_user_not_found(self) -> None:
        respx.get(f"{API_PREFIX}/users/nonexistent").mock(
            return_value=httpx.Response(
                200,
                json={"message": "User not found"},
                headers={
                    "x-stack-known-error": "USER_NOT_FOUND",
                    "x-stack-actual-status": "404",
                },
            )
        )
        app = StackServerApp(project_id="proj", secret_server_key="sk")
        user = app.get_user("nonexistent")
        assert user is None


# ---------------------------------------------------------------------------
# StackServerApp - list_users
# ---------------------------------------------------------------------------


class TestListUsers:
    @respx.mock
    def test_list_users_basic(self) -> None:
        respx.get(f"{API_PREFIX}/users").mock(
            return_value=httpx.Response(200, json=USERS_LIST_JSON)
        )
        app = StackServerApp(project_id="proj", secret_server_key="sk")
        result = app.list_users()
        assert len(result.items) == 1
        assert result.items[0].id == "user-123"
        assert result.next_cursor == "cursor-abc"
        assert result.has_next_page is True

    @respx.mock
    def test_list_users_with_params(self) -> None:
        route = respx.get(f"{API_PREFIX}/users").mock(
            return_value=httpx.Response(
                200, json={"items": [], "pagination": {}}
            )
        )
        app = StackServerApp(project_id="proj", secret_server_key="sk")
        result = app.list_users(
            cursor="abc",
            limit=10,
            order_by="created_at",
            desc=True,
            query="search",
            include_restricted=True,
            include_anonymous=False,
        )
        assert len(result.items) == 0
        # Verify query params were sent
        request = route.calls[0].request
        assert "cursor" in dict(request.url.params)
        assert request.url.params["cursor"] == "abc"
        assert request.url.params["limit"] == "10"


# ---------------------------------------------------------------------------
# StackServerApp - create_user
# ---------------------------------------------------------------------------


class TestCreateUser:
    @respx.mock
    def test_create_user_full(self) -> None:
        respx.post(f"{API_PREFIX}/users").mock(
            return_value=httpx.Response(200, json=USER_JSON)
        )
        app = StackServerApp(project_id="proj", secret_server_key="sk")
        user = app.create_user(
            primary_email="alice@example.com",
            password="secret123",
            display_name="Alice",
        )
        assert user.id == "user-123"
        assert user.primary_email == "alice@example.com"

    @respx.mock
    def test_create_user_omits_none_fields(self) -> None:
        route = respx.post(f"{API_PREFIX}/users").mock(
            return_value=httpx.Response(200, json=USER_JSON)
        )
        app = StackServerApp(project_id="proj", secret_server_key="sk")
        app.create_user(primary_email="a@b.com")
        request = route.calls[0].request
        import json

        body = json.loads(request.content)
        assert "primary_email" in body
        assert "password" not in body
        assert "display_name" not in body


# ---------------------------------------------------------------------------
# StackServerApp - update_user
# ---------------------------------------------------------------------------


class TestUpdateUser:
    @respx.mock
    def test_update_user_sends_only_provided_fields(self) -> None:
        route = respx.patch(f"{API_PREFIX}/users/user-123").mock(
            return_value=httpx.Response(200, json=USER_JSON)
        )
        app = StackServerApp(project_id="proj", secret_server_key="sk")
        user = app.update_user("user-123", display_name="New Name")
        assert user.id == "user-123"
        import json

        body = json.loads(route.calls[0].request.content)
        assert body == {"display_name": "New Name"}

    @respx.mock
    def test_update_user_sends_none_to_clear_field(self) -> None:
        route = respx.patch(f"{API_PREFIX}/users/user-123").mock(
            return_value=httpx.Response(200, json=USER_JSON)
        )
        app = StackServerApp(project_id="proj", secret_server_key="sk")
        app.update_user("user-123", display_name=None)
        import json

        body = json.loads(route.calls[0].request.content)
        assert body == {"display_name": None}

    @respx.mock
    def test_update_user_sentinel_distinguishes_not_provided(self) -> None:
        route = respx.patch(f"{API_PREFIX}/users/user-123").mock(
            return_value=httpx.Response(200, json=USER_JSON)
        )
        app = StackServerApp(project_id="proj", secret_server_key="sk")
        # Only provide display_name, not server_metadata
        app.update_user("user-123", display_name="X")
        import json

        body = json.loads(route.calls[0].request.content)
        assert "server_metadata" not in body
        assert body == {"display_name": "X"}


# ---------------------------------------------------------------------------
# StackServerApp - delete_user
# ---------------------------------------------------------------------------


class TestDeleteUser:
    @respx.mock
    def test_delete_user(self) -> None:
        respx.delete(f"{API_PREFIX}/users/user-123").mock(
            return_value=httpx.Response(200)
        )
        app = StackServerApp(project_id="proj", secret_server_key="sk")
        result = app.delete_user("user-123")
        assert result is None


# ---------------------------------------------------------------------------
# StackServerApp - get_user_by_api_key
# ---------------------------------------------------------------------------


class TestGetUserByApiKey:
    @respx.mock
    def test_get_user_by_api_key_success(self) -> None:
        respx.post(f"{API_PREFIX}/api-keys/check").mock(
            return_value=httpx.Response(200, json={"user_id": "user-123"})
        )
        respx.get(f"{API_PREFIX}/users/user-123").mock(
            return_value=httpx.Response(200, json=USER_JSON)
        )
        app = StackServerApp(project_id="proj", secret_server_key="sk")
        user = app.get_user_by_api_key("sk_abc")
        assert user is not None
        assert user.id == "user-123"

    @respx.mock
    def test_get_user_by_api_key_invalid(self) -> None:
        respx.post(f"{API_PREFIX}/api-keys/check").mock(
            return_value=httpx.Response(
                200,
                json={"message": "API key not valid"},
                headers={
                    "x-stack-known-error": "API_KEY_NOT_VALID",
                    "x-stack-actual-status": "400",
                },
            )
        )
        app = StackServerApp(project_id="proj", secret_server_key="sk")
        user = app.get_user_by_api_key("invalid")
        assert user is None

    @respx.mock
    def test_get_user_by_api_key_no_user_id(self) -> None:
        respx.post(f"{API_PREFIX}/api-keys/check").mock(
            return_value=httpx.Response(200, json={"team_id": "team-1"})
        )
        app = StackServerApp(project_id="proj", secret_server_key="sk")
        user = app.get_user_by_api_key("sk_team")
        assert user is None


# ---------------------------------------------------------------------------
# AsyncStackServerApp - Construction
# ---------------------------------------------------------------------------


class TestAsyncStackServerAppConstruction:
    def test_constructs_with_required_params(self) -> None:
        app = AsyncStackServerApp(project_id="proj", secret_server_key="sk")
        assert app is not None

    @pytest.mark.asyncio
    async def test_async_context_manager(self) -> None:
        async with AsyncStackServerApp(
            project_id="proj", secret_server_key="sk"
        ) as app:
            assert app is not None


# ---------------------------------------------------------------------------
# AsyncStackServerApp - get_user
# ---------------------------------------------------------------------------


class TestAsyncGetUser:
    @respx.mock
    @pytest.mark.asyncio
    async def test_get_user_success(self) -> None:
        respx.get(f"{API_PREFIX}/users/user-123").mock(
            return_value=httpx.Response(200, json=USER_JSON)
        )
        app = AsyncStackServerApp(project_id="proj", secret_server_key="sk")
        user = await app.get_user("user-123")
        assert user is not None
        assert user.id == "user-123"
        assert user.display_name == "Alice"
        await app.aclose()

    @respx.mock
    @pytest.mark.asyncio
    async def test_get_user_not_found(self) -> None:
        respx.get(f"{API_PREFIX}/users/nonexistent").mock(
            return_value=httpx.Response(
                200,
                json={"message": "User not found"},
                headers={
                    "x-stack-known-error": "USER_NOT_FOUND",
                    "x-stack-actual-status": "404",
                },
            )
        )
        app = AsyncStackServerApp(project_id="proj", secret_server_key="sk")
        user = await app.get_user("nonexistent")
        assert user is None
        await app.aclose()


# ---------------------------------------------------------------------------
# AsyncStackServerApp - list_users
# ---------------------------------------------------------------------------


class TestAsyncListUsers:
    @respx.mock
    @pytest.mark.asyncio
    async def test_list_users_basic(self) -> None:
        respx.get(f"{API_PREFIX}/users").mock(
            return_value=httpx.Response(200, json=USERS_LIST_JSON)
        )
        app = AsyncStackServerApp(project_id="proj", secret_server_key="sk")
        result = await app.list_users()
        assert len(result.items) == 1
        assert result.items[0].id == "user-123"
        assert result.next_cursor == "cursor-abc"
        await app.aclose()


# ---------------------------------------------------------------------------
# AsyncStackServerApp - create_user
# ---------------------------------------------------------------------------


class TestAsyncCreateUser:
    @respx.mock
    @pytest.mark.asyncio
    async def test_create_user(self) -> None:
        respx.post(f"{API_PREFIX}/users").mock(
            return_value=httpx.Response(200, json=USER_JSON)
        )
        app = AsyncStackServerApp(project_id="proj", secret_server_key="sk")
        user = await app.create_user(
            primary_email="alice@example.com",
            display_name="Alice",
        )
        assert user.id == "user-123"
        await app.aclose()


# ---------------------------------------------------------------------------
# AsyncStackServerApp - update_user
# ---------------------------------------------------------------------------


class TestAsyncUpdateUser:
    @respx.mock
    @pytest.mark.asyncio
    async def test_update_user(self) -> None:
        route = respx.patch(f"{API_PREFIX}/users/user-123").mock(
            return_value=httpx.Response(200, json=USER_JSON)
        )
        app = AsyncStackServerApp(project_id="proj", secret_server_key="sk")
        user = await app.update_user("user-123", display_name="New")
        assert user.id == "user-123"
        import json

        body = json.loads(route.calls[0].request.content)
        assert body == {"display_name": "New"}
        await app.aclose()


# ---------------------------------------------------------------------------
# AsyncStackServerApp - delete_user
# ---------------------------------------------------------------------------


class TestAsyncDeleteUser:
    @respx.mock
    @pytest.mark.asyncio
    async def test_delete_user(self) -> None:
        respx.delete(f"{API_PREFIX}/users/user-123").mock(
            return_value=httpx.Response(200)
        )
        app = AsyncStackServerApp(project_id="proj", secret_server_key="sk")
        result = await app.delete_user("user-123")
        assert result is None
        await app.aclose()


# ---------------------------------------------------------------------------
# AsyncStackServerApp - get_user_by_api_key
# ---------------------------------------------------------------------------


class TestAsyncGetUserByApiKey:
    @respx.mock
    @pytest.mark.asyncio
    async def test_get_user_by_api_key_success(self) -> None:
        respx.post(f"{API_PREFIX}/api-keys/check").mock(
            return_value=httpx.Response(200, json={"user_id": "user-123"})
        )
        respx.get(f"{API_PREFIX}/users/user-123").mock(
            return_value=httpx.Response(200, json=USER_JSON)
        )
        app = AsyncStackServerApp(project_id="proj", secret_server_key="sk")
        user = await app.get_user_by_api_key("sk_abc")
        assert user is not None
        assert user.id == "user-123"
        await app.aclose()

    @respx.mock
    @pytest.mark.asyncio
    async def test_get_user_by_api_key_invalid(self) -> None:
        respx.post(f"{API_PREFIX}/api-keys/check").mock(
            return_value=httpx.Response(
                200,
                json={"message": "API key not valid"},
                headers={
                    "x-stack-known-error": "API_KEY_NOT_VALID",
                    "x-stack-actual-status": "400",
                },
            )
        )
        app = AsyncStackServerApp(project_id="proj", secret_server_key="sk")
        user = await app.get_user_by_api_key("invalid")
        assert user is None
        await app.aclose()
