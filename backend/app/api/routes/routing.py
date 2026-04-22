from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
import httpx

router = APIRouter()

class RouteRequest(BaseModel):
    from_lat: float
    from_lon: float
    to_lat: float
    to_lon: float

@router.post("/route")
async def get_route(body: RouteRequest):
    coords = f"{body.from_lon},{body.from_lat};{body.to_lon},{body.to_lat}"
    url = (
        f"https://router.project-osrm.org/route/v1/driving/{coords}"
        f"?overview=full&geometries=geojson&steps=false"
    )
    async with httpx.AsyncClient(timeout=10) as client:
        try:
            res = await client.get(url)
            res.raise_for_status()
        except httpx.HTTPError as e:
            raise HTTPException(status_code=502, detail=f"OSRM error: {e}")
    
    data = res.json()
    if data.get("code") != "Ok":
        raise HTTPException(status_code=502, detail="OSRM returned non-Ok code")
    
    # Return just the coordinates array [[lng, lat], ...]
    coords_list = data["routes"][0]["geometry"]["coordinates"]
    return {"coordinates": coords_list}