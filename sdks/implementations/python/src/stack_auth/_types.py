from __future__ import annotations

from typing import Mapping, Protocol, runtime_checkable


@runtime_checkable
class RequestLike(Protocol):
    @property
    def headers(self) -> Mapping[str, str]: ...
