from __future__ import annotations

from fastapi import APIRouter, HTTPException

from app.elevation.service import ElevationService
from app.schemas.elevation import ProfileRequest, ProfileResponse


router = APIRouter(tags=["elevation"])
service = ElevationService()


@router.post("/profile", response_model=ProfileResponse)
async def build_profile(payload: ProfileRequest):
    try:
        return await service.get_profile(payload.line)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=str(exc)) from exc

