// @vitest-environment jsdom
import { render, screen, act, cleanup, waitFor } from "@testing-library/react";
import { afterEach, describe, it, expect, vi } from "vitest";
import { useFileDrop } from "./useFileDrop";

afterEach(cleanup);

function Probe({ onText }: { onText: (text: string, name: string) => void }) {
  const { dragging } = useFileDrop(onText);
  return <div data-testid="state">{dragging ? "dragging" : "idle"}</div>;
}

function dragEvent(type: string, dataTransfer: unknown, relatedTarget: EventTarget | null = null) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "dataTransfer", { value: dataTransfer });
  Object.defineProperty(event, "relatedTarget", { value: relatedTarget });
  return event;
}

const filesTransfer = (files: File[] = []) => ({ types: ["Files"], files });

describe("useFileDrop", () => {
  it("shows dragging while files are dragged over and prevents default", () => {
    render(<Probe onText={vi.fn()} />);
    const over = dragEvent("dragover", filesTransfer());
    act(() => {
      window.dispatchEvent(over);
    });
    expect(over.defaultPrevented).toBe(true);
    expect(screen.getByTestId("state").textContent).toBe("dragging");
    act(() => {
      window.dispatchEvent(dragEvent("dragenter", filesTransfer()));
    });
    expect(screen.getByTestId("state").textContent).toBe("dragging");
  });

  it("ignores drags without files (and a missing dataTransfer)", () => {
    const onText = vi.fn();
    render(<Probe onText={onText} />);
    const over = dragEvent("dragover", { types: ["text/plain"], files: [] });
    act(() => {
      window.dispatchEvent(over);
      window.dispatchEvent(dragEvent("dragover", undefined));
      window.dispatchEvent(dragEvent("drop", { types: ["text/plain"], files: [] }));
    });
    expect(over.defaultPrevented).toBe(false);
    expect(screen.getByTestId("state").textContent).toBe("idle");
    expect(onText).not.toHaveBeenCalled();
  });

  it("clears dragging when the drag leaves the window, not when it moves between elements", () => {
    render(<Probe onText={vi.fn()} />);
    act(() => {
      window.dispatchEvent(dragEvent("dragover", filesTransfer()));
      window.dispatchEvent(dragEvent("dragleave", filesTransfer(), document.body));
    });
    expect(screen.getByTestId("state").textContent).toBe("dragging");
    act(() => {
      window.dispatchEvent(dragEvent("dragleave", filesTransfer(), null));
    });
    expect(screen.getByTestId("state").textContent).toBe("idle");
  });

  it("reads the first dropped file text and hands it to onText", async () => {
    const onText = vi.fn();
    render(<Probe onText={onText} />);
    const file = new File(['{"nodes":[]}'], "g.json");
    const drop = dragEvent("drop", filesTransfer([file]));
    act(() => {
      window.dispatchEvent(dragEvent("dragover", filesTransfer()));
      window.dispatchEvent(drop);
    });
    expect(drop.defaultPrevented).toBe(true);
    expect(screen.getByTestId("state").textContent).toBe("idle");
    await waitFor(() => expect(onText).toHaveBeenCalledWith('{"nodes":[]}', "g.json"));
  });

  it("a drop carrying Files but no file entries calls nothing", () => {
    const onText = vi.fn();
    render(<Probe onText={onText} />);
    act(() => {
      window.dispatchEvent(dragEvent("drop", filesTransfer([])));
    });
    expect(onText).not.toHaveBeenCalled();
  });

  it("removes its listeners on unmount", () => {
    const { unmount } = render(<Probe onText={vi.fn()} />);
    unmount();
    const over = dragEvent("dragover", filesTransfer());
    window.dispatchEvent(over);
    expect(over.defaultPrevented).toBe(false);
  });
});
