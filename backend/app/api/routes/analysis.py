import uuid
from fastapi import APIRouter, Depends, BackgroundTasks, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.database import get_db
from app.core.redis import get_redis
from app.schemas.analysis import AnalysisRequest, AnalysisResult, AnalysisStatus
from app.fusion.pipeline import AnalysisPipeline
from app.models.analysis import AnalysisRun, AnalysisStatus as DBStatus

router = APIRouter(prefix="/analysis", tags=["analysis"])

# In-memory backup cache when Redis is unavailable
_results: dict[str, AnalysisResult] = {}
RESULT_TTL = 86_400
BBOX_RESULT_TTL = 3_600


def _cache_key(run_id: str) -> str:
    return f"analysis:{run_id}"


def _bbox_cache_key(request: AnalysisRequest) -> str:
    return (
        f"analysis:bbox:"
        f"{round(request.bbox.west, 2)}:"
        f"{round(request.bbox.south, 2)}:"
        f"{round(request.bbox.east, 2)}:"
        f"{round(request.bbox.north, 2)}:"
        f"{request.weather_days_back}"
    )


async def _get_cached_result(run_id: str) -> AnalysisResult | None:
    redis = await get_redis()
    if redis is None:
        return None
    try:
        cached = await redis.get(_cache_key(run_id))
        if cached:
            return AnalysisResult.model_validate_json(cached)
    except Exception:
        return None
    return None


async def _store_result(run_id: str, result: AnalysisResult) -> None:
    redis = await get_redis()
    if redis is not None:
        try:
            await redis.set(_cache_key(run_id), result.model_dump_json(), ex=RESULT_TTL)
            return
        except Exception:
            pass
    _results[run_id] = result


async def _store_bbox_result(bbox_key: str, result: AnalysisResult) -> None:
    redis = await get_redis()
    if redis is None:
        return
    try:
        await redis.set(bbox_key, result.model_dump_json(), ex=BBOX_RESULT_TTL)
    except Exception:
        pass


@router.post("/run", response_model=AnalysisStatus | AnalysisResult)
async def run_analysis(
    request: AnalysisRequest,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
):
    bbox_key = _bbox_cache_key(request)
    redis = await get_redis()
    if redis is not None:
        try:
            cached = await redis.get(bbox_key)
            if cached:
                return AnalysisResult.model_validate_json(cached)
        except Exception:
            pass

    run_id = uuid.uuid4()

    # Persist run record
    run = AnalysisRun(
        id=run_id,
        status=DBStatus.pending,
        simulation_engine=request.simulation_engine or "default",
        config_snapshot=request.model_dump(mode="json"),
    )
    db.add(run)
    await db.commit()

    background_tasks.add_task(_execute_pipeline, run_id, request, db, bbox_key)

    from datetime import datetime
    return AnalysisStatus(run_id=run_id, status="pending", created_at=datetime.utcnow())


@router.get("/{run_id}", response_model=AnalysisResult | AnalysisStatus)
async def get_analysis(run_id: uuid.UUID):
    key = str(run_id)
    cached = await _get_cached_result(key)
    if cached is not None:
        return cached

    if key in _results:
        return _results[key]

    from datetime import datetime
    return AnalysisStatus(run_id=run_id, status="running", created_at=datetime.utcnow())


async def _execute_pipeline(
    run_id: uuid.UUID,
    request: AnalysisRequest,
    db: AsyncSession,
    bbox_key: str,
):
    try:
        pipeline = AnalysisPipeline(engine_override=request.simulation_engine)
        result = await pipeline.run(request, run_id)
        await _store_result(str(run_id), result)
        await _store_bbox_result(bbox_key, result)
    except Exception as e:
        failed_result = AnalysisResult(
            run_id=run_id, status=f"failed: {e}", flood_layers=[], heat_layers=[]
        )
        await _store_result(str(run_id), failed_result)
