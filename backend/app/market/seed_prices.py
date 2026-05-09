"""Seed prices and per-ticker parameters for the market simulator.

Covers all 50 tickers in the sector taxonomy (`sectors.py`) so the simulator
can boot the full dashboard with realistic starting prices. Adding a ticker
to a sector requires also adding entries here.
"""

# Realistic starting prices (rough mid-2024 / early-2026 levels — the values
# don't need to match a specific date, only "look like" plausible large-cap
# US prices). Values are intentionally a bit rounded.
SEED_PRICES: dict[str, float] = {
    # --- Technology ---
    "AAPL": 230.00,
    "MSFT": 415.00,
    "GOOGL": 175.00,
    "AMZN": 185.00,
    "META": 540.00,
    "NVDA": 130.00,
    "AVGO": 175.00,
    "ORCL": 165.00,
    "CRM": 280.00,
    "ADBE": 540.00,
    # --- Healthcare ---
    "UNH": 580.00,
    "JNJ": 160.00,
    "LLY": 920.00,
    "PFE": 28.00,
    "ABBV": 195.00,
    "MRK": 105.00,
    "TMO": 590.00,
    "ABT": 115.00,
    "DHR": 255.00,
    "BMY": 50.00,
    # --- Financial ---
    "JPM": 220.00,
    "BAC": 42.00,
    "WFC": 60.00,
    "GS": 510.00,
    "MS": 105.00,
    "C": 65.00,
    "BLK": 870.00,
    "AXP": 270.00,
    "V": 280.00,
    "MA": 480.00,
    # --- Consumer ---
    "WMT": 80.00,
    "COST": 880.00,
    "HD": 380.00,
    "MCD": 290.00,
    "NKE": 78.00,
    "SBUX": 95.00,
    "TGT": 140.00,
    "LOW": 250.00,
    "DIS": 95.00,
    "PG": 170.00,
    # --- Energy ---
    "XOM": 115.00,
    "CVX": 155.00,
    "COP": 110.00,
    "SLB": 47.00,
    "EOG": 125.00,
    "PSX": 135.00,
    "MPC": 165.00,
    "OXY": 55.00,
    "VLO": 145.00,
    "WMB": 45.00,
    # --- Legacy seeds kept for backwards compatibility with existing tests
    # and the simulator demo. Not in the sector taxonomy. ---
    "TSLA": 250.00,
    "NFLX": 600.00,
}

# Per-ticker GBM parameters
# sigma: annualized volatility (higher = more price movement)
# mu: annualized drift / expected return
TICKER_PARAMS: dict[str, dict[str, float]] = {
    # --- Technology ---
    "AAPL": {"sigma": 0.22, "mu": 0.05},
    "MSFT": {"sigma": 0.20, "mu": 0.05},
    "GOOGL": {"sigma": 0.25, "mu": 0.05},
    "AMZN": {"sigma": 0.28, "mu": 0.05},
    "META": {"sigma": 0.30, "mu": 0.05},
    "NVDA": {"sigma": 0.40, "mu": 0.08},  # High vol, strong drift
    "AVGO": {"sigma": 0.32, "mu": 0.07},
    "ORCL": {"sigma": 0.22, "mu": 0.05},
    "CRM": {"sigma": 0.30, "mu": 0.05},
    "ADBE": {"sigma": 0.28, "mu": 0.05},
    # --- Healthcare (lower vol than tech) ---
    "UNH": {"sigma": 0.20, "mu": 0.05},
    "JNJ": {"sigma": 0.15, "mu": 0.03},
    "LLY": {"sigma": 0.28, "mu": 0.10},  # Pharma growth story
    "PFE": {"sigma": 0.20, "mu": 0.02},
    "ABBV": {"sigma": 0.18, "mu": 0.04},
    "MRK": {"sigma": 0.18, "mu": 0.04},
    "TMO": {"sigma": 0.22, "mu": 0.05},
    "ABT": {"sigma": 0.18, "mu": 0.04},
    "DHR": {"sigma": 0.22, "mu": 0.05},
    "BMY": {"sigma": 0.20, "mu": 0.02},
    # --- Financial ---
    "JPM": {"sigma": 0.18, "mu": 0.04},
    "BAC": {"sigma": 0.22, "mu": 0.04},
    "WFC": {"sigma": 0.22, "mu": 0.04},
    "GS": {"sigma": 0.22, "mu": 0.05},
    "MS": {"sigma": 0.22, "mu": 0.04},
    "C": {"sigma": 0.24, "mu": 0.03},
    "BLK": {"sigma": 0.20, "mu": 0.05},
    "AXP": {"sigma": 0.20, "mu": 0.05},
    "V": {"sigma": 0.17, "mu": 0.04},
    "MA": {"sigma": 0.18, "mu": 0.05},
    # --- Consumer ---
    "WMT": {"sigma": 0.16, "mu": 0.05},
    "COST": {"sigma": 0.18, "mu": 0.07},
    "HD": {"sigma": 0.20, "mu": 0.05},
    "MCD": {"sigma": 0.16, "mu": 0.04},
    "NKE": {"sigma": 0.24, "mu": 0.04},
    "SBUX": {"sigma": 0.22, "mu": 0.04},
    "TGT": {"sigma": 0.24, "mu": 0.04},
    "LOW": {"sigma": 0.22, "mu": 0.05},
    "DIS": {"sigma": 0.24, "mu": 0.03},
    "PG": {"sigma": 0.14, "mu": 0.04},
    # --- Energy (highest vol — oil price exposure) ---
    "XOM": {"sigma": 0.26, "mu": 0.04},
    "CVX": {"sigma": 0.24, "mu": 0.04},
    "COP": {"sigma": 0.30, "mu": 0.04},
    "SLB": {"sigma": 0.32, "mu": 0.03},
    "EOG": {"sigma": 0.30, "mu": 0.04},
    "PSX": {"sigma": 0.30, "mu": 0.04},
    "MPC": {"sigma": 0.30, "mu": 0.04},
    "OXY": {"sigma": 0.34, "mu": 0.04},
    "VLO": {"sigma": 0.30, "mu": 0.04},
    "WMB": {"sigma": 0.22, "mu": 0.04},
    # --- Legacy ---
    "TSLA": {"sigma": 0.50, "mu": 0.03},
    "NFLX": {"sigma": 0.35, "mu": 0.05},
}

# Default parameters for tickers not in the list above (dynamically added).
DEFAULT_PARAMS: dict[str, float] = {"sigma": 0.25, "mu": 0.05}

# Correlation groups for the simulator's Cholesky decomposition.
#
# Sector membership drives intra-sector correlation. The legacy "tech" /
# "finance" group keys are preserved for backwards-compatibility with the
# existing simulator tests; they are populated as supersets of the new
# sector lists.
CORRELATION_GROUPS: dict[str, set[str]] = {
    # Legacy / cross-cutting groups.
    "tech": {
        "AAPL", "GOOGL", "MSFT", "AMZN", "META", "NVDA", "NFLX",
        "AVGO", "ORCL", "CRM", "ADBE",
    },
    "finance": {
        "JPM", "V", "BAC", "WFC", "GS", "MS", "C", "BLK", "AXP", "MA",
    },
    # New sector-aligned groups. Used by `_pairwise_correlation` for any
    # ticker that isn't already covered by the legacy groups above.
    "healthcare": {
        "UNH", "JNJ", "LLY", "PFE", "ABBV", "MRK", "TMO", "ABT", "DHR", "BMY",
    },
    "consumer": {
        "WMT", "COST", "HD", "MCD", "NKE", "SBUX", "TGT", "LOW", "DIS", "PG",
    },
    "energy": {
        "XOM", "CVX", "COP", "SLB", "EOG", "PSX", "MPC", "OXY", "VLO", "WMB",
    },
}

# Correlation coefficients
INTRA_TECH_CORR = 0.6  # Tech stocks move together
INTRA_FINANCE_CORR = 0.5  # Finance stocks move together
INTRA_HEALTHCARE_CORR = 0.45
INTRA_CONSUMER_CORR = 0.4
INTRA_ENERGY_CORR = 0.6  # Oil-driven, high co-movement
CROSS_GROUP_CORR = 0.3  # Between sectors / unknown tickers
TSLA_CORR = 0.3  # TSLA does its own thing
