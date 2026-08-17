"""Authenticated MyGarage proxy for Vehicle Hub review operations."""

from __future__ import annotations

from typing import Any

import httpx
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.models.user import User
from app.services.auth import get_vehicle_or_403, require_auth

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


async def _scope(payload: JsonObject, current_user: User, db: AsyncSession) -> str:
    vin = str(payload.get("vehicleVin") or "").strip().upper()
    configured = settings.vehicle_hub_vehicle_vin.strip().upper()
    if not configured or vin != configured:
        raise HTTPException(status_code=403, detail="Vehicle VIN is outside integration scope")
    await get_vehicle_or_403(vin, current_user, db)
    return vin


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
