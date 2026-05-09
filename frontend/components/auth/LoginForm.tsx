"use client";

import { useState, type FormEvent } from "react";

import { ApiError } from "@/lib/api";
import { auth } from "@/lib/auth";

type Mode = "login" | "signup";

const ERROR_LABELS: Record<string, string> = {
  invalid_credentials: "Wrong username or password.",
  username_taken: "That username is already taken.",
  invalid_request: "Username must be 3–32 chars (letters, digits, underscore). Password must be at least 8 chars.",
  not_authenticated: "Sign in to continue.",
};

/**
 * Login + signup, single screen with a mode toggle.
 *
 * - Username 3–32 chars, alnum + underscore (matches the backend regex).
 * - Password 8+ chars on signup; the login flow only checks non-empty
 *   client-side and lets the server reject with `invalid_credentials`.
 * - Submits via `auth.signup` or `auth.login`. Both functions update the
 *   auth store on success, which causes the AuthGate to swap to the
 *   workstation immediately.
 */
export function LoginForm() {
  const [mode, setMode] = useState<Mode>("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    setPending(true);
    setErrorMsg(null);
    try {
      if (mode === "signup") {
        await auth.signup(username.trim(), password);
      } else {
        await auth.login(username.trim(), password);
      }
      // AuthGate re-renders to children automatically via the store update.
    } catch (e) {
      const code = e instanceof ApiError ? e.code : "";
      const fallback =
        e instanceof Error ? e.message : "Something went wrong.";
      setErrorMsg(ERROR_LABELS[code] ?? fallback);
    } finally {
      setPending(false);
    }
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center bg-bg-0 p-6"
      data-testid="login-form"
    >
      <form
        onSubmit={submit}
        className="panel w-full max-w-sm flex flex-col gap-4 p-6"
        aria-labelledby="auth-heading"
      >
        <header className="flex flex-col gap-1">
          <span className="eyebrow text-secondary-glow">FinAlly</span>
          <h1
            id="auth-heading"
            className="font-display text-xl text-ink-0 leading-snug"
          >
            {mode === "login" ? "Sign in" : "Create your account"}
          </h1>
          <p className="font-mono text-xs text-ink-2">
            {mode === "login"
              ? "Trade live market data with $10,000 of simulated cash."
              : "You'll start with $10,000 of simulated cash on a fresh portfolio."}
          </p>
        </header>

        <label className="flex flex-col gap-1">
          <span className="font-mono text-2xs uppercase tracking-eyebrow text-ink-2">
            Username
          </span>
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="input"
            placeholder="3–32 chars · letters, digits, _"
            autoComplete="username"
            required
            minLength={3}
            maxLength={32}
            data-testid="auth-username"
            disabled={pending}
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="font-mono text-2xs uppercase tracking-eyebrow text-ink-2">
            Password
          </span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="input"
            placeholder={mode === "signup" ? "At least 8 characters" : "Your password"}
            autoComplete={mode === "signup" ? "new-password" : "current-password"}
            required
            minLength={mode === "signup" ? 8 : 1}
            maxLength={200}
            data-testid="auth-password"
            disabled={pending}
          />
        </label>

        {errorMsg ? (
          <p
            className="font-mono text-2xs text-down border border-down/40 bg-down/10 rounded-sharp px-2 py-1"
            role="alert"
            data-testid="auth-error"
          >
            {errorMsg}
          </p>
        ) : null}

        <button
          type="submit"
          className="btn-submit"
          data-testid="auth-submit"
          disabled={pending}
          aria-busy={pending}
        >
          {pending
            ? "…"
            : mode === "login"
              ? "Sign in"
              : "Create account"}
        </button>

        <button
          type="button"
          onClick={() => {
            setMode((m) => (m === "login" ? "signup" : "login"));
            setErrorMsg(null);
          }}
          className="font-mono text-2xs text-ink-2 hover:text-ink-0 underline-offset-2 hover:underline"
          data-testid="auth-toggle-mode"
          disabled={pending}
        >
          {mode === "login"
            ? "No account yet? Create one"
            : "Already have an account? Sign in"}
        </button>
      </form>
    </div>
  );
}
