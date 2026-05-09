"use client";

import { useEffect } from "react";

import { LoginForm } from "./LoginForm";
import { auth, useAuth } from "@/lib/auth";
import { registerUnauthorizedHandler } from "@/lib/api";

/**
 * AuthGate — top-level auth boundary.
 *
 * Behavior:
 * - On mount, calls `/api/auth/me` once. While in flight, renders a small
 *   centered placeholder so we don't flash the login screen for users with
 *   a valid cookie.
 * - If the session is valid, renders `children` (the workstation).
 * - If not, renders the login/signup form.
 * - Subscribes to a global "401" hook from the API client so a stale
 *   session detected mid-request kicks the user back to login automatically.
 *
 * The auth store is in `lib/auth.ts`; this component is purely presentation.
 */
export function AuthGate({ children }: { children: React.ReactNode }) {
  const { user, status } = useAuth();

  useEffect(() => {
    // Register the global 401 hook on the API client so any non-auth
    // endpoint that returns 401 resets the auth store.
    registerUnauthorizedHandler(auth.onUnauthorized);
    auth.refresh();
    return () => registerUnauthorizedHandler(null);
  }, []);

  if (status === "loading") {
    return (
      <div
        className="min-h-screen flex items-center justify-center bg-bg-0"
        data-testid="auth-loading"
      >
        <span className="font-mono text-xs text-ink-3 animate-pulse">
          Loading…
        </span>
      </div>
    );
  }

  if (user === null) {
    return <LoginForm />;
  }

  return <>{children}</>;
}
