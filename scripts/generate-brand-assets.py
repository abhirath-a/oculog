#!/usr/bin/env python3
"""Rasterize the authoritative currentColor wordmark without app/native dependencies.
Requires the preinstalled Chromium/chromedriver; run pi-dev-check before use.
The PNG is an alpha mask: iOS Image.tintColor supplies the live semantic color.
"""
import base64
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import time
import urllib.parse
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
BROWSER = os.environ.get("PI_BROWSER_EXECUTABLE") or os.environ.get("PUPPETEER_EXECUTABLE_PATH")
if not BROWSER:
    raise SystemExit("Set PI_BROWSER_EXECUTABLE to the installed Chromium executable.")

with tempfile.TemporaryDirectory(prefix="oculog-brand-") as temporary:
    log = open(Path(temporary) / "driver.log", "w")
    process = subprocess.Popen(["chromedriver", "--port=0", "--allowed-ips=127.0.0.1"], stdout=log, stderr=log)
    session = None
    port = None
    try:
        for _ in range(100):
            text = (Path(temporary) / "driver.log").read_text()
            match = re.search(r"started successfully on port (\d+)", text)
            if match:
                port = match[1]
                break
            if process.poll() is not None:
                raise RuntimeError("Could not start the isolated brand renderer.")
            time.sleep(.05)
        if not port:
            raise RuntimeError("Brand renderer did not become ready.")
        def call(method, path, value=None):
            request = urllib.request.Request(f"http://127.0.0.1:{port}{path}", method=method, headers={"Content-Type": "application/json"}, data=json.dumps(value).encode() if value is not None else None)
            with urllib.request.urlopen(request, timeout=30) as response:
                return json.load(response)["value"]
        session = call("POST", "/session", {"capabilities": {"alwaysMatch": {"browserName": "chrome", "goog:chromeOptions": {"binary": BROWSER, "args": ["--headless=new", "--no-sandbox", "--disable-dev-shm-usage", f"--user-data-dir={temporary}/profile"]}}}})["sessionId"]
        def rpc(method, path, value=None):
            return call(method, f"/session/{session}{path}", value)
        def cdp(command, params):
            return rpc("POST", "/goog/cdp/execute", {"cmd": command, "params": params})
        cdp("Emulation.setDeviceMetricsOverride", {"width": 1077, "height": 282, "deviceScaleFactor": 1, "mobile": False})
        cdp("Emulation.setDefaultBackgroundColorOverride", {"color": {"r": 0, "g": 0, "b": 0, "a": 0}})
        svg = (ROOT / "assets/logo.svg").read_text()
        html = '<!doctype html><html><head><style>html,body{margin:0;width:100%;height:100%;background:transparent;color:#000}svg{display:block;width:100%;height:100%}</style></head><body>' + svg + '</body></html>'
        rpc("POST", "/url", {"url": "data:text/html;charset=utf-8," + urllib.parse.quote(html)})
        assert rpc("POST", "/execute/sync", {"script": "return document.querySelectorAll('svg path').length", "args": []}) > 0
        screenshot = cdp("Page.captureScreenshot", {"format": "png", "captureBeyondViewport": False})
        target = ROOT / "mobile/src/components/brand/wordmark-mask.png"
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(base64.b64decode(screenshot["data"]))
        print(f"Generated {target.relative_to(ROOT)} (1077 x 282, transparent currentColor mask)")
    finally:
        if session:
            try: call("DELETE", f"/session/{session}")
            except Exception: pass
        process.terminate()
        process.wait(timeout=10)
        log.close()
