# Smoke test (I1, #27)

Manual end-to-end script. Run it in **Chrome or Edge** (File System Access API) **and Firefox** (download / upload fallback) before the bug bash. Steps marked ⏳ depend on tickets that haven't merged yet. Skip them until those land.

Start with `npm run dev` and a fresh tab.

| # | Step | Expected |
|---|------|----------|
| 1 | Press <kbd>Tab</kbd> once | "Skip to diagram" link appears; focus ring visible |
| 2 | ⏳ O1 #24: click **Load sample** | Browser, API, database and one trust boundary on the canvas |
| 2b | (until O1) Click **New** | "Started a new threat model." in the status line |
| 3 | ⏳ R2/T1: click **Refresh threats** | Generated threats listed in the threats panel |
| 4 | ⏳ T2 #23: edit one threat's mitigation | Threat shows as modified |
| 5 | ⏳ Click **Refresh threats** again | The edited threat keeps its edit (FR 2.3) |
| 6 | Click **Save** | Chrome: save dialog suggests `<title>.threatpilot.json`. Firefox: file downloads. Status says "Saved …" |
| 7 | Click **Save** again (Chrome) | No dialog; same file overwritten |
| 8 | Reload the page | If there were unsaved changes, the browser warns first |
| 9 | Click **Open**, pick the saved file | Diagram and threats identical to before the reload |
| 10 | Click **Open**, pick a non-JSON file | Red error: "… is not a valid ThreatPilot file …"; current project untouched |
| 11 | Click **Open**, pick a JSON file with `"schemaVersion": 99` | Red error listing `schemaVersion: unsupported schemaVersion 99 …`; nothing loaded |
| 12 | Click **Open**, then cancel the dialog | Nothing happens, no error |
| 13 | Click **Export** | `<title>.html` downloads |
| 14 | Turn Wi-Fi off and open the exported HTML | Opens offline; metadata, element inventory and threats grouped by element match the app |
| 15 | ⏳ T2: rename a threat to `<script>alert(1)</script>`, export, open | The title shows as text; no alert |

Log failures as issues labelled `bug` with the step number.
