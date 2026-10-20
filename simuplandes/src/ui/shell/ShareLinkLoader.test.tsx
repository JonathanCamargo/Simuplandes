// @vitest-environment jsdom
import { render, screen, fireEvent, cleanup, waitFor, act } from "@testing-library/react";
import { afterEach, beforeAll, describe, it, expect, vi } from "vitest";
import { I18nextProvider } from "react-i18next";
import { ThemeProvider } from "@mui/material";
import { ShareLinkLoader } from "./ShareLinkLoader";
import { createStudioTheme } from "../theme/studioTheme";
import { createI18n } from "../../i18n/i18n";
import { createStudioStore } from "../../uiState/studioStore";
import { startSession } from "../../persistence/session";
import { createMemoryStorage } from "../../persistence/memoryStorage";
import { createEmptyDocument, type MechanismDocument } from "../../model";
import { fourBarFixtureParsed } from "../../model/__fixtures__/fourBar";
import { decodeShareHash } from "../../persistence/shareLink";
import { installDomStubs } from "../../test/domStubs";

// jsdom has no DecompressionStream; decoding is covered by shareLink.test.ts.
vi.mock("../../persistence/shareLink", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../persistence/shareLink")>();
  return { ...actual, decodeShareHash: vi.fn() };
});
const mockDecode = vi.mocked(decodeShareHash);

beforeAll(() => {
  installDomStubs();
});

afterEach(() => {
  cleanup();
  mockDecode.mockReset();
});

function setup(hash: string, current?: MechanismDocument, events: EventTarget = new EventTarget()) {
  const session = startSession({ storage: createMemoryStorage(), target: null });
  if (current) session.store.getState().loadDocument(current);
  const studioStore = createStudioStore();
  const replaceState = vi.fn();
  const location = { hash, pathname: "/simuplandes/", search: "" };
  render(
    <I18nextProvider i18n={createI18n("es")}>
      <ThemeProvider theme={createStudioTheme("light", "es")}>
        <ShareLinkLoader
          mechanismStore={session.store}
          studioStore={studioStore}
          location={location}
          history={{ replaceState }}
          events={events}
        />
      </ThemeProvider>
    </I18nextProvider>,
  );
  return { session, studioStore, replaceState, location };
}

describe("ShareLinkLoader", () => {
  it("does nothing without a #m= fragment", () => {
    const { session, replaceState } = setup("");
    expect(mockDecode).not.toHaveBeenCalled();
    expect(replaceState).not.toHaveBeenCalled();
    expect(session.store.getState().document.links).toHaveLength(0);
  });

  it("opens the shared mechanism straight away over an empty drawing, in Simulate", async () => {
    mockDecode.mockResolvedValue(fourBarFixtureParsed);
    const { session, studioStore, replaceState } = setup("#m=abc");

    await waitFor(() => expect(session.store.getState().document).toEqual(fourBarFixtureParsed));
    expect(replaceState).toHaveBeenCalledWith(null, "", "/simuplandes/");
    expect(studioStore.getState().mode).toBe("simulate");
    expect(screen.queryByTestId("share-confirm")).toBeNull();
  });

  it("asks before replacing a drawing, and keeps it when the user says so", async () => {
    mockDecode.mockResolvedValue(fourBarFixtureParsed);
    const mine = { ...fourBarFixtureParsed, name: "mine" };
    const { session, replaceState } = setup("#m=abc", mine);

    fireEvent.click(await screen.findByRole("button", { name: "Conservar el mío" }));
    expect(session.store.getState().document.name).toBe("mine");
    expect(replaceState).toHaveBeenCalledTimes(1);
  });

  it("replaces the drawing when the user confirms", async () => {
    const shared = { ...createEmptyDocument(), name: "shared" };
    mockDecode.mockResolvedValue(shared);
    const { session } = setup("#m=abc", fourBarFixtureParsed);

    fireEvent.click(await screen.findByRole("button", { name: "Abrir" }));
    expect(session.store.getState().document.name).toBe("shared");
  });

  it("shows an error and clears the fragment when the link is damaged", async () => {
    mockDecode.mockRejectedValue(new Error("bad data"));
    const { session, replaceState } = setup("#m=abc");

    expect((await screen.findByRole("alert")).textContent).toContain("bad data");
    expect(replaceState).toHaveBeenCalledTimes(1);
    expect(session.store.getState().document.links).toHaveLength(0);
  });

  it("opens a link pasted later, when only the fragment changes", async () => {
    mockDecode.mockResolvedValue(fourBarFixtureParsed);
    const events = new EventTarget();
    const { session, location } = setup("", undefined, events);
    expect(mockDecode).not.toHaveBeenCalled();

    location.hash = "#m=later";
    act(() => {
      events.dispatchEvent(new Event("hashchange"));
    });
    await waitFor(() => expect(session.store.getState().document).toEqual(fourBarFixtureParsed));
    expect(mockDecode).toHaveBeenCalledWith("#m=later");
  });
});
