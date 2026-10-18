import os
import urllib.request

host = os.environ["CREATIVE_BOARD_HOSTED_HOSTS"].split(",")[0].strip()
request = urllib.request.Request("http://127.0.0.1:8000/api/health", headers={"Host": host, "X-Forwarded-Proto": "https"})
with urllib.request.urlopen(request, timeout=3) as response:
    if response.status != 200 or b'"creative-whiteboard-hosted"' not in response.read(4096):
        raise SystemExit(1)
