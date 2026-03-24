from __future__ import annotations

from typing import Mapping, Protocol


class RequestLike(Protocol):
    @property
    def headers(self) -> Mapping[str, str]: ...
