from __future__ import annotations
from abc import ABC, abstractmethod


class Forecaster(ABC):
    """Abstract base for vehicle arrival-rate forecasters."""

    @abstractmethod
    def update(self, observed: float) -> float:
        """Ingest new observation, return 1-step-ahead forecast."""

    @abstractmethod
    def forecast(self, h: int = 1) -> float:
        """Return h-step-ahead forecast without updating state."""

    @abstractmethod
    def reset(self) -> None:
        """Reset to uninitialised state."""

    @property
    @abstractmethod
    def is_initialised(self) -> bool:
        """True once at least one observation has been ingested."""
