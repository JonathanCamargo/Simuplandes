/**
 * The Inspector panel: resolves the current selection to an
 * `InspectorTarget` (`edits.ts`) and renders the matching per-entity form.
 * The export name and `{ store }` prop stay stable so `RightDock` doesn't
 * change.
 */

import type { ReactNode } from "react";
import { useStore } from "zustand";
import { Box } from "@mui/material";
import { resolveInspectorTarget } from "./edits";
import { DocumentForm } from "./forms/DocumentForm";
import { LinkForm } from "./forms/LinkForm";
import { JointForm } from "./forms/JointForm";
import { SiteForm } from "./forms/SiteForm";
import { MotorForm } from "./forms/MotorForm";
import { MarkerForm } from "./forms/MarkerForm";
import { MultiSelectionForm } from "./forms/MultiSelectionForm";
import type { MechanismStore } from "../../store";

export function InspectorPanel({ store }: { store: MechanismStore }): ReactNode {
  const doc = useStore(store, (s) => s.document);
  const selection = useStore(store, (s) => s.selection);
  const target = resolveInspectorTarget(doc, selection);

  return (
    <Box sx={{ p: 2 }}>
      {target.kind === "document" ? <DocumentForm store={store} doc={doc} /> : null}
      {target.kind === "multi" ? <MultiSelectionForm store={store} count={target.count} /> : null}
      {target.kind === "link" ? (
        <LinkForm key={target.link.id} store={store} doc={doc} link={target.link} />
      ) : null}
      {target.kind === "joint" ? (
        <JointForm key={target.joint.id} store={store} doc={doc} joint={target.joint} />
      ) : null}
      {target.kind === "site" ? (
        <SiteForm
          key={target.site.id}
          store={store}
          doc={doc}
          site={target.site}
          link={target.link}
        />
      ) : null}
      {target.kind === "motor" ? (
        <MotorForm key={target.motor.id} store={store} doc={doc} motor={target.motor} />
      ) : null}
      {target.kind === "marker" ? (
        <MarkerForm key={target.marker.id} store={store} doc={doc} marker={target.marker} />
      ) : null}
    </Box>
  );
}
