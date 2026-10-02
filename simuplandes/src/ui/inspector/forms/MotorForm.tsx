/**
 * Motor Inspector form: name, constant/expression mode toggle, speed (°/s
 * for a rotary motor, `{unit}/s` for a linear one) or a non-empty expression
 * text field. Rendered inline by `JointForm`, or standalone when a motor id
 * is selected directly.
 */

import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Stack, TextField, ToggleButton, ToggleButtonGroup, Typography } from "@mui/material";
import { NumberField } from "../NumberField";
import { motorSpeedDisplay, motorSpeedFromDisplay } from "../edits";
import { defaultMotorDrive, rename, setMotorDrive } from "../../../store/commands";
import type { MechanismDocument, Motor } from "../../../model";
import type { MechanismStore } from "../../../store";

export interface MotorFormProps {
  store: MechanismStore;
  doc: MechanismDocument;
  motor: Motor;
}

export function MotorForm({ store, doc, motor }: MotorFormProps): ReactNode {
  const { t } = useTranslation();
  const [expressionText, setExpressionText] = useState(
    motor.drive.mode === "expression" ? motor.drive.expression : "t",
  );
  const [expressionInvalid, setExpressionInvalid] = useState(false);

  function commitName(name: string): void {
    if (name !== motor.name) {
      store.getState().execute("inspector-motor-name", rename(motor.id, name));
    }
  }

  function switchMode(mode: "constant" | "expression"): void {
    if (mode === motor.drive.mode) return;
    if (mode === "expression") {
      const expression = expressionText.length > 0 ? expressionText : "t";
      setExpressionText(expression);
      setExpressionInvalid(false);
      store
        .getState()
        .execute(
          "inspector-motor-drive",
          setMotorDrive(motor.id, { mode: "expression", expression }),
        );
    } else {
      const drive = defaultMotorDrive(motor.kind);
      const speed = drive.mode === "constant" ? drive.speed : 0;
      store
        .getState()
        .execute("inspector-motor-drive", setMotorDrive(motor.id, { mode: "constant", speed }));
    }
  }

  function commitSpeed(displayValue: number): void {
    const speed = motorSpeedFromDisplay(motor.kind, displayValue);
    store
      .getState()
      .execute("inspector-motor-drive", setMotorDrive(motor.id, { mode: "constant", speed }));
  }

  function commitExpression(): void {
    if (expressionText.length === 0) {
      setExpressionInvalid(true);
      return;
    }
    setExpressionInvalid(false);
    if (motor.drive.mode !== "expression" || motor.drive.expression !== expressionText) {
      store
        .getState()
        .execute(
          "inspector-motor-drive",
          setMotorDrive(motor.id, { mode: "expression", expression: expressionText }),
        );
    }
  }

  const speedUnit = motor.kind === "rotary" ? "°/s" : `${doc.units.length}/s`;

  return (
    <Stack spacing={1.5}>
      <Typography variant="subtitle2">{t("inspector.motor.title")}</Typography>
      <TextField
        size="small"
        label={t("inspector.common.name")}
        defaultValue={motor.name}
        key={`${motor.id}-${motor.name}`}
        onBlur={(event) => commitName(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") commitName((event.target as HTMLInputElement).value);
        }}
      />
      <ToggleButtonGroup
        size="small"
        exclusive
        value={motor.drive.mode}
        onChange={(_event, value: "constant" | "expression" | null) => {
          if (value !== null) switchMode(value);
        }}
      >
        <ToggleButton value="constant">{t("inspector.motor.modeConstant")}</ToggleButton>
        <ToggleButton value="expression">{t("inspector.motor.modeExpression")}</ToggleButton>
      </ToggleButtonGroup>
      {motor.drive.mode === "constant" ? (
        <NumberField
          label={t("inspector.motor.speed")}
          unit={speedUnit}
          value={motorSpeedDisplay(motor.kind, motor.drive.speed)}
          onCommit={commitSpeed}
        />
      ) : (
        <TextField
          size="small"
          label={t("inspector.motor.expression")}
          placeholder={t("inspector.motor.expressionPlaceholder")}
          value={expressionText}
          error={expressionInvalid}
          helperText={expressionInvalid ? t("inspector.motor.expressionRequired") : " "}
          onChange={(event) => {
            setExpressionText(event.target.value);
            setExpressionInvalid(false);
          }}
          onBlur={commitExpression}
          onKeyDown={(event) => {
            if (event.key === "Enter") commitExpression();
          }}
        />
      )}
    </Stack>
  );
}
