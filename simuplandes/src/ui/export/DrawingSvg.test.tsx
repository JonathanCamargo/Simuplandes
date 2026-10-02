// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { renderDrawingSvgText, type DrawingSvgView } from "./DrawingSvg";
import { fourBarFixtureParsed } from "../../model/__fixtures__/fourBar";
import { siteWorldPosition, type Pose } from "../../model";
import { worldToScreen } from "../../canvas/viewport";
import { canvasTokensFor } from "../theme/studioTheme";

const VIEW: DrawingSvgView = {
  viewport: { panWorld: { x: 0, y: 0 }, zoom: 1, widthPx: 400, heightPx: 300 },
  widthPx: 400,
  heightPx: 300,
};

function parse(svgText: string): Document {
  return new DOMParser().parseFromString(svgText, "image/svg+xml");
}

describe("renderDrawingSvgText", () => {
  it("returns a standalone, transparent SVG string sized to the CSS box", () => {
    const svgText = renderDrawingSvgText({
      doc: fourBarFixtureParsed,
      view: VIEW,
      themeMode: "light",
    });

    expect(svgText.startsWith("<svg")).toBe(true);
    expect(svgText).toContain('xmlns="http://www.w3.org/2000/svg"');

    const doc = parse(svgText);
    const root = doc.documentElement;
    expect(root.getAttribute("width")).toBe("400");
    expect(root.getAttribute("height")).toBe("300");
    expect(root.getAttribute("viewBox")).toBe("0 0 400 300");

    // No full-size background rect (transparent SVG).
    const rects = Array.from(doc.querySelectorAll("rect"));
    const backgroundRect = rects.find(
      (r) => r.getAttribute("width") === "400" && r.getAttribute("height") === "300",
    );
    expect(backgroundRect).toBeUndefined();
  });

  it("draws one element per bar/plate/pin/ground pivot/marker, y-up mapped to SVG y-down", () => {
    const svgText = renderDrawingSvgText({
      doc: fourBarFixtureParsed,
      view: VIEW,
      themeMode: "light",
    });
    const doc = parse(svgText);

    // ground (bar) + crank (bar) + rocker (bar) = 3; coupler (plate) = 1.
    expect(doc.querySelectorAll('[data-kind="bar"]').length).toBe(3);
    expect(doc.querySelectorAll('[data-kind="plate"]').length).toBe(1);
    // 4 R joints.
    expect(doc.querySelectorAll('[data-kind="pin"]').length).toBe(4);
    // The ground link has 2 sites.
    expect(doc.querySelectorAll('[data-kind="ground-pivot"]').length).toBe(2);
    // 1 marker.
    expect(doc.querySelectorAll('[data-kind="marker"]').length).toBe(1);
    // No free sites in this fixture, and none are ever drawn regardless.
    expect(doc.querySelectorAll('[data-kind="free-site"]').length).toBe(0);

    // World y-up -> SVG y-down: a larger world y maps to a smaller SVG y.
    // The ground link's 2nd site (local [140,0]) has world y=0; the rocker's
    // 2nd site (local [-30,40], rocker pose position [140,0]) has world y=40.
    const groundLink = fourBarFixtureParsed.links[0];
    const rockerLink = fourBarFixtureParsed.links[3];
    const pGround = siteWorldPosition({ pose: groundLink.pose }, groundLink.sites[1].local);
    const pRocker = siteWorldPosition({ pose: rockerLink.pose }, rockerLink.sites[1].local);
    expect(pRocker.y).toBeGreaterThan(pGround.y);

    const sGround = worldToScreen(VIEW.viewport, pGround);
    const sRocker = worldToScreen(VIEW.viewport, pRocker);
    expect(sRocker.y).toBeLessThan(sGround.y);
  });

  it("moves bar endpoints to the posed world points when `poses` overrides the crank", () => {
    const crank = fourBarFixtureParsed.links[1];
    const posedPose: Pose = { position: [0, 0], angle: Math.PI / 2 };
    const poses = new Map([[crank.id, posedPose]]);

    const svgText = renderDrawingSvgText({
      doc: fourBarFixtureParsed,
      poses,
      view: VIEW,
      themeMode: "light",
    });
    const doc = parse(svgText);

    const crankGroup = doc.querySelector(`[data-kind="bar"][data-id="${crank.id}"]`);
    expect(crankGroup).not.toBeNull();
    const polyline = crankGroup!.querySelector("polyline");
    expect(polyline).not.toBeNull();
    const points = polyline!.getAttribute("points")!.trim().split(/\s+/);
    const lastPoint = points[points.length - 1].split(",").map(Number);

    const expectedWorld = siteWorldPosition({ pose: posedPose }, crank.sites[1].local);
    const expectedScreen = worldToScreen(VIEW.viewport, expectedWorld);

    expect(lastPoint[0]).toBeCloseTo(expectedScreen.x, 6);
    expect(lastPoint[1]).toBeCloseTo(expectedScreen.y, 6);

    // Not the reference (unposed) endpoint.
    const referenceWorld = siteWorldPosition({ pose: crank.pose }, crank.sites[1].local);
    const referenceScreen = worldToScreen(VIEW.viewport, referenceWorld);
    expect(lastPoint[1]).not.toBeCloseTo(referenceScreen.y, 3);
  });

  it("draws one polyline per trace", () => {
    const svgText = renderDrawingSvgText({
      doc: fourBarFixtureParsed,
      view: VIEW,
      themeMode: "light",
      traces: [{ markerId: "marker-1", points: [0, 0, 10, 10, 20, 0], closed: false }],
    });
    const doc = parse(svgText);
    expect(doc.querySelectorAll('[data-kind="trace"]').length).toBe(1);
  });

  it("draws no selection/hover/issue halos", () => {
    const svgText = renderDrawingSvgText({
      doc: fourBarFixtureParsed,
      view: VIEW,
      themeMode: "light",
    });
    expect(svgText).not.toContain("is-selected");
    expect(svgText).not.toContain("is-hovered");
    expect(svgText).not.toContain("is-issue");
  });

  it("changes colors between light and dark themeMode", () => {
    const light = renderDrawingSvgText({
      doc: fourBarFixtureParsed,
      view: VIEW,
      themeMode: "light",
    });
    const dark = renderDrawingSvgText({ doc: fourBarFixtureParsed, view: VIEW, themeMode: "dark" });

    const lightTokens = canvasTokensFor("light");
    const darkTokens = canvasTokensFor("dark");
    expect(lightTokens.pin).not.toBe(darkTokens.pin);
    expect(light).toContain(`fill="${lightTokens.pin}"`);
    expect(dark).toContain(`fill="${darkTokens.pin}"`);
    expect(light).not.toContain(`fill="${darkTokens.pin}"`);
  });
});
