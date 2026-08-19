"""Authenticated MyGarage proxy for Vehicle Hub review operations."""

from __future__ import annotations

import datetime as dt
from typing import Any

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


async def _scope(payload: JsonObject, current_user: User, db: AsyncSession) -> str:
    vin = str(payload.get("vehicleVin") or "").strip().upper()
    configured = await _configured_vin(db)
    if not configured or vin != configured:
        raise HTTPException(status_code=403, detail="Vehicle VIN is outside integration scope")
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
    return {"enabled": bool(configured and vin == configured), "vehicleVin": vin}


@router.post("/test-connection")
async def test_connection(
    payload: JsonObject,
    current_user: User = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
) -> JsonObject:
    vin = str(payload.get("vehicleVin") or "").strip().upper()
    await get_vehicle_or_403(vin, current_user, db)
    result = await _forward("/v1/test", {"vehicleVin": vin})
    verified_at = dt.datetime.now(dt.UTC).isoformat()
    await SettingsService.set(db, "vehicle_hub_vehicle_vin", vin, category="integration")
    await SettingsService.set(
        db,
        "vehicle_hub_vin_verified_at",
        verified_at,
        category="integration",
    )
    await db.commit()
    return {"connected": True, "vehicleVin": vin, "verifiedAt": verified_at, **result}


@router.post("/reconcile")
async def reconcile(
    payload: JsonObject,
    current_user: User = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    await _scope(payload, current_user, db)
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
