// Pipeline Studio — SP3 2D node editor. Palette (left) · canvas (center, nodes +
// SVG wires) · config (right). Drag nodes, connect type-matching ports, edit each
// block's model/thinking/promptBody, then Save / Use (set as the active Customize
// pipeline). Backed by the pipeline-* IPC. Vanilla DOM/SVG — no framework.

const MODELS = ['deepseek-v4-flash', 'deepseek-v4-pro'];

export function createPipelineStudio({ api, onUsed, showFeedback }) {
  const el = (id) => document.getElementById(id);
  const root = el('pipeline-studio');
  if (!root) return { open: () => {}, close: () => {} };
  const canvas = el('ps-canvas');
  const wires = el('ps-wires');
  const palette = el('ps-palette');
  const config = el('ps-config');
  const status = el('ps-status');
  const libBtn = el('ps-library-btn');
  const libMenu = el('ps-library-menu');
  const nameInput = el('ps-name');
  let libItems = []; // [{id,name,builtin,nodes}] for the custom dropdown

  let blockTypes = [];      // [{id,label,inputs,outputType,defaults,schemaId}]
  let typeById = {};
  let pipeline = null;      // working copy {id,name,nodes,edges,version,builtin}
  let selectedId = null;
  let connecting = null;    // { fromNode } while drawing an edge
  let seq = 0;

  function setStatus(msg, kind) { status.textContent = msg || ''; status.dataset.kind = kind || ''; }

  function slug(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || `pipeline-${Date.now().toString(36)}`; }
  function uniqueNodeId(type) { let i = ++seq; let id = `${type}-${i}`; const has = (x) => pipeline.nodes.some((n) => n.id === x); while (has(id)) { i = ++seq; id = `${type}-${i}`; } return id; }

  async function loadBlockTypes() {
    const r = await api.pipelineBlockTypes();
    blockTypes = (r && r.blockTypes) || [];
    typeById = Object.fromEntries(blockTypes.map((t) => [t.id, t]));
  }

  async function refreshLibrary(selectId) {
    const r = await api.pipelineList();
    libItems = (r && r.pipelines) || [];
    // Custom dropdown (native <select> popups do not render on this transparent
    // frameless window — they silently fail to open). Build clickable rows.
    libMenu.innerHTML = `<button type="button" class="ps-libpick__item" data-pid="" role="option">+ 新建（克隆 Expert）</button>`
      + libItems.map((p) => `<button type="button" class="ps-libpick__item" data-pid="${escapeAttr(p.id)}" role="option">${p.builtin ? '★ ' : ''}${escapeAttr(p.name)} <span class="ps-libpick__n">(${p.nodes})</span></button>`).join('');
    setLibLabel(selectId != null ? selectId : '');
  }

  function setLibLabel(id) {
    const found = libItems.find((p) => p.id === id);
    libBtn.textContent = (found ? `${found.builtin ? '★ ' : ''}${found.name}` : '+ 新建（克隆 Expert）') + ' ▾';
  }

  function toggleLibMenu(open) {
    const show = open == null ? libMenu.classList.contains('hidden') : open;
    libMenu.classList.toggle('hidden', !show);
    libBtn.setAttribute('aria-expanded', show ? 'true' : 'false');
  }

  function escapeAttr(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

  async function loadPipeline(id) {
    if (!id) {
      const r = await api.pipelineGet('expert');
      const base = r && r.pipeline ? r.pipeline : { nodes: [], edges: [] };
      pipeline = JSON.parse(JSON.stringify(base));
      pipeline.id = ''; pipeline.name = '我的流程'; pipeline.builtin = false; pipeline.version = 'custom_v1';
    } else {
      const r = await api.pipelineGet(id);
      pipeline = r && r.pipeline ? JSON.parse(JSON.stringify(r.pipeline)) : null;
      if (!pipeline) { setStatus('加载流程失败', 'error'); return; }
    }
    selectedId = null;
    nameInput.value = pipeline.name || '';
    setLibLabel(id || '');
    render();
    setStatus(pipeline.builtin ? '内置预设 — 保存将创建可编辑副本。' : '');
  }

  function addNode(typeId) {
    const t = typeById[typeId];
    if (!t) return;
    const id = uniqueNodeId(typeId);
    pipeline.nodes.push({ id, type: typeId, pos: { x: 60 + (pipeline.nodes.length % 5) * 40, y: 60 + (pipeline.nodes.length % 6) * 30 } });
    selectedId = id;
    render();
  }

  function deleteNode(id) {
    pipeline.nodes = pipeline.nodes.filter((n) => n.id !== id);
    pipeline.edges = pipeline.edges.filter((e) => e.fromNode !== id && e.toNode !== id);
    if (selectedId === id) selectedId = null;
    render();
  }

  // Connect output(fromNode) → input(toNode.toPort) if types match. One inbound
  // edge per (toNode,toPort): replace any existing.
  function tryConnect(fromNode, toNode, toPort) {
    if (fromNode === toNode) return;
    const fromType = typeById[pipeline.nodes.find((n) => n.id === fromNode).type];
    const toType = typeById[pipeline.nodes.find((n) => n.id === toNode).type];
    const port = (toType.inputs || []).find((p) => p.name === toPort);
    if (!port) return;
    if (port.type !== fromType.outputType) { setStatus(`类型不匹配: ${fromType.outputType} → ${port.type}`, 'error'); return; }
    pipeline.edges = pipeline.edges.filter((e) => !(e.toNode === toNode && e.toPort === toPort));
    pipeline.edges.push({ fromNode, fromPort: 'out', toNode, toPort });
    setStatus('');
    render();
  }

  // ── Rendering ──────────────────────────────────────────────────────────────
  function render() {
    // nodes
    canvas.querySelectorAll('.ps-node').forEach((n) => n.remove());
    for (const node of pipeline.nodes) {
      const t = typeById[node.type] || { label: node.type, inputs: [], outputType: '?' };
      const div = document.createElement('div');
      div.className = `ps-node${selectedId === node.id ? ' is-selected' : ''}`;
      div.style.left = `${(node.pos && node.pos.x) || 40}px`;
      div.style.top = `${(node.pos && node.pos.y) || 40}px`;
      div.dataset.node = node.id;
      const inputs = (t.inputs || []).map((p) => `<div class="ps-port ps-port--in" data-node="${node.id}" data-port="${p.name}" data-type="${p.type}" title="${p.name}:${p.type}"><span class="ps-dot"></span><span class="ps-portlbl">${p.name}</span></div>`).join('');
      div.innerHTML = `
        <div class="ps-node__hdr"><span>${escapeAttr(t.label)}</span><button class="ps-node__del" data-del="${node.id}" title="删除">✕</button></div>
        <div class="ps-node__id">${node.id}${node.promptBody ? ' ·✎' : ''}${node.model ? ` ·${node.model.replace('deepseek-v4-', '')}` : ''}</div>
        <div class="ps-node__ports">
          <div class="ps-ports-in">${inputs}</div>
          <div class="ps-port ps-port--out" data-node="${node.id}" data-type="${t.outputType}" title="输出:${t.outputType}"><span class="ps-portlbl">${t.outputType}</span><span class="ps-dot"></span></div>
        </div>`;
      canvas.appendChild(div);
    }
    drawWires();
    renderConfig();
  }

  function portCenter(sel) {
    const node = canvas.querySelector(sel);
    if (!node) return null;
    const dot = node.querySelector('.ps-dot') || node;
    const cr = canvas.getBoundingClientRect();
    const r = dot.getBoundingClientRect();
    return { x: r.left + r.width / 2 - cr.left + canvas.scrollLeft, y: r.top + r.height / 2 - cr.top + canvas.scrollTop };
  }

  function drawWires() {
    while (wires.firstChild) wires.removeChild(wires.firstChild);
    for (const e of pipeline.edges) {
      const a = portCenter(`.ps-port--out[data-node="${e.fromNode}"]`);
      const b = portCenter(`.ps-port--in[data-node="${e.toNode}"][data-port="${e.toPort}"]`);
      if (!a || !b) continue;
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      const dx = Math.max(30, Math.abs(b.x - a.x) / 2);
      path.setAttribute('d', `M ${a.x} ${a.y} C ${a.x + dx} ${a.y} ${b.x - dx} ${b.y} ${b.x} ${b.y}`);
      path.setAttribute('class', 'ps-wire');
      wires.appendChild(path);
    }
  }

  function renderConfig() {
    if (!selectedId) { config.innerHTML = '<div class="ps-config__empty">选择一个节点进行配置。</div>'; return; }
    const node = pipeline.nodes.find((n) => n.id === selectedId);
    if (!node) { config.innerHTML = ''; return; }
    const t = typeById[node.type] || {};
    const thinking = node.thinking || t.defaults.thinking || { type: 'disabled' };
    const isOn = thinking && thinking.type === 'enabled';
    config.innerHTML = `
      <h4 class="ps-config__title">${escapeAttr(t.label || node.type)} <span class="ps-config__id">${node.id}</span></h4>
      <label class="ps-field"><span>模型</span>
        <select id="ps-f-model">${MODELS.concat(node.model && !MODELS.includes(node.model) ? [node.model] : []).map((m) => `<option ${(node.model || t.defaults.model) === m ? 'selected' : ''}>${m}</option>`).join('')}</select>
      </label>
      <label class="ps-field ps-field--row"><span>思考</span>
        <input type="checkbox" id="ps-f-think" ${isOn ? 'checked' : ''} /> <span class="ps-muted">预算</span>
        <input type="number" id="ps-f-budget" value="${isOn ? (thinking.budget_tokens || 1024) : 1024}" min="0" step="256" ${isOn ? '' : 'disabled'} style="width:80px" />
      </label>
      <label class="ps-field ps-field--row"><span>温度</span><input type="number" id="ps-f-temp" value="${node.temperature != null ? node.temperature : (t.defaults.temperature != null ? t.defaults.temperature : 0.2)}" step="0.05" min="0" max="1" style="width:80px" /></label>
      <label class="ps-field"><span>提示词正文 — 默认已显示；编辑以微调（schema/输入保持不变）。不修改则使用默认值。</span>
        <textarea id="ps-f-body" rows="10">${escapeAttr(node.promptBody != null ? node.promptBody : (t.defaultBody || ''))}</textarea>
        <button type="button" id="ps-f-reset" class="ps-btn" style="align-self:flex-start;margin-top:4px">恢复默认</button>
      </label>`;
    el('ps-f-model').addEventListener('change', (ev) => { node.model = ev.target.value; render(); });
    el('ps-f-think').addEventListener('change', (ev) => {
      node.thinking = ev.target.checked ? { type: 'enabled', budget_tokens: Number(el('ps-f-budget').value) || 1024 } : { type: 'disabled' };
      renderConfig();
    });
    el('ps-f-budget').addEventListener('change', (ev) => { if (node.thinking && node.thinking.type === 'enabled') node.thinking.budget_tokens = Number(ev.target.value) || 1024; });
    el('ps-f-temp').addEventListener('change', (ev) => { node.temperature = Number(ev.target.value); });
    el('ps-f-body').addEventListener('change', (ev) => {
      const val = ev.target.value;
      const def = (t.defaultBody || '');
      // Unchanged from the default → store nothing (engine uses the builder default).
      node.promptBody = (val.trim() === def.trim() || val.trim() === '') ? undefined : val;
      render();
    });
    el('ps-f-reset').addEventListener('click', () => { node.promptBody = undefined; renderConfig(); render(); });
  }

  // ── Canvas interactions (event delegation) ──────────────────────────────────
  let drag = null; // { id, dx, dy }
  canvas.addEventListener('mousedown', (ev) => {
    const del = ev.target.closest('.ps-node__del');
    if (del) { deleteNode(del.dataset.del); return; }
    const port = ev.target.closest('.ps-port');
    if (port) {
      if (port.classList.contains('ps-port--out')) { connecting = { fromNode: port.dataset.node }; setStatus('点击匹配的输入端口以连接…'); }
      else if (port.classList.contains('ps-port--in') && connecting) { tryConnect(connecting.fromNode, port.dataset.node, port.dataset.port); connecting = null; }
      ev.preventDefault();
      return;
    }
    const nodeEl = ev.target.closest('.ps-node');
    if (nodeEl) {
      selectedId = nodeEl.dataset.node; renderConfig();
      canvas.querySelectorAll('.ps-node').forEach((n) => n.classList.toggle('is-selected', n.dataset.node === selectedId));
      const node = pipeline.nodes.find((n) => n.id === selectedId);
      if (!node.pos) node.pos = { x: 40, y: 40 };
      drag = { id: selectedId, dx: ev.clientX - node.pos.x, dy: ev.clientY - node.pos.y };
      ev.preventDefault();
    } else { connecting = null; setStatus(''); }
  });
  window.addEventListener('mousemove', (ev) => {
    if (!drag) return;
    const node = pipeline.nodes.find((n) => n.id === drag.id);
    if (!node) return;
    node.pos = { x: Math.max(0, ev.clientX - drag.dx), y: Math.max(0, ev.clientY - drag.dy) };
    const dom = canvas.querySelector(`.ps-node[data-node="${drag.id}"]`);
    if (dom) { dom.style.left = `${node.pos.x}px`; dom.style.top = `${node.pos.y}px`; }
    drawWires();
  });
  window.addEventListener('mouseup', () => { drag = null; });

  // ── Topbar actions ──────────────────────────────────────────────────────────
  function buildPipelineForSave() {
    const name = nameInput.value.trim() || '我的流程';
    const id = (pipeline.id && !pipeline.builtin) ? pipeline.id : slug(name);
    return { ...pipeline, id, name, builtin: false, version: pipeline.version || 'custom_v1' };
  }

  async function doValidate() {
    const r = await api.pipelineValidate({ pipeline: buildPipelineForSave() });
    if (r && r.ok) setStatus('有效 ✓', 'ok');
    else setStatus(`无效: ${(r && r.errors || ['unknown']).join('; ')}`, 'error');
    return r && r.ok;
  }
  async function doSave() {
    const p = buildPipelineForSave();
    const r = await api.pipelineSave({ pipeline: p });
    if (r && r.success) { pipeline.id = p.id; pipeline.builtin = false; setStatus(`已保存"${p.name}"`, 'ok'); await refreshLibrary(p.id); }
    else setStatus(`保存失败: ${r && r.error}`, 'error');
    return r && r.success;
  }

  palette.addEventListener('click', (ev) => { const b = ev.target.closest('[data-add]'); if (b) addNode(b.dataset.add); });
  // Custom template dropdown (replaces a native <select>, which won't open on a
  // transparent frameless window).
  libBtn.addEventListener('click', (ev) => { ev.stopPropagation(); toggleLibMenu(); });
  libMenu.addEventListener('click', (ev) => {
    const item = ev.target.closest('[data-pid]');
    if (!item) return;
    toggleLibMenu(false);
    loadPipeline(item.dataset.pid || '');
  });
  // Click-away closes the menu.
  document.addEventListener('click', (ev) => {
    if (libMenu.classList.contains('hidden')) return;
    if (!ev.target.closest('#ps-library')) toggleLibMenu(false);
  });
  el('ps-validate').addEventListener('click', doValidate);
  el('ps-save').addEventListener('click', doSave);
  el('ps-use').addEventListener('click', async () => {
    if (!(await doValidate())) return;
    if (!(await doSave())) return;
    const r = await api.pipelineSetActive({ id: pipeline.id });
    if (r && r.success) { setStatus(`已激活: ${pipeline.name}（自定义模式）`, 'ok'); if (typeof onUsed === 'function') onUsed(pipeline.id, pipeline.name); close(); }
    else setStatus(`激活失败: ${r && r.error}`, 'error');
  });
  el('ps-export').addEventListener('click', async () => {
    const p = buildPipelineForSave();
    try { await navigator.clipboard.writeText(JSON.stringify(p, null, 2)); setStatus('已导出 JSON 到剪贴板', 'ok'); }
    catch (_) { setStatus('复制失败', 'error'); }
  });
  el('ps-close').addEventListener('click', close);

  function renderPalette() {
    palette.innerHTML = '<div class="ps-palette__title">节点</div>' + blockTypes.map((t) =>
      `<button class="ps-palette__item" data-add="${t.id}" title="输入: ${(t.inputs || []).map((p) => p.type).join(', ') || '—'} → ${t.outputType}">${escapeAttr(t.label)}<span class="ps-palette__type">${t.outputType}</span></button>`).join('');
  }

  async function open(pipelineId) {
    root.classList.remove('hidden');
    if (!blockTypes.length) await loadBlockTypes();
    renderPalette();
    await refreshLibrary(pipelineId || '');
    await loadPipeline(pipelineId || '');
  }
  function close() { root.classList.add('hidden'); connecting = null; drag = null; }

  return { open, close };
}
