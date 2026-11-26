# RunSync — Smart Treadmill PWA (Lenovo Duet + Roger Black)

A zero-bundler, offline-capable Progressive Web App (PWA) for indoor treadmill running on a **Lenovo Duet** (ChromeOS), built in incremental phases:

1. **Phase 1 (Complete):** Web Bluetooth telemetry (**Zwift RunPod** `0x1814` + **BT HR Chest Strap** `0x180D` or **Garmin FR 245** *Virtual Run*), speed-synced **YouTube POV** (Premium Lite compatible, with `0.25×` hysteresis) & **Local MP4/WebM** (continuous smooth scaling), manual incline logging, optional HR zone bar & 1 km voice splits, Screen Wake Lock, and Garmin/Strava/Intervals.icu **`.FIT` + HRV export** with post-run Roger Black console distance reconciliation.
2. **Phase 2A (Complete):** Offline lightweight **Three.js 3D World** view tuned for Lenovo Duet (`devicePixelRatio <= 1`, `< 15` draw calls via `InstancedMesh`, 3 themes: *Forest Trail*, *Coastal Sunset*, *Synthwave Grid*, dynamic incline road pitch, 500 m milestone arches, toggleable stride bob, and Ghost Pacer).
3. **Phase 2B (Complete):** Real-world **`.gpx` 3D courses** (built-in *Box Hill 5K*, *Rolling Parkrun 5K*, *Alpine Hill Repeats 4K*, plus custom `.gpx` file upload), live **2D SVG elevation profile** with Runner & Ghost Pacer dots, auto-synced route grade, and Web Speech incline callouts.
4. **Phase 3 / 3B (Planned):** Non-invasive **JZK ESP-32S** BLE FTMS (`0x1826`) speed + deck incline bridge (`KY-003`/`KY-033` + `GY-521` IMU) + optional **ESP32-4848S040** console HMI.
5. **Phase 4 (Planned):** Closed-loop speed automation after console PCB & incline rocker multimeter inspection.

---

## Local Desk Testing

Web Bluetooth and ES modules require `http://localhost` or `https://` (never `file://`).

```bash
# From d:\Coding\00_to sort\Treadmill
python -m http.server 8080
# or: npx serve . -l 8080
```

Open `http://localhost:8080/` in Chrome, open **Setup**, and toggle **Desk Simulator** (plus **Auto interval demo loop**) to test YouTube/Local MP4 speed sync, manual incline, HR zones, and `.FIT` export at your desk.

### Run Unit Tests

```bash
node --test tests/telemetry.test.mjs
```

---

## Publish to GitHub Pages (for Lenovo Duet PWA Install)

1. Push this directory to a GitHub repository (e.g., `runsync-treadmill`).
2. In GitHub: **Settings → Pages → Build and deployment → Source: Deploy from a branch** (`main`, `/ (root)`).
3. Open `https://<your-github-username>.github.io/<repo>/` in Chrome on your **Lenovo Duet** and click **Install RunSync** in the address bar to pin it to the ChromeOS shelf.

---

## Treadmill Pairing Checklist (Duet)

1. **BT HR Chest Strap (Primary):** Put strap on dampened, tap **HR** in the top bar (or Setup drawer), and select your strap (`0x180D`).
2. **Zwift RunPod (`0x1814`):** Wake the pod by shaking/tapping it, ensure it isn't auto-connected to your phone, tap **Pod** in the top bar, and select it.
3. **Garmin FR 245 Fallback:** Start the **Virtual Run** activity on the watch (press Start so BLE doesn't time out after 30 minutes) and connect it as Pod and/or HR.
4. **1-Tap Speed Sync:** Set your Roger Black treadmill to a steady cruise (e.g., `9.0 km/h`), open **Setup → Calibration**, type `9.0`, and tap **Sync Speed**.
