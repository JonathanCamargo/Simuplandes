/**
 * `ChecksStrip`: `n`, `j`, `F = 3(n-1) - 2j`, Baranov pass/fail/skipped, link
 * assortment and the chain name / atlas id (GRF-03/GRF-04) as a wrapping
 * `Stack` of MUI `Chip`s. Pure presentation over one `GraphAnalysis` -- no
 * store reads of its own.
 */

import { Chip, Stack, Tooltip, type ChipProps } from "@mui/material";
import { useTranslation } from "react-i18next";
import type { ReactNode } from "react";
import type { GraphAnalysis } from "../../graph";

export interface ChecksStripProps {
  analysis: GraphAnalysis;
}

type MobilitySeverity = "ok" | "warn" | "error" | "neutral";

function mobilitySeverity(gruebler: number | null): MobilitySeverity {
  if (gruebler === null) return "neutral";
  if (gruebler === 1) return "ok";
  if (gruebler >= 2) return "warn";
  return "error";
}

const SEVERITY_COLOR: Record<MobilitySeverity, ChipProps["color"]> = {
  ok: "success",
  warn: "warning",
  error: "error",
  neutral: "default",
};

export function ChecksStrip({ analysis }: ChecksStripProps): ReactNode {
  const { t } = useTranslation();
  const { mobility, baranov, assortment, topology, graph } = analysis;

  const severity = mobilitySeverity(mobility.gruebler);
  const formula =
    mobility.gruebler === null
      ? t("graph.checks.formulaEmpty")
      : t("graph.checks.formula", { n: mobility.n, j: mobility.j, f: mobility.gruebler });
  const mobilityLabel = [
    t("graph.checks.n", { n: mobility.n }),
    t("graph.checks.j", { j: mobility.j }),
    formula,
  ].join(" · ");

  let baranovLabel: string;
  let baranovTitle: string | undefined;
  if (baranov.status === "pass") {
    baranovLabel = t("graph.checks.baranov.pass");
  } else if (baranov.status === "skipped") {
    baranovLabel = t("graph.checks.baranov.skipped");
  } else {
    const links = baranov.nodeIds.map((id) => graph.nodeById.get(id)?.label || id).join(", ");
    baranovLabel = t("graph.checks.baranov.fail", { links });
    baranovTitle = t("graph.checks.baranov.explain");
  }

  const assortmentParts: string[] = [];
  if (assortment.n2 > 0)
    assortmentParts.push(t("graph.checks.assortment.n2", { count: assortment.n2 }));
  if (assortment.n3 > 0)
    assortmentParts.push(t("graph.checks.assortment.n3", { count: assortment.n3 }));
  if (assortment.n4 > 0)
    assortmentParts.push(t("graph.checks.assortment.n4", { count: assortment.n4 }));
  if (assortment.n5 > 0)
    assortmentParts.push(t("graph.checks.assortment.n5", { count: assortment.n5 }));
  const assortmentLabel = assortmentParts.join(" · ");

  let topologyId: string;
  let topologyLabel: string;
  let topologyTitle: string | undefined;
  switch (topology.kind) {
    case "fourBar":
      topologyId = "four-bar";
      topologyLabel = t("graph.topology.fourBar");
      break;
    case "atlas":
      topologyId = topology.id;
      if (topology.name === "watt") topologyLabel = t("graph.topology.watt");
      else if (topology.name === "stephenson") topologyLabel = t("graph.topology.stephenson");
      else topologyLabel = t("graph.topology.atlas", { nLinks: topology.nLinks, id: topology.id });
      break;
    case "none":
      topologyId = "none";
      topologyLabel = t("graph.topology.none");
      topologyTitle = t(`graph.topology.reason.${topology.reason}`);
      break;
  }

  const groundLoopWarnings = graph.warnings.filter((w) => w.kind === "groundLoop");

  return (
    <Stack
      data-testid="graph-checks"
      direction="row"
      spacing={1}
      useFlexGap
      flexWrap="wrap"
      sx={{ p: 1 }}
    >
      <Chip
        data-testid="graph-check-mobility"
        data-severity={severity}
        color={SEVERITY_COLOR[severity]}
        label={mobilityLabel}
      />
      <Tooltip title={baranovTitle ?? ""} disableHoverListener={!baranovTitle}>
        <Chip
          data-testid="graph-check-baranov"
          data-status={baranov.status}
          color={
            baranov.status === "pass" ? "success" : baranov.status === "fail" ? "error" : "default"
          }
          label={baranovLabel}
        />
      </Tooltip>
      {assortmentLabel ? (
        <Chip data-testid="graph-check-assortment" label={assortmentLabel} />
      ) : null}
      <Tooltip title={topologyTitle ?? ""} disableHoverListener={!topologyTitle}>
        <Chip
          data-testid="graph-check-topology"
          data-topology-id={topologyId}
          label={topologyLabel}
        />
      </Tooltip>
      {groundLoopWarnings.length > 0 ? (
        <Chip
          data-testid="graph-check-warnings"
          color="warning"
          label={groundLoopWarnings
            .map((w) => t("graph.warnings.groundLoop", { name: w.jointId }))
            .join(", ")}
        />
      ) : null}
    </Stack>
  );
}
