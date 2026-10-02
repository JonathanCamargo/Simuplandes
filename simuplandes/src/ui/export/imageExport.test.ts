// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { svgTextToBlob, imageFileName } from "./imageExport";

describe("svgTextToBlob", () => {
  it("wraps the given SVG text in an image/svg+xml;charset=utf-8 blob, byte-equal to the input", async () => {
    const svgText = '<svg xmlns="http://www.w3.org/2000/svg"><circle r="1"/></svg>';
    const blob = svgTextToBlob(svgText);
    expect(blob.type).toBe("image/svg+xml;charset=utf-8");
    await expect(blob.text()).resolves.toBe(svgText);
  });
});

describe("imageFileName", () => {
  it("slugifies doc.name into <slug>-<kind>.<format>", () => {
    expect(imageFileName({ name: "My Four-Bar!" }, "drawing", "svg")).toBe(
      "my-four-bar-drawing.svg",
    );
    expect(imageFileName({ name: "My Four-Bar!" }, "graph", "png")).toBe("my-four-bar-graph.png");
  });

  it("falls back to 'mechanism' for an empty name", () => {
    expect(imageFileName({ name: "" }, "drawing", "png")).toBe("mechanism-drawing.png");
  });
});
