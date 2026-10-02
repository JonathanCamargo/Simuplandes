/**
 * Joint Inspector form: name, R/P type chip, world X/Y (moving the whole
 * R-cluster of `siteA`), the slide axis angle for a P joint, and an inline
 * `MotorForm` or an "Add motor" button.
 */

import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button, Chip, Stack, TextField, Typography } from "@mui/material";
import { NumberField } from "../NumberField";
import { MotorForm } from "./MotorForm";
import {
  jointAxisWorldAngleDeg,
  jointWorldPosition,
  moveSiteClusterRecipes,
  setJointAxisFromWorldAngleRecipe,
} from "../edits";
import { defaultMotorDrive, rename } from "../../../store/commands";
import type { Joint, MechanismDocument } from "../../../model";
import type { MechanismStore } from "../../../store";

export interface JointFormProps {
  store: MechanismStore;
  doc: MechanismDocument;
  joint: Joint;
}

export function JointForm({ store, doc, joint }: JointFormProps): ReactNode {
  const { t } = useTranslation();
  const world = jointWorldPosition(doc, joint);
  const motor = doc.motors.find((m) => m.jointId === joint.id);

  function commitName(name: string): void {
    if (name !== joint.name) {
      store.getState().execute("inspector-joint-name", rename(joint.id, name));
    }
  }

  function commitWorld(edit: { x?: number; y?: number }): void {
    const next = { x: edit.x ?? world.x, y: edit.y ?? world.y };
    store
      .getState()
      .execute("inspector-joint-move", moveSiteClusterRecipes(doc, joint.siteA, next));
  }

  function commitAxis(angleDeg: number): void {
    if (joint.type !== "P") return;
    store
      .getState()
      .execute("inspector-joint-axis", setJointAxisFromWorldAngleRecipe(doc, joint, angleDeg));
  }

  function addMotor(): void {
    const kind = joint.type === "R" ? "rotary" : "linear";
    store.getState().addMotor({ jointId: joint.id, kind, drive: defaultMotorDrive(kind) });
  }

  return (
    <Stack spacing={2}>
      <Typography variant="subtitle2">{t("inspector.joint.title")}</Typography>
      <TextField
        size="small"
        label={t("inspector.common.name")}
        defaultValue={joint.name}
        key={`${joint.id}-${joint.name}`}
        onBlur={(event) => commitName(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") commitName((event.target as HTMLInputElement).value);
        }}
      />
      <Chip
        size="small"
        label={joint.type === "R" ? t("inspector.joint.typeR") : t("inspector.joint.typeP")}
      />
      <NumberField
        label={t("inspector.common.x")}
        value={world.x}
        onCommit={(v) => commitWorld({ x: v })}
      />
      <NumberField
        label={t("inspector.common.y")}
        value={world.y}
        onCommit={(v) => commitWorld({ y: v })}
      />
      {joint.type === "P" ? (
        <NumberField
          label={t("inspector.joint.axis")}
          unit="°"
          value={jointAxisWorldAngleDeg(doc, joint)}
          onCommit={commitAxis}
        />
      ) : null}
      {motor ? (
        <MotorForm key={motor.id} store={store} doc={doc} motor={motor} />
      ) : (
        <Button size="small" variant="outlined" onClick={addMotor}>
          {t("inspector.joint.addMotor")}
        </Button>
      )}
    </Stack>
  );
}
