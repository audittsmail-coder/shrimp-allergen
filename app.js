import {
  getStoredConfig,
  connect,
  isConnected,
  listPonds,
  listPondHistory,
  deletePondPathogenEntry,
  clearAllPathogenForPond,
} from './firebase.js';

const $ = (sel) => document.querySelector(sel);

const SEV_LABEL = { critical: 'วิกฤต', watch: 'เฝ้าระวัง', normal: 'ปกติ' };
const SEV_CLASS = { critical: 'sev-red', watch: 'sev-amber', normal: 'sev-green' };

let pondsCache = null;
let currentPondId = null;

function escapeAttr(s) {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function farmLabel(farmId) {
  const m = String(farmId || '').match(/\d+/);
  return m ? `ฟาร์ม ${m[0]}` : (farmId || 'ไม่ระบุฟาร์ม');
}

// ---------- Firebase connection ----------
function setFbStatus(text, cls) {
  const el = $('#fbStatusText');
  el.textContent = text;
  el.className = cls || '';
}

async function autoConnect() {
  const cfg = getStoredConfig();
  setFbStatus('กำลังเชื่อมต่อ...', '');
  try {
    await connect(cfg);
    setFbStatus('เชื่อมต่อแล้ว ✅', 'status-txt ok');
  } catch (err) {
    setFbStatus('เชื่อมต่อไม่สำเร็จ', 'status-txt err');
  }
  route(); // showHome()/showDetail() fetch their own data — no manual refresh needed
}

// ---------- Home: pond grid grouped by farm ----------
async function loadHome() {
  const statusEl = $('#homeStatus');
  if (!isConnected()) {
    statusEl.textContent = 'กรุณาตั้งค่า Firebase ก่อน';
    statusEl.className = 'status-txt err';
    return;
  }
  statusEl.textContent = 'กำลังโหลด...';
  statusEl.className = 'status-txt';
  try {
    const ponds = await listPonds();
    pondsCache = ponds;
    statusEl.textContent = `พบ ${ponds.length} บ่อ`;
    statusEl.className = 'status-txt ok';
    renderFarmGroups(ponds);
  } catch (err) {
    statusEl.textContent = 'โหลดไม่สำเร็จ: ' + err.message;
    statusEl.className = 'status-txt err';
  }
}

function renderFarmGroups(ponds) {
  const container = $('#farmGroups');
  container.innerHTML = '';
  const groups = new Map();
  ponds.forEach((p) => {
    const key = p.farmId || '';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(p);
  });
  const sortedKeys = Array.from(groups.keys()).sort((a, b) => farmLabel(a).localeCompare(farmLabel(b), 'th'));
  sortedKeys.forEach((key) => {
    const list = groups.get(key);
    const block = document.createElement('div');
    block.className = 'farm-block';
    const head = document.createElement('div');
    head.className = 'farm-head';
    head.textContent = `${farmLabel(key)} · ${list.length} บ่อ`;
    block.appendChild(head);
    const grid = document.createElement('div');
    grid.className = 'pond-grid';
    list.forEach((p) => grid.appendChild(buildPondTile(p)));
    block.appendChild(grid);
    container.appendChild(block);
  });
}

function buildPondTile(p) {
  const tile = document.createElement('button');
  tile.type = 'button';
  tile.className = 'pond-tile ' + (SEV_CLASS[p.pathogenSeverity] || 'sev-none');
  tile.innerHTML = `
    <div class="pond-tile-no">${escapeAttr(p.name || p.id)}</div>
    <div class="pond-tile-sev">${p.pathogenSeverity ? (SEV_LABEL[p.pathogenSeverity] || p.pathogenSeverity) : 'ไม่มีข้อมูล'}</div>
  `;
  tile.addEventListener('click', () => { location.hash = '#pond=' + encodeURIComponent(p.id); });
  return tile;
}

// ---------- Detail: full history for one pond ----------
async function showDetail(pondId) {
  currentPondId = pondId;
  $('#view-home').style.display = 'none';
  $('#view-detail').style.display = 'block';

  if (!pondsCache) {
    try { pondsCache = await listPonds(); } catch { /* fall through with id-only header */ }
  }

  const pond = (pondsCache || []).find((p) => p.id === pondId);
  $('#detailHeader').innerHTML = `
    <div class="detail-title">บ่อ ${escapeAttr(pond?.name || pondId)}</div>
    <div class="detail-sub">${escapeAttr(farmLabel(pond?.farmId))}${pond?.species ? ' · ' + escapeAttr(pond.species) : ''}</div>
  `;

  const statusEl = $('#detailStatus');
  $('#detailHistory').innerHTML = '';
  if (!isConnected()) {
    statusEl.textContent = 'กรุณาตั้งค่า Firebase ก่อน';
    statusEl.className = 'status-txt err';
    return;
  }
  statusEl.textContent = 'กำลังโหลด...';
  statusEl.className = 'status-txt';
  try {
    const entries = await listPondHistory(pondId);
    statusEl.textContent = entries.length ? `พบ ${entries.length} สัปดาห์` : 'ยังไม่มีข้อมูลผลเชื้อ';
    statusEl.className = 'status-txt ok';
    renderHistory(entries, pondId);
  } catch (err) {
    statusEl.textContent = 'โหลดไม่สำเร็จ: ' + err.message;
    statusEl.className = 'status-txt err';
  }
}

function wqChip(label, value, unit) {
  if (value == null) return '';
  return `<span class="wq-chip">${label} ${escapeAttr(value)}${unit ? ' ' + unit : ''}</span>`;
}

function renderHistory(entries, pondId) {
  const listEl = $('#detailHistory');
  listEl.innerHTML = '';
  // listPondHistory returns oldest-first; show newest-first for a detail/review view,
  // but keep each entry's original array index (needed by deletePondPathogenEntry).
  const ordered = entries.map((e, i) => ({ e, i })).reverse();
  ordered.forEach(({ e, i }) => {
    const card = document.createElement('div');
    card.className = 'history-card ' + (SEV_CLASS[e.severity] || '');
    const wq = [
      wqChip('แอมโมเนีย', e.ammonia, 'mg/L'),
      wqChip('ไนไตรท์', e.nitrite, 'mg/L'),
      wqChip('pH', e.ph, ''),
      wqChip('ด่าง', e.alkalinity, 'mg/L'),
      wqChip('ความเค็ม', e.salinity, 'ppt'),
    ].join('');
    card.innerHTML = `
      <div class="h">${escapeAttr(e.weekDate || '-')}${e.worsened ? ' · ▲ แย่ลง' : ''}</div>
      <div class="sub">${escapeAttr(e.status || '-')}</div>
      ${wq ? `<div class="wq-row">${wq}</div>` : ''}
      <button type="button" class="row-del hist-del-btn">ลบรายการนี้</button>
    `;
    card.querySelector('.hist-del-btn').addEventListener('click', async () => {
      if (!confirm(`ลบผลเชื้อของสัปดาห์ ${e.weekDate} ออก?`)) return;
      try {
        await deletePondPathogenEntry(pondId, i);
        await showDetail(pondId);
      } catch (err) {
        alert('ลบไม่สำเร็จ: ' + err.message);
      }
    });
    listEl.appendChild(card);
  });
}

$('#clearPondBtn').addEventListener('click', async () => {
  if (!currentPondId) return;
  const pond = (pondsCache || []).find((p) => p.id === currentPondId);
  const label = pond?.name || currentPondId;
  if (!confirm(`ลบผลเชื้อทั้งหมดของบ่อ ${label} ทุกสัปดาห์? การกระทำนี้ย้อนกลับไม่ได้ (ข้อมูลไซส์/อาหาร/อัตรารอดจะไม่ถูกลบ)`)) return;
  try {
    await clearAllPathogenForPond(currentPondId);
    await showDetail(currentPondId); // showHome() refetches the grid on the way back, no need to do it here too
  } catch (err) {
    alert('ลบไม่สำเร็จ: ' + err.message);
  }
});

function showHome() {
  currentPondId = null;
  $('#view-detail').style.display = 'none';
  $('#view-home').style.display = 'block';
  loadHome(); // always fetch fresh data, so returning to the grid shows current results
}

$('#backBtn').addEventListener('click', () => { location.hash = ''; });

function route() {
  const m = (location.hash || '').match(/^#pond=(.+)$/);
  if (m) {
    showDetail(decodeURIComponent(m[1]));
  } else {
    showHome();
  }
}
window.addEventListener('hashchange', route);

autoConnect();
