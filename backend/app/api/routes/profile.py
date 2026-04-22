from __future__ import annotations

from fastapi import APIRouter, HTTPException

from app.elevation.service import ElevationService, get_profile_options
from app.schemas.elevation import ProfileRequest, ProfileResponse


router = APIRouter(tags=["elevation"])
service = ElevationService()


@router.get("/profile/options")
async def profile_options():
    return get_profile_options()


@router.post("/profile", response_model=ProfileResponse)
async def build_profile(payload: ProfileRequest):
    try:
        return await service.get_profile(
            payload.line,
            provider=payload.provider,
            dataset=payload.dataset,
            use_fallback=payload.use_fallback,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=str(exc)) from exc
