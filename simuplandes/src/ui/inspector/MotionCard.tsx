/**
 * The Inspector's "Motion" card, shown in Simulate when nothing is selected:
 * how the input is driven, and how each link and coupler curve moves over
 * the whole sweep (see `sim/motionSummary.ts`). It reads only the sweep data,
 * published once per session, so it never re-renders per frame.
 */

import { useMemo, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { useStore } from "zustand";
import { Box, Chip, Divider, Stack, Typography } from "@mui/material";
import { createSimStore, type SimStore } from "../../sim/simStore";
import { summarizeMotion, type LinkMotion } from "../../sim/motionSummary";
import { inputDisplayValue } from "../../sim/session";
import { formatNumber, type Language } from "../../i18n/numberFormat";

export interface MotionCardProps {
  simStore?: SimStore;
  lengthUnit: string;
}

/** A stable fallback so `useStore` always gets a real store when `simStore` is omitted. */
const EMPTY_SIM_STORE: SimStore = createSimStore();

/**
 * Default ids read as names: "link-3" -> "Eslabón 3" (ground is link-0, so
 * links keep their number, as in the graph panel), "motor-0" -> "Motor 1",
 * "marker-0" -> "Marcador 1". Any other (user-given) name is shown as is.
 */
function friendlyLabel(label: string, t: TFunction): string {
  const match = /^(link|motor|marker)-(\d+)$/.exec(label);
  if (!match) return label;
  const n = Number(match[2]);
  if (match[1] === "link") return t("inspector.motion.linkN", { n });
  return t(`inspector.motion.${match[1]}N`, { n: n + 1 });
}

export function MotionCard({ simStore, lengthUnit }: MotionCardProps): ReactNode {
  const { t, i18n } = useTranslation();
  const lang = i18n.language as Language;
  const store = simStore ?? EMPTY_SIM_STORE;
  const session = useStore(store, (s) => s.session);
  const range = useStore(store, (s) => s.range);
  const sweepTable = useStore(store, (s) => s.sweepTable);
  const summary = useMemo(() => summarizeMotion(sweepTable), [sweepTable]);

  if (!simStore || !session || session.status !== "ready" || !range || !sweepTable) return null;

  const isLinear = session.inputKind === "linear";
  const unit = isLinear ? ` ${lengthUnit}` : "°";
  const deg = (value: number): string => `${formatNumber(value, lang, 1)}°`;

  const inputText = range.fullRotation
    ? t("inspector.motion.inputFullTurn")
    : t("inspector.motion.inputBetween", {
        min: `${formatNumber(inputDisplayValue(session, range, range.min), lang, 1)}${unit}`,
        max: `${formatNumber(inputDisplayValue(session, range, range.max), lang, 1)}${unit}`,
      });

  function motionChip(motion: LinkMotion): ReactNode {
    if (motion.kind === "rotates") {
      return (
        <Chip
          size="small"
          color="success"
          variant="outlined"
          label={t("inspector.motion.rotates", { count: motion.turns })}
        />
      );
    }
    if (motion.kind === "translates") {
      return <Chip size="small" variant="outlined" label={t("inspector.motion.translates")} />;
    }
    return (
      <Chip
        size="small"
        variant="outlined"
        label={t("inspector.motion.oscillates", { span: deg(motion.maxDeg - motion.minDeg) })}
        title={t("inspector.motion.oscillatesRange", {
          min: deg(motion.minDeg),
          max: deg(motion.maxDeg),
        })}
      />
    );
  }

  return (
    <Box data-testid="motion-card">
      <Divider sx={{ my: 2 }} />
      <Typography variant="subtitle2" component="h2" sx={{ fontWeight: 700 }}>
        {t("inspector.motion.title")}
      </Typography>
      <Typography variant="caption" color="text.secondary" component="p" sx={{ mb: 1.5 }}>
        {t("inspector.motion.hint")}
      </Typography>

      <Stack spacing={1}>
        <Row label={friendlyLabel(session.inputLabel, t) || t("inspector.motion.input")}>
          <Typography variant="body2">{inputText}</Typography>
        </Row>
        {summary.links.map((link) => (
          <Row key={link.linkId} label={friendlyLabel(link.label, t)}>
            {motionChip(link.motion)}
          </Row>
        ))}
        {summary.markers.map((marker) => (
          <Row
            key={marker.markerId}
            label={friendlyLabel(marker.label, t) || t("inspector.motion.marker")}
          >
            <Typography variant="body2" color="text.secondary">
              {t("inspector.motion.curveSize", {
                width: formatNumber(marker.width, lang, 1),
                height: formatNumber(marker.height, lang, 1),
                unit: lengthUnit,
              })}
            </Typography>
          </Row>
        ))}
      </Stack>
    </Box>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }): ReactNode {
  return (
    <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1}>
      <Typography variant="body2" noWrap title={label} sx={{ minWidth: 0 }}>
        {label}
      </Typography>
      <Box sx={{ flexShrink: 0 }}>{children}</Box>
    </Stack>
  );
}
