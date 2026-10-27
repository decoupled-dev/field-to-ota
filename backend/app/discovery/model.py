"""Normalized complaint record shared across discovery sources."""
from __future__ import annotations

import hashlib
from dataclasses import dataclass, field


# Map a discovery source category to the app's SignalSource enum value.
# The app accepts: reddit | forum | x | issuetracker | partner_jira | device
SIGNAL_SOURCE_BY_KIND = {
    "forum": "forum",
    "reddit": "reddit",
    "nhtsa": "issuetracker",
    "google_tracker": "issuetracker",
    "public_jira": "partner_jira",
    "partner_jira": "partner_jira",
    "jira": "partner_jira",
    "social": "x",
    "web": "forum",
}


@dataclass
class Complaint:
    """One raw complaint discovered from a source, before LLM judgement."""

    source_kind: str            # forum | reddit | nhtsa | google_tracker | public_jira | jira | social | web
    source_name: str            # human/source label, e.g. "r/Jeep" or "jira:HU"
    title: str
    body: str = ""
    author: str | None = None
    url: str | None = None
    external_id: str | None = None
    simulated: bool = False
    extra: dict = field(default_factory=dict)

    def stable_id(self) -> str:
        """Deterministic id for dedupe when the source gives none."""
        if self.external_id:
            return self.external_id
        basis = f"{self.source_name}|{self.title}|{self.url or ''}".encode("utf-8", "replace")
        return self.source_name.replace(" ", "_") + "-" + hashlib.sha1(basis).hexdigest()[:12]

    def signal_source(self) -> str:
        return SIGNAL_SOURCE_BY_KIND.get(self.source_kind, "forum")
