"""Event fan-out: in-process pub/sub for SSE, mirrored to Amazon EventBridge in aws mode."""
from __future__ import annotations

import asyncio
import json
import logging

from .config import settings
from .models import Event

log = logging.getLogger("f2f.bus")


class Bus:
    def __init__(self):
        self._subs: set[asyncio.Queue] = set()
        self._loop: asyncio.AbstractEventLoop | None = None
        self._eb = None
        if settings.mode == "aws" and settings.event_bus_name:
            import boto3
            self._eb = boto3.client("events", region_name=settings.aws_region)

    def bind(self, loop: asyncio.AbstractEventLoop) -> None:
        self._loop = loop

    def subscribe(self) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue(maxsize=1000)
        self._subs.add(q)
        return q

    def unsubscribe(self, q: asyncio.Queue) -> None:
        self._subs.discard(q)

    def publish(self, type_: str, case_id: str | None = None, **data) -> None:
        ev = Event(type=type_, case_id=case_id, data=data)
        payload = ev.model_dump(mode="json")
        if self._loop is not None:
            self._loop.call_soon_threadsafe(self._fanout, payload)
        if self._eb is not None and type_ in ("case.created", "bug.detected", "stage.updated"):
            try:
                self._eb.put_events(Entries=[{"Source": "f2f.console", "DetailType": type_, "EventBusName": settings.event_bus_name,
                                              "Detail": json.dumps(payload)}])
            except Exception as e:  # never let telemetry break the pipeline
                log.warning("EventBridge put_events failed: %s", e)

    def _fanout(self, payload: dict) -> None:
        for q in list(self._subs):
            try:
                q.put_nowait(payload)
            except asyncio.QueueFull:
                pass


bus = Bus()
