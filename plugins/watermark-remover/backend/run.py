"""Start the watermark remover backend.

    python run.py                                   # http://127.0.0.1:8000
    python run.py --reload                          # auto-restart while editing
    python run.py --site-packages /path/to/pkgs     # used by the Node.js wrapper

The Node.js backend wrapper passes --site-packages so that packages installed
via `pip install --target` are importable even on the Windows embeddable
distribution, which ignores PYTHONPATH when a ._pth file is present.
"""
import argparse
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent

# ── Bootstrap: add site-packages to sys.path BEFORE any third-party import ──
# PYTHONPATH is ignored by the Windows embeddable Python when a ._pth file
# exists, so the Node wrapper passes the path explicitly instead.
_bp = argparse.ArgumentParser(add_help=False)
_bp.add_argument("--site-packages", default="")
_bp_args, _ = _bp.parse_known_args()
if _bp_args.site_packages:
    sp = str(Path(_bp_args.site_packages).resolve())
    if sp not in sys.path:
        sys.path.insert(0, sp)

if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))
# ─────────────────────────────────────────────────────────────────────────────

import uvicorn  # noqa: E402  (import after sys.path is prepared)
import webbrowser  # noqa: E402

if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="Watermark Remover backend")
    ap.add_argument("--host", default="127.0.0.1", help="bind address")
    ap.add_argument("--port", type=int, default=8000, help="bind port")
    ap.add_argument("--reload", action="store_true", help="reload on code changes")
    ap.add_argument("--open", action="store_true", help="open the app in a browser")
    ap.add_argument("--site-packages", default="", help="extra site-packages dir (passed by Node wrapper)")
    args = ap.parse_args()

    url = f"http://{args.host}:{args.port}"
    if not (HERE.parent / "frontend" / "dist" / "index.html").exists():
        print("Note: the interface has not been built yet.")
        print("      Run 'npm install && npm run build' in the frontend folder,")
        print("      or 'npm run dev' there for the live-reloading dev server.\n")
    if args.open:
        webbrowser.open(url)

    print(f"Watermark Remover -> {url}\n")
    uvicorn.run("app.main:app", host=args.host, port=args.port,
                reload=args.reload, reload_dirs=[str(HERE)] if args.reload else None)
