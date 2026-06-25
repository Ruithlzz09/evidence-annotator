# Evidence Annotator — Prototype

Browser-based PNG annotation editor. Annotations are stored as JSON inside the
PNG itself, in an `iTXt` metadata chunk (keyword: `ann.editor`). Reopen the
saved PNG anywhere — it is a normal PNG. Reopen it in this editor and your
annotations come back as editable shapes.

## What this prototype proves

1. **`iTXt` round-trip works.** Read annotations from a PNG, edit, write them
   back. Reopen — edits persist.
2. **The CRUD model on Konva is workable.** Create / read / update / delete
   annotations against a shared document object that is the source of truth.

If both work here, the production `pywebview + Konva` version is essentially
the same JS plus a Python file-IO backend.

## Files

```text
annotator-prototype/
├── index.html        — page + toolbar markup
├── styles.css        — dark theme
├── constants.js      — shared constants (SCHEMA_VERSION, APP_ID, MAX_UNDO)
├── handlers.js       — DOM event wiring, overlays, status bar
├── app.js            — editor logic (state, tools, canvas, save, import/export)
├── png-chunks.js     — pure-JS iTXt read/write (CRC32 + zlib via pako)
└── vendor/
    ├── konva.min.js  — Konva 9.3.22  (bundled locally, no CDN required)
    └── pako.min.js   — pako 2.1.0   (bundled locally, no CDN required)
```

Dependencies are vendored locally — the app works fully offline.

### Checking / updating vendor versions

**Find current version:**

- **pako** — comment at top of `vendor/pako.min.js`: `/*! pako 2.1.0 ...*/`
- **Konva** — search for `version:` inside `vendor/konva.min.js`

**Upgrade to a newer version:**

```powershell
# Replace version numbers as needed
Invoke-WebRequest -Uri "https://cdn.jsdelivr.net/npm/pako@2.1.0/dist/pako.min.js" -OutFile "vendor/pako.min.js"
Invoke-WebRequest -Uri "https://unpkg.com/konva@9.3.22/konva.min.js"              -OutFile "vendor/konva.min.js"
```

Check latest releases:

- Konva — [github.com/konvajs/konva/releases](https://github.com/konvajs/konva/releases)
- pako  — [github.com/nodeca/pako/releases](https://github.com/nodeca/pako/releases)

## Running locally

Open `index.html` via a local static server (required for JS module loading):

```bash
cd annotator-prototype
python -m http.server 8000
```

Then open <http://localhost:8000/> in Chrome, Edge, Firefox, or Safari.

## Hosting

Static site — works on GitHub Pages, an internal web server, or anywhere that
serves files over HTTP(S). No build step, no npm.

## Usage

### Opening an image

- Click **Open PNG** or drag-drop a PNG onto the page.
- Only PNG files support annotation metadata (Save Editable). Other formats
  could be opened for display and flat-save only.

### Tools

| Tool | How to use |
| --- | --- |
| **Select** | Click to select. Drag to move. Drag handles to resize. |
| **Rectangle** | Click and drag to draw. |
| **Highlight** | Click and drag — semi-transparent yellow fill. |
| **Line** | Click and drag — straight line, no arrowhead. |
| **Arrow** | Click and drag — line with arrowhead at the end. |
| **Pen** | Click and drag — freehand stroke. |
| **Text** | Click — inline dialog opens, type text, press OK or Enter. |
| **Marker** | Click — places a numbered circle. Auto-increments. |
| **Bubble** | Click — inline dialog opens, type text, press OK or Enter. |
| **Redact** | Click and drag — solid black block. |

### Stroke controls

- **Color swatches** — 8 preset colors. Click to select.
- **Color picker** — custom color via browser color input.
- **Width slider** — stroke width for lines, arrows, rectangles, pen.
- **Size input** — circle radius for Marker, font size for Text and Bubble
  (screen pixels; default 10).

### Edit actions

- **Undo** — `Ctrl+Z` or the Undo button. Up to 50 levels.
- **Delete** — select a shape then press `Delete` / `Backspace`, or click
  the Delete button. Asks for confirmation when deleting all.
- **Delete All** — removes all annotations (confirm dialog).
- **Escape** — deselects and switches back to Select tool.

### Selection feedback

Selected annotations show a **blue glow** regardless of type. Resizable shapes
(rect, highlight, line, arrow, text, bubble, redact) additionally show
transformer handles for resize.

### Annotations import / export

- **Export** — saves `<name>_annotations.json` — a standalone copy of the
  annotation document. Useful for backup or sharing without the PNG.
- **Import** — loads a JSON file back. Validates schema and confirms before
  replacing existing annotations.

### Saving

- **Save Editable** — embeds annotations as an `iTXt` metadata chunk in the
  PNG. Downloads as `<name>_annotated.png`. Reopen this file in the editor
  to continue editing.
- **Save Flat** — burns annotations onto the image pixels. Downloads as
  `<name>_marked.png`. Not re-editable but works in any viewer.

### Inline dialogs

Browser `prompt()` and `confirm()` are replaced with styled in-app dialogs:

- **Text / Bubble input** — textarea, Enter to confirm, Shift+Enter for
  newline, Escape to cancel.
- **Confirm** — for Delete All and Import-over-existing. Enter confirms,
  Escape cancels.

## Schema

```json
{
  "schemaVersion": "1.0.0",
  "appId": "evidence-annotator",
  "imageSize": { "w": 1920, "h": 1080 },
  "createdAt": "2026-06-25T08:00:00.000Z",
  "modifiedAt": "2026-06-25T08:30:00.000Z",
  "annotations": [
    { "id": "uuid", "type": "rect",      "x": 0, "y": 0, "w": 100, "h": 50, "stroke": "#ff0000", "strokeWidth": 3 },
    { "id": "uuid", "type": "highlight", "x": 0, "y": 0, "w": 100, "h": 50, "color": "#ffff00", "opacity": 0.35 },
    { "id": "uuid", "type": "redact",    "x": 0, "y": 0, "w": 100, "h": 50 },
    { "id": "uuid", "type": "line",      "from": [0, 0], "to": [100, 100], "stroke": "#ff0000", "strokeWidth": 3 },
    { "id": "uuid", "type": "arrow",     "from": [0, 0], "to": [100, 100], "stroke": "#ff0000", "strokeWidth": 3 },
    { "id": "uuid", "type": "pen",       "points": [0, 0, 10, 20, 30, 40], "stroke": "#ff0000", "strokeWidth": 3 },
    { "id": "uuid", "type": "text",      "x": 0, "y": 0, "text": "Note", "size": 18, "color": "#ff0000" },
    { "id": "uuid", "type": "marker",    "x": 0, "y": 0, "number": 1, "color": "#ff0000", "radius": 16 },
    { "id": "uuid", "type": "bubble",    "x": 0, "y": 0, "text": "Note", "size": 14, "stroke": "#ff0000", "strokeWidth": 2, "fill": "#fffde7", "color": "#000000", "pointerDirection": "down" }
  ]
}
```

Coordinates are in **image pixel space** (origin top-left). The editor scales
the canvas to fit the viewport on load; all stored coordinates are at the
original image resolution.

## Verification checklist

1. Open a fresh PNG → empty canvas, status bar says "no annotations found".
2. Draw one of each tool type → all appear with correct stroke/color.
3. Click a shape → blue glow appears; transformer handles appear on resizable
   shapes.
4. Drag to move, drag handles to resize → shape updates correctly.
5. Double-click a Text or Bubble → inline edit dialog opens.
6. Undo several times → shapes revert correctly.
7. Click **Save Editable** → downloads `<name>_annotated.png`.
8. Open the downloaded file → all annotations reload as editable shapes.
   **This is the key round-trip test.**
9. Click **Save Flat** → downloads `<name>_marked.png`; annotations burned in.
10. Export annotations as JSON → valid file downloads.
11. Import that JSON back → annotations restore (confirm dialog shown if
    existing annotations are present).
12. Try a PNG with Japanese text in a Text annotation → UTF-8 round-trips
    cleanly.

## Known limitations

- **Browser download only.** No save-in-place — browser security model
  prevents it. The production `pywebview` version saves directly via Python.
- **PNG only for Save Editable.** JPEG and WebP have no standardized plain-text
  metadata chunk equivalent to PNG `iTXt`.
- **No zoom/pan.** Image is scaled to fit the viewport on load but cannot be
  zoomed further. Add when needed.
- **No mobile-optimised touch UX.** Konva supports touch; the toolbar layout
  does not.

## Migration to pywebview

| Prototype (browser)            | Production (pywebview)                         |
|--------------------------------|------------------------------------------------|
| `<input type="file">`          | `webview.create_file_dialog(OPEN_DIALOG)`      |
| `<a download>` blob URL        | Python writes file via Pillow `PngInfo`        |
| `readAnnotationsFromPng` in JS | `png_itxt.read_annotations()` in Python        |
| `writeAnnotationsToPng` in JS  | `png_itxt.write_annotations()` in Python       |

The editor UI (Konva, tools, selection, document model) stays as-is. Only the
file-IO seam changes.
