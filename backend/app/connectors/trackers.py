"""Issue tracker connectors: Jira Cloud (REST v3) and a built-in tracker for offline demos."""
from __future__ import annotations

import base64
import itertools

import httpx

from ..config import settings
from ..store import store
from .base import ConnectorInfo, Issue

_JIRA_PRIORITY = {"critical": "Highest", "high": "High", "medium": "Medium", "low": "Low"}


class JiraTracker:
    def __init__(self):
        self.info = ConnectorInfo("jira", "Jira Software", "Atlassian", "issue_tracker",
                                  "Defects created with evidence, commented per stage, resolved after OTA.", "connected",
                                  ["JIRA_URL", "JIRA_EMAIL", "JIRA_API_TOKEN", "JIRA_PROJECT"])
        auth = base64.b64encode(f"{settings.jira_email}:{settings.jira_token}".encode()).decode()
        self._http = httpx.Client(base_url=settings.jira_url.rstrip("/"), timeout=20,
                                  headers={"Authorization": f"Basic {auth}", "Accept": "application/json"})

    @staticmethod
    def _adf(text: str) -> dict:
        return {"type": "doc", "version": 1, "content": [
            {"type": "paragraph", "content": [{"type": "text", "text": line}]} for line in text.splitlines() if line.strip()]}

    def create_issue(self, title, description, labels, severity) -> Issue:
        r = self._http.post("/rest/api/3/issue", json={"fields": {
            "project": {"key": settings.jira_project}, "summary": title, "issuetype": {"name": "Bug"},
            "labels": labels, "priority": {"name": _JIRA_PRIORITY.get(severity, "High")},
            "description": self._adf(description)}})
        r.raise_for_status()
        key = r.json()["key"]
        return Issue(key, f"{settings.jira_url.rstrip('/')}/browse/{key}", False)

    def comment(self, key, body) -> None:
        self._http.post(f"/rest/api/3/issue/{key}/comment", json={"body": self._adf(body)}).raise_for_status()

    def resolve(self, key, resolution) -> None:
        self.comment(key, resolution)
        transitions = self._http.get(f"/rest/api/3/issue/{key}/transitions").json().get("transitions", [])
        done = next((t for t in transitions if t["name"].lower() in ("done", "resolved", "closed")), None)
        if done:
            self._http.post(f"/rest/api/3/issue/{key}/transitions", json={"transition": {"id": done["id"]}}).raise_for_status()


class BuiltinTracker:
    """Keeps issues in the console store so the flow runs without a Jira site."""

    _seq = itertools.count(101)

    def __init__(self):
        self.info = ConnectorInfo("jira", "Jira Software", "Atlassian", "issue_tracker",
                                  "Defects created with evidence, commented per stage, resolved after OTA.", "simulated",
                                  ["JIRA_URL", "JIRA_EMAIL", "JIRA_API_TOKEN", "JIRA_PROJECT"])

    def create_issue(self, title, description, labels, severity) -> Issue:
        existing = store.list_docs("kv", "issue:")
        key = f"{settings.jira_project}-{101 + len(existing)}"
        store.put_doc("kv", f"issue:{key}", {"key": key, "title": title, "description": description, "labels": labels,
                                             "severity": severity, "status": "Open", "comments": []})
        return Issue(key, f"{settings.public_url}/tools/issues/{key}", True)

    def comment(self, key, body) -> None:
        doc = store.get_doc("kv", f"issue:{key}")
        if doc:
            doc["comments"].append(body)
            store.put_doc("kv", f"issue:{key}", doc)

    def resolve(self, key, resolution) -> None:
        doc = store.get_doc("kv", f"issue:{key}")
        if doc:
            doc["comments"].append(resolution)
            doc["status"] = "Done"
            store.put_doc("kv", f"issue:{key}", doc)


def issue_tracker():
    if settings.jira_url and settings.jira_email and settings.jira_token:
        return JiraTracker()
    return BuiltinTracker()
