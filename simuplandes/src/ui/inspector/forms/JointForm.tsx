/**
 * Joint Inspector form: name, R/P type chip, world X/Y (moving the whole
 * R-cluster of `siteA`), the slide axis angle for a P joint, an inline
 * `MotorForm` or an "Add motor" button, and (R joints) its torsional
 * springs with an "Add torsional spring" button.
 */

import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  Button,
  Chip,
  List,
  ListItemButton,
  ListItemText,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { NumberField } from "../NumberField";
import { MotorForm } from "./MotorForm";
import {
  jointAxisWorldAngleDeg,
  jointWorldPosition,
  moveSiteClusterRecipes,
  setJointAxisFromWorldAngleRecipe,
} from "../edits";
import { addSpring, defaultMotorDrive, rename } from "../../../store/commands";
import type { Joint, MechanismDocument } from "../../../model";
import type { MechanismStore } from "../../../store";

export interface JointFormProps {
  store: MechanismStore;
  doc: MechanismDocument;
  joint: Joint;
}

/** The stiffness of a new torsional spring, N·m/rad. */
const DEFAULT_TORSIONAL_STIFFNESS = 1;

export function JointForm({ store, doc, joint }: JointFormProps): ReactNode {
  const { t } = useTranslation();
  const world = jointWorldPosition(doc, joint);
  const motor = doc.motors.find((m) => m.jointId === joint.id);
  const torsionalSprings = doc.springs.filter(
    (spring) => spring.kind === "torsional" && spring.jointId === joint.id,
  );

  function addTorsionalSpring(): void {
    const id = store.getState().newId("spring");
    store.getState().execute(
      "inspector-add-torsional-spring",
      addSpring({
        id,
        kind: "torsional",
        jointId: joint.id,
        name: `${t("inspector.spring.titleTorsional")} ${joint.name || ""}`.trim(),
        stiffness: DEFAULT_TORSIONAL_STIFFNESS,
      }),
    );
    store.getState().select([id]);
  }

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
      {joint.type === "R" ? (
        <>
          {torsionalSprings.length > 0 ? (
            <>
              <Typography variant="caption" color="text.secondary">
                {t("inspector.joint.torsionalSprings")}
              </Typography>
              <List dense disablePadding>
                {torsionalSprings.map((spring) => (
                  <ListItemButton
                    key={spring.id}
                    onClick={() => store.getState().select([spring.id])}
                  >
                    <ListItemText primary={spring.name || spring.id} />
                  </ListItemButton>
                ))}
              </List>
            </>
          ) : null}
          <Button size="small" variant="outlined" onClick={addTorsionalSpring}>
            {t("inspector.joint.addTorsionalSpring")}
          </Button>
        </>
      ) : null}
    </Stack>
  );
}
