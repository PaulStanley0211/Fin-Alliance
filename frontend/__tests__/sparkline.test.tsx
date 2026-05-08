import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { Sparkline } from "@/components/charts/Sparkline";

describe("Sparkline", () => {
  it("renders a dashed hairline when fewer than minPoints values", () => {
    const { container } = render(<Sparkline values={[100]} />);
    const line = container.querySelector("line");
    expect(line).not.toBeNull();
    expect(line?.getAttribute("stroke-dasharray")).toBe("2 3");
  });

  it("renders a polyline with one comma-separated point per value", () => {
    const { container } = render(<Sparkline values={[100, 102, 101, 105]} />);
    const polyline = container.querySelector("polyline");
    expect(polyline).not.toBeNull();
    const points = polyline?.getAttribute("points") ?? "";
    expect(points.split(/\s+/).filter(Boolean)).toHaveLength(4);
  });

  it("infers up-trend stroke when the last value exceeds the first", () => {
    const { container } = render(<Sparkline values={[100, 105]} />);
    const polyline = container.querySelector("polyline");
    expect(polyline?.getAttribute("stroke")).toBe("var(--up)");
  });

  it("infers down-trend stroke when the last value is below the first", () => {
    const { container } = render(<Sparkline values={[105, 100]} />);
    const polyline = container.querySelector("polyline");
    expect(polyline?.getAttribute("stroke")).toBe("var(--down)");
  });
});
