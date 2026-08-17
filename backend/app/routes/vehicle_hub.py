"""Private, VIN-scoped Vehicle Hub reviewed maintenance ingestion."""

from __future__ import annotations

import hashlib
import hmac
import json
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Header, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.models.service_line_item import ServiceLineItem
from app.models.service_visit import ServiceVisit
from app.services.service_visit_service import ServiceVisitService, service_visit_full_load_options

JsonObject = dict[str, Any]
router = APIRouter(prefix="/api/integration/v1/vehicle-hub", tags=["Vehicle Hub"])
KM_PER_MILE = Decimal("1.609344")
SERVICE_CATEGORIES = {"Maintenance", "Inspection", "Collision", "Upgrades", "Detailing"}
WRITE_DECISIONS = {"create", "keep_both", "update_linked", "replace", "merge"}


def _require_token(authorization: Annotated[str | None, Header()] = None) -> None:
    expected = settings.vehicle_hub_sync_token
    scheme, _, supplied = (authorization or "").partition(" ")
    if not expected:
        raise HTTPException(status_code=503, detail="Vehicle Hub integration is not configured")
    if scheme.lower() != "bearer" or not supplied or not hmac.compare_digest(supplied, expected):
        raise HTTPException(status_code=401, detail="Invalid Vehicle Hub token")


def _text(value: Any, limit: int) -> str | None:
    result = str(value or "").strip()
    return result[:limit] or None


def _decimal(value: Any) -> Decimal | None:
    if value in (None, ""):
        return None
    try:
        result = Decimal(str(value))
    except (InvalidOperation, ValueError):
        return None
    return result if result >= 0 else None


def _date(value: Any) -> date:
    try:
        return date.fromisoformat(str(value or "")[:10])
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Source service date must be YYYY-MM-DD") from exc


def _datetime(value: Any) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00")).replace(tzinfo=None)
    except ValueError:
        return None


def _category(value: Any) -> str:
    supplied = _text(value, 30)
    if supplied in SERVICE_CATEGORIES:
        return supplied
    return "Inspection" if supplied and "inspect" in supplied.casefold() else "Maintenance"


def _fingerprint(source: JsonObject) -> str:
    business = {
        key: source.get(key)
        for key in ("date", "mileage", "type", "subtype", "notes", "shop", "cost", "invoiceNumber")
        if source.get(key) is not None
    }
    raw = json.dumps(business, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _notes(source: JsonObject) -> str | None:
    lines: list[str] = []
    for value in (
        source.get("notes"),
        f"Provider: {source['shop']}" if source.get("shop") else None,
        f"Invoice / RO: {source['invoiceNumber']}" if source.get("invoiceNumber") else None,
    ):
        text = _text(value, 5000)
        if text and text.casefold() not in {line.casefold() for line in lines}:
            lines.append(text)
    return "\n".join(lines) or None


def _merge_text(existing: str | None, incoming: str | None) -> str | None:
    values: list[str] = []
    for value in (existing, incoming):
        text = _text(value, 5000)
        if text and text.casefold() not in {item.casefold() for item in values}:
            values.append(text)
    return "\n\n".join(values) or None


async def _loaded_visit(db: AsyncSession, vin: str, visit_id: int) -> ServiceVisit | None:
    result = await db.execute(
        select(ServiceVisit)
        .options(*service_visit_full_load_options())
        .where(ServiceVisit.vin == vin, ServiceVisit.id == visit_id)
    )
    return result.scalar_one_or_none()


@router.get("/health")
async def integration_health(_: None = Depends(_require_token)):
    return {
        "healthy": True,
        "integration": "vehicle-hub",
        "vehicleConfigured": bool(settings.vehicle_hub_vehicle_vin),
    }


@router.post("/service-records")
async def apply_reviewed_records(
    payload: JsonObject,
    _: None = Depends(_require_token),
    db: AsyncSession = Depends(get_db),
):
    vin = str(payload.get("vehicleVin") or "").strip().upper()
    configured_vin = settings.vehicle_hub_vehicle_vin.strip().upper()
    if not configured_vin or not hmac.compare_digest(vin, configured_vin):
        raise HTTPException(status_code=403, detail="Vehicle VIN is outside integration scope")
    if payload.get("sourceSystem") != "command":
        raise HTTPException(status_code=400, detail="Reviewed sourceSystem must be command")
    actions = payload.get("actions")
    if not isinstance(actions, list) or not actions or len(actions) > 500:
        raise HTTPException(status_code=400, detail="One to 500 reviewed actions are required")
    applied: list[tuple[str, int, str]] = []
    for action in actions:
        if not isinstance(action, dict) or action.get("decision") not in WRITE_DECISIONS:
            raise HTTPException(status_code=400, detail="Invalid reviewed action")
        decision = str(action["decision"])
        source = action.get("source")
        if not isinstance(source, dict):
            raise HTTPException(status_code=400, detail="Reviewed action source is required")
        source_id = _text(source.get("externalId"), 200)
        if not source_id:
            raise HTTPException(status_code=400, detail="Source externalId is required")
        existing_result = await db.execute(
            select(ServiceVisit).options(*service_visit_full_load_options()).where(
                ServiceVisit.external_source == "command",
                ServiceVisit.external_id == source_id,
            )
        )
        visit = existing_result.scalar_one_or_none()
        target_id = action.get("targetId")
        if visit is None and decision in {"replace", "merge", "update_linked"} and target_id:
            try:
                visit = await _loaded_visit(db, vin, int(str(target_id)))
            except ValueError as exc:
                raise HTTPException(status_code=400, detail="MyGarage targetId must be numeric") from exc
        creating = visit is None
        if creating:
            visit = ServiceVisit(vin=vin, date=_date(source.get("date")))
            db.add(visit)
            await db.flush()
        assert visit is not None
        if visit.external_source not in (None, "command"):
            raise HTTPException(status_code=409, detail="Target service visit belongs to another source")
        incoming_date = _date(source.get("date"))
        incoming_mileage = _decimal(source.get("mileage"))
        incoming_km = (incoming_mileage * KM_PER_MILE).quantize(Decimal("0.01")) if incoming_mileage is not None else None
        incoming_notes = _notes(source)
        incoming_category = _category(source.get("type"))
        incoming_cost = _decimal(source.get("cost"))
        description = _text(source.get("subtype"), 200) or _text(source.get("type"), 200) or "Service event"
        if decision == "merge" and not creating:
            visit.date = incoming_date or visit.date
            visit.odometer_km = incoming_km if incoming_km is not None else visit.odometer_km
            visit.notes = _merge_text(visit.notes, incoming_notes)
            visit.service_category = visit.service_category or incoming_category
            descriptions = {item.description.casefold() for item in visit.line_items}
            if description.casefold() not in descriptions:
                db.add(ServiceLineItem(visit_id=visit.id, description=description, category=incoming_category, cost=None, notes="Merged from CarChief Command"))
            if visit.total_cost is None:
                visit.total_cost = incoming_cost
        else:
            visit.date = incoming_date
            visit.odometer_km = incoming_km
            visit.notes = incoming_notes
            visit.service_category = incoming_category
            visit.total_cost = incoming_cost
            for item in list(visit.line_items):
                await db.delete(item)
            await db.flush()
            db.add(ServiceLineItem(visit_id=visit.id, description=description, category=incoming_category, cost=incoming_cost, notes=_text(source.get("notes"), 5000)))
        visit.external_source = "command"
        visit.external_id = source_id
        visit.external_updated_at = _datetime(source.get("externalUpdatedAt"))
        visit.external_fingerprint = _text(source.get("fingerprint"), 64) or _fingerprint(source)
        await db.flush()
        applied.append((source_id, visit.id, decision))
    await db.commit()
    results: list[JsonObject] = []
    for source_id, visit_id, decision in applied:
        loaded = await ServiceVisitService(db)._reload_visit_full(visit_id)
        response = ServiceVisitService(db)._visit_to_response(loaded).model_dump(mode="json")
        results.append({"sourceId": source_id, "targetId": str(visit_id), "decision": decision, "record": response})
    return {"results": results}
