/**
 * Public API of the GraphThe interchange module (08-01): the v1 export
 * envelope's schema/reader and the pure exporter. `importGraphthe` is
 * exported once `importGraphthe.ts` lands (08-01 Task 2).
 */

export {
  GRAPHTHE_FILE_SUFFIX,
  GRAPHTHE_FORMAT,
  GRAPHTHE_VERSION,
  GraphtheEdgeSchema,
  GraphtheExportSchema,
  GraphtheGraphSchema,
  GraphtheMarkerSchema,
  GraphtheNodeSchema,
  parseGraphtheText,
  type GraphtheEdge,
  type GraphtheExport,
  type GraphtheGraph,
  type GraphtheMarker,
  type GraphtheNode,
} from "./graphtheSchema";

export {
  SIMUPLANDES_VERSION,
  exportGraphthe,
  serializeGraphthe,
  type ExportNote,
  type GraphtheExportResult,
} from "./graphthe";

export { importGraphthe, type ImportGraphtheOptions } from "./importGraphthe";

export {
  IMPORT_LIMITS,
  readGraph,
  type ReadEdge,
  type ReadGraph,
  type ReadMarker,
  type ReadNode,
} from "./readGraph";

export {
  DEFAULT_IMPORT_OPTIONS,
  MOBILITY_TARGET_DEG,
  edgeKey,
  makeItem,
  type ImportCode,
  type ImportDeps,
  type ImportFix,
  type ImportOptions,
  type ImportReportItem,
  type ImportSeverity,
  type LayoutControl,
  type LayoutEdge,
  type LayoutRequest,
  type LayoutResult,
  type MobilityVerdict,
} from "./importReport";

export {
  buildStudioDocument,
  buildStudioDocumentDetailed,
  convexHull,
  type StudioBuildEdge,
  type StudioBuildInput,
} from "./buildDocument";

export { planImport, type ImportPlan } from "./planImport";

export {
  findMultiJointGroups,
  planStarSplit,
  MULTI_JOINT_TOLERANCE_SCALE,
  type MultiJointGroup,
  type StarEdge,
  type StarSplitPlan,
} from "./multiJoint";

export {
  buildExportReport,
  type ExportReport,
  type ReportCode,
  type ReportItem,
  type ReportSeverity,
} from "./validate";
