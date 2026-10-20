// @vitest-environment jsdom
import { render, screen, cleanup, act } from "@testing-library/react";
import { afterEach, describe, it, expect } from "vitest";
import { I18nextProvider } from "react-i18next";
import { MotionCard } from "./MotionCard";
import { createI18n } from "../../i18n/i18n";
import { createSimStore } from "../../sim/simStore";
import type { SimSessionSummary } from "../../sim/session";
import type { MeasurementTable, QuantityDef } from "../../sim/plots";

afterEach(cleanup);

const SUMMARY: SimSessionSummary = {
  status: "ready",
  reason: null,
  drivingMode: "motor",
  inputKind: "rotary",
  inputJointId: "j1",
  inputMotorId: "m1",
  inputLabel: "motor-0",
  ignoredMotorCount: 0,
  inputDisplayOffset: 0,
  gruebler: 1,
  rankDof: 1,
  violations: [],
  errorMessage: null,
} as unknown as SimSessionSummary;

function q(
  entityKind: "link" | "marker",
  entityId: string,
  token: QuantityDef["token"],
): QuantityDef {
  return {
    id: `${entityKind}:${entityId}:${token}`,
    entityKind,
    entityId,
    entityLabel: entityId,
    token,
    unit: "deg",
    linkIndex: 0,
  };
}

const TABLE: MeasurementTable = {
  xKind: "input",
  xUnit: "deg",
  x: Float64Array.from([0, 1, 2]),
  quantities: [
    q("link", "link-1", "angle"),
    q("link", "link-3", "angle"),
    q("marker", "marker-0", "x"),
    q("marker", "marker-0", "y"),
  ],
  columns: [
    Float64Array.from([0, 180, 360]),
    Float64Array.from([40, 80, 40]),
    Float64Array.from([0, 12, 3]),
    Float64Array.from([0, 5, 1]),
  ],
  length: 3,
};

function renderCard(store = createSimStore()) {
  render(
    <I18nextProvider i18n={createI18n("es")}>
      <MotionCard simStore={store} lengthUnit="mm" />
    </I18nextProvider>,
  );
  return store;
}

describe("MotionCard", () => {
  it("renders nothing outside a ready Simulate session", () => {
    renderCard();
    expect(screen.queryByTestId("motion-card")).toBeNull();
  });

  it("describes the input, each link's motion and each coupler curve", () => {
    const store = createSimStore();
    act(() => {
      store.getState().setSession(SUMMARY, { min: 0, max: 2 * Math.PI, fullRotation: true });
      store
        .getState()
        .setSweepData({ traces: [], sweepTable: TABLE, quantities: TABLE.quantities });
    });
    renderCard(store);

    const card = screen.getByTestId("motion-card");
    expect(card.textContent).toContain("Motor 1");
    expect(card.textContent).toContain("vuelta completa");
    expect(card.textContent).toContain("Eslabón 1");
    expect(card.textContent).toContain("gira completo");
    expect(card.textContent).toContain("Eslabón 3");
    expect(card.textContent).toContain("oscila 40,0°");
    expect(card.textContent).toContain("Marcador 1");
    expect(card.textContent).toContain("curva de 12,0 × 5,0 mm");
  });

  it("shows the input range of a bounded sweep", () => {
    const store = createSimStore();
    act(() => {
      store.getState().setSession(SUMMARY, { min: 0, max: Math.PI / 2, fullRotation: false });
      store
        .getState()
        .setSweepData({ traces: [], sweepTable: TABLE, quantities: TABLE.quantities });
    });
    renderCard(store);
    expect(screen.getByTestId("motion-card").textContent).toContain("de 0,0° a 90,0°");
  });
});
