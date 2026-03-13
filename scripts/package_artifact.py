from pathlib import Path
import zipfile

root = Path(__file__).resolve().parents[1]
out = root.parent / 'xrpl-credit-orchestrator-starter.zip'
with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as zf:
    for path in root.rglob('*'):
        if path.is_file():
            zf.write(path, path.relative_to(root.parent))
print(out)
