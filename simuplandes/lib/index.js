// Barrel for host sites: `dist/` is produced by `npm run build:lib` (run from
// the parent folder). Everything but React is bundled, so this package needs
// no install of its own.
import "./dist/simuplandes.css";

export { SimuplandesStudio } from "./dist/simuplandes.js";
