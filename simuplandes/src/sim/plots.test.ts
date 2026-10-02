import { describe, it, expect } from "vitest";
import {
  compileSystem,
  linkPose,
  pointKinematics,
  referenceState,
  advanceDrive,
  solveVelocityAcceleration,
  type KinematicSystem,
} from "../kinematics";
import { freudensteinTheta4, freudensteinBranchOf } from "../kinematics/__fixtures__/analytic";
import * as fourBarFixture from "../kinematics/__fixtures__/fourBar";
import {
  listQuantities,
  measureAll,
  buildSweepTable,
  unwrapDegrees,
  defaultQuantityIds,
  TimeHistory,
  type QuantityDef,
  type MeasuredSampleInput,
} from "./plots";

const RAD_TO_DEG = 180 / Math.PI;

function buildFourBarSystem(): KinematicSystem {
  return compileSystem(fourBarFixture.build());
}

describe("listQuantities", () => {
  it("returns 3 link quantities per moving link, then 6 per marker, in document order", () => {
    const system = buildFourBarSystem();
    const quantities = listQuantities(system);

    expect(quantities).toHaveLength(15);

    const linkNames = ["crank", "coupler", "rocker"];
    for (let li = 0; li < linkNames.length; li++) {
      const base = li * 3;
      expect(quantities[base].entityKind).toBe("link");
      expect(quantities[base].entityLabel).toBe(linkNames[li]);
      expect(quantities[base].token).toBe("angle");
      expect(quantities[base].unit).toBe("deg");
      expect(quantities[base].id).toBe(`link:${quantities[base].entityId}:angle`);
      expect(quantities[base + 1].token).toBe("omega");
      expect(quantities[base + 1].unit).toBe("deg/s");
      expect(quantities[base + 2].token).toBe("alpha");
      expect(quantities[base + 2].unit).toBe("deg/s^2");
    }

    const markerTokens = ["x", "y", "vx", "vy", "ax", "ay"];
    const markerUnits = ["len", "len", "len/s", "len/s", "len/s^2", "len/s^2"];
    for (let k = 0; k < markerTokens.length; k++) {
      const q = quantities[9 + k];
      expect(q.entityKind).toBe("marker");
      expect(q.entityLabel).toBe("coupler-tracer");
      expect(q.token).toBe(markerTokens[k]);
      expect(q.unit).toBe(markerUnits[k]);
      expect(q.id).toBe(`marker:${q.entityId}:${markerTokens[k]}`);
    }
  });

  it("falls back entityLabel to the id when the name is empty", () => {
    const doc = fourBarFixture.build();
    const unnamedDoc = {
      ...doc,
      links: doc.links.map((l) => (l.isGround ? l : { ...l, name: "" })),
    };
    const system = compileSystem(unnamedDoc);
    const quantities = listQuantities(system);
    const crankAngle = quantities.find((q) => q.token === "angle");
    expect(crankAngle?.entityLabel).toBe(crankAngle?.entityId);
  });
});

describe("measureAll", () => {
  it("matches linkPose/pointKinematics directly, converted to display units", () => {
    const system = buildFourBarSystem();
    const quantities = listQuantities(system);
    const state = referenceState(system);
    const rates = solveVelocityAcceleration(
      system,
      state.q,
      Float64Array.from([1]),
      Float64Array.from([0]),
    );

    const out = new Float64Array(quantities.length);
    measureAll(system, state.q, rates.qDot, rates.qDDot, quantities, out);

    const crankAngleIndex = quantities.findIndex(
      (q) => q.token === "angle" && q.entityLabel === "crank",
    );
    const expectedAngle =
      linkPose(system, state.q, quantities[crankAngleIndex].linkIndex).angle * RAD_TO_DEG;
    expect(out[crankAngleIndex]).toBeCloseTo(expectedAngle, 9);

    const markerXIndex = quantities.findIndex((q) => q.token === "x");
    const markerQuantity = quantities[markerXIndex];
    const pk = pointKinematics(
      system,
      state.q,
      rates.qDot,
      rates.qDDot,
      markerQuantity.linkIndex,
      markerQuantity.local!,
    );
    expect(out[markerXIndex]).toBeCloseTo(pk.position.x, 9);
  });

  it("is defensive against a mismatched token/entityKind pairing (out-of-band QuantityDef)", () => {
    const system = buildFourBarSystem();
    const state = referenceState(system);
    const bogusLinkQuantity: QuantityDef = {
      id: "bogus:link",
      entityKind: "link",
      entityId: "x",
      entityLabel: "x",
      token: "x", // not a link token
      unit: "len",
      linkIndex: 1,
    };
    const bogusMarkerQuantity: QuantityDef = {
      id: "bogus:marker",
      entityKind: "marker",
      entityId: "x",
      entityLabel: "x",
      token: "angle", // not a marker token
      unit: "deg",
      linkIndex: 2,
      local: { x: 0, y: 0 },
    };
    const out = new Float64Array(2);
    measureAll(
      system,
      state.q,
      new Float64Array(system.n),
      new Float64Array(system.n),
      [bogusLinkQuantity, bogusMarkerQuantity],
      out,
    );
    expect(out[0]).toBeNaN();
    expect(out[1]).toBeNaN();
  });
});

describe("unwrapDegrees", () => {
  it("keeps consecutive differences under 180 degrees, wrapping down on a large negative jump", () => {
    const column = Float64Array.from([170, -170, 170, -170]);
    unwrapDegrees(column);
    for (let i = 1; i < column.length; i++) {
      expect(Math.abs(column[i] - column[i - 1])).toBeLessThanOrEqual(180);
    }
  });

  it("wraps up on a large positive jump", () => {
    const column = Float64Array.from([-170, 170, -170, 170]);
    unwrapDegrees(column);
    for (let i = 1; i < column.length; i++) {
      expect(Math.abs(column[i] - column[i - 1])).toBeLessThanOrEqual(180);
    }
  });
});

describe("buildSweepTable: fourBar rocker angle vs Freudenstein", () => {
  it("reproduces the analytic rocker angle within 1e-6 deg over a full 360 degree sweep", () => {
    const doc = fourBarFixture.build();
    const system = compileSystem(doc);
    const quantities = listQuantities(system);
    const rockerAngleIndex = quantities.findIndex(
      (q) => q.token === "angle" && q.entityLabel === "rocker",
    );

    const {
      crankLength: a,
      couplerLength: b,
      rockerLength: c,
      groundLength: d,
    } = fourBarFixture.dims;
    const crankLinkIndex = quantities.find(
      (q) => q.token === "angle" && q.entityLabel === "crank",
    )!.linkIndex;
    const crankReferenceAngle = linkPose(system, system.q0, crankLinkIndex).angle;
    const rockerLinkIndex = quantities[rockerAngleIndex].linkIndex;
    const rockerReferenceAngle = linkPose(system, system.q0, rockerLinkIndex).angle;
    const branch = freudensteinBranchOf(a, b, c, d, crankReferenceAngle, rockerReferenceAngle);

    const step = Math.PI / 180;
    const samples: MeasuredSampleInput[] = [];
    let state = referenceState(system);
    for (let k = 0; k <= 360; k++) {
      const target = Float64Array.from([k * step]);
      const result = advanceDrive(system, state, target);
      expect(result.status).toBe("ok");
      state = result.state;
      const rates = solveVelocityAcceleration(
        system,
        state.q,
        Float64Array.from([1]),
        Float64Array.from([0]),
      );
      samples.push({ input: k * step, q: state.q, qDot: rates.qDot, qDDot: rates.qDDot });
    }

    const table = buildSweepTable(system, quantities, samples, {
      inputKind: "rotary",
      inputDisplayOffset: 0,
    });

    expect(table.xKind).toBe("input");
    expect(table.xUnit).toBe("deg");
    for (let i = 1; i < table.x.length; i++) {
      expect(table.x[i]).toBeGreaterThan(table.x[i - 1]);
    }
    expect(table.x[0]).toBeCloseTo(0, 9);
    expect(table.x[360]).toBeCloseTo(360, 9);

    // freudensteinTheta4 returns 2*atan2(...), range (-360, 360], not
    // reduced to atan2's own (-180, 180] range -- wrap each raw value into
    // (-180, 180] first so its starting point matches linkPose's atan2
    // convention before applying the same unwrap the sweep table used
    // (otherwise the two sequences can differ by a constant +/-360).
    const wrapDeg = (deg: number): number => {
      let d = deg % 360;
      if (d > 180) d -= 360;
      if (d <= -180) d += 360;
      return d;
    };
    const analyticDeg = new Float64Array(samples.length);
    for (let i = 0; i < samples.length; i++) {
      const theta2 = crankReferenceAngle + samples[i].input;
      analyticDeg[i] = wrapDeg(freudensteinTheta4(a, b, c, d, theta2, branch) * RAD_TO_DEG);
    }
    unwrapDegrees(analyticDeg);

    const rockerColumn = table.columns[rockerAngleIndex];
    for (let i = 0; i < rockerColumn.length; i++) {
      expect(Math.abs(rockerColumn[i] - analyticDeg[i])).toBeLessThan(1e-6);
    }

    // First row equals last row mod 360, for every angle column.
    quantities.forEach((q, j) => {
      if (q.token !== "angle") return;
      const col = table.columns[j];
      const diff = ((((col[col.length - 1] - col[0]) % 360) + 540) % 360) - 180;
      expect(Math.abs(diff)).toBeLessThan(1e-6);
    });
  });

  it("uses xUnit len and no scaling for a linear input", () => {
    const system = buildFourBarSystem();
    const samples: MeasuredSampleInput[] = [
      {
        input: 0,
        q: system.q0,
        qDot: new Float64Array(system.n),
        qDDot: new Float64Array(system.n),
      },
      {
        input: 10,
        q: system.q0,
        qDot: new Float64Array(system.n),
        qDDot: new Float64Array(system.n),
      },
      {
        input: 20,
        q: system.q0,
        qDot: new Float64Array(system.n),
        qDDot: new Float64Array(system.n),
      },
    ];
    const table = buildSweepTable(system, [], samples, {
      inputKind: "linear",
      inputDisplayOffset: 5,
    });
    expect(table.xUnit).toBe("len");
    expect(Array.from(table.x)).toEqual([0, 10, 20]);
  });
});

describe("TimeHistory", () => {
  it("drops the oldest samples once past capacity, and clear() empties it", () => {
    const history = new TimeHistory(2, 5);
    for (let i = 0; i < 10; i++) {
      history.push(i, Float64Array.from([i, -i]));
    }
    expect(history.size).toBe(5);

    const quantities: QuantityDef[] = [
      {
        id: "q1",
        entityKind: "link",
        entityId: "l1",
        entityLabel: "l1",
        token: "omega",
        unit: "deg/s",
        linkIndex: 0,
      },
      {
        id: "q2",
        entityKind: "link",
        entityId: "l1",
        entityLabel: "l1",
        token: "omega",
        unit: "deg/s",
        linkIndex: 0,
      },
    ];
    const table = history.toTable(quantities);
    expect(table.xKind).toBe("time");
    expect(table.xUnit).toBe("s");
    expect(table.length).toBe(5);
    expect(Array.from(table.x)).toEqual([5, 6, 7, 8, 9]);
    expect(Array.from(table.columns[0])).toEqual([5, 6, 7, 8, 9]);

    history.clear();
    expect(history.size).toBe(0);
    expect(history.toTable(quantities).length).toBe(0);
  });

  it("unwraps angle columns in toTable", () => {
    const history = new TimeHistory(1, 10);
    const angles = [170, -170, 170, -170];
    for (let i = 0; i < angles.length; i++) history.push(i, Float64Array.from([angles[i]]));

    const quantities: QuantityDef[] = [
      {
        id: "a",
        entityKind: "link",
        entityId: "l1",
        entityLabel: "l1",
        token: "angle",
        unit: "deg",
        linkIndex: 0,
      },
    ];
    const table = history.toTable(quantities);
    const col = table.columns[0];
    for (let i = 1; i < col.length; i++) {
      expect(Math.abs(col[i] - col[i - 1])).toBeLessThanOrEqual(180);
    }
  });

  it("throws a plain Error when pushing a row of the wrong length", () => {
    const history = new TimeHistory(3);
    expect(() => history.push(0, Float64Array.from([1, 2]))).toThrow(Error);
  });
});

describe("defaultQuantityIds", () => {
  it("picks the rocker's angle for the fourBar (crank is the input link)", () => {
    const system = buildFourBarSystem();
    const crankLinkIndex = system.links.findIndex((l) => l.name === "crank");
    const groundLinkIndex = system.links.findIndex((l) => l.isGround);
    const ids = defaultQuantityIds(system, [groundLinkIndex, crankLinkIndex]);

    const rockerLinkIndex = system.links.findIndex((l) => l.name === "rocker");
    expect(ids).toEqual([`link:${system.links[rockerLinkIndex].id}:angle`]);
  });

  it("returns an empty array for a system with no moving links", () => {
    const doc = fourBarFixture.build();
    const groundOnlyDoc = {
      ...doc,
      links: doc.links.filter((l) => l.isGround),
      joints: [],
      motors: [],
      markers: [],
    };
    const system = compileSystem(groundOnlyDoc);
    expect(defaultQuantityIds(system, [])).toEqual([]);
  });

  it("falls back to the first non-input moving link when no moving link has its own ground joint outside the input set", () => {
    const system = buildFourBarSystem();
    const crankLinkIndex = system.links.findIndex((l) => l.name === "crank");
    const rockerLinkIndex = system.links.findIndex((l) => l.name === "rocker");
    const couplerLinkIndex = system.links.findIndex((l) => l.name === "coupler");
    // Both links with a ground joint (crank, rocker) are marked as "input";
    // only the coupler (no ground joint) remains -- second fallback tier.
    const ids = defaultQuantityIds(system, [crankLinkIndex, rockerLinkIndex]);
    expect(ids).toEqual([`link:${system.links[couplerLinkIndex].id}:angle`]);
  });

  it("falls back to the first moving link when every moving link is an input link", () => {
    const system = buildFourBarSystem();
    const crankLinkIndex = system.links.findIndex((l) => l.name === "crank");
    const rockerLinkIndex = system.links.findIndex((l) => l.name === "rocker");
    const couplerLinkIndex = system.links.findIndex((l) => l.name === "coupler");
    const ids = defaultQuantityIds(system, [crankLinkIndex, rockerLinkIndex, couplerLinkIndex]);
    expect(ids).toEqual([`link:${system.links[crankLinkIndex].id}:angle`]);
  });
});
