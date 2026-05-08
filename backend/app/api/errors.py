"""HTTP error helpers — single error envelope across all endpoints.

The envelope shape (`{"error": "<code>", "message": "<human>"}`) is the
contract the frontend, the LLM chat layer, and tests all rely on.
Validation errors from FastAPI are also rewrapped into this shape so the
frontend never has to handle two error formats.
"""

from __future__ import annotations

from fastapi import FastAPI, HTTPException, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

ErrorCode = str


class APIError(HTTPException):
    """HTTPException subclass that carries our error envelope.

    `code` is a stable machine-readable identifier; `message` is human text.
    Use one of the exported helpers below — they pin sensible status codes
    and codes used elsewhere in the codebase.
    """

    def __init__(self, status_code: int, code: ErrorCode, message: str) -> None:
        super().__init__(status_code=status_code, detail={"error": code, "message": message})
        self.code = code
        self.message = message


def ticker_unsupported(message: str = "Ticker is not supported.") -> APIError:
    return APIError(status.HTTP_400_BAD_REQUEST, "ticker_unsupported", message)


def watchlist_full(limit: int) -> APIError:
    return APIError(
        status.HTTP_400_BAD_REQUEST,
        "watchlist_full",
        f"Watchlist already contains {limit} tickers.",
    )


def insufficient_cash(message: str = "Insufficient cash for this trade.") -> APIError:
    return APIError(status.HTTP_400_BAD_REQUEST, "insufficient_cash", message)


def insufficient_shares(message: str = "Not enough shares to sell.") -> APIError:
    return APIError(status.HTTP_400_BAD_REQUEST, "insufficient_shares", message)


def duplicate_request(message: str = "Duplicate request_id.") -> APIError:
    return APIError(status.HTTP_409_CONFLICT, "duplicate_request", message)


def invalid_request(message: str) -> APIError:
    return APIError(status.HTTP_400_BAD_REQUEST, "invalid_request", message)


def price_unavailable(message: str = "No live price available for ticker.") -> APIError:
    return APIError(status.HTTP_503_SERVICE_UNAVAILABLE, "price_unavailable", message)


def register_exception_handlers(app: FastAPI) -> None:
    """Install handlers that wrap all error responses in our envelope."""

    @app.exception_handler(APIError)
    async def _api_error(request: Request, exc: APIError):  # noqa: ARG001
        return JSONResponse(status_code=exc.status_code, content=exc.detail)

    @app.exception_handler(RequestValidationError)
    async def _validation_error(request: Request, exc: RequestValidationError):  # noqa: ARG001
        # Pull the first error message so the human text is meaningful.
        first_error = exc.errors()[0] if exc.errors() else {"msg": "invalid request"}
        msg = first_error.get("msg", "invalid request")
        loc = ".".join(str(p) for p in first_error.get("loc", []) if p != "body")
        if loc:
            msg = f"{loc}: {msg}"
        return JSONResponse(
            status_code=status.HTTP_400_BAD_REQUEST,
            content={"error": "invalid_request", "message": msg},
        )

    @app.exception_handler(HTTPException)
    async def _http_error(request: Request, exc: HTTPException):  # noqa: ARG001
        # Pass-through for our APIError subclasses; rewrap stock HTTPException.
        if isinstance(exc.detail, dict) and "error" in exc.detail:
            return JSONResponse(status_code=exc.status_code, content=exc.detail)
        return JSONResponse(
            status_code=exc.status_code,
            content={"error": "http_error", "message": str(exc.detail)},
        )
