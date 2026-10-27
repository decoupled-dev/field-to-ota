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

# NHTSA model-year window to query (public complaints/recalls API is per make/model/year).
_NHTSA_YEARS = (2021, 2022, 2023, 2024)

# Real, free, keyless NHTSA API. Host is api.nhtsa.gov (NOT api.nhtsa.dot.gov, which does not resolve).
_NHTSA_HOST = "https://api.nhtsa.gov"

# Components/keywords that indicate an electronic-control / software / comfort-electronics issue.
# Broadened beyond infotainment to cover ECU, HVAC, electrical and powertrain-software defects.
_SOFTWARE_HINTS = (
    # infotainment / connectivity
    "software", "update", "firmware", "ota", "infotainment", "uconnect", "screen", "display",
    "bluetooth", "android auto", "carplay", "navigation", "nav", "freeze", "frozen", "reboot",
    "crash", "glitch", "lag", "connectivity", "head unit", "headunit", "radio", "app",
    # electronic control units / electrical / HVAC / ADAS
    "ecu", "ecm", "tcm", "bcm", "control module", "control unit", "electrical", "electronic",
    "hvac", "defroster", "defogger", "climate", "air condition", "ac ", "heater", "blower",
    "sensor", "camera", "adas", "lane", "cruise", "telematics", "gateway", "can bus", "instrument",
    "cluster", "gauge", "power train", "powertrain", "transmission:control", "charging",
)


# Strong component signals: if the COMPONENT field contains any of these, it's in scope regardless
# of the summary. Keeps the focus on electronic-control / software / comfort-electronics defects.
_COMPONENT_SIGNALS = (
    "software", "control module", "control unit", "ecu", "ecm", "tcm", "bcm", "electrical",
    "electronic", "hvac", "defroster", "defogger", "climate", "air condition", "telematics",
    "infotainment", "display", "radio", "navigation", "camera", "sensor", "lighting control",
    "forward collision", "lane", "cruise control", "instrument panel", "gauge", "cluster",
)


def _looks_software(component: str = "", summary: str = "") -> bool:
    """In scope if the component clearly names an electronic/software/HVAC system, OR the summary
    describes a software/electronic symptom. Component match is the stronger, primary signal."""
    comp = (component or "").lower()
    if any(sig in comp for sig in _COMPONENT_SIGNALS):
        return True
    blob = (summary or "").lower()
    return any(h in blob for h in _SOFTWARE_HINTS)


def _pretty(model: str) -> str:
    """Model names are URL-encoded for the API query; decode for human-readable titles."""
    return model.replace("%20", " ").title()


def _recent_enough(date_str: str, since_days: int) -> bool:
    """NHTSA dates look like MM/DD/YYYY. Keep if within the window (or if unparseable)."""
    from datetime import datetime, timedelta
    for fmt in ("%m/%d/%Y", "%d/%m/%Y", "%Y-%m-%d"):
        try:
            d = datetime.strptime(date_str, fmt)
            return d >= datetime.now() - timedelta(days=max(since_days, 1))
        except (ValueError, TypeError):
            continue
    return True


# --------------------------------------------------------------------------------------------
# NHTSA public complaints + recalls API (REAL, free, no key — api.nhtsa.gov)
# --------------------------------------------------------------------------------------------
def nhtsa(oem: str, models: list[str], since_days: int) -> list[Complaint]:
    out: list[Complaint] = []
    makes = _oem_makes(oem, models)
    cap = settings.discovery_max_per_source * 4
    try:
        with httpx.Client(timeout=_TIMEOUT, headers=_UA, follow_redirects=True) as client:
            for make in makes:
                for model in _nhtsa_models(models):
                    for year in _NHTSA_YEARS:
                        out.extend(_nhtsa_complaints(client, make, model, year, since_days))
                        out.extend(_nhtsa_recalls(client, make, model, year))
                        if len(out) >= cap:
                            return out[:cap]
    except Exception as e:  # noqa: BLE001
        log.warning("NHTSA crawl failed: %s", e)
    return out


def _nhtsa_complaints(client: httpx.Client, make: str, model: str, year: int, since_days: int) -> list[Complaint]:
    url = f"{_NHTSA_HOST}/complaints/complaintsByVehicle?make={make}&model={model}&modelYear={year}"
    try:
        r = client.get(url)
        if r.status_code != 200:
            return []
        results = r.json().get("results", [])
    except (httpx.HTTPError, json.JSONDecodeError):
        return []
    out: list[Complaint] = []
    for c in results:
        summary = (c.get("summary") or "").strip()
        comp = (c.get("components") or "")
        if not _looks_software(comp, summary):
            continue
        if not _recent_enough(c.get("dateComplaintFiled") or c.get("dateOfIncident") or "", since_days):
            continue
        odi = str(c.get("odiNumber") or "")
        out.append(Complaint(
            source_kind="nhtsa",
            source_name="NHTSA complaints",
            title=f"{comp or 'NHTSA complaint'} — {make.title()} {_pretty(model)} {year}",
            body=summary,
            author=f"nhtsa-odi-{odi}" if odi else None,
            url=f"https://www.nhtsa.gov/vehicle/{year}/{make}/{model}#complaints",
            external_id=f"nhtsa:{odi}" if odi else None,
            extra={"manufacturer": c.get("manufacturer"), "component": comp},
        ))
    return out


def _nhtsa_recalls(client: httpx.Client, make: str, model: str, year: int) -> list[Complaint]:
    url = f"{_NHTSA_HOST}/recalls/recallsByVehicle?make={make}&model={model}&modelYear={year}"
    try:
        r = client.get(url)
        if r.status_code != 200:
            return []
        results = r.json().get("results", [])
    except (httpx.HTTPError, json.JSONDecodeError):
        return []
    out: list[Complaint] = []
    for c in results:
        comp = c.get("Component", "")
        summary = (c.get("Summary") or "").strip()
        if not _looks_software(comp, summary):
            continue
        campaign = c.get("NHTSACampaignNumber", "")
        out.append(Complaint(
            source_kind="nhtsa",
            source_name="NHTSA recalls",
            title=f"{comp} — {make.title()} {_pretty(model)} {year}",
            body=summary,
            author=c.get("Manufacturer") or "NHTSA",
            url=f"https://www.nhtsa.gov/recalls?nhtsaId={campaign}" if campaign else None,
            external_id=f"nhtsa-recall:{campaign}" if campaign else None,
            extra={"component": comp, "campaign": campaign, "ota": c.get("overTheAirUpdate")},
        ))
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
# Brand -> NHTSA make names. Stellantis is a parent group, so expand it to its marques.
_OEM_MAKES = {
    "stellantis": ["jeep", "dodge", "ram", "chrysler"],
    "ford": ["ford"],
    "gm": ["chevrolet", "gmc", "cadillac", "buick"],
    "toyota": ["toyota", "lexus"],
    "honda": ["honda", "acura"],
    "volkswagen": ["volkswagen", "audi"],
    "hyundai": ["hyundai", "kia", "genesis"],
}

# Default model names per make when the caller passes only a brand. NHTSA queries are per model.
_DEFAULT_MODELS = {
    "jeep": ["grand cherokee", "wrangler", "gladiator", "wagoneer", "compass"],
    "dodge": ["durango", "charger", "challenger"],
    "ram": ["1500", "2500"],
    "chrysler": ["pacifica", "300"],
    "ford": ["f-150", "explorer", "escape", "mustang mach-e"],
    "chevrolet": ["silverado 1500", "equinox", "bolt ev", "tahoe"],
    "gmc": ["sierra 1500"],
    "toyota": ["camry", "rav4", "highlander"],
    "honda": ["accord", "cr-v", "civic"],
    "volkswagen": ["jetta", "atlas", "id.4"],
    "hyundai": ["tucson", "santa fe", "ioniq 5"],
}

# These are passed to NHTSA (case-insensitive). Spaces must be URL-encoded by the caller via httpx params.
_CURRENT_MAKES: list[str] = []


def _oem_makes(oem: str, models: list[str]) -> list[str]:
    makes = _OEM_MAKES.get(oem.lower())
    if makes:
        result = list(makes)
    else:
        # Unknown parent: treat the OEM string itself as the make.
        result = [oem.lower()]
    _CURRENT_MAKES.clear()
    _CURRENT_MAKES.extend(result)
    return [m.replace(" ", "%20") for m in result]


def _nhtsa_models(models: list[str]) -> list[str]:
    # If the caller gave concrete model names (not just brand words), use them directly.
    brandish = set().union(*(set(v) for v in _OEM_MAKES.values())) | set(_OEM_MAKES) | {"uconnect"}
    concrete = [m for m in models if m.lower() not in brandish]
    if concrete:
        return [m.replace(" ", "%20") for m in concrete]
    # Otherwise expand the current makes to their default model names.
    out: list[str] = []
    for mk in _CURRENT_MAKES or ["jeep"]:
        out.extend(_DEFAULT_MODELS.get(mk, []))
    return [m.replace(" ", "%20") for m in (out or ["grand cherokee", "f-150", "silverado 1500"])]


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
