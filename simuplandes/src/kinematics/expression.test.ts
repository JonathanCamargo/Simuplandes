import { describe, it, expect } from "vitest";
import { compileExpression, ExpressionError } from "./expression";

describe("compileExpression — arithmetic", () => {
  it('"t" at 2 -> 2', () => {
    expect(compileExpression("t").evaluate(2)).toBeCloseTo(2, 12);
  });
  it('"2*t+1" -> 5 at t=2', () => {
    expect(compileExpression("2*t+1").evaluate(2)).toBeCloseTo(5, 12);
  });
  it('"-2^2" -> -4 (^ binds tighter than unary minus)', () => {
    expect(compileExpression("-2^2").evaluate(0)).toBeCloseTo(-4, 12);
  });
  it('"2^3^2" -> 512 (right-assoc)', () => {
    expect(compileExpression("2^3^2").evaluate(0)).toBeCloseTo(512, 9);
  });
  it('"(1+2)*3" -> 9', () => {
    expect(compileExpression("(1+2)*3").evaluate(0)).toBeCloseTo(9, 12);
  });
  it('"1e-3*t" -> 0.002 at t=2', () => {
    expect(compileExpression("1e-3*t").evaluate(2)).toBeCloseTo(0.002, 12);
  });
  it('".5" -> 0.5', () => {
    expect(compileExpression(".5").evaluate(0)).toBeCloseTo(0.5, 12);
  });
  it('"pi" -> Math.PI', () => {
    expect(compileExpression("pi").evaluate(0)).toBeCloseTo(Math.PI, 12);
  });
  it('"e" -> Math.E', () => {
    expect(compileExpression("e").evaluate(0)).toBeCloseTo(Math.E, 12);
  });
});

describe("compileExpression — whitelisted functions", () => {
  it('"0.5*sin(2*pi*t/4)" evaluates', () => {
    const f = compileExpression("0.5*sin(2*pi*t/4)");
    expect(f.evaluate(1)).toBeCloseTo(0.5 * Math.sin((2 * Math.PI * 1) / 4), 9);
  });
  it('"atan2(1, 1)" -> pi/4', () => {
    expect(compileExpression("atan2(1, 1)").evaluate(0)).toBeCloseTo(Math.PI / 4, 12);
  });
  it("every whitelisted function compiles and evaluates finitely", () => {
    const cases: [string, number][] = [
      ["sin(t)", 0.5],
      ["cos(t)", 0.5],
      ["tan(t)", 0.5],
      ["asin(t)", 0.5],
      ["acos(t)", 0.5],
      ["atan(t)", 0.5],
      ["sinh(t)", 0.5],
      ["cosh(t)", 0.5],
      ["tanh(t)", 0.5],
      ["sqrt(t)", 4],
      ["abs(t)", -3],
      ["exp(t)", 1],
      ["log(t)", 1],
      ["log10(t)", 100],
      ["floor(t)", 1.7],
      ["ceil(t)", 1.2],
      ["round(t)", 1.5],
      ["sign(t)", -5],
      ["pow(t, 2)", 3],
      ["min(t, 2, 3)", 1],
      ["max(t, 2, 3)", 1],
    ];
    for (const [src, t] of cases) {
      const f = compileExpression(src);
      expect(Number.isFinite(f.evaluate(t))).toBe(true);
    }
  });
});

describe("compileExpression — rejections", () => {
  const rejected: string[] = [
    "",
    "   ",
    "2(3+4)",
    "sin t",
    "sin(",
    "1+",
    "t t",
    "x",
    "constructor",
    "__proto__",
    "toString",
    "valueOf",
    "t.constructor",
    "this",
    "sin(1,2)",
    "atan2(1)",
    "$",
    "t;",
    "1..2",
  ];
  for (const src of rejected) {
    it(`rejects ${JSON.stringify(src)} with an ExpressionError carrying a position`, () => {
      let error: unknown;
      try {
        compileExpression(src);
      } catch (e) {
        error = e;
      }
      expect(error).toBeInstanceOf(ExpressionError);
      expect(typeof (error as ExpressionError).position).toBe("number");
    });
  }

  it("rejects quoted strings", () => {
    expect(() => compileExpression('"t"')).toThrow(ExpressionError);
    expect(() => compileExpression("'t'")).toThrow(ExpressionError);
  });

  it("rejects a source longer than 1000 characters", () => {
    const src = `${"1+".repeat(600)}1`;
    expect(src.length).toBeGreaterThan(1000);
    expect(() => compileExpression(src)).toThrow(ExpressionError);
  });

  it("rejects nesting deeper than 64", () => {
    const src = `${"(".repeat(80)}t${")".repeat(80)}`;
    expect(() => compileExpression(src)).toThrow(ExpressionError);
  });

  it("rejects a variadic function called with zero arguments", () => {
    expect(() => compileExpression("min()")).toThrow(ExpressionError);
    expect(() => compileExpression("max()")).toThrow(ExpressionError);
  });
});

describe("compileExpression — evaluate never throws at run time", () => {
  it('"1/0" returns a non-finite number, not a throw', () => {
    const f = compileExpression("1/0");
    expect(() => f.evaluate(0)).not.toThrow();
    expect(Number.isFinite(f.evaluate(0))).toBe(false);
  });
  it('"sqrt(-1)" returns a non-finite number (NaN), not a throw', () => {
    const f = compileExpression("sqrt(-1)");
    expect(() => f.evaluate(0)).not.toThrow();
    expect(Number.isNaN(f.evaluate(0))).toBe(true);
  });
});
