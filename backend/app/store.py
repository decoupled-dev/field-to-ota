"""Persistence. SQLite with JSON documents locally; the same interface maps onto DynamoDB tables in aws mode."""
from __future__ import annotations

import json
import sqlite3
import threading
from typing import TypeVar

from pydantic import BaseModel

from .config import settings
from .models import Case, Signal, StageRun

T = TypeVar("T", bound=BaseModel)

_TABLES = {"cases": "id", "signals": "id", "stage_runs": "pk", "clusters": "id", "kv": "id"}


class Store:
    def __init__(self, path=None):
        self._lock = threading.RLock()
        self._db = sqlite3.connect(path or settings.state_dir / "f2f.db", check_same_thread=False)
        for table in _TABLES:
            self._db.execute(f"CREATE TABLE IF NOT EXISTS {table} (id TEXT PRIMARY KEY, doc TEXT NOT NULL, ts REAL)")
        self._db.commit()

    def _put(self, table: str, key: str, doc: dict, ts: float = 0) -> None:
        with self._lock:
            self._db.execute(f"INSERT OR REPLACE INTO {table} (id, doc, ts) VALUES (?, ?, ?)", (key, json.dumps(doc), ts))
            self._db.commit()

    def _get(self, table: str, key: str) -> dict | None:
        with self._lock:
            row = self._db.execute(f"SELECT doc FROM {table} WHERE id = ?", (key,)).fetchone()
        return json.loads(row[0]) if row else None

    def _all(self, table: str, prefix: str | None = None) -> list[dict]:
        with self._lock:
            if prefix:
                rows = self._db.execute(f"SELECT doc FROM {table} WHERE id LIKE ? ORDER BY ts DESC", (prefix + "%",)).fetchall()
            else:
                rows = self._db.execute(f"SELECT doc FROM {table} ORDER BY ts DESC").fetchall()
        return [json.loads(r[0]) for r in rows]

    def reset(self) -> None:
        with self._lock:
            for table in _TABLES:
                self._db.execute(f"DELETE FROM {table}")
            self._db.commit()

    # Cases
    def put_case(self, c: Case) -> Case:
        self._put("cases", c.id, c.model_dump(mode="json"), c.created_at)
        return c

    def get_case(self, case_id: str) -> Case | None:
        d = self._get("cases", case_id)
        return Case(**d) if d else None

    def list_cases(self) -> list[Case]:
        return [Case(**d) for d in self._all("cases")]

    # Signals
    def put_signal(self, s: Signal) -> Signal:
        self._put("signals", s.id, s.model_dump(mode="json"), s.created_at)
        return s

    def get_signal(self, sid: str) -> Signal | None:
        d = self._get("signals", sid)
        return Signal(**d) if d else None

    def list_signals(self) -> list[Signal]:
        return [Signal(**d) for d in self._all("signals")]

    # Stage runs
    def put_stage(self, r: StageRun) -> StageRun:
        from .stages import STAGE_KEYS
        self._put("stage_runs", f"{r.case_id}#{STAGE_KEYS.index(r.stage):02d}", r.model_dump(mode="json"), -STAGE_KEYS.index(r.stage))
        return r

    def list_stages(self, case_id: str) -> list[StageRun]:
        return [StageRun(**d) for d in self._all("stage_runs", f"{case_id}#")]

    # Clusters & misc documents
    def put_doc(self, table: str, key: str, doc: dict, ts: float = 0) -> None:
        self._put(table, key, doc, ts)

    def get_doc(self, table: str, key: str) -> dict | None:
        return self._get(table, key)

    def list_docs(self, table: str, prefix: str | None = None) -> list[dict]:
        return self._all(table, prefix)


class DynamoStore(Store):
    """Single-table DynamoDB layout: pk = logical table, sk = document id. Used in aws mode."""

    def __init__(self, table_name: str):
        import boto3
        self._lock = threading.RLock()
        self._t = boto3.resource("dynamodb", region_name=settings.aws_region).Table(table_name)

    def _put(self, table, key, doc, ts=0):
        from decimal import Decimal
        self._t.put_item(Item={"pk": table, "sk": key, "doc": json.dumps(doc), "ts": Decimal(str(ts))})

    def _get(self, table, key):
        item = self._t.get_item(Key={"pk": table, "sk": key}).get("Item")
        return json.loads(item["doc"]) if item else None

    def _all(self, table, prefix=None):
        from boto3.dynamodb.conditions import Key
        cond = Key("pk").eq(table) & Key("sk").begins_with(prefix) if prefix else Key("pk").eq(table)
        items, kw = [], {"KeyConditionExpression": cond}
        while True:
            page = self._t.query(**kw)
            items += page["Items"]
            if "LastEvaluatedKey" not in page:
                break
            kw["ExclusiveStartKey"] = page["LastEvaluatedKey"]
        items.sort(key=lambda i: -float(i["ts"]))
        return [json.loads(i["doc"]) for i in items]

    def reset(self):
        from boto3.dynamodb.conditions import Key
        for table in _TABLES:
            for item in self._t.query(KeyConditionExpression=Key("pk").eq(table))["Items"]:
                self._t.delete_item(Key={"pk": table, "sk": item["sk"]})


def _make_store() -> Store:
    import os
    table = os.environ.get("F2F_TABLE")
    return DynamoStore(table) if settings.mode == "aws" and table else Store()


store = _make_store()
