// app.js — editor logic. Document model → Konva nodes. CRUD on annotations.

import { readAnnotationsFromPng, writeAnnotationsToPng } from './png-chunks.js';

const SCHEMA_VERSION = '1.0.0';
const APP_ID = 'ita-annotator';

// ── State ──────────────────────────────────────────────────────────────────

const state = {
  originalBytes: null,   // ArrayBuffer of the loaded PNG, kept untouched for save
  filename: null,
  tool: 'select',
  document: null,        // { schemaVersion, appId, imageSize, annotations: [...] }
  selectedId: null,
  markerCount: 0,        // auto-incremented number for marker annotations
};

let stage, imageLayer, shapeLayer, transformer;
let drawing = null; // the in-progress annotation while user is dragging

// ── Undo stack ─────────────────────────────────────────────────────────────

const undoStack = [];
const MAX_UNDO  = 50;

function pushUndo() {
  undoStack.push(JSON.parse(JSON.stringify(state.document.annotations)));
  if (undoStack.length > MAX_UNDO) undoStack.shift();
  document.getElementById('undo-btn').disabled = false;
}

function undo() {
  if (!undoStack.length) return;
  state.document.annotations = undoStack.pop();
  state.markerCount = state.document.annotations
    .filter(a => a.type === 'marker')
    .reduce((max, a) => Math.max(max, a.number || 0), 0);
  selectNone();
  renderAnnotations();
  document.getElementById('undo-btn').disabled = undoStack.length === 0;
  setStatus(`Undone. ${state.document.annotations.length} annotation(s) remain.`);
}

// ── Initialization ─────────────────────────────────────────────────────────

function init() {
  stage = new Konva.Stage({
    container: 'container',
    width: 800,
    height: 100, // placeholder; resized on image load
  });

  imageLayer = new Konva.Layer();
  shapeLayer = new Konva.Layer();
  stage.add(imageLayer);
  stage.add(shapeLayer);

  transformer = new Konva.Transformer({
    rotateEnabled: false,
    ignoreStroke: true,
    boundBoxFunc: (oldBox, newBox) => {
      if (newBox.width < 5 || newBox.height < 5) return oldBox;
      return newBox;
    },
  });
  shapeLayer.add(transformer);

  bindUI();
  bindCanvas();
}

// ── UI wiring ──────────────────────────────────────────────────────────────

function bindUI() {
  document.getElementById('open-btn').addEventListener('click', () => {
    document.getElementById('file-input').click();
  });

  document.querySelectorAll('[data-tool]').forEach(btn => {
    btn.addEventListener('click', () => setTool(btn.dataset.tool));
  });

  document.getElementById('file-input').addEventListener('change', e => {
    if (e.target.files[0]) loadFile(e.target.files[0]);
  });

  document.getElementById('undo-btn').addEventListener('click', undo);
  document.getElementById('delete-btn').addEventListener('click', deleteSelected);
  document.getElementById('delete-all-btn').addEventListener('click', deleteAll);
  document.getElementById('save-btn').addEventListener('click', saveFile);
  document.getElementById('save-flat-btn').addEventListener('click', saveFlatImage);
  document.getElementById('export-ann-btn').addEventListener('click', exportAnnotations);
  document.getElementById('import-ann-btn').addEventListener('click', () => {
    document.getElementById('ann-import-input').click();
  });
  document.getElementById('ann-import-input').addEventListener('change', e => {
    if (e.target.files[0]) importAnnotations(e.target.files[0]);
    e.target.value = '';
  });

  // Color swatches
  const colorInput = document.getElementById('stroke-color');
  document.querySelectorAll('.swatch').forEach(swatch => {
    swatch.addEventListener('click', () => {
      colorInput.value = swatch.dataset.color;
      document.querySelectorAll('.swatch').forEach(s => s.classList.remove('active'));
      swatch.classList.add('active');
    });
  });
  colorInput.addEventListener('input', () => {
    document.querySelectorAll('.swatch').forEach(s => s.classList.remove('active'));
  });

  // Drag-drop
  const area = document.getElementById('canvas-area');
  area.addEventListener('dragover', e => {
    e.preventDefault();
    area.classList.add('dropping');
  });
  area.addEventListener('dragleave', e => {
    if (e.target === area) area.classList.remove('dropping');
  });
  area.addEventListener('drop', e => {
    e.preventDefault();
    area.classList.remove('dropping');
    const f = e.dataTransfer.files[0];
    if (f) loadFile(f);
  });

  // Keyboard
  window.addEventListener('keydown', e => {
    if (e.target.matches('input, textarea')) return;
    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (state.selectedId) {
        deleteSelected();
        e.preventDefault();
      }
    } else if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
      undo();
      e.preventDefault();
    } else if (e.key === 'Escape') {
      selectNone();
      setTool('select');
    }
  });
}

function bindCanvas() {
  stage.on('mousedown touchstart', onMouseDown);
  stage.on('mousemove touchmove', onMouseMove);
  stage.on('mouseup touchend', onMouseUp);

  // Click on empty stage = deselect
  stage.on('click tap', e => {
    if (e.target === stage) selectNone();
  });
}

// ── File loading ───────────────────────────────────────────────────────────

async function loadFile(file) {
  if (!file.name.toLowerCase().endsWith('.png')) {
    setStatus(`"${file.name}" is not a PNG. Only PNG files support annotation metadata.`);
    return;
  }

  setStatus(`Loading ${file.name}…`);
  state.filename = file.name;
  state.originalBytes = await file.arrayBuffer();

  // Render the image first
  const img = new Image();
  img.onload = () => {
    const canvasArea = document.getElementById('canvas-area');
    const maxW = canvasArea.clientWidth - 40;
    const maxH = window.innerHeight - 140; // toolbar + status + padding
    const scale = Math.min(1, maxW / img.width, maxH / img.height);

    stage.scale({ x: scale, y: scale });
    stage.size({ width: Math.round(img.width * scale), height: Math.round(img.height * scale) });

    imageLayer.destroyChildren();
    const konvaImg = new Konva.Image({ image: img, x: 0, y: 0 });
    imageLayer.add(konvaImg);
    imageLayer.draw();

    // Then try to read annotations from iTXt
    let doc = null;
    try {
      doc = readAnnotationsFromPng(state.originalBytes);
    } catch (e) {
      console.error('Failed to read iTXt:', e);
    }

    if (doc && validateDocument(doc, img.width, img.height)) {
      state.document = doc;
      // Normalize: ensure imageSize matches the actual image
      state.document.imageSize = { w: img.width, h: img.height };
      setStatus(`Loaded "${file.name}" with ${doc.annotations.length} existing annotation(s).`);
    } else {
      state.document = newEmptyDocument(img.width, img.height);
      setStatus(`Loaded "${file.name}" as plain image (no annotations found).`);
    }

    // Reset undo stack for new image
    undoStack.length = 0;
    document.getElementById('undo-btn').disabled = true;

    // Restore marker counter so new markers continue from the highest existing number
    state.markerCount = state.document.annotations
      .filter(a => a.type === 'marker')
      .reduce((max, a) => Math.max(max, a.number || 0), 0);

    renderAnnotations();
    document.getElementById('save-btn').disabled = false;
    document.getElementById('save-flat-btn').disabled = false;
    document.getElementById('delete-all-btn').disabled = false;
    document.getElementById('export-ann-btn').disabled = false;
    document.getElementById('import-ann-btn').disabled = false;
    document.getElementById('drop-hint').style.display = 'none';
    document.getElementById('container').style.display = 'inline-block';
  };
  img.onerror = () => setStatus(`Failed to render "${file.name}" as an image.`);
  img.src = URL.createObjectURL(file);
}

function newEmptyDocument(w, h) {
  return {
    schemaVersion: SCHEMA_VERSION,
    appId: APP_ID,
    imageSize: { w, h },
    createdAt: new Date().toISOString(),
    annotations: [],
  };
}

function validateDocument(doc, imageW, imageH) {
  if (!doc || typeof doc !== 'object') return false;
  if (typeof doc.schemaVersion !== 'string') return false;
  if (!Array.isArray(doc.annotations)) return false;

  // Reject unknown major versions (forward compatibility guard)
  const docMajor = parseInt(doc.schemaVersion.split('.')[0], 10);
  const ourMajor = parseInt(SCHEMA_VERSION.split('.')[0], 10);
  if (Number.isNaN(docMajor) || docMajor > ourMajor) {
    console.warn(`Unknown schema major version: ${doc.schemaVersion}`);
    return false;
  }

  // Soft warning if image size mismatches — coords may be off
  if (doc.imageSize && (doc.imageSize.w !== imageW || doc.imageSize.h !== imageH)) {
    console.warn(`Image size changed since annotations were saved (expected ${doc.imageSize.w}×${doc.imageSize.h}, got ${imageW}×${imageH}). Annotations may be misaligned.`);
  }
  return true;
}

// ── Render: document → Konva ───────────────────────────────────────────────

function renderAnnotations() {
  // Wipe everything except the transformer
  shapeLayer.children
    .filter(n => n.className !== 'Transformer')
    .forEach(n => n.destroy());

  for (const ann of state.document.annotations) {
    const node = createKonvaNode(ann);
    if (node) shapeLayer.add(node);
  }

  // Reattach transformer if a selection survives
  if (state.selectedId) {
    const node = shapeLayer.findOne(n => n.id() === state.selectedId);
    transformer.nodes(node ? [node] : []);
  } else {
    transformer.nodes([]);
  }

  shapeLayer.draw();
}

function createKonvaNode(ann) {
  let node;

  if (ann.type === 'rect') {
    node = new Konva.Rect({
      id: ann.id,
      x: ann.x, y: ann.y,
      width: ann.w, height: ann.h,
      stroke: ann.stroke,
      strokeWidth: ann.strokeWidth,
      fill: ann.fill || 'transparent',
      draggable: true,
    });
  } else if (ann.type === 'highlight') {
    node = new Konva.Rect({
      id: ann.id,
      x: ann.x, y: ann.y,
      width: ann.w, height: ann.h,
      fill: ann.color || '#ffff00',
      opacity: ann.opacity ?? 0.35,
      draggable: true,
    });
  } else if (ann.type === 'redact') {
    node = new Konva.Rect({
      id: ann.id,
      x: ann.x, y: ann.y,
      width: ann.w, height: ann.h,
      fill: '#111111',
      draggable: true,
    });
  } else if (ann.type === 'arrow') {
    node = new Konva.Arrow({
      id: ann.id,
      points: [ann.from[0], ann.from[1], ann.to[0], ann.to[1]],
      stroke: ann.stroke,
      strokeWidth: ann.strokeWidth,
      fill: ann.stroke,
      pointerLength: 12,
      pointerWidth: 12,
      hitStrokeWidth: Math.max(20, ann.strokeWidth),
      draggable: true,
    });
  } else if (ann.type === 'line') {
    node = new Konva.Line({
      id: ann.id,
      points: [ann.from[0], ann.from[1], ann.to[0], ann.to[1]],
      stroke: ann.stroke,
      strokeWidth: ann.strokeWidth,
      lineCap: 'round',
      hitStrokeWidth: Math.max(20, ann.strokeWidth),
      draggable: true,
    });
  } else if (ann.type === 'pen') {
    node = new Konva.Line({
      id: ann.id,
      points: ann.points,
      stroke: ann.stroke,
      strokeWidth: ann.strokeWidth,
      tension: 0.3,
      lineCap: 'round',
      lineJoin: 'round',
      hitStrokeWidth: Math.max(20, ann.strokeWidth),
      draggable: true,
    });
  } else if (ann.type === 'marker') {
    const r = ann.radius || Math.round(16 / stage.scaleX());
    const group = new Konva.Group({ id: ann.id, x: ann.x, y: ann.y, draggable: true });
    group.add(new Konva.Circle({ radius: r, fill: ann.color || '#ff0000' }));
    group.add(new Konva.Text({
      x: -r, y: -r,
      width: r * 2, height: r * 2,
      text: String(ann.number),
      fontSize: Math.round(r * 1.1),
      fontStyle: 'bold',
      fill: '#ffffff',
      align: 'center',
      verticalAlign: 'middle',
      listening: false,
    }));
    node = group;
  } else if (ann.type === 'bubble') {
    const ptr = Math.round(12 / stage.scaleX());
    const pad = Math.round(8  / stage.scaleX());
    const label = new Konva.Label({ id: ann.id, x: ann.x, y: ann.y, draggable: true });
    label.add(new Konva.Tag({
      fill: ann.fill || '#fffde7',
      stroke: ann.stroke,
      strokeWidth: ann.strokeWidth,
      pointerDirection: ann.pointerDirection || 'down',
      pointerWidth: ptr * 2,
      pointerHeight: ptr,
      cornerRadius: ptr * 0.4,
    }));
    label.add(new Konva.Text({
      text: ann.text || '',
      fontSize: ann.size || Math.round(14 / stage.scaleX()),
      fill: ann.color || '#000000',
      padding: pad,
      fontFamily: 'sans-serif',
    }));
    const textChild = label.findOne('Text');
    label.on('dblclick dbltap', () => editTextAnnotation(ann, textChild));
    node = label;
  } else if (ann.type === 'text') {
    node = new Konva.Text({
      id: ann.id,
      x: ann.x, y: ann.y,
      text: ann.text || 'Text',
      fontSize: ann.size || 18,
      fill: ann.color || '#000000',
      fontFamily: ann.font || 'sans-serif',
      draggable: true,
    });
    node.on('dblclick dbltap', () => editTextAnnotation(ann, node));
  } else {
    console.warn('Unknown annotation type:', ann.type);
    return null;
  }

  node.on('click tap', e => {
    e.cancelBubble = true;
    selectAnnotation(ann.id);
  });

  node.on('dragend', () => { pushUndo(); syncNodeToAnnotation(node, ann); });
  node.on('transformend', () => { pushUndo(); syncNodeToAnnotation(node, ann); });

  return node;
}

/**
 * After a drag or transform, push the Konva node's final geometry back into
 * the annotation object (the source of truth). For rectangles and text we
 * also bake any scale back into width/fontSize so the model stays canonical.
 */
function syncNodeToAnnotation(node, ann) {
  if (ann.type === 'rect' || ann.type === 'highlight' || ann.type === 'redact') {
    const sx = node.scaleX();
    const sy = node.scaleY();
    ann.x = node.x();
    ann.y = node.y();
    ann.w = Math.max(1, node.width() * sx);
    ann.h = Math.max(1, node.height() * sy);
    node.scaleX(1); node.scaleY(1);
    node.width(ann.w); node.height(ann.h);
  } else if (ann.type === 'arrow' || ann.type === 'line') {
    const dx = node.x();
    const dy = node.y();
    ann.from = [ann.from[0] + dx, ann.from[1] + dy];
    ann.to   = [ann.to[0]   + dx, ann.to[1]   + dy];
    node.position({ x: 0, y: 0 });
    node.points([ann.from[0], ann.from[1], ann.to[0], ann.to[1]]);
  } else if (ann.type === 'pen') {
    const dx = node.x();
    const dy = node.y();
    if (dx !== 0 || dy !== 0) {
      ann.points = ann.points.map((v, i) => i % 2 === 0 ? v + dx : v + dy);
      node.position({ x: 0, y: 0 });
      node.points(ann.points);
    }
  } else if (ann.type === 'marker' || ann.type === 'bubble') {
    ann.x = node.x();
    ann.y = node.y();
  } else if (ann.type === 'text') {
    const s = node.scaleY();
    ann.x = node.x();
    ann.y = node.y();
    ann.size = Math.max(8, (ann.size || 18) * s);
    node.scaleX(1); node.scaleY(1);
    node.fontSize(ann.size);
  }
  shapeLayer.draw();
}

// ── Selection ──────────────────────────────────────────────────────────────

function selectAnnotation(id) {
  state.selectedId = id;
  const node = shapeLayer.findOne(n => n.id() === id);
  const ann = state.document.annotations.find(a => a.id === id);
  // Markers and freehand pen are position-only; no resize handles needed
  const skipTransform = ann && (ann.type === 'marker' || ann.type === 'pen');
  transformer.nodes(node && !skipTransform ? [node] : []);
  document.getElementById('delete-btn').disabled = !node;
  shapeLayer.draw();
}

function selectNone() {
  state.selectedId = null;
  transformer.nodes([]);
  document.getElementById('delete-btn').disabled = true;
  shapeLayer.draw();
}

function deleteAll() {
  if (!state.document || state.document.annotations.length === 0) return;
  if (!confirm(`Delete all ${state.document.annotations.length} annotation(s)?`)) return;
  pushUndo();
  state.document.annotations = [];
  state.markerCount = 0;
  selectNone();
  renderAnnotations();
  setStatus('All annotations deleted.');
}

function deleteSelected() {
  if (!state.selectedId) return;
  pushUndo();
  state.document.annotations = state.document.annotations.filter(a => a.id !== state.selectedId);
  selectNone();
  renderAnnotations();
  setStatus(`Deleted. ${state.document.annotations.length} annotation(s) remain.`);
}

// ── Tools / drawing ────────────────────────────────────────────────────────

function setTool(tool) {
  state.tool = tool;
  document.querySelectorAll('[data-tool]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tool === tool);
  });
  if (tool !== 'select') selectNone();
}

function getScaledPointerPosition() {
  const raw = stage.getPointerPosition();
  return { x: raw.x / stage.scaleX(), y: raw.y / stage.scaleY() };
}

function onMouseDown(e) {
  if (state.tool === 'select') return;
  if (!state.document) return;

  // Only start drawing when clicking the stage background or the image itself
  const onBackground = (e.target === stage) || (e.target.getParent && e.target.getParent() === imageLayer);
  if (!onBackground) return;

  const pos = getScaledPointerPosition();
  const stroke = document.getElementById('stroke-color').value;
  const strokeWidth = parseInt(document.getElementById('stroke-width').value, 10);
  const id = crypto.randomUUID();

  if (state.tool === 'rect') {
    pushUndo();
    drawing = { id, type: 'rect', x: pos.x, y: pos.y, w: 0, h: 0, stroke, strokeWidth };
    state.document.annotations.push(drawing);
    renderAnnotations();
  } else if (state.tool === 'highlight') {
    pushUndo();
    drawing = { id, type: 'highlight', x: pos.x, y: pos.y, w: 0, h: 0, color: stroke, opacity: 0.35 };
    state.document.annotations.push(drawing);
    renderAnnotations();
  } else if (state.tool === 'redact') {
    pushUndo();
    drawing = { id, type: 'redact', x: pos.x, y: pos.y, w: 0, h: 0 };
    state.document.annotations.push(drawing);
    renderAnnotations();
  } else if (state.tool === 'arrow') {
    pushUndo();
    drawing = { id, type: 'arrow', from: [pos.x, pos.y], to: [pos.x, pos.y], stroke, strokeWidth };
    state.document.annotations.push(drawing);
    renderAnnotations();
  } else if (state.tool === 'line') {
    pushUndo();
    drawing = { id, type: 'line', from: [pos.x, pos.y], to: [pos.x, pos.y], stroke, strokeWidth };
    state.document.annotations.push(drawing);
    renderAnnotations();
  } else if (state.tool === 'pen') {
    pushUndo();
    drawing = { id, type: 'pen', points: [pos.x, pos.y], stroke, strokeWidth };
    state.document.annotations.push(drawing);
    renderAnnotations();
  } else if (state.tool === 'marker') {
    pushUndo();
    state.markerCount++;
    const markerSize = parseInt(document.getElementById('marker-size').value, 10) || 20;
    const ann = {
      id, type: 'marker',
      x: pos.x, y: pos.y,
      number: state.markerCount,
      color: stroke,
      radius: Math.round(markerSize / stage.scaleX()),
    };
    state.document.annotations.push(ann);
    renderAnnotations();
  } else if (state.tool === 'bubble') {
    const text = prompt('Speech bubble text:');
    if (!text) return;
    pushUndo();
    const size = Math.round(14 / stage.scaleX());
    const ann = {
      id, type: 'bubble',
      x: pos.x, y: pos.y,
      text, size,
      color: '#000000',
      fill: '#fffde7',
      stroke, strokeWidth,
      pointerDirection: 'down',
    };
    state.document.annotations.push(ann);
    renderAnnotations();
  } else if (state.tool === 'text') {
    const text = prompt('Enter text:');
    if (!text) return;
    pushUndo();
    const size = Math.round(18 / stage.scaleX());
    const ann = { id, type: 'text', x: pos.x, y: pos.y, text, size, color: stroke };
    state.document.annotations.push(ann);
    renderAnnotations();
  }
}

function onMouseMove() {
  if (!drawing) return;
  const pos = getScaledPointerPosition();

  if (drawing.type === 'pen') {
    drawing.points.push(pos.x, pos.y);
    // Update live node directly — avoids destroying/recreating all nodes on every frame
    const liveNode = shapeLayer.findOne(n => n.id() === drawing.id);
    if (liveNode) { liveNode.points([...drawing.points]); shapeLayer.batchDraw(); }
    return;
  }

  if (drawing.type === 'rect' || drawing.type === 'highlight' || drawing.type === 'redact') {
    drawing.w = pos.x - drawing.x;
    drawing.h = pos.y - drawing.y;
  } else if (drawing.type === 'arrow' || drawing.type === 'line') {
    drawing.to = [pos.x, pos.y];
  }
  renderAnnotations();
}

function onMouseUp() {
  if (!drawing) return;

  if (drawing.type === 'rect' || drawing.type === 'highlight' || drawing.type === 'redact') {
    if (Math.abs(drawing.w) < 5 && Math.abs(drawing.h) < 5) {
      state.document.annotations = state.document.annotations.filter(a => a.id !== drawing.id);
    } else {
      if (drawing.w < 0) { drawing.x += drawing.w; drawing.w = -drawing.w; }
      if (drawing.h < 0) { drawing.y += drawing.h; drawing.h = -drawing.h; }
    }
  } else if (drawing.type === 'arrow' || drawing.type === 'line') {
    const dx = drawing.to[0] - drawing.from[0];
    const dy = drawing.to[1] - drawing.from[1];
    if (Math.hypot(dx, dy) < 5) {
      state.document.annotations = state.document.annotations.filter(a => a.id !== drawing.id);
    }
  } else if (drawing.type === 'pen') {
    if (drawing.points.length < 6) {
      state.document.annotations = state.document.annotations.filter(a => a.id !== drawing.id);
    }
  }

  drawing = null;
  renderAnnotations();
}

// ── Text editing (double-click) ────────────────────────────────────────────

function editTextAnnotation(ann, node) {
  const next = prompt('Edit text:', ann.text);
  if (next === null) return; // cancelled
  ann.text = next;
  node.text(next);
  shapeLayer.draw();
}

// ── Save ───────────────────────────────────────────────────────────────────

function saveFile() {
  if (!state.originalBytes || !state.document) return;
  setStatus('Building PNG with annotations…');

  // Update modification timestamp
  state.document.modifiedAt = new Date().toISOString();

  try {
    const newBytes = writeAnnotationsToPng(state.originalBytes, state.document);
    const blob = new Blob([newBytes], { type: 'image/png' });
    const url = URL.createObjectURL(blob);

    const baseName = state.filename.replace(/\.png$/i, '');
    // If the file already had "_annotated", don't double it
    const downloadName = baseName.endsWith('_annotated')
      ? `${baseName}.png`
      : `${baseName}_annotated.png`;

    const a = document.createElement('a');
    a.href = url;
    a.download = downloadName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    setStatus(`Saved "${downloadName}" with ${state.document.annotations.length} annotation(s).`);
  } catch (e) {
    console.error(e);
    setStatus(`Save failed: ${e.message}`);
  }
}

function saveFlatImage() {
  if (!state.originalBytes || !state.document) return;
  setStatus('Rendering flat image…');

  // Hide transformer handles so they don't appear in the export
  const prevNodes = transformer.nodes();
  transformer.nodes([]);
  shapeLayer.draw();

  // pixelRatio > 1 upscales the export back to original image resolution
  const pixelRatio = 1 / stage.scaleX();
  const dataURL = stage.toDataURL({ mimeType: 'image/png', pixelRatio });

  // Restore transformer
  transformer.nodes(prevNodes);
  shapeLayer.draw();

  const baseName = state.filename.replace(/\.png$/i, '');
  const downloadName = baseName.endsWith('_marked')
    ? `${baseName}.png`
    : `${baseName}_marked.png`;

  const a = document.createElement('a');
  a.href = dataURL;
  a.download = downloadName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);

  setStatus(`Saved "${downloadName}" as flat image (annotations burned in, not editable).`);
}

// ── Annotation import / export ────────────────────────────────────────────

function exportAnnotations() {
  if (!state.document) return;
  const json = JSON.stringify(state.document, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const baseName = state.filename.replace(/\.png$/i, '');
  const a = document.createElement('a');
  a.href = url;
  a.download = `${baseName}_annotations.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  setStatus(`Exported ${state.document.annotations.length} annotation(s) as JSON.`);
}

async function importAnnotations(file) {
  let doc;
  try {
    const text = await file.text();
    doc = JSON.parse(text);
  } catch {
    setStatus('Import failed: file is not valid JSON.');
    return;
  }

  if (!validateDocument(doc, state.document.imageSize.w, state.document.imageSize.h)) {
    setStatus('Import failed: JSON does not match annotation schema.');
    return;
  }

  if (state.document.annotations.length > 0) {
    if (!confirm(`Replace ${state.document.annotations.length} existing annotation(s) with ${doc.annotations.length} from the imported file?`)) return;
  }

  pushUndo();
  state.document.annotations = doc.annotations;
  state.markerCount = doc.annotations
    .filter(a => a.type === 'marker')
    .reduce((max, a) => Math.max(max, a.number || 0), 0);

  selectNone();
  renderAnnotations();
  setStatus(`Imported ${doc.annotations.length} annotation(s) from "${file.name}".`);
}

// ── Status helper ──────────────────────────────────────────────────────────

function setStatus(msg) {
  document.getElementById('status').textContent = msg;
}

// ── Go ─────────────────────────────────────────────────────────────────────

init();
