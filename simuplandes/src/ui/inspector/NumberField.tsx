/**
 * A locale-aware numeric input: accepts `.` or `,` as the decimal separator
 * (via `parseNumberInput`), displays the current value with the locale's
 * separator (via `formatNumber`) while not focused, and commits only on
 * Enter/blur when the parsed value actually differs from `value` -- so an
 * Inspector edit is exactly one `store.execute()` call, never one per
 * keystroke. Esc reverts the displayed text without committing.
 */

import { useState, type InputHTMLAttributes, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { InputAdornment, TextField } from "@mui/material";
import { formatNumber, parseNumberInput, type Language } from "../../i18n/numberFormat";

export interface NumberFieldProps {
  label: string;
  value: number;
  onCommit: (value: number) => void;
  unit?: string;
  fractionDigits?: number;
  inputProps?: InputHTMLAttributes<HTMLInputElement>;
  disabled?: boolean;
}

export function NumberField({
  label,
  value,
  onCommit,
  unit,
  fractionDigits = 2,
  inputProps,
  disabled,
}: NumberFieldProps): ReactNode {
  const { t, i18n } = useTranslation();
  const lang = i18n.language as Language;
  const [focused, setFocused] = useState(false);
  const [text, setText] = useState(() => formatNumber(value, lang, fractionDigits));
  const [invalid, setInvalid] = useState(false);

  // Resync the displayed text from `value`/locale during render (the React-
  // docs-recommended "adjust state when a prop changes" pattern, not an
  // effect) whenever NOT focused -- otherwise an external update (e.g. undo)
  // would fight a user actively typing. `renderedFor` remembers what the
  // text currently reflects so this only fires on an actual change.
  const [renderedFor, setRenderedFor] = useState({ value, lang, fractionDigits });
  if (
    !focused &&
    (renderedFor.value !== value ||
      renderedFor.lang !== lang ||
      renderedFor.fractionDigits !== fractionDigits)
  ) {
    setRenderedFor({ value, lang, fractionDigits });
    setText(formatNumber(value, lang, fractionDigits));
    setInvalid(false);
  }

  function revert(): void {
    setText(formatNumber(value, lang, fractionDigits));
    setInvalid(false);
  }

  function commit(): void {
    const parsed = parseNumberInput(text);
    if (parsed === null) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    if (parsed !== value) {
      onCommit(parsed);
    }
  }

  return (
    <TextField
      size="small"
      label={label}
      value={text}
      error={invalid}
      disabled={disabled}
      helperText={invalid ? t("inspector.common.invalidNumber") : " "}
      onFocus={() => setFocused(true)}
      onChange={(event) => setText(event.target.value)}
      onBlur={() => {
        setFocused(false);
        commit();
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          commit();
        } else if (event.key === "Escape") {
          revert();
        }
      }}
      InputProps={{
        endAdornment: unit ? <InputAdornment position="end">{unit}</InputAdornment> : undefined,
      }}
      inputProps={{
        inputMode: "decimal",
        style: { fontVariantNumeric: "tabular-nums" },
        ...inputProps,
      }}
    />
  );
}
