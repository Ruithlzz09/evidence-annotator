// Copyright (c) 2026. All Rights Reserved. Proprietary and confidential.
// handlers.js — DOM wiring, overlays, status bar

// ── Text input overlay ────────────────────────────────────────────────────

let _overlayResolve = null;

function showTextOverlay(label, defaultValue = '') {
  return new Promise(resolve => {
    _overlayResolve = resolve;
    document.getElementById('text-overlay-label').textContent = label;
    const input = document.getElementById('text-overlay-input');
    input.value = defaultValue;
    document.getElementById('text-overlay').classList.remove('hidden');
    requestAnimationFrame(() => {
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    });
  });
}

function _overlayFinish(value) {
  document.getElementById('text-overlay').classList.add('hidden');
  if (_overlayResolve) { _overlayResolve(value); _overlayResolve = null; }
}

// ── Confirm dialog overlay ────────────────────────────────────────────────

let _confirmResolve = null;

function showConfirmOverlay(message) {
  return new Promise(resolve => {
    _confirmResolve = resolve;
    document.getElementById('confirm-message').textContent = message;
    document.getElementById('confirm-overlay').classList.remove('hidden');
    document.getElementById('confirm-ok').focus();
  });
}

function _confirmFinish(value) {
  document.getElementById('confirm-overlay').classList.add('hidden');
  if (_confirmResolve) { _confirmResolve(value); _confirmResolve = null; }
}

// ── Status bar ────────────────────────────────────────────────────────────

function setStatus(msg, type = 'info') {
  const el = document.getElementById('status');
  el.textContent = msg;
  el.dataset.type = type;
  el.classList.remove('flash');
  void el.offsetWidth; // reflow to restart animation
  el.classList.add('flash');
}

// ── UI wiring ─────────────────────────────────────────────────────────────

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

  // Confirm overlay
  document.getElementById('confirm-ok').addEventListener('click', () => _confirmFinish(true));
  document.getElementById('confirm-cancel').addEventListener('click', () => _confirmFinish(false));
  document.getElementById('confirm-overlay').addEventListener('keydown', e => {
    if (e.key === 'Enter') _confirmFinish(true);
    else if (e.key === 'Escape') _confirmFinish(false);
  });

  // Text overlay
  document.getElementById('text-overlay-ok').addEventListener('click', () => {
    _overlayFinish(document.getElementById('text-overlay-input').value.trim() || null);
  });
  document.getElementById('text-overlay-cancel').addEventListener('click', () => {
    _overlayFinish(null);
  });
  document.getElementById('text-overlay-input').addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      _overlayFinish(document.getElementById('text-overlay-input').value.trim() || null);
    } else if (e.key === 'Escape') {
      _overlayFinish(null);
    }
  });

  // Keyboard shortcuts
  window.addEventListener('keydown', e => {
    if (e.target.matches('input, textarea')) return;
    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (state.selectedId) { deleteSelected(); e.preventDefault(); }
    } else if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
      undo();
      e.preventDefault();
    } else if (e.key === 'Escape') {
      selectNone();
      setTool('select');
    }
  });
}
