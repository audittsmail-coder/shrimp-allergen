import {
  getStoredConfig,
  connect,
  isConnected,
  listPonds,
  listPondHistory,
  deletePondPathogenEntry,
  clearAllPathogenForPond,
} from './firebase.js?v=5'; // bump alongside index.html's ?v= on every deploy (cache-busting)

const $ = (sel) => document.querySelector(sel);

const SEV_LABEL = { critical: 'วิกฤต', watch: 'เฝ้าระวัง', normal: 'ปกติ' };
const SEV_CLASS = { critical: 'sev-red', watch: 'sev-amber', normal: 'sev-green' };

let pondsCache = null;
let currentPondId = null;
let chartInstances = [];

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
  destroyCharts();
  if (!isConnected()) {
    statusEl.textContent = 'กรุณาตั้งค่า Firebase ก่อน';
    statusEl.className = 'status-txt err';
    return;
  }
  statusEl.textContent = 'กำลังโหลด...';
  statusEl.className = 'status-txt';
  try {
    const entries = await listPondHistory(pondId); // oldest-first, full pathogenHistory
    // Only show results from the pond's current stocking cycle — a prior cycle's results
    // belong to that cycle's own (now-closed) pond doc in principle, but this guards against
    // the same doc ever carrying leftover entries from before its current releaseDate too.
    // Each entry keeps its original array index (i), since deletePondPathogenEntry indexes
    // into the full sorted pathogenHistory array, not this filtered view.
    const cutoff = pond?.releaseDate || null;
    const visible = entries
      .map((e, i) => ({ e, i }))
      .filter(({ e }) => !cutoff || !e.weekDate || e.weekDate >= cutoff);
    statusEl.textContent = visible.length ? `พบ ${visible.length} สัปดาห์ (รอบปัจจุบัน)` : 'ยังไม่มีข้อมูลผลเชื้อในรอบนี้';
    statusEl.className = 'status-txt ok';
    renderHistory(visible, pondId);
    renderCharts(visible);
  } catch (err) {
    statusEl.textContent = 'โหลดไม่สำเร็จ: ' + err.message;
    statusEl.className = 'status-txt err';
  }
}

function cell(value, unit) {
  // Spreadsheet-style: a reading this week didn't record simply stays a blank cell,
  // not a "-" placeholder.
  if (value == null) return '';
  return escapeAttr(value) + (unit ? ' ' + unit : '');
}

function renderHistory(visible, pondId) {
  const wrap = $('#detailHistory');
  wrap.innerHTML = '';
  if (!visible.length) return;

  const table = document.createElement('table');
  table.className = 'history-table';
  table.innerHTML = `
    <thead>
      <tr>
        <th>วันที่</th>
        <th>สถานะ / ผลเชื้อ</th>
        <th>แอมโมเนีย</th>
        <th>ไนไตรท์</th>
        <th>pH</th>
        <th>ด่าง</th>
        <th>ความเค็ม</th>
        <th>แย่ลง?</th>
        <th></th>
      </tr>
    </thead>
    <tbody></tbody>
  `;
  const tbody = table.querySelector('tbody');

  // `visible` is oldest-first (filtered to the current cycle); show newest-first for a
  // detail/review view. Each item keeps its original pathogenHistory index (i).
  const ordered = visible.slice().reverse();
  ordered.forEach(({ e, i }) => {
    const tr = document.createElement('tr');
    tr.className = SEV_CLASS[e.severity] || '';
    tr.innerHTML = `
      <td>${escapeAttr(e.weekDate || '')}</td>
      <td class="status-cell">${escapeAttr(e.status || '')}</td>
      <td>${cell(e.ammonia, 'mg/L')}</td>
      <td>${cell(e.nitrite, 'mg/L')}</td>
      <td>${cell(e.ph)}</td>
      <td>${cell(e.alkalinity, 'mg/L')}</td>
      <td>${cell(e.salinity, 'ppt')}</td>
      <td style="text-align:center;">${e.worsened ? '▲' : ''}</td>
      <td><button type="button" class="row-del hist-del-btn">ลบ</button></td>
    `;
    tr.querySelector('.hist-del-btn').addEventListener('click', async () => {
      if (!confirm(`ลบผลเชื้อของสัปดาห์ ${e.weekDate} ออก?`)) return;
      try {
        await deletePondPathogenEntry(pondId, i);
        await showDetail(pondId);
      } catch (err) {
        alert('ลบไม่สำเร็จ: ' + err.message);
      }
    });
    tbody.appendChild(tr);
  });

  const scroller = document.createElement('div');
  scroller.className = 'table-scroll';
  scroller.appendChild(table);
  wrap.appendChild(scroller);
}

function destroyCharts() {
  chartInstances.forEach((c) => c.destroy());
  chartInstances = [];
}

const CHART_METRICS = [
  { key: 'ammonia', label: 'แอมโมเนีย (mg/L)', color: '#e15a4d' },
  { key: 'nitrite', label: 'ไนไตรท์ (mg/L)', color: '#e8a23b' },
  { key: 'ph', label: 'pH', color: '#4f92dd' },
  { key: 'alkalinity', label: 'ด่าง (mg/L)', color: '#2f9e6e' },
  { key: 'salinity', label: 'ความเค็ม (ppt)', color: '#9b7fd4' },
];

function renderCharts(visible) {
  const container = $('#detailCharts');
  container.innerHTML = '';
  destroyCharts();
  if (typeof Chart === 'undefined' || visible.length < 2) return; // need Chart.js + at least 2 points for a trend line

  const labels = visible.map(({ e }) => e.weekDate || ''); // visible is oldest-first already

  CHART_METRICS.forEach((m) => {
    const data = visible.map(({ e }) => (e[m.key] != null ? e[m.key] : null));
    if (!data.some((v) => v != null)) return; // nothing recorded for this metric at all

    const card = document.createElement('div');
    card.className = 'chart-card';
    card.innerHTML = `<div class="chart-title">${m.label}</div><div class="chart-canvas-wrap"><canvas></canvas></div>`;
    container.appendChild(card);

    const chart = new Chart(card.querySelector('canvas'), {
      type: 'line',
      data: {
        labels,
        datasets: [{
          data,
          borderColor: m.color,
          backgroundColor: m.color + '22',
          tension: 0.3,
          pointRadius: 2,
          borderWidth: 1.5,
          spanGaps: false, // a week with no reading breaks the line rather than being interpolated
          fill: true,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { font: { size: 7 }, color: '#9fb3d1', maxRotation: 45, maxTicksLimit: 4 }, grid: { display: false } },
          y: { ticks: { font: { size: 7 }, color: '#9fb3d1', maxTicksLimit: 4 }, grid: { color: 'rgba(255,255,255,0.06)' } },
        },
      },
    });
    chartInstances.push(chart);
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
