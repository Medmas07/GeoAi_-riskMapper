from __future__ import annotations

import logging
from fastapi import APIRouter, HTTPException

from app.elevation.service import ElevationService, get_profile_options
from app.schemas.elevation import ProfileRequest, ProfileResponse


router = APIRouter(tags=["elevation"])
service = ElevationService()
logger = logging.getLogger("uvicorn.error")


@router.get("/profile/options")
async def profile_options():
    return get_profile_options()


@router.post("/profile", response_model=ProfileResponse)
async def build_profile(payload: ProfileRequest):
    try:
        result = await service.get_profile(
            payload.line,
            provider=payload.provider,
            dataset=payload.dataset,
            use_fallback=payload.use_fallback,
        )
        logger.info(
            "Profile built successfully: provider=%s dataset=%s total_distance=%.2fm points=%d",
            result.get("provider"),
            result.get("dataset") or "default",
            float(result.get("total_distance", 0.0)),
            len(result.get("points", [])),
        )
        return result
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=str(exc)) from exc
