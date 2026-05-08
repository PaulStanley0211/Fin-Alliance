"use client";

import { useEffect } from "react";

import { getStore } from "@/lib/sse";

/**
 * Mounts once at the top of the client tree to open the EventSource and
 * keep it alive for the life of the page. Renders nothing.
 */
export function SseBootstrap() {
  useEffect(() => {
    const store = getStore();
    store.start();
    return () => {
      // We deliberately *don't* stop on unmount in production — the connection
      // should live as long as the tab. But hot-reload remounts this in dev
      // and start() is idempotent, so this is safe either way.
    };
  }, []);

  return null;
}
