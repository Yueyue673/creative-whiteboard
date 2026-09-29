"""Keep application files and personal workspace data separate."""
import os
from pathlib import Path
APP_ROOT = Path(__file__).resolve().parent
DATA_ROOT = Path(os.environ.get("CREATIVE_BOARD_DATA_DIR", str(APP_ROOT / "data"))).expanduser().resolve()
