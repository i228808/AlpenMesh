from .base import MasterAgentBase
from .rule_based import RuleBasedMasterAgent
from .safety import SafetyWrapper
from .maxpressure import MaxPressureAgent
from .mpc import MpcAgent
from .mode_selector import ModeSelector
from .hybrid_orchestrator import HybridOrchestrator


def _build_hybrid() -> MasterAgentBase:
    """Hybrid stack:

        SafetyWrapper  (hard MIN/MAX_GREEN, starvation, ped clearance)
          └── HybridOrchestrator  (Holt forecasts + corridor coordination)
                 └── ModeSelector  (incident/MAPE-aware MPC vs MP)
                        ├── MpcAgent         (consumes arrival_forecasts)
                        └── MaxPressureAgent  (consumes downstream_counts + platoon_boost)
    """
    return SafetyWrapper(
        HybridOrchestrator(ModeSelector(MpcAgent(), MaxPressureAgent()))
    )


def _build_mpc() -> MasterAgentBase:
    """Pure MPC stack — SafetyWrapper → HybridOrchestrator → MpcAgent.

    The orchestrator is included so MPC still gets Holt arrival forecasts
    and corridor platoon injections even without the ModeSelector.
    """
    return SafetyWrapper(HybridOrchestrator(MpcAgent()))


def _build_maxpressure() -> MasterAgentBase:
    """MaxPressure-only stack. We keep the orchestrator to deliver
    platoon boost and downstream queue context into the pressure term,
    but wrap in SafetyWrapper so MIN/MAX_GREEN / starvation guards still
    apply — without these, MP has no way to protect minimum green.
    """
    return SafetyWrapper(HybridOrchestrator(MaxPressureAgent()))


_IMPLS = {
    "rule_based":  RuleBasedMasterAgent,
    "mpc":         _build_mpc,
    "maxpressure": _build_maxpressure,
    "hybrid":      _build_hybrid,
}


def load(impl: str = "rule_based") -> MasterAgentBase:
    """Instantiate a MasterAgent by name (env MASTER_AGENT_IMPL)."""
    factory = _IMPLS.get(impl)
    if factory is None:
        raise ValueError(f"Unknown MASTER_AGENT_IMPL={impl!r}. Choices: {list(_IMPLS)}")
    return factory() if callable(factory) and not isinstance(factory, type) else factory()
