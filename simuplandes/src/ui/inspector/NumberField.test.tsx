// @vitest-environment jsdom
import { useState } from "react";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { afterEach, beforeAll, describe, it, expect, vi } from "vitest";
import { I18nextProvider } from "react-i18next";
import { ThemeProvider } from "@mui/material";
import { NumberField } from "./NumberField";
import { createI18n } from "../../i18n/i18n";
import { createStudioTheme } from "../theme/studioTheme";
import { installDomStubs } from "../../test/domStubs";

beforeAll(() => {
  installDomStubs();
});

afterEach(cleanup);

function renderField(props: Partial<React.ComponentProps<typeof NumberField>> = {}) {
  const i18n = createI18n("es");
  const theme = createStudioTheme("light", "es");
  const onCommit = props.onCommit ?? vi.fn();
  render(
    <I18nextProvider i18n={i18n}>
      <ThemeProvider theme={theme}>
        <NumberField label="X" value={props.value ?? 10} onCommit={onCommit} {...props} />
      </ThemeProvider>
    </I18nextProvider>,
  );
  return { onCommit: onCommit as ReturnType<typeof vi.fn> };
}

/** A small controlled harness so re-renders with a new `value` prop are exercised (as after undo). */
function ControlledField({ onCommit }: { onCommit: (value: number) => void }) {
  const [value, setValue] = useState(10);
  return (
    <NumberField
      label="X"
      value={value}
      onCommit={(v) => {
        setValue(v);
        onCommit(v);
      }}
    />
  );
}

describe("NumberField", () => {
  it("typing a comma-decimal value then Enter commits once, parsed", () => {
    const { onCommit } = renderField();
    const input = screen.getByLabelText<HTMLInputElement>("X");
    fireEvent.change(input, { target: { value: "12,5" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith(12.5);
  });

  it("blur also commits", () => {
    const onCommit = vi.fn();
    renderField({ onCommit });
    const input = screen.getByLabelText<HTMLInputElement>("X");
    fireEvent.change(input, { target: { value: "20.5" } });
    fireEvent.blur(input);
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith(20.5);
  });

  it("does not commit when the parsed value equals the current value", () => {
    const onCommit = vi.fn();
    renderField({ onCommit, value: 10 });
    const input = screen.getByLabelText<HTMLInputElement>("X");
    fireEvent.change(input, { target: { value: "10" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("Esc restores the displayed value and does not commit", () => {
    const onCommit = vi.fn();
    renderField({ onCommit, value: 10 });
    const input = screen.getByLabelText<HTMLInputElement>("X");
    fireEvent.change(input, { target: { value: "999" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(input.value).toBe("10,00");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("invalid input shows aria-invalid and helper text, without committing", () => {
    const onCommit = vi.fn();
    renderField({ onCommit });
    const input = screen.getByLabelText<HTMLInputElement>("X");
    fireEvent.change(input, { target: { value: "abc" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByText("Número no válido")).not.toBeNull();
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("re-renders the new value after an external change (e.g. undo) while not focused", () => {
    const onCommit = vi.fn();
    render(
      <I18nextProvider i18n={createI18n("es")}>
        <ThemeProvider theme={createStudioTheme("light", "es")}>
          <ControlledField onCommit={onCommit} />
        </ThemeProvider>
      </I18nextProvider>,
    );
    const input = screen.getByLabelText<HTMLInputElement>("X");
    expect(input.value).toBe("10,00");
    fireEvent.change(input, { target: { value: "15" } });
    fireEvent.blur(input);
    expect(input.value).toBe("15,00");
  });
});
