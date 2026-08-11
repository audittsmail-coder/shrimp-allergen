import { parseReportHtml } from './parser.js';
import {
  getStoredConfig,
  storeConfig,
  connect,
  isConnected,
  saveReport,
  listReports,
  listPondHistory,
} from './firebase.js';

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

let parsedData = null;

// ---------- Tabs ----------
$$('.tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    $$('.tab-btn').forEach((b) => b.classList.remove('active'));
    $$('.tab-panel').forEach((p) => p.classList.remove('active'));
    btn.classList.add('active');
    $(`#tab-${btn.dataset.tab}`).classList.add('active');
    if (btn.dataset.tab === 'history') loadHistory();
    if (btn.dataset.tab === 'trend') populatePondSelect();
  });
});

// ---------- Settings / Firebase connection ----------
function setFbStatus(text, cls) {
  const el = $('#fbStatusText');
  el.textContent = text;
  el.className = cls || '';
}

$('#openSettingsBtn').addEventListener('click', () => {
  const cfg = getStoredConfig();
  if (cfg) $('#firebaseConfigInput').value = JSON.stringify(cfg, null, 2);
  $('#settingsModal').style.display = 'flex';
});
$('#closeSettingsBtn').addEventListener('click', () => {
  $('#settingsModal').style.display = 'none';
});

$('#saveConfigBtn').addEventListener('click', async () => {
  const raw = $('#firebaseConfigInput').value.trim();
  const statusEl = $('#configStatus');
  let cfg;
  try {
    cfg = JSON.parse(raw);
  } catch {
    statusEl.textContent = 'รูปแบบ JSON ไม่ถูกต้อง';
    statusEl.className = 'status-txt err';
    return;
  }
  if (!cfg.apiKey || !cfg.projectId) {
    statusEl.textContent = 'ต้องมี apiKey และ projectId อย่างน้อย';
    statusEl.className = 'status-txt err';
    return;
  }
  statusEl.textContent = 'กำลังเชื่อมต่อ...';
  statusEl.className = 'status-txt';
  try {
    await connect(cfg);
    storeConfig(cfg);
    statusEl.textContent = 'เชื่อมต่อสำเร็จ ✅';
    statusEl.className = 'status-txt ok';
    setFbStatus('เชื่อมต่อแล้ว ✅', 'status-txt ok');
    setTimeout(() => {
      $('#settingsModal').style.display = 'none';
    }, 700);
  } catch (err) {
    statusEl.textContent = 'เชื่อมต่อไม่สำเร็จ: ' + err.message;
    statusEl.className = 'status-txt err';
  }
});

async function autoConnect() {
  const cfg = getStoredConfig();
  if (!cfg) {
    setFbStatus('ยังไม่ได้ตั้งค่า — กด ⚙️ ตั้งค่า Firebase', '');
    return;
  }
  setFbStatus('กำลังเชื่อมต่อ...', '');
  try {
    await connect(cfg);
    setFbStatus('เชื่อมต่อแล้ว ✅', 'status-txt ok');
  } catch (err) {
    setFbStatus('เชื่อมต่อไม่สำเร็จ', 'status-txt err');
  }
}
autoConnect();

// ---------- Import / Parse ----------
$('#pasteBtn').addEventListener('click', () => {
  const ta = $('#htmlInput');
  ta.style.display = ta.style.display === 'none' ? 'block' : 'none';
});

$('#fileInput').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const text = await file.text();
  $('#htmlInput').value = text;
  $('#htmlInput').style.display = 'block';
  $('#parseStatus').textContent = `โหลดไฟล์ ${file.name} แล้ว`;
  $('#parseStatus').className = 'status-txt';
});

$('#parseBtn').addEventListener('click', () => {
  const html = $('#htmlInput').value.trim();
  const statusEl = $('#parseStatus');
  if (!html) {
    statusEl.textContent = 'กรุณาวางไฟล์หรือข้อความ HTML ก่อน';
    statusEl.className = 'status-txt err';
    return;
  }
  try {
    parsedData = parseReportHtml(html);
    if (!parsedData.ponds.length) {
      statusEl.textContent = 'แยกข้อมูลสำเร็จ แต่ไม่พบข้อมูลบ่อ — ตรวจสอบโครงสร้าง HTML หรือเพิ่มแถวเอง';
      statusEl.className = 'status-txt err';
    } else {
      statusEl.textContent = `แยกข้อมูลสำเร็จ พบ ${parsedData.ponds.length} รายการบ่อ`;
      statusEl.className = 'status-txt ok';
    }
    renderPreview(parsedData);
  } catch (err) {
    statusEl.textContent = 'แยกข้อมูลไม่สำเร็จ: ' + err.message;
    statusEl.className = 'status-txt err';
  }
});

function renderPreview(data) {
  $('#previewArea').style.display = 'block';
  $('#metaTitle').value = data.title || '';
  $('#metaDistrict').value = data.district || '';
  $('#metaRound').value = data.round || '';

  const tbody = $('#pondTableBody');
  tbody.innerHTML = '';
  data.ponds.forEach((p) => addPondRow(p));

  const extra = $('#extraSummary');
  extra.innerHTML = '';
  if (data.alerts.length) {
    extra.appendChild(
      buildBlock(
        '🔴 บ่อที่ถูกแจ้งเตือน',
        data.alerts.map((a) => `บ่อ ${a.pondNo || '-'}: ${a.title}${a.desc ? ' — ' + a.desc : ''}`)
      )
    );
  }
  if (data.goodNews.length) {
    extra.appendChild(buildBlock('✅ ข่าวดี', data.goodNews.map((g) => `${g.title} — ${g.desc}`)));
  }
  if (data.recommendations.length) {
    extra.appendChild(buildBlock('📋 คำแนะนำ', data.recommendations.map((r) => r.text)));
  }
  if (data.compareTables.length) {
    extra.appendChild(
      buildBlock(
        '📊 ตารางเทียบผล (เก็บดิบไว้ในบันทึก)',
        data.compareTables.map((t, i) => `ตาราง ${i + 1}: ${t.headers.join(' | ')} (${t.rows.length} แถว)`)
      )
    );
  }
}

function buildBlock(heading, lines) {
  const div = document.createElement('div');
  div.className = 'blk';
  const h = document.createElement('div');
  h.className = 'h';
  h.textContent = heading;
  div.appendChild(h);
  lines.forEach((line) => {
    const p = document.createElement('div');
    p.textContent = '• ' + line;
    div.appendChild(p);
  });
  return div;
}

function addPondRow(p = {}) {
  const tbody = $('#pondTableBody');
  const tr = document.createElement('tr');
  tr.className = { critical: 'sev-red', watch: 'sev-amber', normal: 'sev-green' }[p.severity] || '';
  tr.innerHTML = `
    <td><input type="text" class="f-farm" value="${escapeAttr(p.farm || '')}" /></td>
    <td><input type="text" class="f-pond" value="${escapeAttr(p.pondNo || '')}" /></td>
    <td><input type="date" class="f-date" value="${escapeAttr(p.dateISO || '')}" /></td>
    <td><input type="text" class="f-status" value="${escapeAttr(p.status || '')}" /></td>
    <td>
      <select class="f-sev">
        <option value="normal" ${p.severity === 'normal' ? 'selected' : ''}>ปกติ</option>
        <option value="watch" ${p.severity === 'watch' ? 'selected' : ''}>เฝ้าระวัง</option>
        <option value="critical" ${p.severity === 'critical' ? 'selected' : ''}>วิกฤต</option>
      </select>
    </td>
    <td style="text-align:center;"><input type="checkbox" class="f-worse" ${p.worsened ? 'checked' : ''} /></td>
    <td><button type="button" class="row-del">✕</button></td>
  `;
  tr.querySelector('.f-sev').addEventListener('change', (e) => {
    tr.className = { critical: 'sev-red', watch: 'sev-amber', normal: 'sev-green' }[e.target.value] || '';
  });
  tr.querySelector('.row-del').addEventListener('click', () => tr.remove());
  tbody.appendChild(tr);
}

function escapeAttr(s) {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

$('#addRowBtn').addEventListener('click', () => addPondRow());

function readPondsFromTable() {
  return $$('#pondTableBody tr').map((tr) => {
    const dateISO = tr.querySelector('.f-date').value || null;
    return {
      farm: tr.querySelector('.f-farm').value.trim(),
      pondNo: tr.querySelector('.f-pond').value.trim(),
      status: tr.querySelector('.f-status').value.trim(),
      severity: tr.querySelector('.f-sev').value,
      worsened: tr.querySelector('.f-worse').checked,
      dateISO,
      dateRaw: dateISO || '',
    };
  }).filter((p) => p.pondNo);
}

$('#saveBtn').addEventListener('click', async () => {
  const statusEl = $('#saveStatus');
  if (!isConnected()) {
    statusEl.textContent = 'กรุณาตั้งค่า Firebase ก่อน (กด ⚙️ ด้านบน)';
    statusEl.className = 'status-txt err';
    return;
  }
  const ponds = readPondsFromTable();
  if (!ponds.length) {
    statusEl.textContent = 'ไม่มีข้อมูลบ่อให้บันทึก';
    statusEl.className = 'status-txt err';
    return;
  }
  const payload = {
    title: $('#metaTitle').value.trim(),
    district: $('#metaDistrict').value.trim(),
    round: $('#metaRound').value.trim(),
    pondCount: parsedData?.pondCount || '',
    ponds,
    alerts: parsedData?.alerts || [],
    goodNews: parsedData?.goodNews || [],
    recommendations: parsedData?.recommendations || [],
    compareTables: parsedData?.compareTables || [],
  };
  statusEl.textContent = 'กำลังบันทึก...';
  statusEl.className = 'status-txt';
  $('#saveBtn').disabled = true;
  try {
    const id = await saveReport(payload);
    statusEl.textContent = `บันทึกสำเร็จ ✅ (รหัส ${id})`;
    statusEl.className = 'status-txt ok';
  } catch (err) {
    statusEl.textContent = 'บันทึกไม่สำเร็จ: ' + err.message;
    statusEl.className = 'status-txt err';
  } finally {
    $('#saveBtn').disabled = false;
  }
});

// ---------- History ----------
$('#refreshHistoryBtn').addEventListener('click', loadHistory);

async function loadHistory() {
  const statusEl = $('#historyStatus');
  const listEl = $('#historyList');
  if (!isConnected()) {
    statusEl.textContent = 'กรุณาตั้งค่า Firebase ก่อน';
    statusEl.className = 'status-txt err';
    return;
  }
  statusEl.textContent = 'กำลังโหลด...';
  statusEl.className = 'status-txt';
  try {
    const reports = await listReports();
    statusEl.textContent = `พบ ${reports.length} รายงาน`;
    statusEl.className = 'status-txt ok';
    listEl.innerHTML = '';
    reports.forEach((r) => listEl.appendChild(buildHistoryCard(r)));
  } catch (err) {
    statusEl.textContent = 'โหลดไม่สำเร็จ: ' + err.message;
    statusEl.className = 'status-txt err';
  }
}

function buildHistoryCard(report) {
  const div = document.createElement('div');
  div.className = 'history-card';
  const dateStr = report.createdAt?.toDate ? report.createdAt.toDate().toLocaleString('th-TH') : '';
  div.innerHTML = `
    <div class="h">${escapeAttr(report.title || 'รายงาน')}</div>
    <div class="sub">${escapeAttr(report.district || '')} ${report.round ? '· รอบ ' + escapeAttr(report.round) : ''} ${dateStr ? '· บันทึกเมื่อ ' + dateStr : ''}</div>
    <div class="ponds"></div>
  `;
  const pondsEl = div.querySelector('.ponds');
  (report.ponds || []).forEach((p) => {
    const chip = document.createElement('span');
    chip.className = 'chip ' + ({ critical: 'red', watch: 'amber', normal: 'green' }[p.severity] || 'amber');
    chip.textContent = `บ่อ ${p.pondNo}${p.dateRaw ? ' (' + p.dateRaw + ')' : ''}`;
    chip.title = p.status;
    pondsEl.appendChild(chip);
  });
  return div;
}

// ---------- Trend ----------
async function populatePondSelect() {
  const sel = $('#pondSelect');
  const statusEl = $('#trendStatus');
  if (!isConnected()) {
    statusEl.textContent = 'กรุณาตั้งค่า Firebase ก่อน';
    statusEl.className = 'status-txt err';
    return;
  }
  if (sel.dataset.loaded) return;
  statusEl.textContent = 'กำลังโหลดรายชื่อบ่อ...';
  try {
    const reports = await listReports();
    const pondNos = new Set();
    reports.forEach((r) => (r.ponds || []).forEach((p) => pondNos.add(p.pondNo)));
    Array.from(pondNos)
      .sort()
      .forEach((no) => {
        const opt = document.createElement('option');
        opt.value = no;
        opt.textContent = 'บ่อ ' + no;
        sel.appendChild(opt);
      });
    sel.dataset.loaded = '1';
    statusEl.textContent = `พบ ${pondNos.size} บ่อ`;
    statusEl.className = 'status-txt ok';
  } catch (err) {
    statusEl.textContent = 'โหลดไม่สำเร็จ: ' + err.message;
    statusEl.className = 'status-txt err';
  }
}

$('#pondSelect').addEventListener('change', async (e) => {
  const pondNo = e.target.value;
  const resultEl = $('#trendResult');
  const statusEl = $('#trendStatus');
  resultEl.innerHTML = '';
  if (!pondNo) return;
  statusEl.textContent = 'กำลังโหลดเทรนด์...';
  try {
    const entries = await listPondHistory(pondNo);
    statusEl.textContent = `พบ ${entries.length} รายการ`;
    statusEl.className = 'status-txt ok';
    const table = document.createElement('table');
    table.className = 'edit-table';
    table.innerHTML = `
      <thead><tr><th>วันที่</th><th>ฟาร์ม</th><th>สถานะ</th><th>ระดับ</th></tr></thead>
      <tbody>
        ${entries
          .map(
            (e) => `
          <tr class="${{ critical: 'sev-red', watch: 'sev-amber', normal: 'sev-green' }[e.severity] || ''}">
            <td>${escapeAttr(e.dateRaw || e.dateISO || '-')}</td>
            <td>${escapeAttr(e.farm || '-')}</td>
            <td>${escapeAttr(e.status || '-')}</td>
            <td>${escapeAttr(e.severity || '-')}</td>
          </tr>`
          )
          .join('')}
      </tbody>
    `;
    resultEl.appendChild(table);
  } catch (err) {
    statusEl.textContent = 'โหลดไม่สำเร็จ: ' + err.message;
    statusEl.className = 'status-txt err';
  }
});
