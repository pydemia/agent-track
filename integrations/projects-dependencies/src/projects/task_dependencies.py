"""Bounded task dependency metadata within current native and service grants."""

from datetime import UTC, datetime

from sqlalchemy import or_, select
from sqlalchemy.orm import Load, Session, aliased

from projects.database import Item, Link, Project
from projects.project_access import accessible_project_ids

DEPENDENCY_LIMIT = 200


def _task(item: Item) -> dict:
    return {
        "id": item.id,
        "project_id": item.project_id,
        "kind": "task",
        "title": item.title,
        "revision": item.revision,
        "data": {
            "state": item.data.get("state", "unknown"),
            "requires_test": item.data.get("requires_test", True),
        },
    }


def read_task_dependencies(
    db: Session,
    account_id: str,
    project_ids: list[str],
    project_id: str,
) -> dict:
    """Filter ownership and both endpoints before ordering or applying the limit."""
    source = aliased(Item)
    target = aliased(Item)
    readable = accessible_project_ids(db, account_id).where(
        Project.id.in_(project_ids)
    )
    rows = db.execute(
        select(Link, source, target)
        .options(
            Load(Link).load_only(
                Link.id,
                Link.project_id,
                Link.relation,
                Link.source_revision,
                Link.target_revision,
            ),
            Load(source).load_only(
                source.id,
                source.project_id,
                source.kind,
                source.title,
                source.revision,
                source.data,
            ),
            Load(target).load_only(
                target.id,
                target.project_id,
                target.kind,
                target.title,
                target.revision,
                target.data,
            ),
        )
        .join(source, source.id == Link.source_id)
        .join(target, target.id == Link.target_id)
        .where(
            Link.relation == "depends_on",
            source.kind == "task",
            target.kind == "task",
            Link.project_id.in_(readable),
            source.project_id.in_(readable),
            target.project_id.in_(readable),
            or_(
                Link.project_id == project_id,
                source.project_id == project_id,
                target.project_id == project_id,
            ),
        )
        .order_by(Link.id)
        .limit(DEPENDENCY_LIMIT + 1)
    ).all()
    return {
        "version": 1,
        "project_id": project_id,
        "observed_at": datetime.now(UTC).isoformat(),
        "items": [
            {
                "id": link.id,
                "project_id": link.project_id,
                "relation": "depends_on",
                "source_task": _task(from_task),
                "target_task": _task(to_task),
                "source_revision": link.source_revision,
                "target_revision": link.target_revision,
            }
            for link, from_task, to_task in rows[:DEPENDENCY_LIMIT]
        ],
        "has_more": len(rows) > DEPENDENCY_LIMIT,
    }
