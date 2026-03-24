"""Stack Auth Python SDK."""

from stack_auth._version import __version__
from stack_auth.errors import (
    AnalyticsError,
    ApiKeyError,
    AuthenticationError,
    CliError,
    ConflictError,
    EmailError,
    NotFoundError,
    OAuthError,
    PasskeyError,
    PaymentError,
    PermissionDeniedError,
    RateLimitError,
    StackAuthError,
    ValidationError,
)

__all__ = [
    "__version__",
    "StackAuthError",
    "AuthenticationError",
    "NotFoundError",
    "ValidationError",
    "PermissionDeniedError",
    "ConflictError",
    "OAuthError",
    "PasskeyError",
    "ApiKeyError",
    "PaymentError",
    "EmailError",
    "RateLimitError",
    "CliError",
    "AnalyticsError",
]
