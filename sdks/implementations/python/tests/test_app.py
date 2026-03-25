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


# ---------------------------------------------------------------------------
# Session test data
# ---------------------------------------------------------------------------

SESSION_JSON = {
    "id": "sess-1",
    "userId": "user-123",
    "createdAtMillis": 1700000000000,
    "isImpersonation": False,
    "lastUsedAtMillis": 1700001000000,
    "isCurrentSession": False,
    "geoInfo": {
        "city": "San Francisco",
        "region": "CA",
        "country": "US",
        "countryName": "United States",
        "latitude": 37.7749,
        "longitude": -122.4194,
    },
}

SESSION_JSON_2 = {
    "id": "sess-2",
    "userId": "user-123",
    "createdAtMillis": 1700002000000,
    "isImpersonation": False,
    "lastUsedAtMillis": None,
    "isCurrentSession": True,
    "geoInfo": None,
}

SESSIONS_LIST_JSON = {"items": [SESSION_JSON, SESSION_JSON_2]}


# ---------------------------------------------------------------------------
# StackServerApp - list_sessions
# ---------------------------------------------------------------------------


class TestListSessions:
    @respx.mock
    def test_list_sessions(self) -> None:
        respx.get(f"{API_PREFIX}/auth/sessions").mock(
            return_value=httpx.Response(200, json=SESSIONS_LIST_JSON)
        )
        app = StackServerApp(project_id="proj", secret_server_key="sk")
        sessions = app.list_sessions("user-123")
        assert len(sessions) == 2
        assert sessions[0].id == "sess-1"
        assert sessions[0].user_id == "user-123"
        assert sessions[0].geo_info is not None
        assert sessions[0].geo_info.city == "San Francisco"
        assert sessions[1].id == "sess-2"
        assert sessions[1].is_current_session is True

    @respx.mock
    def test_list_sessions_sends_user_id_param(self) -> None:
        route = respx.get(f"{API_PREFIX}/auth/sessions").mock(
            return_value=httpx.Response(200, json={"items": []})
        )
        app = StackServerApp(project_id="proj", secret_server_key="sk")
        sessions = app.list_sessions("user-456")
        assert sessions == []
        request = route.calls[0].request
        assert request.url.params["user_id"] == "user-456"

    @respx.mock
    def test_list_sessions_empty(self) -> None:
        respx.get(f"{API_PREFIX}/auth/sessions").mock(
            return_value=httpx.Response(200, json={"items": []})
        )
        app = StackServerApp(project_id="proj", secret_server_key="sk")
        sessions = app.list_sessions("user-123")
        assert sessions == []


# ---------------------------------------------------------------------------
# StackServerApp - get_session
# ---------------------------------------------------------------------------


class TestGetSession:
    @respx.mock
    def test_get_session_found(self) -> None:
        respx.get(f"{API_PREFIX}/auth/sessions").mock(
            return_value=httpx.Response(200, json=SESSIONS_LIST_JSON)
        )
        app = StackServerApp(project_id="proj", secret_server_key="sk")
        session = app.get_session("sess-1", user_id="user-123")
        assert session is not None
        assert session.id == "sess-1"

    @respx.mock
    def test_get_session_not_found(self) -> None:
        respx.get(f"{API_PREFIX}/auth/sessions").mock(
            return_value=httpx.Response(200, json=SESSIONS_LIST_JSON)
        )
        app = StackServerApp(project_id="proj", secret_server_key="sk")
        session = app.get_session("nonexistent", user_id="user-123")
        assert session is None


# ---------------------------------------------------------------------------
# StackServerApp - revoke_session
# ---------------------------------------------------------------------------


class TestRevokeSession:
    @respx.mock
    def test_revoke_session(self) -> None:
        route = respx.delete(f"{API_PREFIX}/auth/sessions/sess-1").mock(
            return_value=httpx.Response(200)
        )
        app = StackServerApp(project_id="proj", secret_server_key="sk")
        result = app.revoke_session("sess-1", user_id="user-123")
        assert result is None
        request = route.calls[0].request
        assert request.url.params["user_id"] == "user-123"


# ---------------------------------------------------------------------------
# AsyncStackServerApp - list_sessions
# ---------------------------------------------------------------------------


class TestAsyncListSessions:
    @respx.mock
    @pytest.mark.asyncio
    async def test_list_sessions(self) -> None:
        respx.get(f"{API_PREFIX}/auth/sessions").mock(
            return_value=httpx.Response(200, json=SESSIONS_LIST_JSON)
        )
        app = AsyncStackServerApp(project_id="proj", secret_server_key="sk")
        sessions = await app.list_sessions("user-123")
        assert len(sessions) == 2
        assert sessions[0].id == "sess-1"
        assert sessions[1].id == "sess-2"
        await app.aclose()

    @respx.mock
    @pytest.mark.asyncio
    async def test_list_sessions_empty(self) -> None:
        respx.get(f"{API_PREFIX}/auth/sessions").mock(
            return_value=httpx.Response(200, json={"items": []})
        )
        app = AsyncStackServerApp(project_id="proj", secret_server_key="sk")
        sessions = await app.list_sessions("user-123")
        assert sessions == []
        await app.aclose()


# ---------------------------------------------------------------------------
# AsyncStackServerApp - get_session
# ---------------------------------------------------------------------------


class TestAsyncGetSession:
    @respx.mock
    @pytest.mark.asyncio
    async def test_get_session_found(self) -> None:
        respx.get(f"{API_PREFIX}/auth/sessions").mock(
            return_value=httpx.Response(200, json=SESSIONS_LIST_JSON)
        )
        app = AsyncStackServerApp(project_id="proj", secret_server_key="sk")
        session = await app.get_session("sess-1", user_id="user-123")
        assert session is not None
        assert session.id == "sess-1"
        await app.aclose()

    @respx.mock
    @pytest.mark.asyncio
    async def test_get_session_not_found(self) -> None:
        respx.get(f"{API_PREFIX}/auth/sessions").mock(
            return_value=httpx.Response(200, json=SESSIONS_LIST_JSON)
        )
        app = AsyncStackServerApp(project_id="proj", secret_server_key="sk")
        session = await app.get_session("nonexistent", user_id="user-123")
        assert session is None
        await app.aclose()


# ---------------------------------------------------------------------------
# AsyncStackServerApp - revoke_session
# ---------------------------------------------------------------------------


class TestAsyncRevokeSession:
    @respx.mock
    @pytest.mark.asyncio
    async def test_revoke_session(self) -> None:
        route = respx.delete(f"{API_PREFIX}/auth/sessions/sess-1").mock(
            return_value=httpx.Response(200)
        )
        app = AsyncStackServerApp(project_id="proj", secret_server_key="sk")
        result = await app.revoke_session("sess-1", user_id="user-123")
        assert result is None
        request = route.calls[0].request
        assert request.url.params["user_id"] == "user-123"
        await app.aclose()


# ---------------------------------------------------------------------------
# Team test data
# ---------------------------------------------------------------------------

TEAM_JSON = {
    "id": "team-123",
    "displayName": "Engineering",
    "profileImageUrl": None,
    "clientMetadata": {},
    "clientReadOnlyMetadata": {},
    "serverMetadata": {"tier": "pro"},
    "createdAtMillis": 1700000000000,
}

TEAM_JSON_2 = {
    "id": "team-456",
    "displayName": "Design",
    "profileImageUrl": "https://img.example.com/design.png",
    "clientMetadata": {"color": "blue"},
    "clientReadOnlyMetadata": {},
    "serverMetadata": {},
    "createdAtMillis": 1700001000000,
}

TEAMS_LIST_JSON = {"items": [TEAM_JSON, TEAM_JSON_2]}


# ---------------------------------------------------------------------------
# StackServerApp - get_team
# ---------------------------------------------------------------------------


class TestGetTeam:
    @respx.mock
    def test_get_team_success(self) -> None:
        respx.get(f"{API_PREFIX}/teams/team-123").mock(
            return_value=httpx.Response(200, json=TEAM_JSON)
        )
        app = StackServerApp(project_id="proj", secret_server_key="sk")
        team = app.get_team("team-123")
        assert team is not None
        assert team.id == "team-123"
        assert team.display_name == "Engineering"
        assert team.server_metadata == {"tier": "pro"}

    @respx.mock
    def test_get_team_not_found(self) -> None:
        respx.get(f"{API_PREFIX}/teams/nonexistent").mock(
            return_value=httpx.Response(
                200,
                json={"message": "Team not found"},
                headers={
                    "x-stack-known-error": "TEAM_NOT_FOUND",
                    "x-stack-actual-status": "404",
                },
            )
        )
        app = StackServerApp(project_id="proj", secret_server_key="sk")
        team = app.get_team("nonexistent")
        assert team is None


# ---------------------------------------------------------------------------
# StackServerApp - list_teams
# ---------------------------------------------------------------------------


class TestListTeams:
    @respx.mock
    def test_list_teams_basic(self) -> None:
        respx.get(f"{API_PREFIX}/teams").mock(
            return_value=httpx.Response(200, json=TEAMS_LIST_JSON)
        )
        app = StackServerApp(project_id="proj", secret_server_key="sk")
        teams = app.list_teams()
        assert len(teams) == 2
        assert teams[0].id == "team-123"
        assert teams[1].id == "team-456"

    @respx.mock
    def test_list_teams_with_user_id(self) -> None:
        route = respx.get(f"{API_PREFIX}/teams").mock(
            return_value=httpx.Response(200, json={"items": [TEAM_JSON]})
        )
        app = StackServerApp(project_id="proj", secret_server_key="sk")
        teams = app.list_teams(user_id="user-1")
        assert len(teams) == 1
        request = route.calls[0].request
        assert request.url.params["user_id"] == "user-1"


# ---------------------------------------------------------------------------
# StackServerApp - create_team
# ---------------------------------------------------------------------------


class TestCreateTeam:
    @respx.mock
    def test_create_team_basic(self) -> None:
        respx.post(f"{API_PREFIX}/teams").mock(
            return_value=httpx.Response(200, json=TEAM_JSON)
        )
        app = StackServerApp(project_id="proj", secret_server_key="sk")
        team = app.create_team(display_name="Engineering")
        assert team.id == "team-123"
        assert team.display_name == "Engineering"

    @respx.mock
    def test_create_team_with_optional_fields(self) -> None:
        route = respx.post(f"{API_PREFIX}/teams").mock(
            return_value=httpx.Response(200, json=TEAM_JSON)
        )
        app = StackServerApp(project_id="proj", secret_server_key="sk")
        app.create_team(
            display_name="Eng",
            profile_image_url="https://img.example.com/eng.png",
            creator_user_id="user-1",
        )
        import json

        body = json.loads(route.calls[0].request.content)
        assert body["display_name"] == "Eng"
        assert body["profile_image_url"] == "https://img.example.com/eng.png"
        assert body["creator_user_id"] == "user-1"


# ---------------------------------------------------------------------------
# StackServerApp - update_team
# ---------------------------------------------------------------------------


class TestUpdateTeam:
    @respx.mock
    def test_update_team_sends_only_provided_fields(self) -> None:
        route = respx.patch(f"{API_PREFIX}/teams/team-123").mock(
            return_value=httpx.Response(200, json=TEAM_JSON)
        )
        app = StackServerApp(project_id="proj", secret_server_key="sk")
        team = app.update_team("team-123", display_name="New Name")
        assert team.id == "team-123"
        import json

        body = json.loads(route.calls[0].request.content)
        assert body == {"display_name": "New Name"}

    @respx.mock
    def test_update_team_sends_none_to_clear_field(self) -> None:
        route = respx.patch(f"{API_PREFIX}/teams/team-123").mock(
            return_value=httpx.Response(200, json=TEAM_JSON)
        )
        app = StackServerApp(project_id="proj", secret_server_key="sk")
        app.update_team("team-123", profile_image_url=None)
        import json

        body = json.loads(route.calls[0].request.content)
        assert body == {"profile_image_url": None}

    @respx.mock
    def test_update_team_unset_sentinel(self) -> None:
        route = respx.patch(f"{API_PREFIX}/teams/team-123").mock(
            return_value=httpx.Response(200, json=TEAM_JSON)
        )
        app = StackServerApp(project_id="proj", secret_server_key="sk")
        app.update_team("team-123", display_name="X")
        import json

        body = json.loads(route.calls[0].request.content)
        assert "server_metadata" not in body
        assert "client_metadata" not in body


# ---------------------------------------------------------------------------
# StackServerApp - delete_team
# ---------------------------------------------------------------------------


class TestDeleteTeam:
    @respx.mock
    def test_delete_team(self) -> None:
        respx.delete(f"{API_PREFIX}/teams/team-123").mock(
            return_value=httpx.Response(200)
        )
        app = StackServerApp(project_id="proj", secret_server_key="sk")
        result = app.delete_team("team-123")
        assert result is None


# ---------------------------------------------------------------------------
# StackServerApp - get_team_by_api_key
# ---------------------------------------------------------------------------


class TestGetTeamByApiKey:
    @respx.mock
    def test_get_team_by_api_key_success(self) -> None:
        respx.post(f"{API_PREFIX}/api-keys/check").mock(
            return_value=httpx.Response(200, json={"team_id": "team-123"})
        )
        respx.get(f"{API_PREFIX}/teams/team-123").mock(
            return_value=httpx.Response(200, json=TEAM_JSON)
        )
        app = StackServerApp(project_id="proj", secret_server_key="sk")
        team = app.get_team_by_api_key("sk_team_abc")
        assert team is not None
        assert team.id == "team-123"

    @respx.mock
    def test_get_team_by_api_key_invalid(self) -> None:
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
        team = app.get_team_by_api_key("invalid")
        assert team is None

    @respx.mock
    def test_get_team_by_api_key_no_team_id(self) -> None:
        respx.post(f"{API_PREFIX}/api-keys/check").mock(
            return_value=httpx.Response(200, json={"user_id": "user-1"})
        )
        app = StackServerApp(project_id="proj", secret_server_key="sk")
        team = app.get_team_by_api_key("sk_user_only")
        assert team is None


# ---------------------------------------------------------------------------
# AsyncStackServerApp - Team CRUD
# ---------------------------------------------------------------------------


class TestAsyncGetTeam:
    @respx.mock
    @pytest.mark.asyncio
    async def test_get_team_success(self) -> None:
        respx.get(f"{API_PREFIX}/teams/team-123").mock(
            return_value=httpx.Response(200, json=TEAM_JSON)
        )
        app = AsyncStackServerApp(project_id="proj", secret_server_key="sk")
        team = await app.get_team("team-123")
        assert team is not None
        assert team.id == "team-123"
        assert team.display_name == "Engineering"
        await app.aclose()

    @respx.mock
    @pytest.mark.asyncio
    async def test_get_team_not_found(self) -> None:
        respx.get(f"{API_PREFIX}/teams/nonexistent").mock(
            return_value=httpx.Response(
                200,
                json={"message": "Team not found"},
                headers={
                    "x-stack-known-error": "TEAM_NOT_FOUND",
                    "x-stack-actual-status": "404",
                },
            )
        )
        app = AsyncStackServerApp(project_id="proj", secret_server_key="sk")
        team = await app.get_team("nonexistent")
        assert team is None
        await app.aclose()


class TestAsyncListTeams:
    @respx.mock
    @pytest.mark.asyncio
    async def test_list_teams(self) -> None:
        respx.get(f"{API_PREFIX}/teams").mock(
            return_value=httpx.Response(200, json=TEAMS_LIST_JSON)
        )
        app = AsyncStackServerApp(project_id="proj", secret_server_key="sk")
        teams = await app.list_teams()
        assert len(teams) == 2
        assert teams[0].id == "team-123"
        await app.aclose()


class TestAsyncCreateTeam:
    @respx.mock
    @pytest.mark.asyncio
    async def test_create_team(self) -> None:
        respx.post(f"{API_PREFIX}/teams").mock(
            return_value=httpx.Response(200, json=TEAM_JSON)
        )
        app = AsyncStackServerApp(project_id="proj", secret_server_key="sk")
        team = await app.create_team(display_name="Engineering")
        assert team.id == "team-123"
        await app.aclose()


class TestAsyncUpdateTeam:
    @respx.mock
    @pytest.mark.asyncio
    async def test_update_team(self) -> None:
        route = respx.patch(f"{API_PREFIX}/teams/team-123").mock(
            return_value=httpx.Response(200, json=TEAM_JSON)
        )
        app = AsyncStackServerApp(project_id="proj", secret_server_key="sk")
        team = await app.update_team("team-123", display_name="New")
        assert team.id == "team-123"
        import json

        body = json.loads(route.calls[0].request.content)
        assert body == {"display_name": "New"}
        await app.aclose()


class TestAsyncDeleteTeam:
    @respx.mock
    @pytest.mark.asyncio
    async def test_delete_team(self) -> None:
        respx.delete(f"{API_PREFIX}/teams/team-123").mock(
            return_value=httpx.Response(200)
        )
        app = AsyncStackServerApp(project_id="proj", secret_server_key="sk")
        result = await app.delete_team("team-123")
        assert result is None
        await app.aclose()


class TestAsyncGetTeamByApiKey:
    @respx.mock
    @pytest.mark.asyncio
    async def test_get_team_by_api_key_success(self) -> None:
        respx.post(f"{API_PREFIX}/api-keys/check").mock(
            return_value=httpx.Response(200, json={"team_id": "team-123"})
        )
        respx.get(f"{API_PREFIX}/teams/team-123").mock(
            return_value=httpx.Response(200, json=TEAM_JSON)
        )
        app = AsyncStackServerApp(project_id="proj", secret_server_key="sk")
        team = await app.get_team_by_api_key("sk_team_abc")
        assert team is not None
        assert team.id == "team-123"
        await app.aclose()

    @respx.mock
    @pytest.mark.asyncio
    async def test_get_team_by_api_key_invalid(self) -> None:
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
        team = await app.get_team_by_api_key("invalid")
        assert team is None
        await app.aclose()


# ---------------------------------------------------------------------------
# Team membership test data
# ---------------------------------------------------------------------------

TEAM_MEMBER_PROFILE_JSON = {
    "userId": "user-1",
    "displayName": "Alice",
    "profileImageUrl": None,
}

TEAM_MEMBER_PROFILE_JSON_2 = {
    "userId": "user-2",
    "displayName": "Bob",
    "profileImageUrl": "https://img.example.com/bob.png",
}

TEAM_MEMBER_PROFILES_LIST_JSON = {
    "items": [TEAM_MEMBER_PROFILE_JSON, TEAM_MEMBER_PROFILE_JSON_2]
}

INVITATION_JSON = {
    "id": "inv-1",
    "recipientEmail": "alice@example.com",
    "expiresAtMillis": 1700100000000,
}

INVITATION_JSON_2 = {
    "id": "inv-2",
    "recipientEmail": "bob@example.com",
    "expiresAtMillis": 1700200000000,
}

INVITATIONS_LIST_JSON = {"items": [INVITATION_JSON, INVITATION_JSON_2]}


# ---------------------------------------------------------------------------
# StackServerApp - add_team_member / remove_team_member
# ---------------------------------------------------------------------------


class TestAddTeamMember:
    @respx.mock
    def test_add_team_member(self) -> None:
        route = respx.post(
            f"{API_PREFIX}/team-memberships/team-1/user-1"
        ).mock(return_value=httpx.Response(200))
        app = StackServerApp(project_id="proj", secret_server_key="sk")
        result = app.add_team_member("team-1", "user-1")
        assert result is None
        assert route.called


class TestRemoveTeamMember:
    @respx.mock
    def test_remove_team_member(self) -> None:
        route = respx.delete(
            f"{API_PREFIX}/team-memberships/team-1/user-1"
        ).mock(return_value=httpx.Response(200))
        app = StackServerApp(project_id="proj", secret_server_key="sk")
        result = app.remove_team_member("team-1", "user-1")
        assert result is None
        assert route.called


# ---------------------------------------------------------------------------
# StackServerApp - team invitations
# ---------------------------------------------------------------------------


class TestSendTeamInvitation:
    @respx.mock
    def test_send_team_invitation_basic(self) -> None:
        route = respx.post(
            f"{API_PREFIX}/team-invitations/send-code"
        ).mock(return_value=httpx.Response(200))
        app = StackServerApp(project_id="proj", secret_server_key="sk")
        result = app.send_team_invitation("team-1", "a@b.com")
        assert result is None
        import json

        body = json.loads(route.calls[0].request.content)
        assert body["email"] == "a@b.com"
        assert body["team_id"] == "team-1"

    @respx.mock
    def test_send_team_invitation_with_callback_url(self) -> None:
        route = respx.post(
            f"{API_PREFIX}/team-invitations/send-code"
        ).mock(return_value=httpx.Response(200))
        app = StackServerApp(project_id="proj", secret_server_key="sk")
        app.send_team_invitation(
            "team-1", "a@b.com", callback_url="https://example.com/accept"
        )
        import json

        body = json.loads(route.calls[0].request.content)
        assert body["callback_url"] == "https://example.com/accept"


class TestListTeamInvitations:
    @respx.mock
    def test_list_team_invitations(self) -> None:
        respx.get(f"{API_PREFIX}/teams/team-1/invitations").mock(
            return_value=httpx.Response(200, json=INVITATIONS_LIST_JSON)
        )
        app = StackServerApp(project_id="proj", secret_server_key="sk")
        invitations = app.list_team_invitations("team-1")
        assert len(invitations) == 2
        assert invitations[0].id == "inv-1"
        assert invitations[0].recipient_email == "alice@example.com"
        assert invitations[1].id == "inv-2"


class TestRevokeTeamInvitation:
    @respx.mock
    def test_revoke_team_invitation(self) -> None:
        route = respx.delete(
            f"{API_PREFIX}/teams/team-1/invitations/inv-1"
        ).mock(return_value=httpx.Response(200))
        app = StackServerApp(project_id="proj", secret_server_key="sk")
        result = app.revoke_team_invitation("team-1", "inv-1")
        assert result is None
        assert route.called


# ---------------------------------------------------------------------------
# StackServerApp - team member profiles
# ---------------------------------------------------------------------------


class TestListTeamMemberProfiles:
    @respx.mock
    def test_list_team_member_profiles(self) -> None:
        respx.get(f"{API_PREFIX}/team-member-profiles").mock(
            return_value=httpx.Response(
                200, json=TEAM_MEMBER_PROFILES_LIST_JSON
            )
        )
        app = StackServerApp(project_id="proj", secret_server_key="sk")
        profiles = app.list_team_member_profiles("team-1")
        assert len(profiles) == 2
        assert profiles[0].user_id == "user-1"
        assert profiles[0].display_name == "Alice"
        assert profiles[1].user_id == "user-2"


class TestGetTeamMemberProfile:
    @respx.mock
    def test_get_team_member_profile_found(self) -> None:
        respx.get(f"{API_PREFIX}/team-member-profiles").mock(
            return_value=httpx.Response(
                200, json=TEAM_MEMBER_PROFILES_LIST_JSON
            )
        )
        app = StackServerApp(project_id="proj", secret_server_key="sk")
        profile = app.get_team_member_profile("team-1", "user-2")
        assert profile is not None
        assert profile.user_id == "user-2"
        assert profile.display_name == "Bob"

    @respx.mock
    def test_get_team_member_profile_not_found(self) -> None:
        respx.get(f"{API_PREFIX}/team-member-profiles").mock(
            return_value=httpx.Response(
                200, json=TEAM_MEMBER_PROFILES_LIST_JSON
            )
        )
        app = StackServerApp(project_id="proj", secret_server_key="sk")
        profile = app.get_team_member_profile("team-1", "nonexistent")
        assert profile is None


# ---------------------------------------------------------------------------
# AsyncStackServerApp - membership, invitations, profiles
# ---------------------------------------------------------------------------


class TestAsyncAddTeamMember:
    @respx.mock
    @pytest.mark.asyncio
    async def test_add_team_member(self) -> None:
        respx.post(f"{API_PREFIX}/team-memberships/team-1/user-1").mock(
            return_value=httpx.Response(200)
        )
        app = AsyncStackServerApp(project_id="proj", secret_server_key="sk")
        result = await app.add_team_member("team-1", "user-1")
        assert result is None
        await app.aclose()


class TestAsyncRemoveTeamMember:
    @respx.mock
    @pytest.mark.asyncio
    async def test_remove_team_member(self) -> None:
        respx.delete(f"{API_PREFIX}/team-memberships/team-1/user-1").mock(
            return_value=httpx.Response(200)
        )
        app = AsyncStackServerApp(project_id="proj", secret_server_key="sk")
        result = await app.remove_team_member("team-1", "user-1")
        assert result is None
        await app.aclose()


class TestAsyncSendTeamInvitation:
    @respx.mock
    @pytest.mark.asyncio
    async def test_send_team_invitation(self) -> None:
        route = respx.post(
            f"{API_PREFIX}/team-invitations/send-code"
        ).mock(return_value=httpx.Response(200))
        app = AsyncStackServerApp(project_id="proj", secret_server_key="sk")
        result = await app.send_team_invitation("team-1", "a@b.com")
        assert result is None
        import json

        body = json.loads(route.calls[0].request.content)
        assert body["email"] == "a@b.com"
        assert body["team_id"] == "team-1"
        await app.aclose()


class TestAsyncListTeamInvitations:
    @respx.mock
    @pytest.mark.asyncio
    async def test_list_team_invitations(self) -> None:
        respx.get(f"{API_PREFIX}/teams/team-1/invitations").mock(
            return_value=httpx.Response(200, json=INVITATIONS_LIST_JSON)
        )
        app = AsyncStackServerApp(project_id="proj", secret_server_key="sk")
        invitations = await app.list_team_invitations("team-1")
        assert len(invitations) == 2
        assert invitations[0].id == "inv-1"
        await app.aclose()


class TestAsyncRevokeTeamInvitation:
    @respx.mock
    @pytest.mark.asyncio
    async def test_revoke_team_invitation(self) -> None:
        respx.delete(f"{API_PREFIX}/teams/team-1/invitations/inv-1").mock(
            return_value=httpx.Response(200)
        )
        app = AsyncStackServerApp(project_id="proj", secret_server_key="sk")
        result = await app.revoke_team_invitation("team-1", "inv-1")
        assert result is None
        await app.aclose()


class TestAsyncListTeamMemberProfiles:
    @respx.mock
    @pytest.mark.asyncio
    async def test_list_team_member_profiles(self) -> None:
        respx.get(f"{API_PREFIX}/team-member-profiles").mock(
            return_value=httpx.Response(
                200, json=TEAM_MEMBER_PROFILES_LIST_JSON
            )
        )
        app = AsyncStackServerApp(project_id="proj", secret_server_key="sk")
        profiles = await app.list_team_member_profiles("team-1")
        assert len(profiles) == 2
        assert profiles[0].user_id == "user-1"
        await app.aclose()


class TestAsyncGetTeamMemberProfile:
    @respx.mock
    @pytest.mark.asyncio
    async def test_get_team_member_profile_found(self) -> None:
        respx.get(f"{API_PREFIX}/team-member-profiles").mock(
            return_value=httpx.Response(
                200, json=TEAM_MEMBER_PROFILES_LIST_JSON
            )
        )
        app = AsyncStackServerApp(project_id="proj", secret_server_key="sk")
        profile = await app.get_team_member_profile("team-1", "user-2")
        assert profile is not None
        assert profile.display_name == "Bob"
        await app.aclose()

    @respx.mock
    @pytest.mark.asyncio
    async def test_get_team_member_profile_not_found(self) -> None:
        respx.get(f"{API_PREFIX}/team-member-profiles").mock(
            return_value=httpx.Response(
                200, json=TEAM_MEMBER_PROFILES_LIST_JSON
            )
        )
        app = AsyncStackServerApp(project_id="proj", secret_server_key="sk")
        profile = await app.get_team_member_profile("team-1", "nonexistent")
        assert profile is None
        await app.aclose()


# ---------------------------------------------------------------------------
# Permission test data
# ---------------------------------------------------------------------------

PERMISSION_JSON = {"id": "read"}
PERMISSION_JSON_2 = {"id": "write"}
PERMISSIONS_LIST_JSON = {"items": [PERMISSION_JSON, PERMISSION_JSON_2]}


# ---------------------------------------------------------------------------
# StackServerApp - grant_permission
# ---------------------------------------------------------------------------


class TestGrantPermission:
    @respx.mock
    def test_grant_permission_with_team_id(self) -> None:
        route = respx.post(
            f"{API_PREFIX}/users/user-1/permissions"
        ).mock(return_value=httpx.Response(200))
        app = StackServerApp(project_id="proj", secret_server_key="sk")
        result = app.grant_permission("user-1", "read", team_id="team-1")
        assert result is None
        import json

        body = json.loads(route.calls[0].request.content)
        assert body["permission_id"] == "read"
        assert body["team_id"] == "team-1"

    @respx.mock
    def test_grant_permission_project_level(self) -> None:
        route = respx.post(
            f"{API_PREFIX}/users/user-1/permissions"
        ).mock(return_value=httpx.Response(200))
        app = StackServerApp(project_id="proj", secret_server_key="sk")
        app.grant_permission("user-1", "admin")
        import json

        body = json.loads(route.calls[0].request.content)
        assert body["permission_id"] == "admin"
        assert "team_id" not in body


# ---------------------------------------------------------------------------
# StackServerApp - revoke_permission
# ---------------------------------------------------------------------------


class TestRevokePermission:
    @respx.mock
    def test_revoke_permission_with_team_id(self) -> None:
        route = respx.delete(
            f"{API_PREFIX}/users/user-1/permissions/read"
        ).mock(return_value=httpx.Response(200))
        app = StackServerApp(project_id="proj", secret_server_key="sk")
        result = app.revoke_permission("user-1", "read", team_id="team-1")
        assert result is None
        request = route.calls[0].request
        assert request.url.params["team_id"] == "team-1"

    @respx.mock
    def test_revoke_permission_project_level(self) -> None:
        route = respx.delete(
            f"{API_PREFIX}/users/user-1/permissions/admin"
        ).mock(return_value=httpx.Response(200))
        app = StackServerApp(project_id="proj", secret_server_key="sk")
        app.revoke_permission("user-1", "admin")
        request = route.calls[0].request
        assert "team_id" not in dict(request.url.params)


# ---------------------------------------------------------------------------
# StackServerApp - list_permissions
# ---------------------------------------------------------------------------


class TestListPermissions:
    @respx.mock
    def test_list_permissions_with_team_id(self) -> None:
        route = respx.get(
            f"{API_PREFIX}/users/user-1/permissions"
        ).mock(return_value=httpx.Response(200, json=PERMISSIONS_LIST_JSON))
        app = StackServerApp(project_id="proj", secret_server_key="sk")
        perms = app.list_permissions("user-1", team_id="team-1")
        assert len(perms) == 2
        assert perms[0].id == "read"
        assert perms[1].id == "write"
        request = route.calls[0].request
        assert request.url.params["team_id"] == "team-1"

    @respx.mock
    def test_list_permissions_with_direct(self) -> None:
        route = respx.get(
            f"{API_PREFIX}/users/user-1/permissions"
        ).mock(
            return_value=httpx.Response(
                200, json={"items": [PERMISSION_JSON]}
            )
        )
        app = StackServerApp(project_id="proj", secret_server_key="sk")
        perms = app.list_permissions(
            "user-1", team_id="team-1", direct=True
        )
        assert len(perms) == 1
        request = route.calls[0].request
        assert request.url.params["direct"] == "true"


# ---------------------------------------------------------------------------
# StackServerApp - has_permission
# ---------------------------------------------------------------------------


class TestHasPermission:
    @respx.mock
    def test_has_permission_true(self) -> None:
        respx.get(f"{API_PREFIX}/users/user-1/permissions").mock(
            return_value=httpx.Response(
                200, json={"items": [PERMISSION_JSON]}
            )
        )
        app = StackServerApp(project_id="proj", secret_server_key="sk")
        assert app.has_permission("user-1", "read", team_id="team-1") is True

    @respx.mock
    def test_has_permission_false(self) -> None:
        respx.get(f"{API_PREFIX}/users/user-1/permissions").mock(
            return_value=httpx.Response(200, json={"items": []})
        )
        app = StackServerApp(project_id="proj", secret_server_key="sk")
        assert (
            app.has_permission("user-1", "read", team_id="team-1") is False
        )


# ---------------------------------------------------------------------------
# StackServerApp - get_permission
# ---------------------------------------------------------------------------


class TestGetPermission:
    @respx.mock
    def test_get_permission_found(self) -> None:
        respx.get(f"{API_PREFIX}/users/user-1/permissions").mock(
            return_value=httpx.Response(
                200, json={"items": [PERMISSION_JSON]}
            )
        )
        app = StackServerApp(project_id="proj", secret_server_key="sk")
        perm = app.get_permission("user-1", "read", team_id="team-1")
        assert perm is not None
        assert perm.id == "read"

    @respx.mock
    def test_get_permission_not_found(self) -> None:
        respx.get(f"{API_PREFIX}/users/user-1/permissions").mock(
            return_value=httpx.Response(200, json={"items": []})
        )
        app = StackServerApp(project_id="proj", secret_server_key="sk")
        perm = app.get_permission("user-1", "read", team_id="team-1")
        assert perm is None


# ---------------------------------------------------------------------------
# AsyncStackServerApp - Permissions
# ---------------------------------------------------------------------------


class TestAsyncGrantPermission:
    @respx.mock
    @pytest.mark.asyncio
    async def test_grant_permission(self) -> None:
        route = respx.post(
            f"{API_PREFIX}/users/user-1/permissions"
        ).mock(return_value=httpx.Response(200))
        app = AsyncStackServerApp(project_id="proj", secret_server_key="sk")
        result = await app.grant_permission(
            "user-1", "read", team_id="team-1"
        )
        assert result is None
        import json

        body = json.loads(route.calls[0].request.content)
        assert body["permission_id"] == "read"
        assert body["team_id"] == "team-1"
        await app.aclose()


class TestAsyncRevokePermission:
    @respx.mock
    @pytest.mark.asyncio
    async def test_revoke_permission(self) -> None:
        route = respx.delete(
            f"{API_PREFIX}/users/user-1/permissions/read"
        ).mock(return_value=httpx.Response(200))
        app = AsyncStackServerApp(project_id="proj", secret_server_key="sk")
        result = await app.revoke_permission(
            "user-1", "read", team_id="team-1"
        )
        assert result is None
        request = route.calls[0].request
        assert request.url.params["team_id"] == "team-1"
        await app.aclose()


class TestAsyncListPermissions:
    @respx.mock
    @pytest.mark.asyncio
    async def test_list_permissions(self) -> None:
        respx.get(f"{API_PREFIX}/users/user-1/permissions").mock(
            return_value=httpx.Response(200, json=PERMISSIONS_LIST_JSON)
        )
        app = AsyncStackServerApp(project_id="proj", secret_server_key="sk")
        perms = await app.list_permissions("user-1", team_id="team-1")
        assert len(perms) == 2
        assert perms[0].id == "read"
        await app.aclose()


class TestAsyncHasPermission:
    @respx.mock
    @pytest.mark.asyncio
    async def test_has_permission(self) -> None:
        respx.get(f"{API_PREFIX}/users/user-1/permissions").mock(
            return_value=httpx.Response(
                200, json={"items": [PERMISSION_JSON]}
            )
        )
        app = AsyncStackServerApp(project_id="proj", secret_server_key="sk")
        result = await app.has_permission(
            "user-1", "read", team_id="team-1"
        )
        assert result is True
        await app.aclose()


class TestAsyncGetPermission:
    @respx.mock
    @pytest.mark.asyncio
    async def test_get_permission_found(self) -> None:
        respx.get(f"{API_PREFIX}/users/user-1/permissions").mock(
            return_value=httpx.Response(
                200, json={"items": [PERMISSION_JSON]}
            )
        )
        app = AsyncStackServerApp(project_id="proj", secret_server_key="sk")
        perm = await app.get_permission("user-1", "read", team_id="team-1")
        assert perm is not None
        assert perm.id == "read"
        await app.aclose()

    @respx.mock
    @pytest.mark.asyncio
    async def test_get_permission_not_found(self) -> None:
        respx.get(f"{API_PREFIX}/users/user-1/permissions").mock(
            return_value=httpx.Response(200, json={"items": []})
        )
        app = AsyncStackServerApp(project_id="proj", secret_server_key="sk")
        perm = await app.get_permission("user-1", "read", team_id="team-1")
        assert perm is None
        await app.aclose()
