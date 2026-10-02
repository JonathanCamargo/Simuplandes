import { describe, it, expect } from "vitest";
import { formatCsvNumber, escapeCsvField, unitLabel, tableToCsv, csvFileName } from "./csv";
import type { MeasurementTable, QuantityDef } from "./plots";

describe("formatCsvNumber", () => {
  it("formats plain numbers with a . decimal and no locale grouping", () => {
    expect(formatCsvNumber(0.1)).toBe("0.1");
    expect(formatCsvNumber(1234.5678)).toBe("1234.5678");
  });

  it("uses JS exponential form for very small magnitudes", () => {
    expect(formatCsvNumber(-1e-7)).toBe("-1e-7");
  });

  it("rounds to 12 significant digits", () => {
    expect(formatCsvNumber(1 / 3)).toBe("0.333333333333");
  });

  it("gives an empty string for NaN and +/-Infinity", () => {
    expect(formatCsvNumber(NaN)).toBe("");
    expect(formatCsvNumber(Infinity)).toBe("");
    expect(formatCsvNumber(-Infinity)).toBe("");
  });

  it("never contains a comma (no Intl/toLocaleString dependency, unlike an es-locale formatter)", () => {
    expect(formatCsvNumber(1234.5)).not.toContain(",");
    expect(formatCsvNumber(1234567.891)).not.toContain(",");
  });
});

describe("escapeCsvField", () => {
  it("quotes a field containing a comma", () => {
    expect(escapeCsvField("a,b")).toBe('"a,b"');
  });

  it("doubles embedded quotes and wraps in quotes", () => {
    expect(escapeCsvField('say "hi"')).toBe('"say ""hi"""');
  });

  it("quotes a field containing a newline", () => {
    expect(escapeCsvField("line1\nline2")).toBe('"line1\nline2"');
  });

  it("returns a plain value unquoted", () => {
    expect(escapeCsvField("plain")).toBe("plain");
  });
});

describe("unitLabel", () => {
  it("passes through angle/time units unchanged", () => {
    expect(unitLabel("deg/s^2", "mm")).toBe("deg/s^2");
    expect(unitLabel("deg", "mm")).toBe("deg");
    expect(unitLabel("deg/s", "mm")).toBe("deg/s");
    expect(unitLabel("s", "mm")).toBe("s");
  });

  it("substitutes the document length unit for len* units", () => {
    expect(unitLabel("len", "mm")).toBe("mm");
    expect(unitLabel("len/s", "m")).toBe("m/s");
    expect(unitLabel("len/s^2", "mm")).toBe("mm/s^2");
  });
});

function makeTable(): MeasurementTable {
  const quantities: QuantityDef[] = [
    {
      id: "link:r:angle",
      entityKind: "link",
      entityId: "r",
      entityLabel: "rocker",
      token: "angle",
      unit: "deg",
      linkIndex: 3,
    },
    {
      id: "marker:m:x",
      entityKind: "marker",
      entityId: "m",
      entityLabel: "coupler-tracer",
      token: "x",
      unit: "len",
      linkIndex: 2,
      local: { x: 0, y: 0 },
    },
  ];
  return {
    xKind: "input",
    xUnit: "deg",
    x: Float64Array.from([0, 90, 180]),
    quantities,
    columns: [Float64Array.from([0, 45.5, 91]), Float64Array.from([10, 20, 1 / 3])],
    length: 3,
  };
}

describe("tableToCsv", () => {
  it("builds the exact header and CRLF-terminated rows", () => {
    const csv = tableToCsv(makeTable(), ["link:r:angle", "marker:m:x"], {
      inputLabel: "O2",
      lengthUnit: "mm",
    });
    const lines = csv.split("\r\n");
    expect(lines[0]).toBe("input O2 [deg],rocker.angle [deg],coupler-tracer.x [mm]");
    expect(lines[1]).toBe("0,0,10");
    expect(lines[2]).toBe("90,45.5,20");
    expect(lines[3]).toBe("180,91,0.333333333333");
    // Trailing CRLF after the last row, and every line break is CRLF (not bare LF).
    expect(lines[4]).toBe("");
    expect(csv.match(/\n/g)?.length).toBe(csv.match(/\r\n/g)?.length);
  });

  it("uses time [s] header for a time-kind table", () => {
    const table: MeasurementTable = { ...makeTable(), xKind: "time", xUnit: "s" };
    const csv = tableToCsv(table, [], { inputLabel: "unused", lengthUnit: "mm" });
    expect(csv.split("\r\n")[0]).toBe("time [s]");
  });

  it("skips unknown quantity ids", () => {
    const csv = tableToCsv(makeTable(), ["link:r:angle", "marker:missing:x"], {
      inputLabel: "O2",
      lengthUnit: "mm",
    });
    expect(csv.split("\r\n")[0]).toBe("input O2 [deg],rocker.angle [deg]");
  });

  it("escapes an entity name containing a comma and quotes in the header", () => {
    const table = makeTable();
    const quotedTable: MeasurementTable = {
      ...table,
      quantities: [{ ...table.quantities[0], entityLabel: 'Link, "A"' }, table.quantities[1]],
    };
    const csv = tableToCsv(quotedTable, ["link:r:angle"], { inputLabel: "O2", lengthUnit: "mm" });
    expect(csv.split("\r\n")[0]).toBe('input O2 [deg],"Link, ""A"".angle [deg]"');
  });

  it("round-trips numbers within 12 significant digits", () => {
    const csv = tableToCsv(makeTable(), ["link:r:angle", "marker:m:x"], {
      inputLabel: "O2",
      lengthUnit: "mm",
    });
    const rows = csv.split("\r\n").slice(1, 4);
    const parsed = rows.map((r) => r.split(",").map(Number));
    expect(parsed[2][2]).toBeCloseTo(1 / 3, 12);
  });
});

describe("csvFileName", () => {
  it("slugifies the document name and appends -vs-<xKind>.csv", () => {
    expect(csvFileName("Four-bar example", "input")).toBe(
      "simuplandes-four-bar-example-vs-input.csv",
    );
  });

  it("falls back to mechanism for an empty/unslugifiable name", () => {
    expect(csvFileName("", "time")).toBe("simuplandes-mechanism-vs-time.csv");
    expect(csvFileName("***", "time")).toBe("simuplandes-mechanism-vs-time.csv");
  });
});
