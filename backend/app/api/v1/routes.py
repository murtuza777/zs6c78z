"""Version 1 HTTP routes. Handlers only parse input and delegate to the analytics service."""

from datetime import date
from typing import Annotated

from fastapi import APIRouter, Path, Query

from app.api.deps import Gate, Service
from app.domain.market import DECISION_END, DECISION_START
from app.schemas.accuracy import AccuracyResponse, HorizonResponse
from app.schemas.common import Problem
from app.schemas.decisions import DecisionResponse
from app.schemas.meta import HealthResponse, MetaResponse

router = APIRouter()
ERRORS = {422: {"model": Problem, "description": "Invalid or out-of-scope parameters"}}


@router.get("/health", response_model=HealthResponse, tags=["system"])
def health(service: Service) -> dict:
    return service.health()


@router.get(
    "/meta",
    response_model=MetaResponse,
    tags=["system"],
    summary="Scope, gate presets, publication schedule and data coverage",
)
def meta(service: Service) -> dict:
    return service.meta()


@router.get(
    "/decisions/{decision_date}",
    response_model=DecisionResponse,
    responses=ERRORS,
    tags=["decisions"],
    summary="Forecast available at gate closure for delivery day D+1",
)
def decision(
    service: Service,
    gate: Gate,
    decision_date: Annotated[date, Path(description="UK local decision date (2026-01-01..31)")],
) -> dict:
    return service.decision(decision_date, gate)


@router.get(
    "/accuracy",
    response_model=AccuracyResponse,
    responses=ERRORS,
    tags=["accuracy"],
    summary="Accuracy of cutoff-selected forecasts over a range of decision dates",
)
def accuracy(
    service: Service,
    gate: Gate,
    from_date: Annotated[
        date, Query(alias="from", description="First decision date")
    ] = DECISION_START,
    to_date: Annotated[date, Query(alias="to", description="Last decision date")] = DECISION_END,
) -> dict:
    return service.accuracy(from_date, to_date, gate)


@router.get(
    "/horizon",
    response_model=HorizonResponse,
    responses=ERRORS,
    tags=["horizon"],
    summary="Actual vs forecast where each forecast is at least horizon_h hours old",
)
def horizon(
    service: Service,
    from_date: Annotated[date, Query(alias="from", description="First delivery date")],
    to_date: Annotated[date, Query(alias="to", description="Last delivery date")],
    horizon_h: Annotated[float, Query(ge=0, le=48, description="Minimum lead time, hours")] = 24,
) -> dict:
    return service.horizon(from_date, to_date, horizon_h)
