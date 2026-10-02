/**
 * Ambient module declaration for `@mui/icons-material`'s `esm/` subpath
 * imports (e.g. `@mui/icons-material/esm/Undo`). The package ships `.d.ts`
 * files only for its ROOT subpaths (`@mui/icons-material/Undo`), not for
 * the `esm/` mirror -- importing from `esm/` is a deliberate workaround
 * (see `src/ui/shell/TopBar.tsx`'s TSDoc) for a real-browser-only CJS/ESM
 * interop crash under this project's Vite 8 + `@mui/icons-material` 5.18
 * combination. Every icon under `esm/` has the same shape as its root
 * counterpart: a `ComponentType<SvgIconProps>` default export.
 */
declare module "@mui/icons-material/esm/*" {
  import type { ComponentType } from "react";
  import type { SvgIconProps } from "@mui/material/SvgIcon";
  const Icon: ComponentType<SvgIconProps>;
  export default Icon;
}
