"""Source control connectors: GitHub (branch push + PR via REST) and a local git remote for offline demos."""
from __future__ import annotations

import subprocess
from pathlib import Path

import httpx

from ..config import settings
from .base import ConnectorInfo, PullRequest


def git(cwd: str | Path, *args: str) -> str:
    return subprocess.run(["git", *args], cwd=cwd, capture_output=True, text=True, check=True).stdout.strip()


class GitHubSCM:
    def __init__(self):
        self.info = ConnectorInfo("github", "GitHub", "GitHub", "source_control",
                                  "Fix branches, pull requests with traceability, CI status via webhooks.", "connected",
                                  ["GITHUB_TOKEN", "GITHUB_REPO"])
        self._http = httpx.Client(base_url="https://api.github.com", timeout=20, headers={
            "Authorization": f"Bearer {settings.github_token}", "Accept": "application/vnd.github+json"})

    def open_pull_request(self, workdir, branch, title, body) -> PullRequest:
        remote = f"https://x-access-token:{settings.github_token}@github.com/{settings.github_repo}.git"
        git(workdir, "push", "--force", remote, f"HEAD:refs/heads/{branch}")
        base = self._http.get(f"/repos/{settings.github_repo}").json().get("default_branch", "main")
        r = self._http.post(f"/repos/{settings.github_repo}/pulls", json={"title": title, "head": branch, "base": base, "body": body})
        if r.status_code == 422:  # PR already exists for this branch
            r = self._http.get(f"/repos/{settings.github_repo}/pulls", params={"head": f"{settings.github_repo.split('/')[0]}:{branch}"})
            pr = r.json()[0]
        else:
            r.raise_for_status()
            pr = r.json()
        return PullRequest(pr["number"], pr["html_url"], branch, False)

    def merge(self, pr) -> None:
        self._http.put(f"/repos/{settings.github_repo}/pulls/{pr.number}/merge", json={"merge_method": "squash"})


class LocalSCM:
    """A bare git repo under .state acts as the remote; PR pages are rendered by the console."""

    def __init__(self):
        self.info = ConnectorInfo("github", "GitHub", "GitHub", "source_control",
                                  "Fix branches, pull requests with traceability, CI status via webhooks.", "simulated",
                                  ["GITHUB_TOKEN", "GITHUB_REPO"])
        self.remote = settings.workspace_dir / "remote" / "media-service.git"

    def open_pull_request(self, workdir, branch, title, body) -> PullRequest:
        git(workdir, "push", "--force", str(self.remote), f"HEAD:refs/heads/{branch}")
        return PullRequest(1, f"{settings.public_url}/tools/pulls/{branch}", branch, True)

    def merge(self, pr) -> None:
        git(self.remote, "update-ref", "refs/heads/main", f"refs/heads/{pr.branch}")


def source_control():
    if settings.github_token and settings.github_repo:
        return GitHubSCM()
    return LocalSCM()
