from __future__ import annotations
from abc import ABC, abstractmethod
from typing import Any, Dict, Optional


class MasterAgentBase(ABC):
    """Common interface for all MasterAgent decision-engine implementations."""

    @abstractmethod
    def decide(self, metrics: Dict[str, Any]) -> Dict[str, Any]:
        """Return a decision dict given a metrics payload from EdgeAgent."""

    def set_override(self, camera_name: str, action: str,
                     target_roi: Optional[str] = None, duration: int = 60) -> None:
        pass

    def clear_override(self, camera_name: str) -> None:
        pass
