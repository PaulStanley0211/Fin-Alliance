import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ConnectionDot } from "@/components/layout/ConnectionDot";

describe("ConnectionDot — explicit status prop", () => {
  it("renders yellow with 'reconnecting' label", () => {
    render(<ConnectionDot status="yellow" />);
    const dot = screen.getByTestId("header-status-dot");
    expect(dot).toBeInTheDocument();
    expect(dot.dataset.status).toBe("yellow");
    expect(dot).toHaveTextContent(/reconnecting/i);
  });

  it("exposes each status via data-status", () => {
    const { rerender } = render(<ConnectionDot status="green" />);
    expect(screen.getByTestId("header-status-dot").dataset.status).toBe("green");
    rerender(<ConnectionDot status="red" />);
    expect(screen.getByTestId("header-status-dot").dataset.status).toBe("red");
  });
});
