"use client";

import { useEffect } from "react";

import { useSseState } from "@/lib/sse";

/**
 * Toggles `document.body.market-closed` based on the most recent SSE tick's
 * `market_status`. The CSS in globals.css uses this class to *globally*
 * suppress price-flash animations when the market is closed.
 *
 * Renders nothing.
 */
export function MarketStatusBodyClass() {
  const sse = useSseState();

  useEffect(() => {
    if (typeof document === "undefined") return;
    const ticks = Object.values(sse.prices);
    const status = ticks.length === 0 ? null : ticks[0].market_status;
    if (status === "closed") {
      document.body.classList.add("market-closed");
    } else {
      document.body.classList.remove("market-closed");
    }
  }, [sse.prices]);

  return null;
}
