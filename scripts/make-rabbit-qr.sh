#!/usr/bin/env bash
set -euo pipefail

if [ "${1:-}" = "" ]; then
  echo "Usage: $0 <public_app_url>"
  echo "Example: $0 https://<username>.github.io/pregnancy-photo-tracker/"
  exit 1
fi

PUBLIC_URL="${1%/}/"

python3 - "$PUBLIC_URL" <<'PY'
import json
import sys
from pathlib import Path

public_url = sys.argv[1]
payload = {
    "title": "BumpSnap",
    "url": public_url,
    "description": "Pregnancy photo tracker for rabbit r1",
    "iconUrl": public_url + "icon.png",
    "themeColor": "#FE5000",
}

out = Path("metadata/rabbit-creation-payload.json")
out.parent.mkdir(parents=True, exist_ok=True)
out.write_text(json.dumps(payload, separators=(",", ":")))
print(out)
PY

PAYLOAD_JSON="$(cat metadata/rabbit-creation-payload.json)"

npx --yes qrcode -o metadata/rabbit-r1-creation-install-qr.png -w 1200 "$PAYLOAD_JSON"
npx --yes qrcode -o metadata/rabbit-r1-direct-url-qr.png -w 1200 "$PUBLIC_URL"

echo "Created:"
echo "  metadata/rabbit-creation-payload.json"
echo "  metadata/rabbit-r1-creation-install-qr.png"
echo "  metadata/rabbit-r1-direct-url-qr.png"
