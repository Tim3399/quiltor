"""Durable assistant interaction audit records stored with a world."""

from __future__ import annotations

import json
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any

from quiltor.infrastructure.persistence.sqlite.connection import connection


def log_interaction(
    question: str,
    response: dict[str, Any] | None = None,
    error: str = "",
    db_path: Path | None = None,
) -> str:
    interaction_id = uuid.uuid4().hex
    with connection(db_path) as database:
        database.execute(
            """
            INSERT INTO assistant_interactions(
              id,created_at,question,response_json,status,error
            ) VALUES(?,?,?,?,?,?)
            """,
            (
                interaction_id,
                datetime.now().isoformat(),
                question,
                json.dumps(response, ensure_ascii=False) if response is not None else None,
                "failed" if error else "completed",
                error,
            ),
        )
    return interaction_id


def list_interactions(
    limit: int = 50,
    db_path: Path | None = None,
) -> list[dict[str, Any]]:
    with connection(db_path) as database:
        rows = database.execute(
            """
            SELECT id,created_at,question,response_json,status,error
            FROM assistant_interactions
            ORDER BY created_at DESC LIMIT ?
            """,
            (max(1, min(limit, 200)),),
        ).fetchall()
    return [
        {
            "id": row["id"],
            "createdAt": row["created_at"],
            "question": row["question"],
            "response": json.loads(row["response_json"]) if row["response_json"] else None,
            "status": row["status"],
            "error": row["error"],
        }
        for row in rows
    ]


__all__ = ["list_interactions", "log_interaction"]
