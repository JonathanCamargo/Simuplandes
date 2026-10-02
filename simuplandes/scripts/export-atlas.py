"""One-time OFFLINE exporter: dms.mechanisms.atlas.TopologyAtlas -> src/graph/atlas/*.json.

The topology atlas (6-bar Watt/Stephenson, 16 eight-bar chains, ~230 ten-bar
chains) lives in the sibling **dms** repository
(`dms.mechanisms.atlas.TopologyAtlas`, MIT), NOT in GraphThe. This script is
the only place Simuplandes ever imports `dms`. It is never run at build time
or at app runtime -- `npm run check`/`npm run build` never invoke it. Run it
by hand, once, whenever the bundled atlas needs to be regenerated, then
commit the resulting JSON.

10-bar is deliberately NOT supported here: dms's 10-bar enumeration calls
`networkx.random_degree_sequence_graph(..., seed=None)`, which is genuinely
non-deterministic and observed to take 18+ minutes per run. Freezing a
10-bar atlas is the separate, optional plan 06-07 -- passing `--sizes 10`
to this script is rejected with a message pointing there.

Usage (from `simuplandes/`):
    python scripts/export-atlas.py
    python scripts/export-atlas.py --sizes 6 8 --out src/graph/atlas
"""

from __future__ import annotations

import argparse
import importlib.metadata
import json
import os
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
SIMUPLANDES_DIR = SCRIPT_DIR.parent
DEFAULT_OUT = SIMUPLANDES_DIR / "src" / "graph" / "atlas"

SUPPORTED_SIZES = (6, 8)

FILE_NAMES = {6: "sixbar.json", 8: "eightbar.json"}

SIX_BAR_NAMES = {"T6B_W": "watt", "T6B_S": "stephenson"}


def _import_dms():
    """Import `dms.mechanisms.TopologyAtlas`, retrying with a sys.path hack.

    In most workstation setups `dms` is already importable (installed
    editable, or already on PYTHONPATH). If not, fall back to inserting the
    sibling repo's `src/` directory, controlled by the `DMS_SRC` env var.
    """
    try:
        from dms.mechanisms import TopologyAtlas  # noqa: F401

        import dms as dms_module
        import networkx as nx

        return TopologyAtlas, dms_module, nx
    except ImportError:
        dms_src = os.environ.get("DMS_SRC", r"C:\git\dynamics_of_mechanical_systems\src")
        if dms_src not in sys.path:
            sys.path.insert(0, dms_src)
        try:
            from dms.mechanisms import TopologyAtlas  # noqa: F401

            import dms as dms_module
            import networkx as nx

            return TopologyAtlas, dms_module, nx
        except ImportError as exc:
            raise ImportError(
                "Could not import `dms.mechanisms.TopologyAtlas`. Set the DMS_SRC "
                "environment variable to the dms repo's `src` directory "
                "(default: C:\\git\\dynamics_of_mechanical_systems\\src), or install "
                "`dms` into this interpreter's environment."
            ) from exc


def _dms_version(dms_module) -> str:
    version = getattr(dms_module, "__version__", None)
    if version:
        return str(version)
    try:
        return importlib.metadata.version("dms")
    except importlib.metadata.PackageNotFoundError:
        return "unknown"


def _export_size(TopologyAtlas, nx, dms_module, n_links: int) -> dict:
    atlas = TopologyAtlas(n_links=n_links, validate=True)

    topologies = []
    for tid in sorted(atlas.topologies.keys()):
        graph = atlas.topologies[tid]
        edges = sorted(tuple(sorted((int(u), int(v)))) for u, v in graph.edges())
        assortment = list(atlas.get_class(tid))
        name = SIX_BAR_NAMES.get(tid) if n_links == 6 else None
        topologies.append(
            {
                "id": tid,
                "name": name,
                "assortment": assortment,
                "edges": [list(edge) for edge in edges],
            }
        )

    return {
        "format": "simuplandes-topology-atlas",
        "version": 1,
        "nLinks": n_links,
        "source": "dms.mechanisms.atlas.TopologyAtlas",
        "dmsVersion": _dms_version(dms_module),
        "networkxVersion": nx.__version__,
        "idScheme": "dms topology_id, verbatim",
        "topologies": topologies,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--sizes",
        type=int,
        nargs="+",
        default=list(SUPPORTED_SIZES),
        help="Atlas sizes to export (choices: 6, 8). Default: both.",
    )
    parser.add_argument(
        "--out",
        type=Path,
        default=DEFAULT_OUT,
        help=f"Output directory (default: {DEFAULT_OUT}).",
    )
    args = parser.parse_args()

    for size in args.sizes:
        if size == 10:
            parser.error(
                "--sizes 10 is not supported here: dms's 10-bar enumeration is "
                "random and slow (see plan 06-07). This script only exports the "
                "deterministic 6-bar and 8-bar atlases."
            )
        if size not in SUPPORTED_SIZES:
            parser.error(f"--sizes must be one of {SUPPORTED_SIZES}, got {size}")

    TopologyAtlas, dms_module, nx = _import_dms()

    out_dir: Path = args.out
    out_dir.mkdir(parents=True, exist_ok=True)

    for size in args.sizes:
        obj = _export_size(TopologyAtlas, nx, dms_module, size)
        out_path = out_dir / FILE_NAMES[size]
        out_path.write_text(json.dumps(obj, indent=2) + "\n", encoding="utf-8", newline="\n")
        print(f"Wrote {out_path} ({len(obj['topologies'])} topologies)")


if __name__ == "__main__":
    main()
