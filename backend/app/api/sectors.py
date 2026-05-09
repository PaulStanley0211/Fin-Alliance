"""GET /api/sectors — exposes the frozen 6×10 sector taxonomy.

Frontend fetches this once at startup, caches it in memory, and only re-fetches
when `version` changes (spec §6). Sector ordering is preserved from
`app.market.sectors.SECTORS`.
"""

from __future__ import annotations

from fastapi import APIRouter

from app.api.schemas import SectorEntry, SectorsResponse
from app.market.sectors import SECTORS, SECTORS_VERSION

router = APIRouter(prefix="/api/sectors", tags=["sectors"])


@router.get("", response_model=SectorsResponse)
def get_sectors() -> SectorsResponse:
    return SectorsResponse(
        version=SECTORS_VERSION,
        sectors=[
            SectorEntry(id=s.id, label=s.label, tickers=list(s.tickers))
            for s in SECTORS
        ],
    )
