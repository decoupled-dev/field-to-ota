"""Connector contracts. Each pipeline stage talks to a capability, never to a vendor directly."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Protocol


@dataclass
class ConnectorInfo:
    key: str
    name: str
    vendor: str
    capability: str
    description: str
    status: str = "available"  # connected | simulated | available
    config_keys: list[str] = field(default_factory=list)


@dataclass
class Issue:
    key: str
    url: str
    simulated: bool


@dataclass
class PullRequest:
    number: int
    url: str
    branch: str
    simulated: bool


class IssueTracker(Protocol):
    info: ConnectorInfo
    def create_issue(self, title: str, description: str, labels: list[str], severity: str) -> Issue: ...
    def comment(self, key: str, body: str) -> None: ...
    def resolve(self, key: str, resolution: str) -> None: ...


class SourceControl(Protocol):
    info: ConnectorInfo
    def open_pull_request(self, workdir: str, branch: str, title: str, body: str) -> PullRequest: ...
    def merge(self, pr: PullRequest) -> None: ...


class OTAProvider(Protocol):
    info: ConnectorInfo
    def create_job(self, job_id: str, targets: list[str], document: dict, canary: int) -> str: ...


class Notifier(Protocol):
    info: ConnectorInfo
    def notify(self, text: str) -> None: ...
