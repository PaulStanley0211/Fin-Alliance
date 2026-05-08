import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import {
  useSelectedTicker,
  getSelectedTicker,
  setSelectedTicker,
  __resetSelection,
} from "@/lib/selection";

describe("selection store", () => {
  beforeEach(() => {
    __resetSelection();
  });

  it("starts null", () => {
    expect(getSelectedTicker()).toBeNull();
  });

  it("propagates updates from setter to subscribers", () => {
    const { result } = renderHook(() => useSelectedTicker());
    expect(result.current[0]).toBeNull();

    act(() => result.current[1]("aapl"));
    expect(result.current[0]).toBe("AAPL"); // upper-cased

    act(() => result.current[1](null));
    expect(result.current[0]).toBeNull();
  });

  it("imperative setSelectedTicker triggers React subscribers", () => {
    const { result } = renderHook(() => useSelectedTicker());
    act(() => setSelectedTicker("MSFT"));
    expect(result.current[0]).toBe("MSFT");
  });
});
