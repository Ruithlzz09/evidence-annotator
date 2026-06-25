# ITa Annotator — Prototype

Browser-based PNG annotation editor. Annotations are stored as JSON inside the
PNG itself, in an `iTXt` metadata chunk (keyword: `ann.editor`). Reopen the
saved PNG anywhere — it's a normal PNG; reopen it in this editor and your
annotations come back as editable shapes.

## What this prototype proves

1. **`iTXt` round-trip works.** Read annotations from a PNG, edit, write them
   back. Reopen, edits persist.
2. **The CRUD model on Konva is workable.** Create / read / update / delete
   annotations against a shared document object that's the source of truth.

If both work here, the production `pywebview + Konva` version is essentially
the same JS plus a Python file-IO backend.

## Files

```
annotator-prototype/
├── index.html       — page + toolbar
├── styles.css       — dark theme, minimal
├── app.js           — editor logic (document model, tools, selection)
├── png-chunks.js    — pure-JS iTXt read/write (CRC32 + zlib via pako)
└── vendor/
    ├── konva.min.js — Konva 9.3.22  (bundled locally, no CDN required)
    └── pako.min.js  — pako 2.1.0   (bundled locally, no CDN required)
```

Dependencies are vendored locally — the app works fully offline.

### Checking / updating vendor versions

**Find current version:**

- **pako** — comment at top of `vendor/pako.min.js`: `/*! pako 2.1.0 ...*/`
- **Konva** — search for `version:` inside `vendor/konva.min.js`

**Upgrade to a newer version:**

```powershell
# Replace 2.1.0 / 9.3.22 with the new version numbers
Invoke-WebRequest -Uri "https://cdn.jsdelivr.net/npm/pako@2.1.0/dist/pako.min.js" -OutFile "vendor/pako.min.js"
Invoke-WebRequest -Uri "https://unpkg.com/konva@9.3.22/konva.min.js"              -OutFile "vendor/konva.min.js"
```

Check latest releases:

- Konva — [github.com/konvajs/konva/releases](https://github.com/konvajs/konva/releases)
- pako  — [github.com/nodeca/pako/releases](https://github.com/nodeca/pako/releases)

## Running locally

You **cannot** open `index.html` via `file://` because ES modules require an
HTTP origin. Use any local static server:

```bash
cd annotator-prototype
python -m http.server 8000
```

Then open <http://localhost:8000/> in Chrome/Edge/Firefox/Safari.

## Hosting

This is a static site — works on GitHub Pages, an internal web server, or
anywhere that serves files over HTTP(S). No build step, no npm.

## Usage

- **Open PNG** — file picker, or drag-drop onto the page.
- **Tools** — Select / Rectangle / Arrow / Text.
- **Stroke color / width** — applies to new shapes.
- **Select** — click a shape. Drag to move. Drag handles to resize.
- **Edit text** — double-click a text annotation.
- **Delete** — select + press Delete (or Backspace), or click Delete button.
- **Save** — downloads `<original>_annotated.png` with annotations embedded.

If the file you open already contains valid `ann.editor` annotations, they
will load as editable shapes. If not (or if metadata is invalid), it loads as
a plain image with an empty annotation set.

## Schema

```json
{
  "schemaVersion": "1.0.0",
  "appId": "ita-annotator",
  "imageSize": { "w": 1920, "h": 1080 },
  "createdAt": "2026-06-25T08:00:00.000Z",
  "modifiedAt": "2026-06-25T08:30:00.000Z",
  "annotations": [
    { "id": "uuid", "type": "rect",  "x": 0, "y": 0, "w": 100, "h": 50, "stroke": "#ff0000", "strokeWidth": 3 },
    { "id": "uuid", "type": "arrow", "from": [0, 0], "to": [100, 100], "stroke": "#ff0000", "strokeWidth": 3 },
    { "id": "uuid", "type": "text",  "x": 0, "y": 0, "text": "Note", "size": 18, "color": "#000000" }
  ]
}
```

Coordinates are in **image pixel space** (origin top-left). On open, if the
PNG's actual dimensions differ from `imageSize`, a warning is logged but
annotations are still rendered at their stored coordinates.

## Verification checklist

Run these in order to confirm the round-trip is solid:

1. Open a fresh PNG with no annotations → empty canvas, status says
   "no annotations found".
2. Draw a rectangle, arrow, and text → all appear with the chosen
   stroke/color.
3. Click a shape → transformer handles appear; drag to move; drag handles to
   resize; press Delete to remove.
4. Click Save → browser downloads `<name>_annotated.png`.
5. Open the downloaded file → annotations reappear as editable shapes.
   **This is the key test.**
6. Edit, save again, reopen → updates persist.
7. Try with a PNG containing Japanese characters in the text annotation →
   UTF-8 should round-trip cleanly.

## Known prototype limitations (intentional)

- **Browser download only.** No "save in place" — the browser security model
  doesn't allow it. The production `pywebview` version saves directly via
  Python.
- **No undo/redo.** Snapshot-based undo of `state.document` is straightforward
  to add later.
- **Text edit via `prompt()`.** Replace with an inline `<textarea>` overlay
  for v1.
- **No zoom/pan.** Add when needed.
- **No mobile-optimised touch UX.** Konva supports touch; the toolbar
  doesn't.

## Migration to pywebview

When the prototype proves the concept, port like this:

| Prototype (browser)            | Production (pywebview)                         |
|--------------------------------|------------------------------------------------|
| `<input type="file">`          | `webview.create_file_dialog(OPEN_DIALOG)`      |
| `<a download>` blob URL        | Python writes file via Pillow `PngInfo`        |
| `readAnnotationsFromPng` in JS | `png_itxt.read_annotations()` in Python        |
| `writeAnnotationsToPng` in JS  | `png_itxt.write_annotations()` in Python       |

The editor UI (Konva, tools, selection, document model) stays as-is. Only the
file-IO seam changes.
