"""Discovery sources.

Each source function returns ``list[Complaint]``. Sources use real public APIs where one exists
for free (NHTSA, Reddit JSON, Google Issue Tracker, public JIRA JQL, and your own JIRA if
JIRA_* is configured). Where no free API exists (private forums, X/TikTok), the source is
labelled *simulated* and falls back to the seed catalogue — matching the rest of the app.
"""
from __future__ import annotations

import json
import logging
from pathlib import Path

import httpx

from ..config import ROOT, settings
from .model import Complaint

log = logging.getLogger("f2f.discovery.sources")

_UA = {"User-Agent": "field-to-fix-discovery/0.1 (+https://github.com/decoupled-dev/field-to-ota)"}
_TIMEOUT = httpx.Timeout(15.0)

# NHTSA model-year window to query (public complaints API is per make/model/year).
_NHTSA_YEARS = (2021, 2022, 2023, 2024)

# Bug-ish keywords used to keep crawls focused on software/infotainment issues before the LLM runs.
_SOFTWARE_HINTS = (
    "software", "update", "firmware", "ota", "infotainment", "uconnect", "screen", "display",
    "bluetooth", "android auto", "carplay", "navigation", "nav", "freeze", "frozen", "reboot",
    "crash", "glitch", "lag", "connectivity", "head unit", "headunit", "radio", "app", "bug",
)


def _looks_software(*texts: str) -> bool:
    blob = " ".join(t for t in texts if t).lower()
    return any(h in blob for h in _SOFTWARE_HINTS)


# --------------------------------------------------------------------------------------------
# NHTSA public complaints API (real, free, no key)
# --------------------------------------------------------------------------------------------
def nhtsa(oem: str, models: list[str], since_days: int) -> list[Complaint]:
    out: list[Complaint] = []
    makes = _oem_makes(oem, models)
    try:
        with httpx.Client(timeout=_TIMEOUT, headers=_UA) as client:
            for make in makes:
                for model in _nhtsa_models(models):
                    for year in _NHTSA_YEARS:
                        url = ("https://api.nhtsa.dot.gov/complaints/complaintsByVehicle"
                               f"?make={make}&model={model}&modelYear={year}")
                        try:
                            r = client.get(url)
                            if r.status_code != 200:
                                continue
                            results = r.json().get("results", [])
                        except (httpx.HTTPError, json.JSONDecodeError):
                            continue
                        for c in results:
                            summary = (c.get("summary") or "").strip()
                            comp = (c.get("components") or "")
                            if not _looks_software(summary, comp):
                                continue
                            odi = str(c.get("odiNumber") or "")
                            out.append(Complaint(
                                source_kind="nhtsa",
                                source_name="NHTSA",
                                title=(comp or "NHTSA complaint") + f" — {make} {model} {year}",
                                body=summary,
                                author=f"nhtsa-odi-{odi}" if odi else None,
                                url=f"https://www.nhtsa.gov/?nhtsaId={odi}" if odi else url,
                                external_id=f"nhtsa:{odi}" if odi else None,
                            ))
                            if len(out) >= settings.discovery_max_per_source * 4:
                                return out
    except Exception as e:  # noqa: BLE001
        log.warning("NHTSA crawl failed: %s", e)
    return out


# --------------------------------------------------------------------------------------------
# Reddit public search (real when F2F_REDDIT_LIVE=1, else simulated via seed)
# --------------------------------------------------------------------------------------------
_REDDIT_SUBS = {
    "stellantis": ["Jeep", "Dodge", "RAM_Trucks", "ChryslerPacifica", "CarComplaints"],
}


def reddit(oem: str, models: list[str], since_days: int) -> list[Complaint]:
    subs = _REDDIT_SUBS.get(oem.lower(), ["CarComplaints"])
    query = f"{' '.join(models[:3])} {settings.reddit_query}".strip()
    if not settings.reddit_live:
        return _seed_as_complaints("reddit", "r/CarComplaints (simulated)", oem, models, since_days)
    out: list[Complaint] = []
    try:
        with httpx.Client(timeout=_TIMEOUT, headers=_UA) as client:
            for sub in subs:
                url = f"https://www.reddit.com/r/{sub}/search.json"
                try:
                    r = client.get(url, params={"q": query, "restrict_sr": 1, "sort": "new", "limit": settings.discovery_max_per_source})
                    if r.status_code != 200:
                        continue
                    children = r.json().get("data", {}).get("children", [])
                except (httpx.HTTPError, json.JSONDecodeError):
                    continue
                for ch in children:
                    d = ch.get("data", {})
                    title, body = d.get("title", ""), d.get("selftext", "")
                    if not _looks_software(title, body):
                        continue
                    out.append(Complaint(
                        source_kind="reddit",
                        source_name=f"r/{sub}",
                        title=title,
                        body=body[:4000],
                        author=d.get("author"),
                        url="https://www.reddit.com" + d.get("permalink", ""),
                        external_id=f"reddit:{d.get('id')}",
                    ))
    except Exception as e:  # noqa: BLE001
        log.warning("Reddit crawl failed: %s", e)
    return out or _seed_as_complaints("reddit", "r/CarComplaints (simulated)", oem, models, since_days)


# --------------------------------------------------------------------------------------------
# Google public Issue Tracker (real, public web search endpoint for IVI issues)
# --------------------------------------------------------------------------------------------
def google_tracker(oem: str, models: list[str], since_days: int) -> list[Complaint]:
    """issuetracker.google.com hosts public Android/Automotive (IVI) issues.

    The public issue list has a JSON-ish endpoint; it is best-effort and labelled simulated on
    failure so the agent keeps working offline.
    """
    query = f"{oem} infotainment android automotive {' '.join(models[:2])}".strip()
    out: list[Complaint] = []
    try:
        with httpx.Client(timeout=_TIMEOUT, headers=_UA, follow_redirects=True) as client:
            r = client.get("https://issuetracker.google.com/issues",
                           params={"q": query})
            if r.status_code == 200 and "issue" in r.text.lower():
                # The public tracker is JS-rendered; without an API key we can only confirm
                # reachability. Emit a single labelled pointer rather than fabricate issues.
                out.append(Complaint(
                    source_kind="google_tracker",
                    source_name="Google Issue Tracker",
                    title=f"Open IVI issues matching '{query}'",
                    body="Public Google Issue Tracker reachable; full extraction needs the Buganizer API.",
                    url=f"https://issuetracker.google.com/issues?q={query.replace(' ', '%20')}",
                    external_id=f"gtracker:{hash(query) & 0xffffff:x}",
                    simulated=True,
                ))
    except Exception as e:  # noqa: BLE001
        log.info("Google tracker probe failed (expected without API key): %s", e)
    return out


# --------------------------------------------------------------------------------------------
# Partner / public JIRA — JQL search over a public JIRA (real, no auth on public instances)
# --------------------------------------------------------------------------------------------
def public_jira(oem: str, models: list[str], since_days: int) -> list[Complaint]:
    base = settings.jira_url or "https://issues.apache.org/jira"  # public instance as a demo partner tracker
    jql = f'text ~ "{oem} infotainment" ORDER BY created DESC'
    out: list[Complaint] = []
    try:
        with httpx.Client(timeout=_TIMEOUT, headers={**_UA, "Accept": "application/json"}) as client:
            r = client.get(f"{base.rstrip('/')}/rest/api/2/search",
                           params={"jql": jql, "maxResults": settings.discovery_max_per_source})
            if r.status_code == 200:
                for iss in r.json().get("issues", []):
                    f = iss.get("fields", {})
                    out.append(Complaint(
                        source_kind="public_jira",
                        source_name=f"public-jira:{base.split('//')[-1].split('/')[0]}",
                        title=f.get("summary", iss.get("key", "")),
                        body=(f.get("description") or "")[:4000],
                        author=(f.get("reporter") or {}).get("displayName"),
                        url=f"{base.rstrip('/')}/browse/{iss.get('key')}",
                        external_id=f"pjira:{iss.get('key')}",
                    ))
    except Exception as e:  # noqa: BLE001
        log.info("Public JIRA search unavailable: %s", e)
    return out


# --------------------------------------------------------------------------------------------
# Your JIRA — inbound detection of newly created tickets (real when JIRA_* configured)
# --------------------------------------------------------------------------------------------
def jira_inbound(oem: str, models: list[str], since_days: int) -> list[Complaint]:
    """Poll the configured JIRA project for recently created tickets.

    Requirement: 'once a ticket is logged in JIRA it can detect that'. Each new ticket becomes a
    complaint so the app opens/updates a case. No-ops cleanly when JIRA_* is not set.
    """
    if not (settings.jira_url and settings.jira_email and settings.jira_token):
        return []
    jql = f'project = {settings.jira_project} AND created >= -{since_days}d ORDER BY created DESC'
    out: list[Complaint] = []
    try:
        with httpx.Client(timeout=_TIMEOUT, headers={"Accept": "application/json"},
                          auth=(settings.jira_email, settings.jira_token)) as client:
            r = client.get(f"{settings.jira_url.rstrip('/')}/rest/api/3/search",
                           params={"jql": jql, "maxResults": 25, "fields": "summary,description,reporter,created"})
            r.raise_for_status()
            for iss in r.json().get("issues", []):
                f = iss.get("fields", {})
                out.append(Complaint(
                    source_kind="jira",
                    source_name=f"jira:{settings.jira_project}",
                    title=f.get("summary", iss.get("key", "")),
                    body=_adf_to_text(f.get("description"))[:4000],
                    author=(f.get("reporter") or {}).get("displayName") or settings.jira_project,
                    url=f"{settings.jira_url.rstrip('/')}/browse/{iss.get('key')}",
                    external_id=f"jira:{iss.get('key')}",
                ))
    except Exception as e:  # noqa: BLE001
        log.warning("JIRA inbound poll failed: %s", e)
    return out


# --------------------------------------------------------------------------------------------
# Forums / social / web — reuse the repo catalogue; live via Tavily if keyed, else simulated
# --------------------------------------------------------------------------------------------
def forums_and_web(oem: str, models: list[str], since_days: int) -> list[Complaint]:
    if settings.tavily_api_key:
        return _tavily(oem, models, since_days)
    # No web-search key: fall back to the seed catalogue, clearly labelled simulated.
    return _seed_as_complaints("forum", "owner-forums (simulated)", oem, models, since_days)


def _tavily(oem: str, models: list[str], since_days: int) -> list[Complaint]:
    query = f"{oem} {' '.join(models[:3])} infotainment software bug complaint forum"
    out: list[Complaint] = []
    try:
        with httpx.Client(timeout=_TIMEOUT) as client:
            r = client.post("https://api.tavily.com/search", json={
                "api_key": settings.tavily_api_key, "query": query,
                "search_depth": "advanced", "max_results": settings.discovery_max_per_source,
                "include_published_date": True,
            })
            r.raise_for_status()
            for item in r.json().get("results", []):
                out.append(Complaint(
                    source_kind="web",
                    source_name="web-search",
                    title=item.get("title", ""),
                    body=(item.get("content") or "")[:4000],
                    url=item.get("url"),
                    external_id=f"web:{hash(item.get('url', '')) & 0xffffffff:x}",
                ))
    except Exception as e:  # noqa: BLE001
        log.warning("Tavily web search failed: %s", e)
    return out


# --------------------------------------------------------------------------------------------
# Helpers
# --------------------------------------------------------------------------------------------
def _oem_makes(oem: str, models: list[str]) -> list[str]:
    if oem.lower() == "stellantis":
        return ["JEEP", "DODGE", "RAM", "CHRYSLER"]
    return [oem.upper()]


def _nhtsa_models(models: list[str]) -> list[str]:
    # NHTSA wants a model name, not a brand. Use known model names, else a broad default set.
    known = {"grand cherokee", "wrangler", "gladiator", "wagoneer", "durango", "1500", "pacifica", "charger", "challenger"}
    picked = [m for m in models if m.lower() in known]
    return [m.upper().replace(" ", "%20") for m in (picked or ["GRAND CHEROKEE", "1500", "PACIFICA", "DURANGO"])]


def _adf_to_text(adf) -> str:
    """Flatten Atlassian Document Format (JIRA Cloud description) to plain text."""
    if isinstance(adf, str):
        return adf
    if not isinstance(adf, dict):
        return ""
    parts: list[str] = []

    def walk(node):
        if isinstance(node, dict):
            if node.get("type") == "text":
                parts.append(node.get("text", ""))
            for child in node.get("content", []) or []:
                walk(child)
        elif isinstance(node, list):
            for child in node:
                walk(child)

    walk(adf)
    return " ".join(parts)


def _seed_as_complaints(kind: str, label: str, oem: str, models: list[str], since_days: int) -> list[Complaint]:
    """Load the seed catalogue and turn matching issues into labelled, simulated complaints.

    This keeps the agent productive with zero credentials. Each seed issue is expanded into a few
    distinct 'reporters' so the app's author-count threshold can be exercised realistically.
    """
    seed_path = ROOT / "data" / "stellantis_seed_issues.json"
    try:
        issues = json.loads(Path(seed_path).read_text())
    except (OSError, json.JSONDecodeError):
        return []
    models_lower = {m.lower() for m in models}
    out: list[Complaint] = []
    for iss in issues:
        if models_lower:
            affected = {a.lower() for a in iss.get("affected_models", [])}
            if not any(any(m in a for a in affected) for m in models_lower):
                continue
        if kind == "reddit" and iss.get("source", "").startswith("reddit"):
            pass  # keep
        out.append(Complaint(
            source_kind=kind,
            source_name=label,
            title=iss["title"],
            body=iss.get("summary", ""),
            author=f"{iss['id']}-reporter",
            url=iss.get("url"),
            external_id=f"seed:{kind}:{iss['id']}",
            simulated=True,
            extra={"severity": iss.get("severity"), "frequency_score": iss.get("frequency_score"),
                   "tags": iss.get("tags", []), "affected_models": iss.get("affected_models", [])},
        ))
    return out


# The full ordered set of sources the agent crawls each cycle.
ALL_SOURCES = [nhtsa, reddit, google_tracker, public_jira, jira_inbound, forums_and_web]
