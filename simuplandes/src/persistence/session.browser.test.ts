// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { getLocalStorage, startSession } from "./session";

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe("getLocalStorage", () => {
  it("returns window.localStorage when it works", () => {
    expect(getLocalStorage()).toBe(window.localStorage);
  });

  it("returns null when accessing localStorage throws (private mode / quota denied)", () => {
    vi.spyOn(window, "localStorage", "get").mockImplementation(() => {
      throw new DOMException("denied", "SecurityError");
    });
    expect(getLocalStorage()).toBeNull();
  });
});

describe("startSession default target", () => {
  it("defaults to the global window for the pagehide listener", () => {
    const addSpy = vi.spyOn(window, "addEventListener");
    const removeSpy = vi.spyOn(window, "removeEventListener");

    const session = startSession({ storage: null });
    expect(addSpy).toHaveBeenCalledWith("pagehide", expect.any(Function));

    session.dispose();
    expect(removeSpy).toHaveBeenCalledWith("pagehide", expect.any(Function));
  });
});
