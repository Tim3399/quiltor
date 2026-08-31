"""SQLite mapping for the non-canonical Storyboard planning document."""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path
from typing import Any

from quiltor.domain.storyboard import default_storyboard_document, valid_storyboard_document
from quiltor.infrastructure.persistence.sqlite.codec import decode_extra, encode_extra
from quiltor.infrastructure.persistence.sqlite.connection import connect, connection


_DOCUMENT_FIELDS = {"boards", "nodes", "edges"}
_BOARD_FIELDS = {"id", "title"}
_NODE_FIELDS = {
    "id",
    "boardId",
    "kind",
    "x",
    "y",
    "target",
}
_EDGE_FIELDS = {"id", "boardId", "sourceNodeId", "targetNodeId"}


def load(db_path: Path | None = None) -> dict[str, Any]:
    with connection(db_path) as database:
        extension_row = database.execute(
            "SELECT value FROM meta WHERE key='storyboards_extra_json'"
        ).fetchone()
        result = decode_extra(extension_row[0]) if extension_row else {}

        boards = []
        for row in database.execute("SELECT * FROM storyboards ORDER BY position,id"):
            board = decode_extra(row["extra_json"])
            board.update(id=row["id"], title=row["title"])
            boards.append(board)
        if not boards:
            return {**result, **default_storyboard_document()}

        nodes = []
        for row in database.execute(
            """
            SELECT * FROM storyboard_nodes ORDER BY position,id
            """
        ):
            node = decode_extra(row["extra_json"])
            target_extensions = node.pop("target", {})
            node.update(
                id=row["id"],
                boardId=row["board_id"],
                kind=row["kind"],
                x=row["x"],
                y=row["y"],
            )
            if row["kind"] == "note" and "text" not in node:
                node["text"] = row["text"]
            if row["kind"] == "group" and "width" not in node and row["width"] is not None:
                node["width"] = row["width"]
            if row["kind"] == "group" and "height" not in node and row["height"] is not None:
                node["height"] = row["height"]
            if row["target_kind"]:
                target = target_extensions if isinstance(target_extensions, dict) else {}
                node["target"] = {
                    **target,
                    "kind": row["target_kind"],
                    "id": row["target_id"],
                }
            nodes.append(node)

        edges = []
        for row in database.execute(
            """
            SELECT * FROM storyboard_edges ORDER BY position,id
            """
        ):
            edge = decode_extra(row["extra_json"])
            edge.update(
                id=row["id"],
                boardId=row["board_id"],
                sourceNodeId=row["source_node_id"],
                targetNodeId=row["target_node_id"],
            )
            edges.append(edge)

        result.update(boards=boards, nodes=nodes, edges=edges)
        if not valid_storyboard_document(result):
            raise ValueError("invalid persisted Storyboard document")
        return result


def _delete_missing_rows(
    database: sqlite3.Connection,
    table: str,
    retained_ids: set[str],
) -> None:
    removed = [
        (row[0],)
        for row in database.execute(f"SELECT id FROM {table}")
        if row[0] not in retained_ids
    ]
    if removed:
        database.executemany(f"DELETE FROM {table} WHERE id=?", removed)


def _node_extra(node: dict[str, Any]) -> str:
    extensions = {key: value for key, value in node.items() if key not in _NODE_FIELDS}
    target = node.get("target")
    if isinstance(target, dict):
        target_extensions = {
            key: value for key, value in target.items() if key not in {"kind", "id"}
        }
        if target_extensions:
            extensions["target"] = target_extensions
    return json.dumps(extensions, ensure_ascii=False)


def _sync(state: dict[str, Any], database: sqlite3.Connection) -> None:
    if not valid_storyboard_document(state):
        raise ValueError("invalid Storyboard document")

    boards = state["boards"]
    nodes = state["nodes"]
    edges = state["edges"]

    for position, board in enumerate(boards):
        database.execute(
            """
            INSERT INTO storyboards(id,position,title,extra_json)
            VALUES(?,?,?,?)
            ON CONFLICT(id) DO UPDATE SET
              position=excluded.position,
              title=excluded.title,
              extra_json=excluded.extra_json
            """,
            (
                board["id"],
                position,
                board["title"],
                encode_extra(board, _BOARD_FIELDS),
            ),
        )

    for position, node in enumerate(nodes):
        target = node.get("target")
        database.execute(
            """
            INSERT INTO storyboard_nodes(
              id,board_id,position,kind,x,y,width,height,z_index,text,
              target_kind,target_id,extra_json
            ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)
            ON CONFLICT(id) DO UPDATE SET
              board_id=excluded.board_id,
              position=excluded.position,
              kind=excluded.kind,
              x=excluded.x,
              y=excluded.y,
              width=excluded.width,
              height=excluded.height,
              z_index=excluded.z_index,
              text=excluded.text,
              target_kind=excluded.target_kind,
              target_id=excluded.target_id,
              extra_json=excluded.extra_json
            """,
            (
                node["id"],
                node["boardId"],
                position,
                node["kind"],
                float(node["x"]),
                float(node["y"]),
                float(node["width"]) if "width" in node else None,
                float(node["height"]) if "height" in node else None,
                node.get("zIndex", 0),
                node.get("text", ""),
                target.get("kind", "") if isinstance(target, dict) else "",
                target.get("id", "") if isinstance(target, dict) else "",
                _node_extra(node),
            ),
        )

    for position, edge in enumerate(edges):
        database.execute(
            """
            INSERT INTO storyboard_edges(
              id,board_id,position,source_node_id,target_node_id,label,extra_json
            ) VALUES(?,?,?,?,?,?,?)
            ON CONFLICT(id) DO UPDATE SET
              board_id=excluded.board_id,
              position=excluded.position,
              source_node_id=excluded.source_node_id,
              target_node_id=excluded.target_node_id,
              label=excluded.label,
              extra_json=excluded.extra_json
            """,
            (
                edge["id"],
                edge["boardId"],
                position,
                edge["sourceNodeId"],
                edge["targetNodeId"],
                edge.get("label", ""),
                encode_extra(edge, _EDGE_FIELDS),
            ),
        )

    _delete_missing_rows(database, "storyboard_edges", {edge["id"] for edge in edges})
    _delete_missing_rows(database, "storyboard_nodes", {node["id"] for node in nodes})
    _delete_missing_rows(database, "storyboards", {board["id"] for board in boards})
    database.execute(
        "INSERT OR REPLACE INTO meta(key,value) VALUES('storyboards_extra_json',?)",
        (encode_extra(state, _DOCUMENT_FIELDS),),
    )


def save(
    state: dict[str, Any],
    conn: sqlite3.Connection | None = None,
    db_path: Path | None = None,
) -> None:
    """Synchronize one complete Storyboard document in a single transaction."""

    if conn is not None:
        _sync(state, conn)
        return
    database = connect(db_path)
    try:
        with database:
            _sync(state, database)
    finally:
        database.close()


__all__ = ["load", "save"]
