"use client";

/**
 * Renders a price value and briefly applies a `flash-up` / `flash-down` CSS
 * class when it changes. The animation auto-removes via the keyframes (no
 * timeout needed); we just toggle the class via a key.
 *
 * `marketStatus === "closed"` suppresses the flash globally — see the
 * `body.market-closed` cascade in globals.css. This component still gates
 * via a local check so it works in tests without needing the body class.
 */

import { useEffect, useRef, useState } from "react";

import type { MarketStatus, Direction } from "@/lib/types";

interface PriceFlashProps {
  price: number | null;
  /** Optional explicit direction override; when omitted we infer from successive prices. */
  direction?: Direction;
  marketStatus?: MarketStatus;
  className?: string;
  /** How many decimals to render. Defaults to 2 (currency). */
  decimals?: number;
  /** Test ID suffix attached to the inner span. */
  "data-testid"?: string;
}

export function PriceFlash({
  price,
  direction,
  marketStatus = "open",
  className = "",
  decimals = 2,
  ...rest
}: PriceFlashProps) {
  const previous = useRef<number | null>(null);
  const [flashClass, setFlashClass] = useState<"" | "flash-up" | "flash-down">("");
  const [flashKey, setFlashKey] = useState(0);

  useEffect(() => {
    if (price === null) {
      previous.current = null;
      setFlashClass("");
      return;
    }
    if (previous.current === null) {
      previous.current = price;
      return;
    }
    if (marketStatus === "closed") {
      previous.current = price;
      return;
    }
    const inferred: Direction = price > previous.current ? "up" : price < previous.current ? "down" : "flat";
    const dir = direction ?? inferred;
    if (dir === "up") {
      setFlashClass("flash-up");
      setFlashKey((k) => k + 1);
    } else if (dir === "down") {
      setFlashClass("flash-down");
      setFlashKey((k) => k + 1);
    }
    previous.current = price;
  }, [price, direction, marketStatus]);

  const display = price === null ? "—" : price.toFixed(decimals);

  return (
    <span
      key={flashKey}
      className={`${flashClass} inline-block px-1 -mx-1 rounded-sharp ${className}`}
      data-testid={rest["data-testid"]}
      data-flash={flashClass || "none"}
    >
      {display}
    </span>
  );
}
