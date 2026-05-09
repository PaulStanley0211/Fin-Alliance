/**
 * Auth store + React bindings + API helpers.
 *
 * Holds three values: the current `AuthUser` (or null), a transient
 * `status` (`"loading" | "ready"`) used to keep the AuthGate from
 * flashing the login screen on page load, and an optional `error`
 * string from the most recent login/signup attempt.
 *
 * Tiny pub/sub — same shape as `lib/sse.ts` and friends. Components
 * subscribe via `useAuth()` (a `useSyncExternalStore` hook).
 *
 * The store also owns the API helpers (`auth.signup`, `auth.login`,
 * `auth.logout`, `auth.me`, `auth.refresh`). They mutate the store on
 * success / failure so the consuming UI re-renders without manual
 * threading.
 */

"use client";

import { useSyncExternalStore } from "react";

import { ApiError, api } from "./api";

export interface AuthUser {
  id: string;
  username: string;
}

export type AuthStatus = "loading" | "ready";

export interface AuthState {
  user: AuthUser | null;
  status: AuthStatus;
  error: string | null;
}

type Listener = () => void;

let state: AuthState = { user: null, status: "loading", error: null };
const listeners = new Set<Listener>();

function setState(patch: Partial<AuthState>): void {
  state = { ...state, ...patch };
  for (const fn of listeners) fn();
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): AuthState {
  return state;
}

function getServerSnapshot(): AuthState {
  return { user: null, status: "loading", error: null };
}

/** React hook — re-renders on any auth state change. */
export function useAuth(): AuthState {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/**
 * Resolve the current session from the server.
 *
 * Resolves the store to `{ user, status: "ready" }` on 200 and
 * `{ user: null, status: "ready" }` on 401. Other errors leave the
 * store with `user: null` but record the error string so the login
 * screen can show "couldn't reach the server".
 */
async function refresh(): Promise<AuthUser | null> {
  try {
    const me = await api.authMe();
    setState({ user: me, status: "ready", error: null });
    return me;
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) {
      setState({ user: null, status: "ready", error: null });
      return null;
    }
    const msg = e instanceof Error ? e.message : "Network error";
    setState({ user: null, status: "ready", error: msg });
    return null;
  }
}

async function signup(username: string, password: string): Promise<AuthUser> {
  setState({ error: null });
  try {
    const user = await api.authSignup({ username, password });
    setState({ user, status: "ready", error: null });
    return user;
  } catch (e) {
    const msg = e instanceof ApiError ? e.message : (e as Error).message;
    setState({ error: msg });
    throw e;
  }
}

async function login(username: string, password: string): Promise<AuthUser> {
  setState({ error: null });
  try {
    const user = await api.authLogin({ username, password });
    setState({ user, status: "ready", error: null });
    return user;
  } catch (e) {
    const msg = e instanceof ApiError ? e.message : (e as Error).message;
    setState({ error: msg });
    throw e;
  }
}

async function logout(): Promise<void> {
  try {
    await api.authLogout();
  } catch {
    // Logout is best-effort — even if the server rejects, drop the
    // client-side identity so the UI returns to the login screen.
  }
  setState({ user: null, status: "ready", error: null });
}

/**
 * Notify the store that the server returned 401 on a non-auth request.
 * Called by ``request()`` in lib/api.ts as a global hook.
 */
function onUnauthorized(): void {
  if (state.user !== null) {
    setState({ user: null, error: null });
  }
}

function clearError(): void {
  setState({ error: null });
}

export const auth = {
  refresh,
  signup,
  login,
  logout,
  onUnauthorized,
  clearError,
};

// Internal hooks for tests.
export const __internals = {
  reset(): void {
    state = { user: null, status: "loading", error: null };
    for (const fn of listeners) fn();
  },
};
