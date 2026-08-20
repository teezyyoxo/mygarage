"""Authenticated MyGarage proxy for Vehicle Hub review operations."""

from __future__ import annotations

import datetime as dt
from typing import Any
from urllib.parse import urlparse

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.models.user import User
from app.services.auth import get_vehicle_or_403, require_auth
from app.services.settings_service import SettingsService

JsonObject = dict[str, Any]
router = APIRouter(prefix="/api/vehicle-hub", tags=["Vehicle Hub Review"])


async def _forward(path: str, payload: JsonObject) -> JsonObject:
    token = settings.vehicle_hub_sync_token
    base_url = settings.vehicle_hub_url.rstrip("/")
    if not token or not base_url:
        raise HTTPException(status_code=503, detail="Vehicle Hub reviewed synchronization is not configured")
    try:
        async with httpx.AsyncClient(timeout=settings.vehicle_hub_timeout_seconds) as client:
            response = await client.post(
                f"{base_url}{path}",
                json=payload,
                headers={"Authorization": f"Bearer {token}", "Accept": "application/json"},
            )
        if response.status_code >= 400:
            try:
                detail = response.json().get("error") or response.text
            except ValueError:
                detail = response.text
            raise HTTPException(status_code=502, detail=f"Vehicle Hub rejected the request: {str(detail)[:300]}")
        result = response.json()
    except HTTPException:
        raise
    except (httpx.HTTPError, ValueError) as exc:
        raise HTTPException(status_code=502, detail="Vehicle Hub reconciliation service is unavailable") from exc
    if not isinstance(result, dict):
        raise HTTPException(status_code=502, detail="Vehicle Hub returned an invalid response")
    return result


async def _configured_vin(db: AsyncSession) -> str:
    configured_setting = await SettingsService.get(db, "vehicle_hub_vehicle_vin")
    return (configured_setting.value if configured_setting else settings.vehicle_hub_vehicle_vin).strip().upper()


async def _configured_command_url(db: AsyncSession) -> str:
    configured_setting = await SettingsService.get(db, "vehicle_hub_command_url")
    return (configured_setting.value if configured_setting else "").strip().rstrip("/")


def _normalize_command_url(value: Any) -> str:
    raw = str(value or "").strip().rstrip("/")
    try:
        parsed = urlparse(raw)
        port = parsed.port
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Command URL contains an invalid port") from exc
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise HTTPException(status_code=400, detail="Command URL must start with http:// or https://")
    if parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise HTTPException(
            status_code=400,
            detail="Command URL cannot contain credentials, a query, or a fragment",
        )
    if port is None:
        raise HTTPException(status_code=400, detail="Command URL must include an explicit port")
    return raw


async def _test_connection(
    payload: JsonObject, current_user: User, db: AsyncSession
) -> tuple[str, str, JsonObject]:
    vin = str(payload.get("vehicleVin") or "").strip().upper()
    command_url = _normalize_command_url(payload.get("commandUrl"))
    await get_vehicle_or_403(vin, current_user, db)
    result = await _forward("/v1/test", {"vehicleVin": vin, "commandUrl": command_url})
    return vin, command_url, result


async def _scope(payload: JsonObject, current_user: User, db: AsyncSession) -> str:
    vin = str(payload.get("vehicleVin") or "").strip().upper()
    configured = await _configured_vin(db)
    if not configured or vin != configured:
        raise HTTPException(status_code=403, detail="Vehicle VIN is outside integration scope")
    if not await _configured_command_url(db):
        raise HTTPException(status_code=503, detail="A tested Command URL has not been saved")
    await get_vehicle_or_403(vin, current_user, db)
    return vin


@router.get("/scope")
async def scope(
    vehicle_vin: str = Query(..., alias="vehicleVin"),
    current_user: User = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
) -> dict[str, bool | str]:
    vin = vehicle_vin.strip().upper()
    await get_vehicle_or_403(vin, current_user, db)
    configured = await _configured_vin(db)
    command_url = await _configured_command_url(db)
    return {"enabled": bool(configured and command_url and vin == configured), "vehicleVin": vin}


@router.post("/test-connection")
async def test_connection(
    payload: JsonObject,
    current_user: User = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
) -> JsonObject:
    vin, command_url, result = await _test_connection(payload, current_user, db)
    verified_at = dt.datetime.now(dt.UTC).isoformat()
    return {
        "connected": True,
        "vehicleVin": vin,
        "commandUrl": command_url,
        "verifiedAt": verified_at,
        **result,
    }


@router.post("/connection")
async def save_connection(
    payload: JsonObject,
    current_user: User = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
) -> JsonObject:
    """Re-test and persist one exact VIN + Command URL pair."""
    vin, command_url, result = await _test_connection(payload, current_user, db)
    verified_at = dt.datetime.now(dt.UTC).isoformat()
    await SettingsService.set(db, "vehicle_hub_vehicle_vin", vin, category="integration")
    await SettingsService.set(db, "vehicle_hub_command_url", command_url, category="integration")
    await SettingsService.set(
        db,
        "vehicle_hub_vin_verified_at",
        verified_at,
        category="integration",
    )
    await db.commit()
    return {
        "connected": True,
        "vehicleVin": vin,
        "commandUrl": command_url,
        "verifiedAt": verified_at,
        **result,
    }


@router.post("/reconcile")
async def reconcile(
    payload: JsonObject,
    current_user: User = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    await _scope(payload, current_user, db)
    payload["commandUrl"] = await _configured_command_url(db)
    payload["direction"] = "mygarage-to-command"
    return await _forward("/v1/reconcile", payload)


@router.post("/apply")
async def apply_review(
    payload: JsonObject,
    current_user: User = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    await _scope(payload, current_user, db)
    return await _forward("/v1/apply", payload)
