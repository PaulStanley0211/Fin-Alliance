import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PriceFlash } from "@/components/common/PriceFlash";

describe("PriceFlash", () => {
  it("renders a number with default 2 decimals and no flash on first paint", () => {
    render(<PriceFlash price={123.456} data-testid="px" />);
    const el = screen.getByTestId("px");
    expect(el).toHaveTextContent("123.46");
    expect(el.dataset.flash).toBe("none");
  });

  it("renders an em-dash when price is null", () => {
    render(<PriceFlash price={null} data-testid="px" />);
    expect(screen.getByTestId("px")).toHaveTextContent("—");
  });

  it("applies flash-up when price ticks up", () => {
    const { rerender } = render(<PriceFlash price={100} data-testid="px" />);
    rerender(<PriceFlash price={101} data-testid="px" />);
    expect(screen.getByTestId("px").dataset.flash).toBe("flash-up");
  });

  it("applies flash-down when price ticks down", () => {
    const { rerender } = render(<PriceFlash price={100} data-testid="px" />);
    rerender(<PriceFlash price={99} data-testid="px" />);
    expect(screen.getByTestId("px").dataset.flash).toBe("flash-down");
  });

  it("suppresses the flash when marketStatus === 'closed'", () => {
    const { rerender } = render(
      <PriceFlash price={100} marketStatus="closed" data-testid="px" />,
    );
    rerender(<PriceFlash price={102} marketStatus="closed" data-testid="px" />);
    expect(screen.getByTestId("px").dataset.flash).toBe("none");
  });

  it("respects an explicit direction prop over inferred", () => {
    const { rerender } = render(
      <PriceFlash price={100} direction="down" data-testid="px" />,
    );
    rerender(<PriceFlash price={101} direction="down" data-testid="px" />);
    expect(screen.getByTestId("px").dataset.flash).toBe("flash-down");
  });
});
