"""Embedding-based clustering of signals and the trigger policy that opens a case.

Bedrock Titan embeddings when available; otherwise a hashed bag-of-concepts vector. Both are
compared with cosine similarity against cluster centroids.
"""
from __future__ import annotations

import json
import logging
import math
import re
from collections import Counter

from ..config import settings
from .. import llm as _llm
from ..models import Signal, new_id, now
from ..store import store

log = logging.getLogger("f2f.cluster")

_SYN = {"crackle": "stutter", "crackles": "stutter", "crackling": "stutter", "choppy": "stutter", "stutters": "stutter",
        "cuts": "stutter", "underruns": "stutter", "underrun": "stutter", "disconnects": "disconnect", "drops": "disconnect",
        "reconnects": "disconnect", "stall": "disconnect", "reconnecting": "disconnect", "music": "audio", "podcast": "audio",
        "spotify": "audio", "a2dp": "bluetooth", "bt": "bluetooth", "aa": "androidauto", "frost": "cold", "freezing": "cold",
        "ignition": "start", "boot": "start", "morning": "cold"}
_STOP = set("the a an and or to of in on for my is it at i every since after when then with this that be are was not for".split())
SIM_THRESHOLD = 0.32


def _tokens(text: str) -> Counter:
    words = re.findall(r"[a-z0-9]+", text.lower().replace("android auto", "androidauto"))
    return Counter(_SYN.get(w, w) for w in words if w not in _STOP and len(w) > 1)


def _cos(a: dict, b: dict) -> float:
    dot = sum(v * b.get(k, 0) for k, v in a.items())
    na = math.sqrt(sum(v * v for v in a.values()))
    nb = math.sqrt(sum(v * v for v in b.values()))
    return dot / (na * nb) if na and nb else 0.0


def _titan_vector(text: str) -> dict | None:
    """Return a sparse cosine-compatible dict from Bedrock Titan Embeddings, or None on any error."""
    try:
        import boto3
        client = boto3.client("bedrock-runtime", region_name=settings.aws_region)
        resp = client.invoke_model(
            modelId="amazon.titan-embed-text-v1",
            body=json.dumps({"inputText": text[:8192]}),  # Titan hard limit
            contentType="application/json",
            accept="application/json",
        )
        embedding: list[float] = json.loads(resp["body"].read())["embedding"]
        # Store only non-negligible dimensions to keep the dict small
        return {str(i): v for i, v in enumerate(embedding) if abs(v) > 1e-6}
    except Exception as exc:
        log.debug("Titan embedding failed, using offline bag-of-words: %s", exc)
        return None


def _vector(sig: Signal) -> dict:
    """Return a vector for the signal.

    Tries Bedrock Titan Embeddings first (semantic, 1536-dim); falls back to a hashed
    bag-of-concepts vector when Bedrock is unavailable or the call fails.
    """
    if _llm.available():
        text = f"{sig.title} {sig.body} {sig.component or ''} {' '.join(sig.conditions)}"
        titan = _titan_vector(text)
        if titan is not None:
            return titan
    # Offline bag-of-concepts fallback
    base = _tokens(f"{sig.title} {sig.body} {sig.component or ''} {' '.join(sig.conditions)}")
    if sig.component:
        base[f"component:{sig.component}"] += 3
    return dict(base)


def assign(sig: Signal) -> dict | None:
    """Attach a triaged bug signal to the best matching cluster (or a new one). Returns the cluster."""
    if not sig.is_bug:
        return None
    vec = _vector(sig)
    best, best_sim = None, 0.0
    for c in store.list_docs("clusters"):
        if c.get("component") != sig.component:
            continue
        sim = _cos(vec, c["vector"])
        if sim > best_sim:
            best, best_sim = c, sim
    if best is None or best_sim < SIM_THRESHOLD:
        best = {"id": new_id("clu"), "title": sig.title, "component": sig.component, "sw_version": sig.sw_version, "vector": {},
                "signal_ids": [], "authors": [], "sources": {}, "case_id": None, "first_seen": sig.created_at, "score": 0.0}
    for k, v in vec.items():
        best["vector"][k] = best["vector"].get(k, 0) + v
    best["signal_ids"].append(sig.id)
    if sig.author and sig.author not in best["authors"]:
        best["authors"].append(sig.author)
    best["sources"][sig.source.value] = best["sources"].get(sig.source.value, 0) + 1
    best["sw_version"] = best.get("sw_version") or sig.sw_version
    best["last_seen"] = max(best.get("last_seen", 0), sig.created_at)
    best["size"] = len(best["signal_ids"])
    best["score"] = round(max(best.get("score", 0), best_sim), 3)
    best["threshold"] = settings.cluster_threshold_authors
    sig.cluster_id = best["id"]
    store.put_doc("clusters", best["id"], best, best["first_seen"])
    return best


def should_trigger(cluster: dict) -> tuple[bool, str]:
    authors = len(cluster["authors"])
    device = cluster["sources"].get("device", 0)
    social = cluster["size"] - device
    if cluster.get("case_id"):
        return False, "case already open"
    if authors >= settings.cluster_threshold_authors:
        return True, f"{authors} independent reporters across {len(cluster['sources'])} channels (threshold {settings.cluster_threshold_authors})"
    if device >= 1 and social >= 2:
        return True, f"in-vehicle hu-sentinel evidence corroborates {social} public reports"
    return False, f"{authors}/{settings.cluster_threshold_authors} reporters"


def public(cluster: dict) -> dict:
    c = {k: v for k, v in cluster.items() if k != "vector"}
    c["authors"] = len(cluster["authors"])
    return c
