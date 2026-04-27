import React, { useEffect } from 'react';
import { collection, doc, getDoc, getDocs, query, serverTimestamp, setDoc, where, writeBatch } from 'firebase/firestore';
import { db } from '../firebase';
import { analyzeFloorPlanImage } from '../gemini';
import { useHospital } from '../contexts/HospitalContext';
import { buildSystemRoomsFromFloor } from '../utils/floorPublishing';

export default function HospitalMapEditor() {
  const { hospitalId } = useHospital();

  useEffect(() => {

    // â”€â”€ Init canvas refs â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const canvas = document.getElementById('hme-map-canvas');
    const ctx = canvas.getContext('2d');
    const gridCanvas = document.getElementById('hme-grid-canvas');
    const gctx = gridCanvas.getContext('2d');
    const bgCanvas = document.getElementById('hme-bg-canvas');
    const wrap = document.getElementById('hme-canvas-wrap');

    let zones = [], cameras = [], walls = [], selected = null, tool = 'select';
    let dragging = false, dragOffX = 0, dragOffY = 0, resizing = false, resizeHandle = null;
    let drawStart = null, drawPreview = null;
    let dropType = null, dropColor = null, dropLabel = null;
    let bgImage = null, bgOpacity = 0.3;
    const GRID = 20;
    const COMPACT_ZONE_TYPES = new Set(['exit_door', 'entry_door', 'aed_station', 'fire_ext', 'hazard']);

    function getZoneMinSize(zone) {
      if (COMPACT_ZONE_TYPES.has(zone?.type)) {
        return { w: 20, h: 10 };
      }

      return { w: 60, h: 40 };
    }

    function getZoneDefaultSize(type) {
      if (COMPACT_ZONE_TYPES.has(type)) {
        return { w: 40, h: 20 };
      }

      return { w: 120, h: 60 };
    }

    // â”€â”€ Floor management â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    let floors = { 1: { zones: [], cameras: [], walls: [] } };
    let currentFloor = 1;

    function floorData(f) {
      if (!floors[f]) floors[f] = { zones: [], cameras: [], walls: [] };
      return floors[f];
    }

    function saveCurrentFloor() {
      floors[currentFloor] = {
        zones: JSON.parse(JSON.stringify(zones)),
        cameras: JSON.parse(JSON.stringify(cameras)),
        walls: JSON.parse(JSON.stringify(walls)),
      };
    }

    function loadFloor(f) {
      saveCurrentFloor();
      currentFloor = f;
      const d = floorData(f);
      zones = JSON.parse(JSON.stringify(d.zones));
      cameras = JSON.parse(JSON.stringify(d.cameras));
      walls = JSON.parse(JSON.stringify(d.walls));
      selected = null;
      historyStack = []; historyIndex = -1; updateUndoRedoBtns();
      showProps(); render();
      renderFloorTabs();
    }

    function addFloor() {
      saveCurrentFloor();
      const nums = Object.keys(floors).map(Number);
      const nextNum = Math.max(...nums) + 1;
      floors[nextNum] = { zones: [], cameras: [], walls: [] };
      loadFloor(nextNum);
      autoSave();
    }

    function removeFloor(floorNumber) {
      const numericFloor = Number(floorNumber);
      if (!floors[numericFloor]) return;

      const floorNumbers = Object.keys(floors).map(Number).sort((a, b) => a - b);
      const isOnlyFloor = floorNumbers.length === 1;
      const confirmed = window.confirm(
        isOnlyFloor
          ? 'Clear the only floor in the editor?'
          : `Remove Floor ${numericFloor} from the editor?`
      );

      if (!confirmed) return;

      saveCurrentFloor();

      if (isOnlyFloor) {
        floors = { 1: { zones: [], cameras: [], walls: [] } };
        currentFloor = 1;
        zones = [];
        cameras = [];
        walls = [];
      } else {
        delete floors[numericFloor];

        if (currentFloor === numericFloor) {
          const remainingFloors = Object.keys(floors).map(Number).sort((a, b) => a - b);
          const fallbackFloor = remainingFloors.find((floor) => floor > numericFloor) ?? remainingFloors[remainingFloors.length - 1];
          currentFloor = fallbackFloor;
          const nextFloorData = floorData(fallbackFloor);
          zones = JSON.parse(JSON.stringify(nextFloorData.zones));
          cameras = JSON.parse(JSON.stringify(nextFloorData.cameras));
          walls = JSON.parse(JSON.stringify(nextFloorData.walls));
        }
      }

      selected = null;
      historyStack = [];
      historyIndex = -1;
      updateUndoRedoBtns();
      showProps();
      render();
      renderFloorTabs();
      saveHistory();
      autoSave();
      showToast(isOnlyFloor ? 'Floor 1 was cleared.' : `Removed Floor ${numericFloor} from the editor.`);
    }

    function renderFloorTabs() {
      const container = document.getElementById('hme-floor-tabs');
      if (!container) return;
      container.innerHTML = '';
      Object.keys(floors).sort((a, b) => a - b).forEach(f => {
        const floorChip = document.createElement('div');
        floorChip.className = 'hme-floor-chip';

        const btn = document.createElement('button');
        btn.textContent = 'Floor ' + f;
        btn.className = 'hme-floor-btn' + (Number(f) === currentFloor ? ' hme-floor-active' : '');
        btn.onclick = () => { loadFloor(Number(f)); autoSave(); };
        floorChip.appendChild(btn);

        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'hme-floor-remove-btn';
        removeBtn.textContent = 'x';
        removeBtn.title = `Remove Floor ${f}`;
        removeBtn.setAttribute('aria-label', `Remove Floor ${f}`);
        removeBtn.onclick = (event) => {
          event.stopPropagation();
          removeFloor(Number(f));
        };
        floorChip.appendChild(removeBtn);

        container.appendChild(floorChip);
      });
    }

    // â”€â”€ Auto-save â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    let _autoSaveTimer = null;
    let _autoSaveWriteId = 0;
    let _queuedAutoSaveTimer = null;

    async function autoSave() {
      saveCurrentFloor();
      if (!hospitalId) return;

      const writeId = ++_autoSaveWriteId;
      try {
        await setDoc(doc(db, `hospitals/${hospitalId}/meta`, 'map-editor-draft'), {
          floors,
          currentFloor,
          updatedAt: serverTimestamp(),
        }, { merge: true });

        if (writeId === _autoSaveWriteId) {
          flashAutosave();
        }
      } catch (e) {
        console.error('Map draft auto-save failed:', e);
      }
    }

    function queueAutoSave(delay = 250) {
      if (!hospitalId) return;
      clearTimeout(_queuedAutoSaveTimer);
      _queuedAutoSaveTimer = setTimeout(() => {
        _queuedAutoSaveTimer = null;
        autoSave();
      }, delay);
    }

    function flashAutosave() {
      const el = document.getElementById('hme-autosave-indicator');
      if (!el) return;
      el.style.opacity = '1';
      clearTimeout(_autoSaveTimer);
      _autoSaveTimer = setTimeout(() => { el.style.opacity = '0'; }, 2200);
    }

    async function restoreDraftFromCloud() {
      if (!hospitalId) return;
      try {
        const snap = await getDoc(doc(db, `hospitals/${hospitalId}/meta`, 'map-editor-draft'));
        if (!snap.exists()) return;
        const saved = snap.data();
        if (saved && saved.floors) {
          floors = saved.floors;
          currentFloor = saved.currentFloor || 1;
          const d = floorData(currentFloor);
          zones = JSON.parse(JSON.stringify(d.zones));
          cameras = JSON.parse(JSON.stringify(d.cameras));
          walls = JSON.parse(JSON.stringify(d.walls));
        }
      } catch { /* corrupt â€“ start fresh */ }
    }

    // â”€â”€ History â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    let historyStack = [], historyIndex = -1;

    function snapshot() { return JSON.stringify({ zones, cameras, walls }); }

    function saveHistory() {
      historyStack = historyStack.slice(0, historyIndex + 1);
      historyStack.push(snapshot());
      historyIndex = historyStack.length - 1;
      updateUndoRedoBtns();
      autoSave();
    }

    function restoreSnapshot(s) {
      const d = JSON.parse(s);
      zones = d.zones; cameras = d.cameras; walls = d.walls;
      selected = null; showProps(); render();
    }

    function undo() {
      if (historyIndex <= 0) return;
      historyIndex--;
      restoreSnapshot(historyStack[historyIndex]);
      updateUndoRedoBtns();
    }

    function redo() {
      if (historyIndex >= historyStack.length - 1) return;
      historyIndex++;
      restoreSnapshot(historyStack[historyIndex]);
      updateUndoRedoBtns();
    }

    function updateUndoRedoBtns() {
      const uBtn = document.getElementById('hme-btn-undo');
      const rBtn = document.getElementById('hme-btn-redo');
      if (uBtn) uBtn.disabled = historyIndex <= 0;
      if (rBtn) rBtn.disabled = historyIndex >= historyStack.length - 1;
    }

    const keyHandler = (e) => {
      const tag = document.activeElement.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); undo(); }
      if ((e.ctrlKey || e.metaKey) && e.key === 'y') { e.preventDefault(); redo(); }
    };
    document.addEventListener('keydown', keyHandler);

    // â”€â”€ Canvas render â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    let zoomLevel = 1;
    let panX = 0;
    let panY = 0;
    
    function applyTransform() {
      const zc = document.getElementById('hme-zoom-container');
      if (zc) zc.style.transform = `translate(${panX}px, ${panY}px) scale(${zoomLevel})`;
    }

    window._hme_zoom = function(dir) {
      const oldZoom = zoomLevel;
      zoomLevel = Math.max(0.2, Math.min(5, zoomLevel + (dir * 0.25)));
      const w = wrap.clientWidth, h = wrap.clientHeight;
      const r = zoomLevel / oldZoom;
      panX = w/2 - (w/2 - panX) * r;
      panY = h/2 - (h/2 - panY) * r;
      applyTransform();
    };

    window._hme_resetZoom = function() {
      zoomLevel = 1; panX = 0; panY = 0; applyTransform();
    };

    function resize() {
      const w = wrap.clientWidth, h = wrap.clientHeight;
      // When resizing, only reset canvas dimensions if they changed to avoid clearing
      if (canvas.width !== w || canvas.height !== h) {
        [canvas, gridCanvas].forEach(c => { c.width = w; c.height = h; });
        drawGrid(); drawBg(); render();
      }
    }

    function drawGrid() {
      gctx.clearRect(0, 0, gridCanvas.width, gridCanvas.height);
      gctx.strokeStyle = 'rgba(255,255,255,0.05)'; gctx.lineWidth = 0.5;
      for (let x = 0; x < gridCanvas.width; x += GRID) {
        gctx.beginPath(); gctx.moveTo(x, 0); gctx.lineTo(x, gridCanvas.height); gctx.stroke();
      }
      for (let y = 0; y < gridCanvas.height; y += GRID) {
        gctx.beginPath(); gctx.moveTo(0, y); gctx.lineTo(bgCanvas.width, y); gctx.stroke();
      }
    }

    function drawBg() {
      if (!bgImage) {
        bgCanvas.style.display = 'none';
        return;
      }
      bgCanvas.style.display = 'block';
      bgCanvas.style.opacity = bgOpacity;
      const w = wrap.clientWidth, h = wrap.clientHeight;
      const scale = Math.min(w / bgImage.width, h / bgImage.height) * 0.95;
      const dw = bgImage.width * scale, dh = bgImage.height * scale;
      const dx = (w - dw) / 2, dy = (h - dh) / 2;
      bgCanvas.style.position = 'absolute';
      bgCanvas.style.left = dx + 'px';
      bgCanvas.style.top = dy + 'px';
      bgCanvas.style.width = dw + 'px';
      bgCanvas.style.height = dh + 'px';
      bgCanvas.src = bgImage.src;
    }

    function setBgOpacity(v) {
      bgOpacity = v / 100;
      const val = document.getElementById('hme-opacity-val');
      if (val) val.textContent = v + '%';
      drawBg();
    }

    function removeBg() {
      bgImage = null; drawBg();
      const row = document.getElementById('hme-opacity-row');
      if (row) row.style.display = 'none';
    }

    function snap(v) { return Math.round(v / GRID) * GRID; }
    function hexToRgba(hex, a) {
      const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
      return `rgba(${r},${g},${b},${a})`;
    }

    function render() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      walls.forEach(w => {
        ctx.strokeStyle = '#8b949e'; ctx.lineWidth = 3; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(w.x1, w.y1); ctx.lineTo(w.x2, w.y2); ctx.stroke();
      });
      if (drawPreview && tool === 'draw') {
        ctx.strokeStyle = 'rgba(200,200,200,0.4)'; ctx.lineWidth = 2;
        ctx.setLineDash([6, 4]);
        ctx.beginPath(); ctx.moveTo(drawStart.x, drawStart.y); ctx.lineTo(drawPreview.x, drawPreview.y); ctx.stroke();
        ctx.setLineDash([]);
      }
      zones.forEach(z => {
        const sel = selected === z;
        ctx.fillStyle = hexToRgba(z.color, 0.2);
        ctx.strokeStyle = sel ? z.color : hexToRgba(z.color, 0.7);
        ctx.lineWidth = sel ? 2 : 1;
        ctx.beginPath(); ctx.roundRect(z.x, z.y, z.w, z.h, 6); ctx.fill(); ctx.stroke();
        ctx.fillStyle = z.color; ctx.font = '500 11px Inter, system-ui, sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(z.label, z.x + z.w / 2, z.y + z.h / 2);
        if (sel) {
          getHandles(z).forEach(h => {
            ctx.fillStyle = 'white'; ctx.strokeStyle = z.color; ctx.lineWidth = 1.5;
            ctx.beginPath(); ctx.arc(h.x, h.y, 5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
          });
        }
      });
      cameras.forEach(c => {
        const sel = selected === c;
        ctx.fillStyle = sel ? '#3b82f6' : 'rgba(59,130,246,0.85)';
        ctx.strokeStyle = 'white'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(c.x, c.y, 10, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.fillStyle = 'white'; ctx.font = '500 9px Inter, sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('CAM', c.x, c.y);
        ctx.fillStyle = 'rgba(59,130,246,0.35)';
        const a = c.angle || 0, sw = Math.PI / 3;
        ctx.beginPath(); ctx.moveTo(c.x, c.y); ctx.arc(c.x, c.y, 38, a - sw / 2, a + sw / 2); ctx.closePath(); ctx.fill();
        if (c.label) {
          ctx.fillStyle = '#93c5fd'; ctx.font = '10px Inter, sans-serif';
          ctx.textAlign = 'center'; ctx.fillText(c.label, c.x, c.y + 18);
        }
      });
    }

    function getHandles(z) {
      return [{ x: z.x + z.w, y: z.y + z.h, dir: 'se' }, { x: z.x + z.w, y: z.y + z.h / 2, dir: 'e' }, { x: z.x + z.w / 2, y: z.y + z.h, dir: 's' }];
    }
    function hitZone(mx, my) {
      for (let i = zones.length - 1; i >= 0; i--) {
        const z = zones[i];
        if (mx >= z.x && mx <= z.x + z.w && my >= z.y && my <= z.y + z.h) return z;
      }
      return null;
    }
    function hitCamera(mx, my) {
      for (let i = cameras.length - 1; i >= 0; i--) {
        const c = cameras[i];
        if (Math.hypot(mx - c.x, my - c.y) < 12) return c;
      }
      return null;
    }
    function hitHandle(mx, my, z) {
      if (!z) return null;
      return getHandles(z).find(h => Math.hypot(mx - h.x, my - h.y) < 7) || null;
    }

    let _dragStartSnap = null;
    let isMapPanning = false;
    let lastPanMouse = null;
    let isSpaceDown = false;

    // Zoom via wheel
    wrap.addEventListener('wheel', e => {
      e.preventDefault();
      const oldZoom = zoomLevel;
      zoomLevel = Math.max(0.2, Math.min(5, zoomLevel - e.deltaY * 0.002));
      const rect = wrap.getBoundingClientRect();
      const mx = e.clientX - rect.left, my = e.clientY - rect.top;
      const r = zoomLevel / oldZoom;
      panX = mx - (mx - panX) * r;
      panY = my - (my - panY) * r;
      applyTransform();
    }, { passive: false });

    // Pan via Space + Mouse or Middle Click
    document.addEventListener('keydown', e => {
      if (e.code === 'Space' && document.activeElement.tagName !== 'INPUT') {
        if (!isSpaceDown) {
          isSpaceDown = true;
          canvas.style.cursor = 'grab';
        }
        e.preventDefault();
      }
    });

    document.addEventListener('keyup', e => {
      if (e.code === 'Space') {
        isSpaceDown = false;
        if (!isMapPanning) canvas.style.cursor = tool === 'draw' ? 'crosshair' : 'default';
      }
    });

    wrap.addEventListener('contextmenu', e => e.preventDefault());

    canvas.addEventListener('mousedown', e => {
      if (isSpaceDown || e.button === 1 || e.button === 2) {
        isMapPanning = true;
        lastPanMouse = { x: e.clientX, y: e.clientY };
        canvas.style.cursor = 'grabbing';
        return;
      }
      
      const mx = e.offsetX, my = e.offsetY;
      if (tool === 'draw') { drawStart = { x: snap(mx), y: snap(my) }; return; }
      if (tool === 'camera') {
        saveHistory();
        const cam = { x: snap(mx), y: snap(my), angle: 0, label: 'Cam ' + (cameras.length + 1) };
        cameras.push(cam); selected = cam; showProps(); render(); autoSave(); return;
      }
      const handle = selected ? hitHandle(mx, my, selected) : null;
      if (handle) { _dragStartSnap = snapshot(); resizing = true; resizeHandle = handle; return; }
      const cam = hitCamera(mx, my);
      if (cam) { _dragStartSnap = snapshot(); selected = cam; dragging = true; dragOffX = mx - cam.x; dragOffY = my - cam.y; showProps(); render(); return; }
      const z = hitZone(mx, my);
      if (z) { _dragStartSnap = snapshot(); selected = z; dragging = true; dragOffX = mx - z.x; dragOffY = my - z.y; showProps(); render(); return; }
      selected = null; showProps(); render();
    });

    canvas.addEventListener('mousemove', e => {
      if (isMapPanning) {
        panX += (e.clientX - lastPanMouse.x);
        panY += (e.clientY - lastPanMouse.y);
        lastPanMouse = { x: e.clientX, y: e.clientY };
        applyTransform();
        return;
      }
      const mx = e.offsetX, my = e.offsetY;
      if (tool === 'draw' && drawStart) { drawPreview = { x: snap(mx), y: snap(my) }; render(); return; }
      if (resizing && selected?.w !== undefined) {
        const minSize = getZoneMinSize(selected);
        if (resizeHandle.dir === 'se') { selected.w = Math.max(minSize.w, snap(mx) - selected.x); selected.h = Math.max(minSize.h, snap(my) - selected.y); }
        else if (resizeHandle.dir === 'e') { selected.w = Math.max(minSize.w, snap(mx) - selected.x); }
        else if (resizeHandle.dir === 's') { selected.h = Math.max(minSize.h, snap(my) - selected.y); }
        showProps(); render(); return;
      }
      if (dragging && selected) {
        if (selected.w !== undefined) { selected.x = snap(mx - dragOffX); selected.y = snap(my - dragOffY); }
        else { selected.x = snap(mx - dragOffX); selected.y = snap(my - dragOffY); }
        showProps(); render(); return;
      }
      const handle = selected ? hitHandle(mx, my, selected) : null;
      canvas.style.cursor = handle ? handle.dir + '-resize' : (hitCamera(mx, my) || hitZone(mx, my)) ? 'move' : tool === 'draw' ? 'crosshair' : 'default';
    });

    // We use window level mouseup so we don't get stuck if we drag out of canvas
    const handleMouseUp = e => {
      if (isMapPanning) {
        isMapPanning = false;
        canvas.style.cursor = isSpaceDown ? 'grab' : (tool === 'draw' ? 'crosshair' : 'default');
        return;
      }
      if (tool === 'draw' && drawStart) {
        const ex = snap(e.offsetX), ey = snap(e.offsetY);
        if (Math.hypot(ex - drawStart.x, ey - drawStart.y) > 10) {
          saveHistory();
          walls.push({ x1: drawStart.x, y1: drawStart.y, x2: ex, y2: ey });
          autoSave();
        }
        drawStart = null; drawPreview = null; render(); return;
      }
      if ((dragging || resizing) && _dragStartSnap && _dragStartSnap !== snapshot()) {
        historyStack = historyStack.slice(0, historyIndex + 1);
        historyStack.push(_dragStartSnap, snapshot());
        historyIndex = historyStack.length - 1;
        updateUndoRedoBtns();
        autoSave();
      }
      _dragStartSnap = null;
      dragging = false; resizing = false; resizeHandle = null;
    };
    
    window.addEventListener('mouseup', handleMouseUp);
    
    // Additional event listener for the canvas dblclick so we don't break existing features
    canvas.addEventListener('dblclick', e => {
      const z = hitZone(e.offsetX, e.offsetY);
      if (z) {
        const n = prompt('Zone name:', z.label);
        if (n !== null && n !== z.label) { saveHistory(); z.label = n; autoSave(); }
        showProps(); render();
      }
    });


    wrap.addEventListener('dragover', e => e.preventDefault());
    wrap.addEventListener('drop', e => {
      e.preventDefault(); if (!dropType) return;
      saveHistory();
      const rect = wrap.getBoundingClientRect();
      const mx = snap(e.clientX - rect.left), my = snap(e.clientY - rect.top);
      if (dropType === 'camera') {
        const cam = { x: mx, y: my, angle: 0, label: 'Cam ' + (cameras.length + 1) };
        cameras.push(cam); selected = cam;
      } else {
        const defaultSize = getZoneDefaultSize(dropType);
        const z = {
          type: dropType,
          color: dropColor,
          label: dropLabel,
          x: mx - defaultSize.w / 2,
          y: my - defaultSize.h / 2,
          w: defaultSize.w,
          h: defaultSize.h,
        };
        zones.push(z); selected = z;
      }
      showProps(); render(); autoSave();
    });

    document.querySelectorAll('.hme-zone-item').forEach(el => {
      el.addEventListener('dragstart', () => {
        dropType = el.dataset.type; dropColor = el.dataset.color; dropLabel = el.dataset.label;
      });
    });

    // â”€â”€ Tool switching â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    window._hme_setTool = function (t) {
      tool = t;
      document.querySelectorAll('#hme-toolbar button[data-tool]').forEach(b => b.classList.remove('hme-active'));
      const active = document.getElementById('hme-btn-' + t);
      if (active) active.classList.add('hme-active');
      canvas.style.cursor = t === 'draw' ? 'crosshair' : 'default';
    };

    // â”€â”€ Properties panel â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    function showProps() {
      const p = document.getElementById('hme-props-body');
      if (!p) return;
      if (!selected) {
        p.innerHTML = '<div style="color:rgba(255,255,255,0.3);font-size:12px;">Select a zone to edit.</div>';
        return;
      }
      if (selected.w !== undefined) {
        p.innerHTML = `
          <div class="hme-prop-row"><div class="hme-prop-label">Label</div><input class="hme-prop-input" value="${selected.label}" onchange="selected_hme_obj.label=this.value;window._hme_render()"></div>
          <div class="hme-prop-row"><div class="hme-prop-label">Position</div><div class="hme-prop-val">${selected.x}, ${selected.y}</div></div>
          <div class="hme-prop-row"><div class="hme-prop-label">Size</div><div class="hme-prop-val">${selected.w} x ${selected.h}</div></div>
          <div class="hme-prop-row"><div class="hme-prop-label">Color</div><input type="color" value="${selected.color}" style="width:100%;height:26px;border-radius:6px;border:1px solid rgba(255,255,255,0.1);cursor:pointer;background:transparent;" onchange="selected_hme_obj.color=this.value;window._hme_render()"></div>`;
        window.selected_hme_obj = selected;
        const d = document.createElement('button');
        d.className = 'hme-del-btn';
        d.textContent = 'Delete zone';
        d.onclick = deleteSelected;
        p.appendChild(d);
      } else {
        p.innerHTML = `
          <div class="hme-prop-row"><div class="hme-prop-label">Label</div><input class="hme-prop-input" value="${selected.label}" onchange="selected_hme_obj.label=this.value;window._hme_render()"></div>
          <div class="hme-prop-row"><div class="hme-prop-label">Angle</div><input type="range" min="0" max="360" step="1" value="${Math.round((selected.angle || 0) * 180 / Math.PI)}" style="width:100%;accent-color:#3b82f6;" oninput="selected_hme_obj.angle=this.value*Math.PI/180;window._hme_render()"></div>`;
        window.selected_hme_obj = selected;
        const d = document.createElement('button');
        d.className = 'hme-del-btn';
        d.textContent = 'Delete camera';
        d.onclick = deleteSelected;
        p.appendChild(d);
      }
    }

    window._hme_render = function () {
      render();
      queueAutoSave();
    };

    function deleteSelected() {
      saveHistory();
      zones = zones.filter(z => z !== selected);
      cameras = cameras.filter(c => c !== selected);
      selected = null; showProps(); render(); autoSave();
    }

    window._hme_clearAll = function () {
      if (confirm('Clear the entire map?')) {
        saveHistory();
        floors = { 1: { zones: [], cameras: [], walls: [] } };
        currentFloor = 1;
        zones = [];
        cameras = [];
        walls = [];
        selected = null;
        renderFloorTabs();
        showProps();
        render();
        autoSave();
      }
    };

    window._hme_undo = undo;
    window._hme_redo = redo;
    window._hme_addFloor = addFloor;
    window._hme_removeFloor = removeFloor;

    // â”€â”€ Export / Import â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    window._hme_exportJSON = function () {
      saveCurrentFloor();
      const floorsArr = Object.keys(floors).sort((a, b) => a - b).map(f => ({
        floor: Number(f),
        zones: floors[f].zones,
        cameras: floors[f].cameras,
        walls: floors[f].walls,
      }));
      const data = JSON.stringify({ floors: floorsArr, exportedAt: new Date().toISOString() }, null, 2);
      const a = document.createElement('a');
      a.href = 'data:application/json,' + encodeURIComponent(data);
      a.download = 'rehab-facility-map.json'; a.click();
    };

    window._hme_importJSON = function (input) {
      const file = input.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = ev => {
        try {
          const d = JSON.parse(ev.target.result);
          if (d.floors && Array.isArray(d.floors)) {
            floors = {};
            d.floors.forEach(f => { floors[f.floor] = { zones: f.zones || [], cameras: f.cameras || [], walls: f.walls || [] }; });
            if (!Object.keys(floors).length) throw new Error('No floor data found');
            currentFloor = Number(Object.keys(floors).sort((a, b) => a - b)[0]);
            const fd = floorData(currentFloor);
            zones = JSON.parse(JSON.stringify(fd.zones));
            cameras = JSON.parse(JSON.stringify(fd.cameras));
            walls = JSON.parse(JSON.stringify(fd.walls));
            renderFloorTabs();
            showToast('Loaded ' + d.floors.length + ' floor(s).');
          } else if (d.zones || d.cameras || d.walls) {
            saveHistory();
            zones = Array.isArray(d.zones) ? d.zones : [];
            cameras = Array.isArray(d.cameras) ? d.cameras : [];
            walls = Array.isArray(d.walls) ? d.walls : [];
            showToast('Loaded ' + zones.length + ' zone(s).');
          } else {
            throw new Error('Unrecognised map JSON format');
          }
          selected = null; showProps(); render(); autoSave();
        } catch (err) {
          showToast('Could not load: ' + err.message, true);
        }
        input.value = '';
      };
      reader.readAsText(file);
    };

    function setPublishUiState({ disabled = false, busy = false, message = '' } = {}) {
      const publishBtn = document.getElementById('hme-publish-floor-btn');
      const publishStatus = document.getElementById('hme-publish-status');

      if (publishBtn) {
        publishBtn.disabled = disabled || busy;
        publishBtn.textContent = busy ? 'Adding Floor...' : `Add Floor ${currentFloor} To System`;
      }

      if (publishStatus) {
        publishStatus.textContent = message;
      }
    }

    async function publishCurrentFloorToSystem() {
      if (!hospitalId) {
        showToast('Could not publish without a facility ID.', true);
        return;
      }

      saveCurrentFloor();
      const floorNumber = currentFloor;
      const currentFloorData = floorData(floorNumber);
      const systemRooms = buildSystemRoomsFromFloor(floorNumber, currentFloorData);

      try {
        setPublishUiState({
          busy: true,
          message: 'Replacing this floor in the live system...',
        });

        const batch = writeBatch(db);
        const roomsCollection = collection(db, `hospitals/${hospitalId}/rooms`);
        const floorMapRef = doc(db, `hospitals/${hospitalId}/floorMaps`, `floor-${floorNumber}`);
        const existingRoomsSnap = await getDocs(
          query(roomsCollection, where('floor', '==', String(floorNumber)))
        );

        existingRoomsSnap.forEach((roomDoc) => {
          batch.delete(roomDoc.ref);
        });

        batch.set(floorMapRef, {
          floor: String(floorNumber),
          floorNumber,
          zones: currentFloorData.zones || [],
          cameras: currentFloorData.cameras || [],
          walls: currentFloorData.walls || [],
          roomCount: systemRooms.length,
          source: 'map-editor',
          publishedAt: serverTimestamp(),
        }, { merge: true });

        systemRooms.forEach((room) => {
          const roomRef = doc(db, `hospitals/${hospitalId}/rooms`, room.id);
          batch.set(roomRef, {
            ...room,
            publishedAt: serverTimestamp(),
          });
        });

        await batch.commit();

        setPublishUiState({
          message: `Floor ${floorNumber} is now live with ${systemRooms.length} mapped room(s).`,
        });
        showToast(`Added Floor ${floorNumber} to the live system.`);
      } catch (err) {
        console.error('Failed to publish floor:', err);
        setPublishUiState({
          message: 'Could not add this floor right now. Please try again.',
        });
        showToast('Could not add this floor to the system.', true);
      } finally {
        const publishBtn = document.getElementById('hme-publish-floor-btn');
        if (publishBtn) {
          publishBtn.disabled = false;
          publishBtn.textContent = `Add Floor ${currentFloor} To System`;
        }
      }
    }

    window._hme_publishFloor = publishCurrentFloorToSystem;

    // â”€â”€ Validate â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    window._hme_validateMap = function () {
      saveCurrentFloor();
      const results = [];
      const floorNums = Object.keys(floors).sort((a, b) => a - b).map(Number);
      floorNums.forEach(f => {
        const fd = floors[f];
        const fz = fd.zones || [];
        const fc = fd.cameras || [];
        const lbl = 'Floor ' + f;
        const exits = fz.filter(z => z.type === 'exit_door');
        if (exits.length === 0) {
          results.push({ level: 'red', icon: 'Critical', text: lbl + ': No Exit Door found.' });
        } else {
          results.push({ level: 'green', icon: 'OK', text: lbl + ': ' + exits.length + ' Exit Door(s).' });
        }
        const critTypes = ['icu', 'emergency', 'surgery'];
        const crits = fz.filter(z => critTypes.includes(z.type));
        if (crits.length === 0) {
          results.push({ level: 'green', icon: 'OK', text: lbl + ': No critical zones.' });
        } else {
          crits.forEach(z => {
            const cx = z.x + z.w / 2, cy = z.y + z.h / 2;
            const covered = fc.some(cam => Math.hypot(cam.x - cx, cam.y - cy) < 120);
            results.push(covered
              ? { level: 'green', icon: 'OK', text: lbl + ": \"" + z.label + "\" has camera coverage." }
              : { level: 'red', icon: 'Critical', text: lbl + ": \"" + z.label + "\" has NO camera coverage." });
          });
        }
        const aeds = fz.filter(z => z.type === 'aed_station');
        results.push(aeds.length === 0
          ? { level: 'yellow', icon: 'Warning', text: lbl + ': No AED Station found.' }
          : { level: 'green', icon: 'OK', text: lbl + ': ' + aeds.length + ' AED Station(s).' });
      });
      const reds = results.filter(r => r.level === 'red').length;
      const yellows = results.filter(r => r.level === 'yellow').length;
      const greens = results.filter(r => r.level === 'green').length;
      const publishableRooms = buildSystemRoomsFromFloor(currentFloor, floorData(currentFloor));
      let html = `<div style="font-size:12px;color:rgba(255,255,255,0.5);margin-bottom:14px;">Critical: ${reds} - Warnings: ${yellows} - Passed: ${greens}</div>`;
      results.forEach(r => {
        const bg = r.level === 'red' ? 'rgba(239,68,68,0.1)' : r.level === 'yellow' ? 'rgba(245,158,11,0.1)' : 'rgba(34,197,94,0.08)';
        const border = r.level === 'red' ? 'rgba(239,68,68,0.3)' : r.level === 'yellow' ? 'rgba(245,158,11,0.35)' : 'rgba(34,197,94,0.3)';
        html += `<div style="display:flex;gap:10px;padding:9px 12px;border-radius:8px;margin-bottom:7px;font-size:13px;background:${bg};border:0.5px solid ${border};color:rgba(255,255,255,0.85);"><span>${r.icon}</span><span>${r.text}</span></div>`;
      });
      document.getElementById('hme-validate-content').innerHTML = html;
      setPublishUiState({
        message: publishableRooms.length > 0
          ? `Floor ${currentFloor} will publish ${publishableRooms.length} mapped room(s) and replace any existing live data for this floor.`
          : `Floor ${currentFloor} has no publishable mapped rooms yet. Add named zones like guest suites, therapy suites, assessment rooms, or corridors first.`,
        disabled: publishableRooms.length === 0,
      });
      document.getElementById('hme-validate-modal').style.display = 'flex';
    };

    // â”€â”€ Toast â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    function showToast(msg, isError = false) {
      let t = document.getElementById('hme-toast');
      if (!t) {
        t = document.createElement('div');
        t.id = 'hme-toast';
        t.style.cssText = 'position:fixed;bottom:22px;left:50%;transform:translateX(-50%);padding:8px 18px;border-radius:8px;font-size:13px;font-weight:500;box-shadow:0 4px 16px rgba(0,0,0,0.4);z-index:9999;pointer-events:none;transition:opacity 0.3s;';
        document.body.appendChild(t);
      }
      t.textContent = msg;
      t.style.background = isError ? 'rgba(239,68,68,0.9)' : 'rgba(34,197,94,0.9)';
      t.style.color = 'white';
      t.style.opacity = '1';
      clearTimeout(t._tid);
      t._tid = setTimeout(() => { t.style.opacity = '0'; }, 3000);
    }

    // â”€â”€ AI Modal â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    let uploadedBase64 = null, uploadedMimeType = null;
    let _pendingAIResult = null; // Holds Gemini result before user confirms

    // Zone type â†’ internal type + color mapping
    const TYPE_MAP = {
      'ICU':                { type: 'icu',        color: '#D85A30' },
      'Emergency':          { type: 'emergency',  color: '#E24B4A' },
      'General Ward':       { type: 'ward',       color: '#378ADD' },
      'Surgery':            { type: 'surgery',    color: '#7F77DD' },
      'Corridor':           { type: 'corridor',   color: '#888780' },
      'Reception':          { type: 'reception',  color: '#1D9E75' },
      'Lab':                { type: 'lab',        color: '#BA7517' },
      'Pharmacy':           { type: 'pharmacy',   color: '#D4537E' },
      'Stairwell':          { type: 'stairwell',  color: '#444441' },
      'Exit Door':          { type: 'exit_door',  color: '#00FF94' },
      'Entry Door':         { type: 'entry_door', color: '#4FC3F7' },
      'AED Station':        { type: 'aed_station',color: '#FF6B35' },
      'Fire Extinguisher':  { type: 'fire_ext',   color: '#FF2D2D' },
      'Hazard Point':       { type: 'hazard',     color: '#FFB800' },
      'Camera':             { type: 'camera',     color: '#3b82f6' },
    };

    window._hme_openAIModal = function () {
      document.getElementById('hme-ai-modal').style.display = 'flex';
    };
    window._hme_closeModal = function () {
      document.getElementById('hme-ai-modal').style.display = 'none';
      uploadedBase64 = null;
      uploadedMimeType = null;
      _pendingAIResult = null;
      const status = document.getElementById('hme-ai-status');
      if (status) { status.textContent = ''; status.style.color = 'rgba(255,255,255,0.5)'; }
      const preview = document.getElementById('hme-ai-preview');
      if (preview) preview.style.display = 'none';
      const zonePreview = document.getElementById('hme-ai-zone-preview');
      if (zonePreview) { zonePreview.style.display = 'none'; zonePreview.innerHTML = ''; }
      const confirmRow = document.getElementById('hme-ai-confirm-row');
      if (confirmRow) confirmRow.style.display = 'none';
      const actionRow = document.getElementById('hme-ai-action-row');
      if (actionRow) actionRow.style.display = 'flex';
      const btn = document.getElementById('hme-btn-analyze');
      if (btn) btn.disabled = true;
      const cancelBtn = document.getElementById('hme-btn-cancel');
      if (cancelBtn) cancelBtn.disabled = false;
    };

    const dropZone = document.getElementById('hme-drop-zone');
    if (dropZone) {
      dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('hme-dz-over'); });
      dropZone.addEventListener('dragleave', () => dropZone.classList.remove('hme-dz-over'));
      dropZone.addEventListener('drop', e => {
        e.preventDefault(); dropZone.classList.remove('hme-dz-over');
        if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
      });
    }

    window._hme_handleFile = function (file) { handleFile(file); };

    function handleFile(file) {
      if (!file || !file.type.startsWith('image/')) return;
      const reader = new FileReader();
      reader.onload = ev => {
        uploadedBase64 = ev.target.result.split(',')[1];
        uploadedMimeType = file.type || 'image/jpeg';
        const previewImg = document.getElementById('hme-preview-img');
        if (previewImg) previewImg.src = ev.target.result;
        const preview = document.getElementById('hme-ai-preview');
        if (preview) preview.style.display = 'block';
        const btn = document.getElementById('hme-btn-analyze');
        if (btn) btn.disabled = false;
        const status = document.getElementById('hme-ai-status');
        if (status) status.textContent = 'Image ready. Click "Analyze with AI" to generate zones.';
        const img = new Image();
        img.onload = () => { bgImage = img; drawBg(); const row = document.getElementById('hme-opacity-row'); if (row) row.style.display = 'flex'; };
        img.src = ev.target.result;
      };
      reader.readAsDataURL(file);
    }

    window._hme_setBgOpacity = setBgOpacity;
    window._hme_removeBg = removeBg;

    // â”€â”€ Instant JS-based layout generator (no AI needed) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    window._hme_generateLayout = function () {
      const cw = canvas.width, ch = canvas.height;

      // Build a realistic hospital layout scaled to canvas
      const genZones = [
        // Reception at entrance (bottom strip)
        { type: 'reception', color: '#1D9E75', label: 'Main Reception',   x: 0,         y: ch - 90,   w: Math.round(cw * 0.28), h: 70 },
        // Entry door at reception
        { type: 'entry_door', color: '#4FC3F7', label: 'Main Entry',      x: Math.round(cw * 0.12), y: ch - 20, w: 60, h: 20 },
        // Main corridor (horizontal center strip)
        { type: 'corridor',  color: '#888780', label: 'Main Corridor',    x: 0,         y: Math.round(ch * 0.55), w: cw,  h: Math.round(ch * 0.12) },
        // Left vertical corridor
        { type: 'corridor',  color: '#888780', label: 'West Corridor',    x: Math.round(cw * 0.15), y: 0, w: Math.round(cw * 0.08), h: Math.round(ch * 0.56) },
        // ICU bays (top-left)
        { type: 'icu', color: '#D85A30', label: 'ICU Bay 1',              x: 0,         y: 0,         w: Math.round(cw * 0.15), h: Math.round(ch * 0.28) },
        { type: 'icu', color: '#D85A30', label: 'ICU Bay 2',              x: 0,         y: Math.round(ch * 0.28), w: Math.round(cw * 0.15), h: Math.round(ch * 0.27) },
        // Surgery suite (top, right of ICU corridor)
        { type: 'surgery', color: '#7F77DD', label: 'Surgery Suite',      x: Math.round(cw * 0.23), y: 0, w: Math.round(cw * 0.22), h: Math.round(ch * 0.3) },
        // General wards (top-right)
        { type: 'ward', color: '#378ADD', label: 'General Ward A',        x: Math.round(cw * 0.45), y: 0, w: Math.round(cw * 0.28), h: Math.round(ch * 0.28) },
        { type: 'ward', color: '#378ADD', label: 'General Ward B',        x: Math.round(cw * 0.73), y: 0, w: Math.round(cw * 0.27), h: Math.round(ch * 0.28) },
        // Lab and pharmacy (mid-right, between corridor and wards)
        { type: 'lab',   color: '#639922', label: 'Laboratory',           x: Math.round(cw * 0.23), y: Math.round(ch * 0.30), w: Math.round(cw * 0.22), h: Math.round(ch * 0.25) },
        { type: 'pharmacy', color: '#D4537E', label: 'Pharmacy',          x: Math.round(cw * 0.45), y: Math.round(ch * 0.28), w: Math.round(cw * 0.22), h: Math.round(ch * 0.27) },
        // Stairwell (far right)
        { type: 'stairwell', color: '#444441', label: 'Stairwell A',      x: Math.round(cw * 0.9), y: Math.round(ch * 0.28), w: Math.round(cw * 0.1), h: Math.round(ch * 0.27) },
        // Below corridor: more wards and emergency
        { type: 'ward', color: '#378ADD', label: 'General Ward C',        x: 0,         y: Math.round(ch * 0.67), w: Math.round(cw * 0.32), h: Math.round(ch * 0.23) },
        { type: 'ward', color: '#378ADD', label: 'General Ward D',        x: Math.round(cw * 0.32), y: Math.round(ch * 0.67), w: Math.round(cw * 0.32), h: Math.round(ch * 0.23) },
        // Exit door at far end
        { type: 'exit_door', color: '#00FF94', label: 'Fire Exit',        x: Math.round(cw * 0.87), y: ch - 20, w: 60, h: 20 },
        // AED and fire ext in corridor
        { type: 'aed_station', color: '#FF6B35', label: 'AED Station',    x: Math.round(cw * 0.38), y: Math.round(ch * 0.55) + 5, w: 35, h: 35 },
        { type: 'fire_ext',  color: '#FF2D2D', label: 'Fire Extinguisher',x: Math.round(cw * 0.62), y: Math.round(ch * 0.55) + 5, w: 30, h: 35 },
      ];

      const genCameras = [
        { x: Math.round(cw * 0.05),  y: Math.round(ch * 0.05),  angle: Math.PI * 0.75, label: 'Cam 1' },
        { x: Math.round(cw * 0.35),  y: Math.round(ch * 0.05),  angle: Math.PI * 1.25, label: 'Cam 2' },
        { x: Math.round(cw * 0.75),  y: Math.round(ch * 0.05),  angle: Math.PI * 1.25, label: 'Cam 3' },
        { x: Math.round(cw * 0.5),   y: Math.round(ch * 0.61),  angle: Math.PI * 0.5,  label: 'Cam 4' },
        { x: Math.round(cw * 0.05),  y: Math.round(ch * 0.75),  angle: 0,              label: 'Cam 5' },
        { x: Math.round(cw * 0.95),  y: Math.round(ch * 0.35),  angle: Math.PI,        label: 'Cam 6' },
      ];

      const corY = Math.round(ch * 0.55), corH = Math.round(ch * 0.12);
      const genWalls = [
        // Outer perimeter
        { x1: 0, y1: 0,  x2: cw, y2: 0 },
        { x1: cw, y1: 0, x2: cw, y2: ch },
        { x1: cw, y1: ch,x2: 0,  y2: ch },
        { x1: 0, y1: ch, x2: 0,  y2: 0 },
        // Main horizontal corridor top & bottom
        { x1: 0, y1: corY, x2: cw, y2: corY },
        { x1: 0, y1: corY + corH, x2: cw, y2: corY + corH },
        // Left block vertical divider
        { x1: Math.round(cw * 0.15), y1: 0, x2: Math.round(cw * 0.15), y2: corY },
        { x1: Math.round(cw * 0.23), y1: 0, x2: Math.round(cw * 0.23), y2: corY },
        // ICU horizontal separator
        { x1: 0, y1: Math.round(ch * 0.28), x2: Math.round(cw * 0.15), y2: Math.round(ch * 0.28) },
        // Surgery / lab divider
        { x1: Math.round(cw * 0.23), y1: Math.round(ch * 0.3), x2: Math.round(cw * 0.45), y2: Math.round(ch * 0.3) },
        // Ward dividers (top)
        { x1: Math.round(cw * 0.45), y1: 0, x2: Math.round(cw * 0.45), y2: corY },
        { x1: Math.round(cw * 0.73), y1: 0, x2: Math.round(cw * 0.73), y2: corY },
        { x1: Math.round(cw * 0.9),  y1: 0, x2: Math.round(cw * 0.9),  y2: corY },
        // Pharmacy divider
        { x1: Math.round(cw * 0.45), y1: Math.round(ch * 0.28), x2: Math.round(cw * 0.67), y2: Math.round(ch * 0.28) },
        // Ward dividers (bottom)
        { x1: Math.round(cw * 0.32), y1: corY + corH, x2: Math.round(cw * 0.32), y2: ch },
        { x1: Math.round(cw * 0.64), y1: corY + corH, x2: Math.round(cw * 0.64), y2: ch },
        // Reception separator
        { x1: 0, y1: ch - 90, x2: Math.round(cw * 0.28), y2: ch - 90 },
        { x1: Math.round(cw * 0.28), y1: corY + corH, x2: Math.round(cw * 0.28), y2: ch },
      ];

      saveHistory();
      zones.length = 0; cameras.length = 0; walls.length = 0;
      genZones.forEach(z => zones.push({ ...z }));
      genCameras.forEach(c => cameras.push({ ...c }));
      genWalls.forEach(w => walls.push({ ...w }));

      selected = null; showProps(); render(); autoSave();
      window._hme_closeModal();
      showToast('Sample hospital layout generated. Fine-tune as needed.');
    };

    window._hme_analyzeImage = async function () {
      if (!uploadedBase64) return;
      const btn = document.getElementById('hme-btn-analyze');
      const cancelBtn = document.getElementById('hme-btn-cancel');
      const status = document.getElementById('hme-ai-status');
      const preview = document.getElementById('hme-ai-preview');
      const previewZones = document.getElementById('hme-ai-zone-preview');

      if (btn) btn.disabled = true;
      if (cancelBtn) cancelBtn.disabled = true;

      // Animated progress steps
      const steps = [
        'Reading blueprint layout...',
        'Identifying zones and rooms...',
        'Mapping coordinates to grid...',
        'Finalizing zone positions...',
      ];
      let stepIdx = 0;
      if (status) { status.style.color = 'rgba(255,255,255,0.5)'; status.textContent = steps[0]; }
      const stepTimer = setInterval(() => {
        stepIdx = (stepIdx + 1) % steps.length;
        if (status) status.textContent = steps[stepIdx];
      }, 1800);

      try {
        const result = await analyzeFloorPlanImage(uploadedBase64, uploadedMimeType);
        clearInterval(stepTimer);
        _pendingAIResult = result;

        const firstFloor = result.floors?.[0];
        const geminiZones = firstFloor?.zones || [];
        const geminiCams  = firstFloor?.cameras || [];
        const geminiWalls = firstFloor?.walls || [];

        // Build preview summary
        let previewHtml = `<div style="font-size:12px;color:rgba(255,255,255,0.5);margin-bottom:8px;">
          Detected <strong style="color:white">${geminiZones.length}</strong> zones -
          <strong style="color:white">${geminiCams.length}</strong> cameras -
          <strong style="color:white">${geminiWalls.length}</strong> walls
        </div>`;

        // Group zones by type â€” types/colors come directly from Gemini
        const byType = {};
        geminiZones.forEach(z => {
          const t = z.type || 'unknown';
          if (!byType[t]) byType[t] = { count: 0, color: z.color || '#888780' };
          byType[t].count++;
        });
        previewHtml += '<div style="display:flex;flex-wrap:wrap;gap:5px;margin-bottom:10px;">';
        Object.entries(byType).forEach(([type, info]) => {
          const c = info.color;
          previewHtml += `<span style="display:inline-flex;align-items:center;gap:4px;padding:2px 8px;border-radius:12px;font-size:11px;background:${c}22;border:0.5px solid ${c}66;color:rgba(255,255,255,0.85);">
            <span style="width:7px;height:7px;border-radius:2px;background:${c};display:inline-block;"></span>${type} x ${info.count}</span>`;
        });
        previewHtml += '</div>';

        if (previewZones) { previewZones.innerHTML = previewHtml; previewZones.style.display = 'block'; }
        if (status) status.textContent = '';

        // Show confirm row
        const confirmRow = document.getElementById('hme-ai-confirm-row');
        const analyzeRow = document.getElementById('hme-ai-action-row');
        if (confirmRow) confirmRow.style.display = 'flex';
        if (analyzeRow) analyzeRow.style.display = 'none';
        if (preview) preview.style.display = 'none';

      } catch (err) {
        clearInterval(stepTimer);
        if (status) {
          status.style.color = '#f87171';
          const isKeyMissing = err.message.includes('VITE_GEMINI_API_KEY');
          status.innerHTML = isKeyMissing
            ? 'No API key. Use <strong style="color:#c4b5fd;cursor:pointer;" onclick="window._hme_generateLayout()">Generate Sample Layout</strong> instead.'
            : `${err.message} or <strong style="color:#c4b5fd;cursor:pointer;" onclick="window._hme_generateLayout()">Generate Sample Layout</strong>`;
        }
        if (btn) btn.disabled = false;
        if (cancelBtn) cancelBtn.disabled = false;
        console.error('Floor plan analysis failed:', err);
      }
    };

    window._hme_confirmAIImport = function (replaceExisting) {
      if (!_pendingAIResult) return;
      const result = _pendingAIResult;
      _pendingAIResult = null;
      const cw = canvas.width, ch = canvas.height;
      const firstFloor = result.floors?.[0];
      const geminiZones = firstFloor?.zones || [];
      const geminiCams  = firstFloor?.cameras || [];
      const geminiWalls = firstFloor?.walls || [];

      // Gemini returns coordinates in fixed space: x 120â€“820 (range 700), y 80â€“420 (range 340)
      const ox = 120, ow = 700; // origin x, working width
      const oy = 80,  oh = 340; // origin y, working height
      const sx = cw / ow;       // x scale factor
      const sy = ch / oh;       // y scale factor

      // Save undo state before making changes
      saveHistory();

      if (replaceExisting) {
        zones.length = 0;
        cameras.length = 0;
        walls.length = 0;
      }

      // Place zones â€” types and colors come directly from Gemini
      geminiZones.forEach(z => {
        zones.push({
          type:  z.type  || 'corridor',
          color: z.color || '#888780',
          label: z.label || z.type || 'Zone',
          x: Math.round((z.x - ox) * sx),
          y: Math.round((z.y - oy) * sy),
          w: Math.max(20, Math.round(z.w * sx)),
          h: Math.max(10, Math.round(z.h * sy)),
        });
      });

      // Place cameras â€” angles already in radians from Gemini
      geminiCams.forEach(c => {
        cameras.push({
          x:     Math.round((c.x - ox) * sx),
          y:     Math.round((c.y - oy) * sy),
          angle: typeof c.angle === 'number' ? c.angle : 0,
          label: c.label || 'Cam',
        });
      });

      // Place walls â€” new schema includes explicit wall segments
      geminiWalls.forEach(w => {
        walls.push({
          x1: Math.round((w.x1 - ox) * sx),
          y1: Math.round((w.y1 - oy) * sy),
          x2: Math.round((w.x2 - ox) * sx),
          y2: Math.round((w.y2 - oy) * sy),
        });
      });

      // Set blueprint at 35% opacity so user can compare zones against original
      setBgOpacity(35);
      const slider = document.querySelector('#hme-opacity-row input[type=range]');
      if (slider) slider.value = 35;
      const opVal = document.getElementById('hme-opacity-val');
      if (opVal) opVal.textContent = '35%';
      const opRow = document.getElementById('hme-opacity-row');
      if (opRow) opRow.style.display = 'flex';

      selected = null;
      showProps();
      render();
      autoSave();

      window._hme_closeModal();
      showToast(`AI built map: ${geminiZones.length} zones · ${geminiCams.length} cameras · ${geminiWalls.length} walls.`);
    };

    // â”€â”€ Boot â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
    restoreDraftFromCloud().finally(() => {
      renderFloorTabs();
      resize();
      saveHistory();
    });

    return () => {
      document.removeEventListener('keydown', keyHandler);
      ro.disconnect();
      clearTimeout(_queuedAutoSaveTimer);
      // clean up globals
      delete window._hme_setTool;
      delete window._hme_render;
      delete window._hme_clearAll;
      delete window._hme_undo;
      delete window._hme_redo;
      delete window._hme_addFloor;
      delete window._hme_removeFloor;
      delete window._hme_exportJSON;
      delete window._hme_importJSON;
      delete window._hme_publishFloor;
      delete window._hme_validateMap;
      delete window._hme_openAIModal;
      delete window._hme_closeModal;
      delete window._hme_handleFile;
      delete window._hme_setBgOpacity;
      delete window._hme_removeBg;
      delete window._hme_analyzeImage;
      delete window._hme_confirmAIImport;
      delete window.selected_hme_obj;
    };
  }, [hospitalId]);

  const ZONE_TYPES = [
    { type: 'icu', color: '#D85A30', label: 'Intensive Rehab' },
    { type: 'emergency', color: '#E24B4A', label: 'Rapid Response' },
    { type: 'ward', color: '#378ADD', label: 'Guest Suite' },
    { type: 'surgery', color: '#7F77DD', label: 'Therapy Suite' },
    { type: 'corridor', color: '#888780', label: 'Corridor' },
    { type: 'reception', color: '#1D9E75', label: 'Front Desk' },
    { type: 'lab', color: '#BA7517', label: 'Assessment Room' },
    { type: 'pharmacy', color: '#D4537E', label: 'Med Storage' },
    { type: 'stairwell', color: '#444441', label: 'Stairwell' },
  ];

  const CLINICAL_TYPES = [
    { type: 'icu', color: '#D85A30', label: 'ICU' },
    { type: 'emergency', color: '#E24B4A', label: 'Emergency' },
    { type: 'ward', color: '#378ADD', label: 'General Ward' },
    { type: 'surgery', color: '#7F77DD', label: 'Surgery' },
    { type: 'corridor', color: '#888780', label: 'Corridor' },
    { type: 'reception', color: '#1D9E75', label: 'Reception' },
    { type: 'lab', color: '#BA7517', label: 'Lab' },
  ];

  const SAFETY_TYPES = [
    { type: 'exit_door', color: '#00FF94', label: 'Exit Door' },
    { type: 'entry_door', color: '#4FC3F7', label: 'Entry Door' },
    { type: 'aed_station', color: '#FF6B35', label: 'AED Station' },
    { type: 'fire_ext', color: '#FF2D2D', label: 'Fire Extinguisher' },
    { type: 'hazard', color: '#FFB800', label: 'Hazard Point' },
    { type: 'elevator', color: '#9C27B0', label: 'Elevator' },
    { type: 'camera', color: '#3b82f6', label: 'Camera', circle: true },
  ];

  return (
    <div className="flex flex-col h-full min-h-0" style={{ fontFamily: 'Inter, system-ui, sans-serif' }}>
      {/* Page Header */}
      <div className="px-6 py-4 border-b border-white/[0.07] flex items-center justify-between shrink-0">
        <div>
          <h1 className="text-lg font-bold text-white flex items-center gap-2">
            Rehab Facility Map Editor
          </h1>
          <p className="text-xs text-white/40 mt-0.5">Build and annotate multi-floor rehab and hospitality layouts</p>
        </div>
      </div>

      {/* Editor Container */}
      <div className="flex flex-1 min-h-0 overflow-hidden">

        {/* Sidebar - Zone Palette */}
        <div className="w-44 shrink-0 flex flex-col border-r border-white/[0.07] bg-navy-800 overflow-y-auto">
          <div className="px-3 py-2 text-[10px] font-semibold uppercase tracking-widest text-white/40 border-b border-white/[0.07]">
            Zone Types
          </div>
          <div className="text-[10px] font-semibold uppercase tracking-widest text-white/25 px-3 pt-2 pb-1">Care & Guest</div>
          {ZONE_TYPES.map(z => (
            <div
              key={z.type}
              className="hme-zone-item"
              draggable
              data-type={z.type}
              data-color={z.color}
              data-label={z.label}
            >
              <div className="hme-zone-dot" style={{ background: z.color }} />
              {z.label}
            </div>
          ))}
          <div className="text-[10px] font-semibold uppercase tracking-widest text-white/25 px-3 pt-2 pb-1 border-t border-white/[0.05] mt-1">Clinical</div>
          {CLINICAL_TYPES.map(z => (
            <div
              key={`clinical-${z.type}-${z.label}`}
              className="hme-zone-item"
              draggable
              data-type={z.type}
              data-color={z.color}
              data-label={z.label}
            >
              <div className="hme-zone-dot" style={{ background: z.color }} />
              {z.label}
            </div>
          ))}
          <div className="text-[10px] font-semibold uppercase tracking-widest text-white/25 px-3 pt-2 pb-1 border-t border-white/[0.05] mt-1">Safety & Access</div>
          {SAFETY_TYPES.map(z => (
            <div
              key={z.type}
              className="hme-zone-item"
              draggable
              data-type={z.type}
              data-color={z.color}
              data-label={z.label}
            >
              <div className="hme-zone-dot" style={{ background: z.color, borderRadius: z.circle ? '50%' : '3px' }} />
              {z.label}
            </div>
          ))}
        </div>

        {/* Main canvas area */}
        <div className="flex flex-col flex-1 min-w-0">
          {/* Toolbar */}
          <div id="hme-toolbar" className="flex items-center gap-1.5 px-3 py-2 border-b border-white/[0.07] bg-navy-800 flex-wrap shrink-0">
            <button id="hme-btn-select" data-tool="select" className="hme-tool-btn hme-active" onClick={() => window._hme_setTool('select')}>Select</button>
            <button className="hme-tool-btn" onClick={() => document.getElementById('hme-image-input').click()}>Add Image</button>
            <input
              type="file"
              id="hme-image-input"
              accept="image/png,image/jpeg,image/jpg,image/webp,image/gif"
              style={{ display: 'none' }}
              onChange={(e) => {
                if (window._hme_handleFile && e.target.files && e.target.files[0]) {
                  window._hme_handleFile(e.target.files[0]);
                }
                e.target.value = '';
              }}
            />
            <button id="hme-btn-draw" data-tool="draw" className="hme-tool-btn" onClick={() => window._hme_setTool('draw')}>Draw Wall</button>
            <button id="hme-btn-camera" data-tool="camera" className="hme-tool-btn" onClick={() => window._hme_setTool('camera')}>Add Camera</button>

            <button className="hme-tool-btn" onClick={() => window._hme_clearAll()}>Clear All</button>
            <button id="hme-btn-undo" className="hme-tool-btn" onClick={() => window._hme_undo()} disabled title="Undo (Ctrl+Z)">Undo</button>
            <button id="hme-btn-redo" className="hme-tool-btn" onClick={() => window._hme_redo()} disabled title="Redo (Ctrl+Y)">Redo</button>
            <button className="hme-tool-btn hme-btn-validate" onClick={() => window._hme_validateMap()}>Validate</button>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: '6px', alignItems: 'center' }}>
              <button className="hme-tool-btn" onClick={() => window._hme_exportJSON()}>Export JSON</button>
              <button className="hme-tool-btn" onClick={() => document.getElementById('hme-import-json-input').click()}>Import JSON</button>
              <input type="file" id="hme-import-json-input" accept=".json,application/json" style={{ display: 'none' }} onChange={(e) => window._hme_importJSON(e.target)} />
              <span id="hme-autosave-indicator" style={{ fontSize: "10px", color: "rgba(255,255,255,0.3)", opacity: 0, transition: "opacity 0.4s", whiteSpace: "nowrap" }}>Auto-saved</span>
            </div>
          </div>

          {/* Floor bar */}
          <div id="hme-floor-bar" className="flex items-center gap-1.5 px-3 py-1.5 border-b border-white/[0.07] bg-navy-800 overflow-x-auto shrink-0">
            <span style={{ fontSize: '10px', fontWeight: 600, color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginRight: 4, whiteSpace: 'nowrap' }}>Floor</span>
            <div id="hme-floor-tabs" style={{ display: 'flex', gap: 4 }} />
            <button className="hme-floor-btn" onClick={() => window._hme_addFloor()}>+ Add Floor</button>
          </div>

          {/* Opacity row */}
          <div id="hme-opacity-row" style={{ display: 'none', alignItems: 'center', gap: 8, padding: '4px 12px', borderBottom: '0.5px solid rgba(255,255,255,0.07)', background: '#0d1326' }}>
            <label style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>Photo opacity</label>
            <input type="range" min="0" max="100" defaultValue="30" style={{ flex: 1, accentColor: '#3b82f6' }} onInput={(e) => window._hme_setBgOpacity(e.target.value)} />
            <span id="hme-opacity-val" style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', minWidth: 28 }}>30%</span>
            <button onClick={() => window._hme_removeBg()} style={{ fontSize: 11, padding: '2px 8px', borderRadius: 6, border: '0.5px solid rgba(255,255,255,0.12)', background: 'transparent', color: 'rgba(255,255,255,0.4)', cursor: 'pointer' }}>Remove photo</button>
          </div>

          {/* Canvas */}
          <div id="hme-canvas-wrap" style={{ flex: 1, position: 'relative', background: '#0a0f1e', overflow: 'hidden' }}>
            <div id="hme-zoom-container" style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', transformOrigin: 'top left', willChange: 'transform' }}>
              <img id="hme-bg-canvas" style={{ position: 'absolute', top: 0, left: 0, pointerEvents: 'none', display: 'none' }} />
              <canvas id="hme-grid-canvas" style={{ position: 'absolute', top: 0, left: 0, pointerEvents: 'none' }} />
              <canvas id="hme-map-canvas" style={{ position: 'absolute', top: 0, left: 0 }} />
            </div>

            {/* Zoom Controls Overlay */}
            <div style={{ position: 'absolute', bottom: 20, right: 20, display: 'flex', background: 'rgba(13, 19, 38, 0.8)', border: '0.5px solid rgba(255,255,255,0.1)', borderRadius: 8, backdropFilter: 'blur(4px)', zIndex: 10 }}>
               <button onClick={() => window._hme_zoom(-1)} style={{ padding: "6px 12px", fontSize: 13, color: "rgba(255,255,255,0.8)", background: "transparent", border: "none", cursor: "pointer", borderRight: "0.5px solid rgba(255,255,255,0.1)" }}>-</button>
               <button onClick={() => window._hme_resetZoom()} style={{ padding: '6px 14px', fontSize: 11, color: 'rgba(255,255,255,0.8)', background: 'transparent', border: 'none', cursor: 'pointer', fontWeight: 600 }}>Reset</button>
               <button onClick={() => window._hme_zoom(1)} style={{ padding: '6px 12px', fontSize: 13, color: 'rgba(255,255,255,0.8)', background: 'transparent', border: 'none', cursor: 'pointer', borderLeft: '0.5px solid rgba(255,255,255,0.1)' }}>+</button>
            </div>
            
            {/* Pan Hint Overlay */}
            <div style={{ position: 'absolute', top: 20, left: 20, pointerEvents: 'none', background: 'rgba(0,0,0,0.4)', padding: '6px 12px', borderRadius: 20, border: '0.5px solid rgba(255,255,255,0.05)', fontSize: 10, color: 'rgba(255,255,255,0.5)', backdropFilter: 'blur(2px)' }}>
               Scroll to zoom - Space+Drag or Middle-Click to pan
            </div>
          </div>
        </div>

        {/* Properties panel */}
        <div style={{ width: 170, minWidth: 170, display: 'flex', flexDirection: 'column', borderLeft: '0.5px solid rgba(255,255,255,0.07)', background: '#0d1326' }}>
          <div style={{ padding: '10px 14px', fontSize: 12, fontWeight: 500, color: 'rgba(255,255,255,0.4)', borderBottom: '0.5px solid rgba(255,255,255,0.07)' }}>Properties</div>
          <div id="hme-props-body" style={{ padding: '12px 14px', flex: 1, fontSize: 13, overflowY: 'auto' }}>
            <div style={{ color: 'rgba(255,255,255,0.3)', fontSize: 12 }}>Select a zone to edit.</div>
          </div>
        </div>
      </div>

      {/* AI Modal */}
      <div id="hme-ai-modal" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', display: 'none', alignItems: 'center', justifyContent: 'center', zIndex: 1000, backdropFilter: 'blur(6px)' }}>
        <div style={{ background: '#0d1326', borderRadius: 16, border: '0.5px solid rgba(139,92,246,0.3)', width: 480, maxWidth: '95vw', padding: 28, boxShadow: '0 24px 80px rgba(0,0,0,0.8), 0 0 0 1px rgba(139,92,246,0.1)' }}>
          
          {/* Header */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
            <div style={{ width: 32, height: 32, borderRadius: 8, background: "rgba(139,92,246,0.2)", border: "0.5px solid rgba(139,92,246,0.4)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700 }}>AI</div>
            <h2 style={{ fontSize: 15, fontWeight: 700, color: 'white', margin: 0 }}>AI Blueprint Analyzer</h2>
          </div>
          <p style={{ fontSize: 12, color: "rgba(255,255,255,0.4)", marginBottom: 18, marginTop: 4 }}>Upload a hospital floor plan or blueprint. AI will read the layout and auto-generate zones, rooms, and camera positions.</p>

          {/* Drop zone */}
          <div
            id="hme-drop-zone"
            onClick={() => {
              const fileInput = document.getElementById('hme-file-input');
              if (fileInput) fileInput.click();
            }}
            style={{ border: '1.5px dashed rgba(139,92,246,0.35)', borderRadius: 10, padding: '22px 16px', textAlign: 'center', cursor: 'pointer', transition: 'all 0.15s', background: 'rgba(139,92,246,0.04)' }}
          >
            <div style={{ pointerEvents: 'none' }}>
              <div style={{ color: "rgba(139,92,246,0.8)", fontSize: 14, marginBottom: 8, fontWeight: 700 }}>Upload</div>
              <div style={{ color: 'rgba(255,255,255,0.8)', fontSize: 13, fontWeight: 500, marginBottom: 4 }}>Click to upload blueprint</div>
              <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 11 }}>PNG, JPG up to 10MB</div>
            </div>
            <input type="file" id="hme-file-input" accept="image/*" style={{ display: 'none' }} onChange={(e) => {
              if (window._hme_handleFile && e.target.files && e.target.files[0]) {
                window._hme_handleFile(e.target.files[0]);
              }
            }} />
          </div>

          <div id="hme-ai-preview" style={{ display: 'none', marginTop: 16 }}>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', marginBottom: 6, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Selected Image</div>
            <div style={{ width: '100%', height: 140, borderRadius: 8, overflow: 'hidden', border: '0.5px solid rgba(255,255,255,0.1)', background: 'rgba(0,0,0,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <img id="hme-preview-img" src="" style={{ maxHeight: '100%', maxWidth: '100%', objectFit: 'contain' }} />
            </div>
          </div>

          <div id="hme-ai-zone-preview" style={{ display: 'none', marginTop: 16, background: 'rgba(255,255,255,0.02)', border: '0.5px solid rgba(255,255,255,0.08)', padding: 12, borderRadius: 8 }}></div>

          <div id="hme-ai-status" style={{ marginTop: 12, fontSize: 13, color: 'rgba(255,255,255,0.5)', minHeight: 20, textAlign: 'center' }} />

          <div id="hme-ai-action-row" style={{ display: 'flex', gap: 8, marginTop: 18 }}>
            <button id="hme-btn-cancel" onClick={() => window._hme_closeModal && window._hme_closeModal()} style={{ flex: 1, padding: '8px', borderRadius: 8, fontSize: 13, cursor: 'pointer', border: '0.5px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.7)' }}>Cancel</button>
            <button id="hme-btn-analyze" disabled onClick={() => window._hme_analyzeImage && window._hme_analyzeImage()} style={{ flex: 1, padding: '8px', borderRadius: 8, fontSize: 13, cursor: 'pointer', border: '0.5px solid rgba(59,130,246,0.5)', background: 'rgba(59,130,246,0.15)', color: '#93c5fd', fontWeight: 600 }}>Analyze with AI</button>
            <button id="hme-btn-sample" onClick={() => window._hme_generateLayout && window._hme_generateLayout()} style={{ flex: 1, padding: '8px', borderRadius: 8, fontSize: 13, cursor: 'pointer', border: '0.5px solid rgba(139,92,246,0.5)', background: 'rgba(139,92,246,0.15)', color: '#ddd6fe', fontWeight: 600 }}>Sample Layout (Instant)</button>
          </div>

          <div id="hme-ai-confirm-row" style={{ display: 'none', gap: 8, marginTop: 18 }}>
            <button onClick={() => window._hme_closeModal && window._hme_closeModal()} style={{ flex: 1, padding: '8px', borderRadius: 8, fontSize: 13, cursor: 'pointer', border: '0.5px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.7)' }}>Discard</button>
            <button onClick={() => window._hme_confirmAIImport && window._hme_confirmAIImport(false)} style={{ flex: 1, padding: '8px', borderRadius: 8, fontSize: 13, cursor: 'pointer', border: '0.5px solid rgba(59,130,246,0.5)', background: 'rgba(59,130,246,0.15)', color: '#93c5fd', fontWeight: 600 }}>+ Add to Map</button>
            <button onClick={() => window._hme_confirmAIImport && window._hme_confirmAIImport(true)} style={{ flex: 1, padding: '8px', borderRadius: 8, fontSize: 13, cursor: 'pointer', border: '0.5px solid rgba(239,68,68,0.5)', background: 'rgba(239,68,68,0.15)', color: '#fca5a5', fontWeight: 600 }}>Replace Map</button>
          </div>
        </div>
      </div>

      {/* Validate Modal */}
      <div id="hme-validate-modal" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'none', alignItems: 'center', justifyContent: 'center', zIndex: 1010, backdropFilter: 'blur(4px)' }}>
        <div style={{ background: '#0d1326', borderRadius: 14, border: '0.5px solid rgba(255,255,255,0.1)', width: 460, maxWidth: '95vw', padding: 28, maxHeight: '80vh', overflowY: 'auto', boxShadow: '0 24px 64px rgba(0,0,0,0.7)' }}>
          <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 18, color: "white" }}>Map Validation Report</h2>
          <div id="hme-validate-content" />
          <div style={{ marginTop: 14, padding: '10px 12px', borderRadius: 8, border: '0.5px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.03)' }}>
            <p id="hme-publish-status" style={{ margin: 0, fontSize: 12, color: 'rgba(255,255,255,0.58)', lineHeight: 1.5 }}>
              Validate a mapped floor to see what will be added to the live system.
            </p>
          </div>
          <div style={{ marginTop: 18, display: 'flex', justifyContent: 'space-between', gap: 10 }}>
            <button
              id="hme-publish-floor-btn"
              onClick={() => window._hme_publishFloor()}
              style={{ fontSize: 13, padding: '6px 18px', borderRadius: 8, border: '0.5px solid rgba(34,197,94,0.45)', background: 'rgba(34,197,94,0.12)', color: '#86efac', cursor: 'pointer', fontWeight: 600 }}
            >
              Add Floor To System
            </button>
            <button onClick={() => document.getElementById('hme-validate-modal').style.display = 'none'} style={{ fontSize: 13, padding: '6px 18px', borderRadius: 8, border: '0.5px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.7)', cursor: 'pointer' }}>Close</button>
          </div>
        </div>
      </div>

      {/* Scoped styles */}
      <style>{`
        .hme-zone-item {
          padding: 6px 12px;
          font-size: 12px;
          cursor: grab;
          border-bottom: 0.5px solid rgba(255,255,255,0.05);
          display: flex;
          align-items: center;
          gap: 8px;
          color: rgba(255,255,255,0.7);
          user-select: none;
          transition: background 0.12s;
        }
        .hme-zone-item:hover { background: rgba(255,255,255,0.04); }
        .hme-zone-dot {
          width: 10px;
          height: 10px;
          border-radius: 3px;
          flex-shrink: 0;
        }
        .hme-tool-btn {
          font-size: 11px;
          padding: 4px 10px;
          border-radius: 6px;
          border: 0.5px solid rgba(255,255,255,0.1);
          background: rgba(255,255,255,0.04);
          color: rgba(255,255,255,0.65);
          cursor: pointer;
          transition: background 0.15s, color 0.15s;
          white-space: nowrap;
        }
        .hme-tool-btn:hover { background: rgba(255,255,255,0.08); color: white; }
        .hme-tool-btn.hme-active {
          background: rgba(59,130,246,0.15);
          color: #93c5fd;
          border-color: rgba(59,130,246,0.4);
        }
        .hme-tool-btn:disabled { opacity: 0.35; cursor: not-allowed; }
        .hme-btn-ai {
          background: rgba(139,92,246,0.12);
          color: #c4b5fd;
          border-color: rgba(139,92,246,0.35);
        }
        .hme-btn-ai:hover { background: rgba(139,92,246,0.2); color: #ddd6fe; }
        .hme-btn-validate {
          background: rgba(245,158,11,0.1);
          color: #fcd34d;
          border-color: rgba(245,158,11,0.35);
        }
        .hme-btn-validate:hover { background: rgba(245,158,11,0.18); }
        .hme-floor-btn {
          font-size: 11px;
          padding: 3px 10px;
          border-radius: 6px;
          border: 0.5px solid rgba(255,255,255,0.1);
          background: rgba(255,255,255,0.04);
          color: rgba(255,255,255,0.55);
          cursor: pointer;
          white-space: nowrap;
          transition: background 0.12s;
        }
        .hme-floor-btn:hover { background: rgba(255,255,255,0.08); color: white; }
        .hme-floor-btn.hme-floor-active {
          background: rgba(59,130,246,0.15);
          color: #93c5fd;
          border-color: rgba(59,130,246,0.4);
          font-weight: 600;
        }
        .hme-floor-chip {
          display: inline-flex;
          align-items: center;
          gap: 4px;
        }
        .hme-floor-remove-btn {
          width: 22px;
          height: 22px;
          border-radius: 999px;
          border: 0.5px solid rgba(239,68,68,0.25);
          background: rgba(239,68,68,0.08);
          color: rgba(252,165,165,0.9);
          cursor: pointer;
          font-size: 11px;
          line-height: 1;
          transition: background 0.12s, color 0.12s;
        }
        .hme-floor-remove-btn:hover {
          background: rgba(239,68,68,0.16);
          color: #fecaca;
        }
        .hme-prop-row { margin-bottom: 10px; }
        .hme-prop-label { font-size: 10px; color: rgba(255,255,255,0.35); margin-bottom: 3px; }
        .hme-prop-val { font-size: 12px; color: rgba(255,255,255,0.8); font-weight: 500; }
        .hme-prop-input {
          width: 100%;
          font-size: 12px;
          padding: 4px 8px;
          border-radius: 6px;
          border: 0.5px solid rgba(255,255,255,0.1);
          background: rgba(255,255,255,0.05);
          color: white;
          outline: none;
        }
        .hme-prop-input:focus { border-color: rgba(59,130,246,0.5); }
        .hme-del-btn {
          width: calc(100% - 0px);
          margin-top: 12px;
          font-size: 12px;
          padding: 6px;
          border-radius: 6px;
          border: 0.5px solid rgba(239,68,68,0.35);
          background: rgba(239,68,68,0.08);
          color: #f87171;
          cursor: pointer;
          transition: background 0.15s;
        }
        .hme-del-btn:hover { background: rgba(239,68,68,0.16); }
        .hme-dz-over { background: rgba(59,130,246,0.08) !important; border-color: rgba(59,130,246,0.6) !important; }
      `}</style>
    </div>
  );
}
