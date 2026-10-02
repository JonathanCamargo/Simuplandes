/**
 * Idempotent jsdom polyfills for Phase 4's component tests. jsdom lacks
 * `ResizeObserver`, `Element.prototype.scrollIntoView` and
 * `window.matchMedia`, all of which `react-resizable-panels`, `cmdk` and MUI
 * touch during render. Test-only: excluded from coverage (see
 * `vite.config.ts`'s `coverage.exclude`).
 */

class NoopResizeObserver implements ResizeObserver {
  observe(): void {
    // no-op: jsdom has no real layout to observe
  }
  unobserve(): void {
    // no-op
  }
  disconnect(): void {
    // no-op
  }
}

/** Installs missing jsdom globals used by Phase 4's UI libraries. Safe to call more than once. */
export function installDomStubs(): void {
  if (typeof window === "undefined") return;

  if (typeof window.ResizeObserver === "undefined") {
    window.ResizeObserver = NoopResizeObserver;
  }

  if (typeof Element.prototype.scrollIntoView !== "function") {
    Element.prototype.scrollIntoView = function scrollIntoView(): void {
      // no-op
    };
  }

  if (typeof window.matchMedia !== "function") {
    window.matchMedia = function matchMedia(query: string): MediaQueryList {
      return {
        matches: false,
        media: query,
        onchange: null,
        addListener: () => undefined,
        removeListener: () => undefined,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        dispatchEvent: () => false,
      } as MediaQueryList;
    };
  }
}
