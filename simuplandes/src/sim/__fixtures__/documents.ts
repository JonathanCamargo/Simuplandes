/**
 * Test-only re-export of two `src/kinematics/__fixtures__` documents for
 * `src/ui` component tests (`DofBadge.test.tsx`). `src/sim` is the only
 * place outside `src/kinematics` itself allowed to import `src/kinematics`
 * (this plan's own seam, from 05-01) -- this file is that one narrow
 * pass-through, so a UI test can reach a real assembled `MechanismDocument`
 * fixture without a deep `src/kinematics/**` import of its own (which the
 * seam's ESLint rule blocks from `src/ui`, test files included).
 *
 * Excluded from coverage by the existing `src/**\/__fixtures__/**` glob
 * (`vite.config.ts`).
 */

export { build as buildDoubleParallelogram } from "../../kinematics/__fixtures__/doubleParallelogram";
export { build as buildFourBarFixture } from "../../kinematics/__fixtures__/fourBar";
