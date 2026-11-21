"""Complete the city match in resumable, memory-bounded worker segments.

python3 tools/record_city.py ENGINE_DIR RUSH_AI_DIR [seed]
Each worker does new simulation work, saves its checkpoint and exits; completed
ticks are not repeated. This also tolerates short process limits on build hosts.
"""
import json
import os
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
engine, rush = sys.argv[1:3]
seed = sys.argv[3] if len(sys.argv) > 3 else "8"
graph = json.loads((ROOT / "data/map.json").read_text())
def progress_file():
    files = sorted((ROOT / '.cache').glob(f'match-{seed}-{graph["sha256"][:12]}-*.pickle.json'), key=lambda p: p.stat().st_mtime)
    return files[-1] if files else None
segment = 10
for _ in range(250):
    slot = progress_file()
    before = json.loads(slot.read_text())["tick"] if slot else -1
    result = subprocess.run([sys.executable, str(ROOT / "tools/simulate_match.py"), engine, rush, str(ROOT / "data"), seed],
                            cwd=ROOT, env={**os.environ, "SIM_RUN_TICKS": str(segment)})
    slot = progress_file()
    after = json.loads(slot.read_text())["tick"] if slot else -1
    if result.returncode and after <= before:
        if segment > 3:
            segment = 3
            continue
        raise SystemExit(f"Recording worker stopped without progress (exit {result.returncode})")
    manifest = ROOT / "data/recording.json"
    if manifest.exists() and (recorded := json.loads(manifest.read_text()))["mapHash"] == graph["sha256"] and recorded["seed"] == int(seed):
        print("City recording complete.", flush=True)
        break
else:
    raise SystemExit("Recording did not complete within the segment limit")
