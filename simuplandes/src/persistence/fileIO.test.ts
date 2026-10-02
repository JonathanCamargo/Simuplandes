// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fileOpen, fileSave, type FileWithHandle } from "browser-fs-access";
import {
  saveDocumentToFile,
  openDocumentFromFile,
  openTextFromFile,
  sniffDocumentText,
  suggestFileName,
  isAbortError,
  slugifyName,
  graphtheFileName,
  saveBlobToFile,
} from "./fileIO";
import { serializeDocument, DocumentLoadError } from "../model";
import { fourBarFixtureParsed } from "../model/__fixtures__/fourBar";

vi.mock("browser-fs-access", () => ({
  fileOpen: vi.fn(),
  fileSave: vi.fn(),
}));

const mockFileSave = vi.mocked(fileSave);
const mockFileOpen = vi.mocked(fileOpen);

beforeEach(() => {
  mockFileSave.mockReset();
  mockFileOpen.mockReset();
});

describe("suggestFileName", () => {
  it("slugifies the document name", () => {
    expect(suggestFileName({ name: "Four bar / Test" })).toBe("four-bar-test.simup.json");
  });

  it("falls back to 'mechanism' for an empty name", () => {
    expect(suggestFileName({ name: "" })).toBe("mechanism.simup.json");
  });
});

describe("saveDocumentToFile", () => {
  it("calls fileSave once with a correctly-shaped Blob and options", async () => {
    const fakeHandle = {} as FileSystemFileHandle;
    mockFileSave.mockResolvedValue(fakeHandle);

    const result = await saveDocumentToFile(fourBarFixtureParsed);

    expect(mockFileSave).toHaveBeenCalledTimes(1);
    const call = mockFileSave.mock.calls[0];
    if (!call) throw new Error("fileSave was not called");
    const [blobArg, optionsArg, existingHandleArg] = call;
    expect(blobArg).toBeInstanceOf(Blob);
    const blob = blobArg as Blob;
    expect(blob.type).toBe("application/json");
    await expect(blob.text()).resolves.toBe(serializeDocument(fourBarFixtureParsed));

    const fileName = suggestFileName(fourBarFixtureParsed);
    expect(fileName.endsWith(".simup.json")).toBe(true);
    expect(optionsArg).toMatchObject({ fileName, extensions: [".json"] });
    expect(existingHandleArg).toBeNull();
    expect(result).toEqual({ kind: "saved", fileName, handle: fakeHandle });
  });

  it("passes an existing handle as existingHandle for a plain Save (not Save as)", async () => {
    const fakeHandle = {} as FileSystemFileHandle;
    mockFileSave.mockResolvedValue(fakeHandle);

    await saveDocumentToFile(fourBarFixtureParsed, { handle: fakeHandle });

    const call = mockFileSave.mock.calls[0];
    if (!call) throw new Error("fileSave was not called");
    expect(call[2]).toBe(fakeHandle);
  });

  it("returns cancelled on an AbortError, without throwing", async () => {
    mockFileSave.mockRejectedValue(new DOMException("cancelled", "AbortError"));
    await expect(saveDocumentToFile(fourBarFixtureParsed)).resolves.toEqual({
      kind: "cancelled",
    });
  });

  it("propagates any other rejection", async () => {
    mockFileSave.mockRejectedValue(new Error("disk full"));
    await expect(saveDocumentToFile(fourBarFixtureParsed)).rejects.toThrow("disk full");
  });
});

describe("openDocumentFromFile", () => {
  it("round-trips a saved document", async () => {
    let capturedText = "";
    mockFileSave.mockImplementation(async (blobOrPromise) => {
      const blob = await blobOrPromise;
      capturedText = await (blob as Blob).text();
      return {} as FileSystemFileHandle;
    });
    await saveDocumentToFile(fourBarFixtureParsed);

    const openedFile: FileWithHandle = new File([capturedText], "four-bar.simup.json");
    mockFileOpen.mockResolvedValue(openedFile);

    const result = await openDocumentFromFile();
    expect(result).toEqual({
      kind: "opened",
      document: fourBarFixtureParsed,
      fileName: "four-bar.simup.json",
      handle: null,
    });
  });

  it("rejects invalid-json content with reason invalid-json", async () => {
    const brokenFile: FileWithHandle = new File(["{broken"], "bad.simup.json");
    mockFileOpen.mockResolvedValue(brokenFile);

    await expect(openDocumentFromFile()).rejects.toThrow(DocumentLoadError);
    try {
      await openDocumentFromFile();
      throw new Error("unreachable");
    } catch (e) {
      expect(e).toBeInstanceOf(DocumentLoadError);
      expect((e as DocumentLoadError).reason).toBe("invalid-json");
    }
  });

  it("rejects a newer-version document with reason newer-version", async () => {
    const newer = { ...fourBarFixtureParsed, schemaVersion: 2 };
    const newerFile: FileWithHandle = new File([JSON.stringify(newer)], "newer.simup.json");
    mockFileOpen.mockResolvedValue(newerFile);

    try {
      await openDocumentFromFile();
      throw new Error("unreachable");
    } catch (e) {
      expect(e).toBeInstanceOf(DocumentLoadError);
      expect((e as DocumentLoadError).reason).toBe("newer-version");
    }
  });

  it("returns cancelled on an AbortError, without throwing", async () => {
    mockFileOpen.mockRejectedValue(new DOMException("cancelled", "AbortError"));
    await expect(openDocumentFromFile()).resolves.toEqual({ kind: "cancelled" });
  });

  it("propagates any other fileOpen rejection", async () => {
    mockFileOpen.mockRejectedValue(new Error("picker unavailable"));
    await expect(openDocumentFromFile()).rejects.toThrow("picker unavailable");
  });
});

describe("isAbortError", () => {
  it("is true only for a DOMException/Error named AbortError", () => {
    expect(isAbortError(new DOMException("x", "AbortError"))).toBe(true);
    expect(isAbortError(new Error("y"))).toBe(false);
    expect(isAbortError("not an error")).toBe(false);
  });
});

describe("slugifyName", () => {
  it("lowercases, replaces non-alphanumeric runs with a dash, and trims leading/trailing dashes", () => {
    expect(slugifyName("Four bar / Test")).toBe("four-bar-test");
    expect(slugifyName("  My Four-Bar!  ")).toBe("my-four-bar");
    expect(slugifyName("")).toBe("");
  });
});

describe("graphtheFileName", () => {
  it("slugifies doc.name into <slug>.graphthe.json, same slug rule as .simup.json", () => {
    expect(graphtheFileName({ name: "My Four-Bar!" })).toBe("my-four-bar.graphthe.json");
  });

  it("falls back to 'mechanism' for an empty name", () => {
    expect(graphtheFileName({ name: "" })).toBe("mechanism.graphthe.json");
  });
});

describe("saveBlobToFile", () => {
  it("calls fileSave with the given blob, fileName and options", async () => {
    const fakeHandle = {} as FileSystemFileHandle;
    mockFileSave.mockResolvedValue(fakeHandle);
    const blob = new Blob(["<svg></svg>"], { type: "image/svg+xml" });

    const result = await saveBlobToFile(blob, "mechanism-drawing.svg", {
      description: "Drawing (SVG)",
      mimeTypes: ["image/svg+xml"],
      extensions: [".svg"],
    });

    expect(mockFileSave).toHaveBeenCalledTimes(1);
    const call = mockFileSave.mock.calls[0];
    if (!call) throw new Error("fileSave was not called");
    const [blobArg, optionsArg, existingHandleArg] = call;
    expect(blobArg).toBe(blob);
    expect(optionsArg).toMatchObject({
      fileName: "mechanism-drawing.svg",
      description: "Drawing (SVG)",
      mimeTypes: ["image/svg+xml"],
      extensions: [".svg"],
    });
    expect(existingHandleArg).toBeNull();
    expect(result).toEqual({
      kind: "saved",
      fileName: "mechanism-drawing.svg",
      handle: fakeHandle,
    });
  });

  it("returns cancelled on an AbortError, without throwing", async () => {
    mockFileSave.mockRejectedValue(new DOMException("cancelled", "AbortError"));
    const blob = new Blob(["<svg></svg>"], { type: "image/svg+xml" });
    await expect(
      saveBlobToFile(blob, "x.svg", {
        description: "d",
        mimeTypes: ["image/svg+xml"],
        extensions: [".svg"],
      }),
    ).resolves.toEqual({ kind: "cancelled" });
  });

  it("propagates any other rejection", async () => {
    mockFileSave.mockRejectedValue(new Error("disk full"));
    const blob = new Blob(["<svg></svg>"], { type: "image/svg+xml" });
    await expect(
      saveBlobToFile(blob, "x.svg", {
        description: "d",
        mimeTypes: ["image/svg+xml"],
        extensions: [".svg"],
      }),
    ).rejects.toThrow("disk full");
  });
});

describe("openTextFromFile", () => {
  it("returns the raw text, name and handle", async () => {
    const handle = {} as FileSystemFileHandle;
    const file = Object.assign(new File(['{"a":1}'], "g.graphthe.json"), {
      handle,
    }) as FileWithHandle;
    mockFileOpen.mockResolvedValue(file);
    expect(await openTextFromFile()).toEqual({
      kind: "opened",
      text: '{"a":1}',
      fileName: "g.graphthe.json",
      handle,
    });
  });

  it("uses a null handle when the picker gives none", async () => {
    mockFileOpen.mockResolvedValue(new File(["x"], "x.json"));
    const result = await openTextFromFile();
    expect(result).toMatchObject({ kind: "opened", handle: null });
  });

  it("resolves cancelled on an AbortError and rethrows anything else", async () => {
    mockFileOpen.mockRejectedValueOnce(new DOMException("x", "AbortError"));
    expect(await openTextFromFile()).toEqual({ kind: "cancelled" });
    mockFileOpen.mockRejectedValueOnce(new Error("boom"));
    await expect(openTextFromFile()).rejects.toThrow("boom");
  });
});

describe("sniffDocumentText", () => {
  it("recognizes a serialized MechanismDocument", () => {
    expect(sniffDocumentText(serializeDocument(fourBarFixtureParsed))).toBe("simuplandes");
  });

  it("accepts a legacy `version` key on a document-shaped object", () => {
    expect(sniffDocumentText('{"version":1,"links":[],"joints":[]}')).toBe("simuplandes");
  });

  it("recognizes graph envelopes and node-link dicts", () => {
    expect(sniffDocumentText('{"format":"simuplandes-graphthe-export"}')).toBe("graph");
    expect(sniffDocumentText('{"format":"simuplandes-parity-fixture"}')).toBe("graph");
    expect(sniffDocumentText('{"nodes":[],"edges":[]}')).toBe("graph");
    expect(sniffDocumentText('{"nodes":[],"links":[]}')).toBe("graph");
  });

  it("returns unknown for unparseable, non-object and unrelated JSON", () => {
    expect(sniffDocumentText("{broken")).toBe("unknown");
    expect(sniffDocumentText("[1,2]")).toBe("unknown");
    expect(sniffDocumentText("3")).toBe("unknown");
    expect(sniffDocumentText('{"nodes":[]}')).toBe("unknown");
    expect(sniffDocumentText('{"links":[],"joints":[]}')).toBe("unknown");
  });
});
