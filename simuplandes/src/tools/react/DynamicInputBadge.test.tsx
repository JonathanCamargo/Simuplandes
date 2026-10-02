// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DynamicInputBadge } from "./DynamicInputBadge";

afterEach(cleanup);

describe("DynamicInputBadge", () => {
  it("renders nothing when dynamicInput is undefined", () => {
    const { container } = render(<DynamicInputBadge />);
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when both fields are empty", () => {
    const { container } = render(
      <DynamicInputBadge
        dynamicInput={{
          state: { field: "length", length: "", angle: "" },
          screenAt: { x: 0, y: 0 },
        }}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders the typed length in the length field", () => {
    const { getByTestId } = render(
      <DynamicInputBadge
        dynamicInput={{
          state: { field: "length", length: "120", angle: "" },
          screenAt: { x: 10, y: 20 },
        }}
      />,
    );
    expect(getByTestId("dynamic-input-length").textContent).toContain("120");
  });

  it("renders the typed angle in the angle field", () => {
    const { getByTestId } = render(
      <DynamicInputBadge
        dynamicInput={{
          state: { field: "angle", length: "120", angle: "30" },
          screenAt: { x: 10, y: 20 },
        }}
      />,
    );
    expect(getByTestId("dynamic-input-angle").textContent).toContain("30");
  });

  it("marks the active field with data-active, exclusively", () => {
    const { getByTestId } = render(
      <DynamicInputBadge
        dynamicInput={{
          state: { field: "angle", length: "120", angle: "30" },
          screenAt: { x: 10, y: 20 },
        }}
      />,
    );
    expect(getByTestId("dynamic-input-length").getAttribute("data-active")).toBe("false");
    expect(getByTestId("dynamic-input-angle").getAttribute("data-active")).toBe("true");
  });

  it("renders when only the length field has text (angle still shown, unmarked active)", () => {
    const { getByTestId } = render(
      <DynamicInputBadge
        dynamicInput={{
          state: { field: "length", length: "5", angle: "" },
          screenAt: { x: 100, y: 200 },
        }}
      />,
    );
    expect(getByTestId("dynamic-input-length").getAttribute("data-active")).toBe("true");
    expect(getByTestId("dynamic-input-angle").getAttribute("data-active")).toBe("false");
    expect(getByTestId("dynamic-input-badge")).toBeTruthy();
  });
});
