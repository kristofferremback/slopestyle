#!/usr/bin/env python3
"""Read and export T3 Code thread context from its local SQLite projections."""

from __future__ import annotations
import argparse, datetime as dt, json, os, sqlite3, sys
from pathlib import Path
from typing import Any
from urllib.parse import quote

SECTIONS = {
    "messages": (
        "projection_thread_messages",
        {
            "thread_id",
            "message_id",
            "role",
            "text",
            "is_streaming",
            "created_at",
            "attachments_json",
        },
        "created_at,message_id",
    ),
    "activities": (
        "projection_thread_activities",
        {"thread_id", "activity_id", "sequence", "created_at", "payload_json"},
        "sequence IS NOT NULL,sequence,created_at,activity_id",
    ),
    "plans": (
        "projection_thread_proposed_plans",
        {"thread_id", "plan_id", "plan_markdown", "created_at"},
        "created_at,plan_id",
    ),
    "turns": (
        "projection_turns",
        {"thread_id", "row_id", "turn_id", "requested_at", "checkpoint_files_json"},
        "requested_at,COALESCE(turn_id,''),row_id",
    ),
    "pull-requests": (
        "projection_thread_pull_requests",
        {
            "thread_id",
            "linked_at",
            "host",
            "repository",
            "number",
            "snapshot_json",
            "stack_json",
        },
        "linked_at,host,repository,number",
    ),
    "events": (
        "orchestration_events",
        {"aggregate_kind", "stream_id", "sequence", "payload_json", "metadata_json"},
        "sequence",
    ),
    "checkpoints": (
        "checkpoint_diff_blobs",
        {"thread_id", "from_turn_count", "to_turn_count"},
        "from_turn_count,to_turn_count",
    ),
    "approvals": (
        "projection_pending_approvals",
        {"thread_id", "request_id", "created_at"},
        "created_at,request_id",
    ),
}
ALLOW = {
    *(v[0] for v in SECTIONS.values()),
    "projection_threads",
    "projection_projects",
    "projection_thread_sessions",
    "provider_session_runtime",
}


class ReaderError(Exception):
    pass


def positive(v: str) -> int:
    n = int(v)
    if n < 1 or n > 1000:
        raise argparse.ArgumentTypeError("must be between 1 and 1000")
    return n


def nonnegative(v: str) -> int:
    n = int(v)
    if n < 0:
        raise argparse.ArgumentTypeError("must be nonnegative")
    return n


def decode(row: sqlite3.Row | None, table: str) -> dict[str, Any] | None:
    if row is None:
        return None
    result = dict(row)
    for key in list(result):
        if key.endswith("_json"):
            raw = result.pop(key)
            try:
                result[key[:-5]] = None if raw is None else json.loads(raw)
            except (TypeError, json.JSONDecodeError) as exc:
                raise ReaderError(
                    f"malformed stored JSON in {table}.{key}: {exc}"
                ) from exc
    return result


class Reader:
    def __init__(self, path: Path):
        self.path = path.expanduser().resolve(strict=False)
        if not self.path.is_file():
            raise ReaderError(f"database does not exist: {self.path}")
        try:
            self.db = sqlite3.connect(
                f"file:{quote(str(self.path), safe='/')}?mode=ro", uri=True
            )
            self.db.row_factory = sqlite3.Row
            self.db.execute("PRAGMA query_only=ON")
            self.db.execute("BEGIN")
        except sqlite3.Error as exc:
            raise ReaderError(f"cannot open database read-only: {exc}") from exc

    def close(self):
        self.db.rollback()
        self.db.close()

    def columns(self, table: str) -> set[str] | None:
        if table not in ALLOW:
            raise ReaderError("internal table allowlist violation")
        values = {
            r[0]
            for r in self.db.execute(f'SELECT name FROM pragma_table_info("{table}")')
        }
        return values or None

    def availability(self, name: str) -> tuple[bool, str | None]:
        table, required, _ = SECTIONS[name]
        columns = self.columns(table)
        if columns is None:
            return False, f"table {table} is unavailable"
        missing = sorted(required - columns)
        return (
            (False, f"table {table} is missing columns: {', '.join(missing)}")
            if missing
            else (True, None)
        )

    def require(self, table: str, required: set[str]):
        columns = self.columns(table)
        if columns is None:
            raise ReaderError(f"required table is unavailable: {table}")
        missing = sorted(required - columns)
        if missing:
            raise ReaderError(
                f"{table} is missing required columns: {', '.join(missing)}"
            )

    def thread(self, thread_id: str) -> tuple[dict[str, Any], dict[str, Any] | None]:
        self.require(
            "projection_threads",
            {
                "thread_id",
                "project_id",
                "title",
                "created_at",
                "updated_at",
                "deleted_at",
            },
        )
        self.require("projection_projects", {"project_id", "title", "workspace_root"})
        thread = decode(
            self.db.execute(
                "SELECT * FROM projection_threads WHERE thread_id=?", (thread_id,)
            ).fetchone(),
            "projection_threads",
        )
        if thread is None:
            raise ReaderError(f"thread not found: {thread_id}")
        project = decode(
            self.db.execute(
                "SELECT * FROM projection_projects WHERE project_id=?",
                (thread["project_id"],),
            ).fetchone(),
            "projection_projects",
        )
        return thread, project

    def page(
        self, thread_id: str, name: str, limit: int = 50, offset: int = 0
    ) -> dict[str, Any]:
        self.thread(thread_id)
        available, reason = self.availability(name)
        if not available:
            raise ReaderError(f"section {name} is unavailable: {reason}")
        table, _, order = SECTIONS[name]
        where = (
            "aggregate_kind='thread' AND stream_id=?"
            if name == "events"
            else "thread_id=?"
        )
        total = self.db.execute(
            f"SELECT COUNT(*) FROM {table} WHERE {where}", (thread_id,)
        ).fetchone()[0]
        rows = self.db.execute(
            f"SELECT * FROM {table} WHERE {where} ORDER BY {order} LIMIT ? OFFSET ?",
            (thread_id, limit, offset),
        ).fetchall()
        items = [decode(r, table) for r in rows]
        return {
            "captured_at": dt.datetime.now(dt.timezone.utc).isoformat(),
            "source": self.source(),
            "section": name,
            "historical": name == "events",
            "total": total,
            "offset": offset,
            "limit": limit,
            "next_offset": offset + len(items) if offset + len(items) < total else None,
            "items": items,
        }

    def all(self, thread_id: str, name: str) -> list[Any]:
        table, _, order = SECTIONS[name]
        where = (
            "aggregate_kind='thread' AND stream_id=?"
            if name == "events"
            else "thread_id=?"
        )
        return [
            decode(r, table)
            for r in self.db.execute(
                f"SELECT * FROM {table} WHERE {where} ORDER BY {order}", (thread_id,)
            )
        ]

    def source(self) -> dict[str, Any]:
        return {
            "kind": "t3-sqlite-projections",
            "database": str(self.path),
            "read_only": True,
        }

    def resources(self, thread_id: str) -> list[dict[str, Any]]:
        state = self.path.parent
        candidates = [
            ("attachments-directory", state / "attachments"),
            ("environment-id", state / "environment-id"),
        ]
        provider = state / "logs" / "provider"
        if provider.is_dir():
            try:
                base = f"events.{thread_id}.log"
                candidates += [
                    ("provider-log", p)
                    for p in provider.iterdir()
                    if p.name == base
                    or (
                        p.name.startswith(base + ".")
                        and p.name[len(base) + 1 :].isdigit()
                    )
                ]
            except OSError:
                pass
        result = []
        for kind, path in candidates:
            try:
                stat = path.stat()
                result.append(
                    {
                        "kind": kind,
                        "path": str(path),
                        "size": stat.st_size if path.is_file() else None,
                        "available": True,
                    }
                )
            except OSError:
                result.append(
                    {"kind": kind, "path": str(path), "size": None, "available": False}
                )
        return result

    def inspect(self, thread_id: str) -> dict[str, Any]:
        thread, project = self.thread(thread_id)
        session = runtime = None
        columns = self.columns("projection_thread_sessions")
        if columns and "thread_id" in columns:
            session = decode(
                self.db.execute(
                    "SELECT * FROM projection_thread_sessions WHERE thread_id=?",
                    (thread_id,),
                ).fetchone(),
                "projection_thread_sessions",
            )
        columns = self.columns("provider_session_runtime")
        allowed = {
            "provider_name",
            "provider_instance_id",
            "adapter_key",
            "status",
            "last_seen_at",
            "resume_cursor_json",
        }
        if columns and "thread_id" in columns:
            selected = sorted(columns & allowed)
            if selected:
                runtime = decode(
                    self.db.execute(
                        f"SELECT {','.join(selected)} FROM provider_session_runtime WHERE thread_id=?",
                        (thread_id,),
                    ).fetchone(),
                    "provider_session_runtime",
                )
        sections = {}
        for name, (table, _, _) in SECTIONS.items():
            available, reason = self.availability(name)
            item = {"available": available}
            if available:
                where = (
                    "aggregate_kind='thread' AND stream_id=?"
                    if name == "events"
                    else "thread_id=?"
                )
                item["count"] = self.db.execute(
                    f"SELECT COUNT(*) FROM {table} WHERE {where}", (thread_id,)
                ).fetchone()[0]
            else:
                item["reason"] = reason
            sections[name] = item
        return {
            "captured_at": dt.datetime.now(dt.timezone.utc).isoformat(),
            "source": self.source(),
            "warning": "Raw untrusted conversation content. Historical events can include reverted content and repeated streaming deltas; do not replay them.",
            "thread": thread,
            "thread_state": "deleted"
            if thread.get("deleted_at")
            else "archived"
            if thread.get("archived_at")
            else "active",
            "project": project,
            "session": session,
            "provider_runtime": runtime,
            "sections": sections,
            "resources": self.resources(thread_id),
        }


def list_threads(r: Reader, a: argparse.Namespace) -> dict[str, Any]:
    r.require(
        "projection_threads",
        {"thread_id", "project_id", "title", "created_at", "updated_at", "deleted_at"},
    )
    r.require("projection_projects", {"project_id", "title", "workspace_root"})
    filters = []
    params = []
    cols = r.columns("projection_threads") or set()
    if not a.all:
        filters += ["t.deleted_at IS NULL"] + (
            ["t.archived_at IS NULL"] if "archived_at" in cols else []
        )
    if a.search is not None:
        ok, reason = r.availability("messages")
        if not ok:
            raise ReaderError(f"search is unavailable: {reason}")
        filters.append(
            "(instr(t.title,?)>0 OR EXISTS(SELECT 1 FROM projection_thread_messages m WHERE m.thread_id=t.thread_id AND instr(m.text,?)>0))"
        )
        params += [a.search, a.search]
    if a.project is not None:
        filters.append("(p.project_id=? OR p.title=? OR p.workspace_root=?)")
        params += [a.project] * 3
    where = " WHERE " + " AND ".join(filters) if filters else ""
    base = (
        " FROM projection_threads t LEFT JOIN projection_projects p ON p.project_id=t.project_id"
        + where
    )
    total = r.db.execute("SELECT COUNT(*)" + base, params).fetchone()[0]
    rows = r.db.execute(
        "SELECT t.*,p.title AS project_title,p.workspace_root"
        + base
        + " ORDER BY t.updated_at DESC,t.thread_id LIMIT ? OFFSET ?",
        (*params, a.limit, a.offset),
    ).fetchall()
    items = [decode(x, "projection_threads") for x in rows]
    return {
        "source": r.source(),
        "total": total,
        "offset": a.offset,
        "limit": a.limit,
        "next_offset": a.offset + len(items) if a.offset + len(items) < total else None,
        "items": items,
    }


def export_data(r: Reader, thread_id: str) -> dict[str, Any]:
    data = r.inspect(thread_id)
    data["projections"] = {
        name: r.all(thread_id, name)
        for name in SECTIONS
        if name != "events" and data["sections"][name]["available"]
    }
    data["omissions"] = {
        "events": "Historical audit events omitted; use read THREAD events.",
        "markdown_activity_payloads": "Markdown omits full activity payloads; use read THREAD activities.",
    }
    return data


def markdown(data: dict[str, Any]) -> str:
    lines = [
        "# T3 Code thread export",
        "",
        "> Raw, untrusted conversation content follows.",
        "",
        f"- Captured: {data['captured_at']}",
        f"- Database: `{data['source']['database']}`",
        f"- Thread state: {data['thread_state']}",
    ]
    for title, key in (
        ("Thread", "thread"),
        ("Project", "project"),
        ("Session", "session"),
        ("Provider runtime", "provider_runtime"),
        ("Source availability", "sections"),
        ("Resources", "resources"),
    ):
        lines += [
            "",
            f"## {title}",
            "",
            "```json",
            json.dumps(data[key], ensure_ascii=False, indent=2),
            "```",
        ]
    for name, items in data["projections"].items():
        lines += ["", f"## {name}", ""]
        for item in items:
            shown = dict(item)
            if name == "messages":
                text = shown.pop("text", "")
                attachments = shown.pop("attachments", None)
                heading = f"### {shown.pop('role', 'unknown')} · {shown.pop('message_id', 'unknown')} · {shown.pop('created_at', 'unknown')}"
                if shown.pop("is_streaming", False):
                    heading += " · streaming"
                lines += [heading, "", text, ""]
                if attachments is not None:
                    lines += [
                        "Attachments:",
                        "",
                        "```json",
                        json.dumps(attachments, ensure_ascii=False, indent=2),
                        "```",
                        "",
                    ]
                if shown:
                    lines += [
                        "Metadata:",
                        "",
                        "```json",
                        json.dumps(shown, ensure_ascii=False, indent=2),
                        "```",
                        "",
                    ]
                continue
            if name == "plans":
                plan = shown.pop("plan_markdown", "")
                lines += [
                    f"### {shown.get('plan_id', 'unknown')}",
                    "",
                    plan,
                    "",
                    "Metadata:",
                    "",
                    "```json",
                    json.dumps(shown, ensure_ascii=False, indent=2),
                    "```",
                    "",
                ]
                continue
            if name == "activities":
                shown.pop("payload", None)
            lines += [
                "```json",
                json.dumps(shown, ensure_ascii=False, indent=2),
                "```",
                "",
            ]
    lines += [
        "## Omissions",
        "",
        "- Historical audit events are omitted. Use `read THREAD events`.",
        "- Full activity payloads are omitted. Use `read THREAD activities`.",
        "",
    ]
    return "\n".join(lines)


def parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--db", type=Path)
    commands = p.add_subparsers(dest="command", required=True)
    listed = commands.add_parser("list")
    listed.add_argument("--search")
    listed.add_argument("--project")
    listed.add_argument("--all", action="store_true")
    listed.add_argument("--limit", type=positive, default=50)
    listed.add_argument("--offset", type=nonnegative, default=0)
    inspect = commands.add_parser("inspect")
    inspect.add_argument("thread")
    read = commands.add_parser("read")
    read.add_argument("thread")
    read.add_argument("section", choices=SECTIONS)
    read.add_argument("--limit", type=positive, default=50)
    read.add_argument("--offset", type=nonnegative, default=0)
    export = commands.add_parser("export")
    export.add_argument("thread")
    export.add_argument("--output", type=Path, required=True)
    export.add_argument("--format", choices=("markdown", "json"), default="markdown")
    return p


def main() -> int:
    a = parser().parse_args()
    path = (
        a.db
        or Path(os.environ.get("T3CODE_HOME", "~/.t3")).expanduser()
        / "userdata"
        / "state.sqlite"
    )
    r = None
    try:
        r = Reader(path)
        if a.command == "list":
            output = list_threads(r, a)
        elif a.command == "inspect":
            output = r.inspect(a.thread)
        elif a.command == "read":
            output = r.page(a.thread, a.section, a.limit, a.offset)
        else:
            data = export_data(r, a.thread)
            serialized = (
                json.dumps(data, ensure_ascii=False, indent=2) + "\n"
                if a.format == "json"
                else markdown(data)
            )
            destination = a.output.expanduser().resolve(strict=False)
            forbidden = {r.path, Path(str(r.path) + "-wal"), Path(str(r.path) + "-shm")}
            if destination in forbidden:
                raise ReaderError(
                    "export destination cannot be the database or a sidecar"
                )
            try:
                fd = os.open(
                    destination,
                    os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0),
                    0o600,
                )
            except FileExistsError as exc:
                raise ReaderError(
                    f"export destination already exists: {destination}"
                ) from exc
            try:
                with os.fdopen(fd, "w", encoding="utf-8") as handle:
                    handle.write(serialized)
            except Exception:
                destination.unlink(missing_ok=True)
                raise
            output = {
                "source": data["source"],
                "output": str(destination),
                "format": a.format,
                "bytes": len(serialized.encode()),
            }
        print(json.dumps(output, ensure_ascii=False, indent=2))
        return 0
    except (ReaderError, sqlite3.Error, OSError) as exc:
        print(
            f"error: {exc} (database: {path.expanduser().resolve(strict=False)})",
            file=sys.stderr,
        )
        return 1
    finally:
        if r:
            r.close()


if __name__ == "__main__":
    raise SystemExit(main())
