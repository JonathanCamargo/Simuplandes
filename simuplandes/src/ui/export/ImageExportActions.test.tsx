// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { createI18n } from "../../i18n/i18n";
import { fourBarFixtureParsed } from "../../model/__fixtures__/fourBar";
import { analyzeDocument } from "../../graph";
import { createMechanismStore } from "../../store";
import { createStudioStore } from "../../uiState/studioStore";
import type { SaveResult } from "../../persistence/fileIO";
import { ImageExportActions, type ImageExportActionsProps } from "./ImageExportActions";

vi.mock("./DrawingSvg", () => ({
  renderDrawingSvgText: vi.fn((props: { themeMode: string }) => `drawing-svg:${props.themeMode}`),
}));

vi.mock("./graphImage", () => ({
  renderGraphSvgText: vi.fn((options: { themeMode: string }) => `graph-svg:${options.themeMode}`),
}));

import { renderDrawingSvgText } from "./DrawingSvg";
import { renderGraphSvgText } from "./graphImage";

const mockRenderDrawing = vi.mocked(renderDrawingSvgText);
const mockRenderGraph = vi.mocked(renderGraphSvgText);

function baseProps(overrides?: Partial<ImageExportActionsProps>): ImageExportActionsProps {
  return {
    doc: fourBarFixtureParsed,
    view: {
      viewport: { panWorld: { x: 0, y: 0 }, zoom: 1, widthPx: 400, heightPx: 300 },
      widthPx: 400,
      heightPx: 300,
    },
    analysis: analyzeDocument(fourBarFixtureParsed),
    layoutMode: "spatial",
    stores: { studioStore: createStudioStore(), mechanismStore: createMechanismStore() },
    themeMode: "dark",
    i18n: createI18n("en"),
    ...overrides,
  };
}

function renderWith(props: ImageExportActionsProps): void {
  render(
    <I18nextProvider i18n={props.i18n}>
      <ImageExportActions {...props} />
    </I18nextProvider>,
  );
}

beforeEach(() => {
  mockRenderDrawing.mockClear();
  mockRenderGraph.mockClear();
});

afterEach(cleanup);

describe("ImageExportActions", () => {
  it("renders the four buttons and the print-light switch, labelled in the current language", () => {
    renderWith(baseProps());
    expect(screen.getByTestId("export-drawing-svg").textContent).toBe("Drawing as SVG");
    expect(screen.getByTestId("export-drawing-png").textContent).toBe("Drawing as PNG");
    expect(screen.getByTestId("export-graph-svg").textContent).toBe("Graph as SVG");
    expect(screen.getByTestId("export-graph-png").textContent).toBe("Graph as PNG");
    expect(screen.getByTestId("export-print-light")).toBeTruthy();
  });

  it("labels everything in Spanish when the i18n instance is Spanish", () => {
    renderWith(baseProps({ i18n: createI18n("es") }));
    expect(screen.getByTestId("export-drawing-svg").textContent).toBe("Dibujo como SVG");
    expect(screen.getByTestId("export-drawing-png").textContent).toBe("Dibujo como PNG");
    expect(screen.getByTestId("export-graph-svg").textContent).toBe("Grafo como SVG");
    expect(screen.getByTestId("export-graph-png").textContent).toBe("Grafo como PNG");
  });

  it("clicking Drawing as SVG saves an image/svg+xml blob named <slug>-drawing.svg through `save`", async () => {
    const save =
      vi.fn<
        (blob: Blob, fileName: string, options: { mimeTypes: string[] }) => Promise<SaveResult>
      >();
    save.mockResolvedValue({ kind: "saved", fileName: "x", handle: null });
    renderWith(baseProps({ save: save as unknown as ImageExportActionsProps["save"] }));

    fireEvent.click(screen.getByTestId("export-drawing-svg"));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));

    const [blob, fileName, options] = save.mock.calls[0];
    expect(blob.type).toBe("image/svg+xml;charset=utf-8");
    await expect(blob.text()).resolves.toBe(`drawing-svg:dark`);
    expect(fileName).toBe("four-bar-drawing.svg");
    expect(options.mimeTypes).toEqual(["image/svg+xml"]);
  });

  it("clicking Graph as PNG saves an image/png blob named <slug>-graph.png via the injected rasterizer", async () => {
    const save = vi.fn<(blob: Blob, fileName: string) => Promise<SaveResult>>();
    save.mockResolvedValue({ kind: "saved", fileName: "x", handle: null });
    const rasterize = vi.fn<(svgText: string, options: Record<string, unknown>) => Promise<Blob>>();
    const pngBlob = new Blob(["png"], { type: "image/png" });
    rasterize.mockResolvedValue(pngBlob);
    renderWith(
      baseProps({
        save: save as unknown as ImageExportActionsProps["save"],
        rasterize: rasterize as unknown as ImageExportActionsProps["rasterize"],
      }),
    );

    fireEvent.click(screen.getByTestId("export-graph-png"));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));

    const [rasterSvgText, rasterOptions] = rasterize.mock.calls[0];
    expect(rasterSvgText).toBe("graph-svg:dark");
    expect(rasterOptions).toMatchObject({
      widthPx: 400,
      heightPx: 300,
      scale: 2,
      background: "#FFFFFF",
    });
    const [blob, fileName] = save.mock.calls[0];
    expect(blob).toBe(pngBlob);
    expect(fileName).toBe("four-bar-graph.png");
  });

  it("calls the renderers with themeMode light when print-light is ON, the current mode when OFF", async () => {
    const save = vi.fn<() => Promise<SaveResult>>();
    save.mockResolvedValue({ kind: "saved", fileName: "x", handle: null });
    renderWith(baseProps({ save: save as unknown as ImageExportActionsProps["save"] }));

    fireEvent.click(screen.getByTestId("export-drawing-svg"));
    await waitFor(() => expect(mockRenderDrawing).toHaveBeenCalledTimes(1));
    expect(mockRenderDrawing.mock.calls[0][0]).toMatchObject({ themeMode: "dark" });

    fireEvent.click(screen.getByTestId("export-print-light"));
    fireEvent.click(screen.getByTestId("export-drawing-svg"));
    await waitFor(() => expect(mockRenderDrawing).toHaveBeenCalledTimes(2));
    expect(mockRenderDrawing.mock.calls[1][0]).toMatchObject({ themeMode: "light" });
  });

  it("shows nothing when the save is cancelled (AbortError)", async () => {
    const save = vi.fn<() => Promise<SaveResult>>();
    save.mockRejectedValue(new DOMException("cancelled", "AbortError"));
    renderWith(baseProps({ save: save as unknown as ImageExportActionsProps["save"] }));

    fireEvent.click(screen.getByTestId("export-drawing-svg"));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  });

  it("shows a localized error message for any other failure", async () => {
    const save = vi.fn<() => Promise<SaveResult>>();
    save.mockRejectedValue(new Error("disk full"));
    renderWith(baseProps({ save: save as unknown as ImageExportActionsProps["save"] }));

    fireEvent.click(screen.getByTestId("export-drawing-svg"));
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeNull());
    expect(screen.getByRole("alert").textContent).toMatch(/try again/i);
  });
});
