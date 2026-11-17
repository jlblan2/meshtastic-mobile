# Meshtastic Mobile

A phone version of the Meshtastic GUI PC program: a web app (PWA) that talks to a
Meshtastic radio over Bluetooth from an Android phone or an iPhone.

- **Radio** – connect / disconnect, radio summary, battery
- **Messages** – channel and direct messages with delivery status
- **Nodes** – the radio's node list: last heard, signal, hops, distance (miles), battery
- **Map** – node positions on Esri street tiles
- **Settings** – owner name, role, Bluetooth PIN, LoRa (with the same regional rules as
  the PC program), channels and keys, network / WiFi, MQTT, settings backup and restore,
  restart, log

Firmware updates and full-flash backups are not possible from a phone browser; use the
PC program for those. Settings backups use the same file format as the PC program, so a
backup made on one can be restored with the other.

## Which browser

| Phone | Use |
|-------|-----|
| Android | **Chrome** (or Edge). Menu > *Add to Home screen* installs it like an app. |
| iPhone / iPad | **Bluefy – Web BLE Browser** (free, App Store). Safari and Chrome on iOS do not allow web pages to use Bluetooth at all, so the app cannot connect from them. |
| PC | Chrome or Edge, for trying it out. |

The page must be served over **https** (GitHub Pages does this); Web Bluetooth does not
work from a plain `http://` address other than `localhost`.

Only one program can hold a radio's Bluetooth link at a time: close the official
Meshtastic app, and disconnect the PC program if it is connected by Bluetooth.

**Try the demo radio** on the Radio tab (or add `?demo` to the address) shows every screen
with a made-up radio and nodes. Nothing is transmitted.

## Not yet tested on real hardware

Everything has been exercised against the built-in demo radio, and the message
encoder/decoder is checked byte-for-byte against the real protobuf library
(`tests.html`). The Bluetooth link itself can only be tested on a phone with a radio:
connect, check the node list, send a message, then try one small settings change.

## Files

| File | What it is |
|------|------------|
| `index.html`, `style.css`, `app.js` | the screens |
| `radio.js` | Bluetooth link and the Meshtastic client protocol |
| `proto.js`, `schema.js` | protobuf encode/decode; `schema.js` is generated |
| `lora.js` | LoRa regional rules and IPv4 checks (mirrors `mesh_client.py`) |
| `backup.js` | settings backup / restore (mirrors `settings_backup.py`) |
| `demo.js` | the pretend radio |
| `sw.js`, `manifest.json`, `icons/` | install-to-home-screen and offline start |
| `disclaimer.js`, `LICENSE` | same as the other apps |
| `tests.html`, `tests/vectors.js` | open `tests.html` to run the checks |
| `Meshtastic Mobile Guide.doc` / `.docx` / `.pdf` | installation and user guide; the PDF opens from Settings › About and is kept for offline use |
| `tools/` | Python generators (not needed on the phone); `python tools/make_guide.py` rebuilds the guide from `tools/shot.html` screenshots in `tools/screens/` (needs python-docx and LibreOffice) |

## Maintenance

- **New firmware fields:** `pip install -U meshtastic`, then
  `python tools/make_schema.py` and `python tools/make_vectors.py`, and open `tests.html`.
  Settings the app does not know about are preserved when a section is saved.
- **After changing any file:** bump `CACHE` in `sw.js` (`meshmobile-v1` -> `v2`), or
  phones keep running the old copy.
- **Run locally:** `python -m http.server --directory . 8460`, then open
  `http://localhost:8460/?demo`.

Meshtastic® is a registered trademark of Meshtastic LLC. This app is independent and is
not affiliated with or endorsed by the Meshtastic project.
