/**
 * Motor Inspector form: name, constant/expression mode toggle, speed (°/s
 * for a rotary motor, `{unit}/s` for a linear one) or a non-empty expression
 * text field. Rendered inline by `JointForm`, or standalone when a motor id
 * is selected directly. A second toggle sets what the motor does in
 * dynamics: follow that motion, or apply a torque/force expression.
 */

import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Stack, TextField, ToggleButton, ToggleButtonGroup, Typography } from "@mui/material";
import { NumberField } from "../NumberField";
import { motorSpeedDisplay, motorSpeedFromDisplay } from "../edits";
import {
  defaultMotorDrive,
  rename,
  setMotorDrive,
  setMotorDynamics,
} from "../../../store/commands";
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
  const [effortText, setEffortText] = useState(
    motor.dynamics.mode === "effort" ? motor.dynamics.expression : "0",
  );
  const [effortInvalid, setEffortInvalid] = useState(false);
  const rotary = motor.kind === "rotary";

  function switchDynamics(mode: "motion" | "effort"): void {
    if (mode === motor.dynamics.mode) return;
    const expression = effortText.trim().length > 0 ? effortText : "0";
    setEffortText(expression);
    setEffortInvalid(false);
    store
      .getState()
      .execute(
        "inspector-motor-dynamics",
        setMotorDynamics(motor.id, mode === "motion" ? { mode } : { mode, expression }),
      );
  }

  function commitEffort(): void {
    if (effortText.trim().length === 0) {
      setEffortInvalid(true);
      return;
    }
    setEffortInvalid(false);
    if (motor.dynamics.mode === "effort" && motor.dynamics.expression === effortText) return;
    store
      .getState()
      .execute(
        "inspector-motor-dynamics",
        setMotorDynamics(motor.id, { mode: "effort", expression: effortText }),
      );
  }

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
      <Typography variant="caption" color="text.secondary">
        {t("inspector.motor.dynamics")}
      </Typography>
      <ToggleButtonGroup
        size="small"
        exclusive
        value={motor.dynamics.mode}
        aria-label={t("inspector.motor.dynamics")}
        onChange={(_event, value: "motion" | "effort" | null) => {
          if (value !== null) switchDynamics(value);
        }}
      >
        <ToggleButton value="motion">{t("inspector.motor.dynamicsMotion")}</ToggleButton>
        <ToggleButton value="effort">
          {rotary
            ? t("inspector.motor.dynamicsEffortRotary")
            : t("inspector.motor.dynamicsEffortLinear")}
        </ToggleButton>
      </ToggleButtonGroup>
      {motor.dynamics.mode === "effort" ? (
        <TextField
          size="small"
          label={`${rotary ? t("inspector.motor.effortRotary") : t("inspector.motor.effortLinear")} [${rotary ? "N·m" : "N"}]`}
          value={effortText}
          error={effortInvalid}
          helperText={
            effortInvalid
              ? t("inspector.motor.expressionRequired")
              : t("inspector.motor.effortHelp")
          }
          onChange={(event) => {
            setEffortText(event.target.value);
            setEffortInvalid(false);
          }}
          onBlur={commitEffort}
          onKeyDown={(event) => {
            if (event.key === "Enter") commitEffort();
          }}
        />
      ) : null}
    </Stack>
  );
}
