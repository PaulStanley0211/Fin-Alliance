import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, waitFor, fireEvent, act } from "@testing-library/react";

import { AuthGate } from "@/components/auth/AuthGate";
import { __internals as authInternals } from "@/lib/auth";

const realFetch = globalThis.fetch;

beforeEach(() => {
  authInternals.reset();
});

afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

interface Capture {
  url: string;
  method?: string;
  body: unknown;
}

function mockFetch(handler: (call: Capture) => Promise<Response> | Response): Capture[] {
  const calls: Capture[] = [];
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    let body: unknown = undefined;
    if (typeof init?.body === "string") {
      try {
        body = JSON.parse(init.body);
      } catch {
        body = init.body;
      }
    }
    const call: Capture = { url, method: init?.method, body };
    calls.push(call);
    return await handler(call);
  }) as unknown as typeof fetch;
  return calls;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("AuthGate", () => {
  it("renders the loading placeholder while /api/auth/me is in flight", async () => {
    let resolveMe: ((res: Response) => void) | null = null;
    mockFetch(({ url }) => {
      if (url === "/api/auth/me") {
        return new Promise<Response>((resolve) => {
          resolveMe = resolve;
        });
      }
      return jsonResponse({ error: "not_found", message: "x" }, 404);
    });

    render(
      <AuthGate>
        <div data-testid="protected">workstation</div>
      </AuthGate>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("auth-loading")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("login-form")).toBeNull();
    expect(screen.queryByTestId("protected")).toBeNull();

    // Resolve so the test can finish cleanly.
    resolveMe!(jsonResponse({ error: "not_authenticated", message: "x" }, 401));
    await waitFor(() => expect(screen.queryByTestId("auth-loading")).toBeNull());
  });

  it("renders the login form when /api/auth/me returns 401", async () => {
    mockFetch(({ url }) => {
      if (url === "/api/auth/me") {
        return jsonResponse({ error: "not_authenticated", message: "x" }, 401);
      }
      return jsonResponse({ error: "not_found", message: "x" }, 404);
    });

    render(
      <AuthGate>
        <div data-testid="protected">workstation</div>
      </AuthGate>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("login-form")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("protected")).toBeNull();
  });

  it("renders children when /api/auth/me returns a valid user", async () => {
    mockFetch(({ url }) => {
      if (url === "/api/auth/me") {
        return jsonResponse({ id: "u-1", username: "alice" });
      }
      return jsonResponse({ error: "not_found", message: "x" }, 404);
    });

    render(
      <AuthGate>
        <div data-testid="protected">workstation</div>
      </AuthGate>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("protected")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("login-form")).toBeNull();
  });
});

describe("LoginForm (via AuthGate)", () => {
  function renderLoggedOut(
    handler: (call: Capture) => Promise<Response> | Response,
  ): { calls: Capture[] } {
    const calls = mockFetch((call) => {
      if (call.url === "/api/auth/me") {
        return jsonResponse({ error: "not_authenticated", message: "x" }, 401);
      }
      return handler(call);
    });
    render(
      <AuthGate>
        <div data-testid="protected">workstation</div>
      </AuthGate>,
    );
    return { calls };
  }

  it("submits login on button click and swaps to children on success", async () => {
    const { calls } = renderLoggedOut(({ url }) => {
      if (url === "/api/auth/login") {
        return jsonResponse({ id: "u-1", username: "alice" });
      }
      return jsonResponse({ error: "not_found", message: "x" }, 404);
    });

    await waitFor(() =>
      expect(screen.getByTestId("login-form")).toBeInTheDocument(),
    );

    fireEvent.change(screen.getByTestId("auth-username"), {
      target: { value: "alice" },
    });
    fireEvent.change(screen.getByTestId("auth-password"), {
      target: { value: "supersecret" },
    });
    fireEvent.click(screen.getByTestId("auth-submit"));

    await waitFor(() => {
      expect(screen.getByTestId("protected")).toBeInTheDocument();
    });

    const loginCall = calls.find((c) => c.url === "/api/auth/login");
    expect(loginCall).toBeDefined();
    expect(loginCall?.body).toEqual({ username: "alice", password: "supersecret" });
  });

  it("shows the friendly invalid_credentials message on 401", async () => {
    renderLoggedOut(({ url }) => {
      if (url === "/api/auth/login") {
        return jsonResponse(
          { error: "invalid_credentials", message: "Invalid username or password." },
          401,
        );
      }
      return jsonResponse({ error: "not_found", message: "x" }, 404);
    });

    await waitFor(() =>
      expect(screen.getByTestId("login-form")).toBeInTheDocument(),
    );

    fireEvent.change(screen.getByTestId("auth-username"), {
      target: { value: "alice" },
    });
    fireEvent.change(screen.getByTestId("auth-password"), {
      target: { value: "wrong" },
    });
    fireEvent.click(screen.getByTestId("auth-submit"));

    await waitFor(() => {
      expect(screen.getByTestId("auth-error")).toHaveTextContent(
        /wrong username or password/i,
      );
    });
    // Still on the login form, not the workstation.
    expect(screen.queryByTestId("protected")).toBeNull();
  });

  it("toggle-mode switches to signup and submits POST /api/auth/signup", async () => {
    const { calls } = renderLoggedOut(({ url }) => {
      if (url === "/api/auth/signup") {
        return jsonResponse({ id: "u-2", username: "bob" }, 201);
      }
      return jsonResponse({ error: "not_found", message: "x" }, 404);
    });

    await waitFor(() =>
      expect(screen.getByTestId("login-form")).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByTestId("auth-toggle-mode"));
    // Heading flipped to "Create your account".
    expect(screen.getByRole("heading")).toHaveTextContent(/create/i);

    fireEvent.change(screen.getByTestId("auth-username"), {
      target: { value: "bob" },
    });
    fireEvent.change(screen.getByTestId("auth-password"), {
      target: { value: "supersecret" },
    });
    fireEvent.click(screen.getByTestId("auth-submit"));

    await waitFor(() => {
      expect(screen.getByTestId("protected")).toBeInTheDocument();
    });
    const signupCall = calls.find((c) => c.url === "/api/auth/signup");
    expect(signupCall).toBeDefined();
    expect(signupCall?.method).toBe("POST");
  });

  it("surfaces username_taken with a friendly label on 409", async () => {
    renderLoggedOut(({ url }) => {
      if (url === "/api/auth/signup") {
        return jsonResponse(
          { error: "username_taken", message: "That username is already taken." },
          409,
        );
      }
      return jsonResponse({ error: "not_found", message: "x" }, 404);
    });

    await waitFor(() =>
      expect(screen.getByTestId("login-form")).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByTestId("auth-toggle-mode"));
    fireEvent.change(screen.getByTestId("auth-username"), {
      target: { value: "taken" },
    });
    fireEvent.change(screen.getByTestId("auth-password"), {
      target: { value: "supersecret" },
    });
    fireEvent.click(screen.getByTestId("auth-submit"));

    await waitFor(() => {
      expect(screen.getByTestId("auth-error")).toHaveTextContent(
        /already taken/i,
      );
    });
  });
});
