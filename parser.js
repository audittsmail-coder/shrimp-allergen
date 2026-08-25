// Parses the weekly shrimp-farm lab report (summary_v2.html style) into structured data.
// The report template is hand-authored but reuses a stable set of CSS classes each week:
// .farm-divider / .farm-group-label mark which farm a block belongs to,
// .pcard is one pond's current-week status, .severe/.alert are flagged ponds,
// .issue-grid is good news, .reco-item is a recommendation, .compare-table is a multi-week table.

const DATE_RE = /(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/;

function currentBEYear() {
  return new Date().getFullYear() + 543;
}

// Converts a Thai short date ("10/8/69" or "22/6") to an ISO date string (Gregorian).
// A 2-digit year is treated as Buddhist Era (BE); missing year falls back to contextYearBE.
export function thaiDateToISO(raw, contextYearBE) {
  const m = raw && raw.match(DATE_RE);
  if (!m) return null;
  const day = parseInt(m[1], 10);
  const month = parseInt(m[2], 10);
  let yearBE = m[3] ? parseInt(m[3], 10) : contextYearBE || currentBEYear();
  if (yearBE < 100) yearBE += 2500;
  const gYear = yearBE - 543;
  if (!day || !month || month > 12 || day > 31) return null;
  const iso = `${gYear.toString().padStart(4, '0')}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
  return iso;
}

function extractFirstDate(text, contextYearBE) {
  const m = text && text.match(DATE_RE);
  if (!m) return null;
  return { raw: m[0], iso: thaiDateToISO(m[0], contextYearBE) };
}

function sevFromClass(el) {
  if (el.classList.contains('red')) return 'critical';
  if (el.classList.contains('amber')) return 'watch';
  if (el.classList.contains('green')) return 'normal';
  return 'unknown';
}

// Best-effort extraction of water-quality readings when a report happens to mention them
// in a pond's status text or alert description (e.g. "แอมโมเนีย 0.5 mg/L") — the sample
// report doesn't include these at all, so this mostly matters for future report formats.
// Falls back to null (left blank for manual entry in the preview table) when not found.
function extractNumberAfterLabel(text, labelPattern) {
  const re = new RegExp(labelPattern + '[^0-9]{0,10}(\\d+(?:\\.\\d+)?)');
  const m = text.match(re);
  return m ? parseFloat(m[1]) : null;
}

function extractWaterQuality(text) {
  return {
    ammonia: extractNumberAfterLabel(text, 'แอมโมเนีย'),
    nitrite: extractNumberAfterLabel(text, 'ไนไตร(?:ท์)?'),
  };
}

export function parseReportHtml(htmlString) {
  const doc = new DOMParser().parseFromString(htmlString, 'text/html');
  const contextYearBE = currentBEYear();

  const title = doc.querySelector('title')?.textContent?.trim()
    || doc.querySelector('.hero h1')?.textContent?.trim()
    || 'รายงานผลตรวจ';

  const metaEl = doc.querySelector('.hero .meta');
  let district = '', round = '', pondCount = '';
  if (metaEl) {
    Array.from(metaEl.children).forEach((child) => {
      const text = child.textContent.replace(/\s+/g, ' ').trim();
      if (text.startsWith('เขต')) district = text.replace(/^เขต\s*/, '').trim();
      else if (text.startsWith('รอบ')) round = text.replace(/^รอบ\s*/, '').trim();
      else if (/บ่อสะสม/.test(text)) pondCount = text.replace(/\s*บ่อสะสม.*/, '').trim();
    });
  }

  // Walk the document in order, tracking "current farm" / "current date" context
  // so pond cards inherit the nearest preceding farm/date label.
  const ponds = [];
  let currentFarm = '';
  let currentDate = { raw: '', iso: null };

  const all = doc.body ? doc.body.querySelectorAll('*') : [];
  all.forEach((el) => {
    if (el.classList.contains('farm-divider')) {
      const tag = el.querySelector('.tag')?.textContent?.trim();
      if (tag) currentFarm = tag;
      const txt = el.querySelector('.txt')?.textContent || '';
      const d = extractFirstDate(txt, contextYearBE);
      if (d) currentDate = d;
      return;
    }
    if (el.classList.contains('farm-group-label')) {
      const t = el.textContent.replace(/[^\wก-๙\s]/g, '').trim();
      if (t) currentFarm = t;
      return;
    }
    if (el.classList.contains('section-label')) {
      const d = extractFirstDate(el.textContent, contextYearBE);
      if (d) currentDate = d;
      return;
    }
    if (el.classList.contains('pcard')) {
      const pondNo = el.querySelector('.pname')?.textContent?.trim() || '';
      const status = el.querySelector('.pstate')?.textContent?.trim() || '';
      const worsened = !!el.querySelector('.badge');
      if (pondNo) {
        ponds.push({
          farm: currentFarm,
          pondNo,
          status,
          severity: sevFromClass(el),
          worsened,
          dateRaw: currentDate.raw,
          dateISO: currentDate.iso,
        });
      }
    }
  });

  // Alerts (severe + regular) — pond-level flagged issues with free-text description.
  const alerts = [];
  doc.querySelectorAll('.severe, .alert').forEach((el) => {
    const pondNo = (el.querySelector('.pond')?.textContent || '').replace(/\s+/g, ' ').replace(/บ่อ/g, '').trim();
    const title = el.querySelector('.body .t, .t')?.textContent?.trim() || '';
    const desc = el.querySelector('.body .d, .d')?.textContent?.trim() || '';
    const tag = el.querySelector('.body .tag, .tag')?.textContent?.trim() || '';
    const stats = Array.from(el.querySelectorAll('.stat-chip')).map((s) => s.textContent.trim());
    if (title || desc) {
      alerts.push({
        pondNo,
        level: el.classList.contains('severe') ? 'severe' : 'alert',
        title,
        desc,
        tag,
        stats,
      });
    }
  });

  // Merge in any water-quality readings mentioned in a pond's own status text or in an
  // alert about that pond (matched by pond number), so they don't need re-typing by hand
  // when the report happens to include them.
  const alertTextByPond = {};
  alerts.forEach((a) => {
    if (!a.pondNo) return;
    alertTextByPond[a.pondNo] = `${alertTextByPond[a.pondNo] || ''} ${a.title} ${a.desc}`;
  });
  ponds.forEach((p) => {
    const combinedText = `${p.status} ${alertTextByPond[p.pondNo] || ''}`;
    const wq = extractWaterQuality(combinedText);
    p.ammonia = wq.ammonia;
    p.nitrite = wq.nitrite;
  });

  // Good news items.
  const goodNews = [];
  doc.querySelectorAll('.issue-grid .issue').forEach((el) => {
    const t = el.querySelector('.t')?.textContent?.trim() || '';
    const d = el.querySelector('.d')?.textContent?.trim() || '';
    if (t || d) goodNews.push({ title: t, desc: d });
  });

  // Recommendations.
  const recommendations = [];
  doc.querySelectorAll('.reco .reco-item').forEach((el) => {
    const txt = el.querySelector('.txt')?.textContent?.trim() || '';
    const urgent = el.classList.contains('urgent');
    if (txt) recommendations.push({ text: txt, urgent });
  });

  // Multi-week comparison tables — kept as raw rows/headers rather than
  // semantically parsed, since column meaning (VA/VV/Vp/calcium/...) varies per table.
  // Each row is wrapped as { cells: [...] } rather than a bare array — Firestore
  // rejects an array whose direct elements are themselves arrays ("nested arrays").
  const compareTables = [];
  doc.querySelectorAll('.compare-table').forEach((table) => {
    const headers = Array.from(table.querySelectorAll('thead th')).map((th) => th.textContent.trim());
    const rows = Array.from(table.querySelectorAll('tbody tr')).map((tr) => ({
      cells: Array.from(tr.querySelectorAll('td')).map((td) => td.textContent.trim().replace(/\s+/g, ' ')),
    }));
    if (headers.length || rows.length) compareTables.push({ headers, rows });
  });

  return {
    title,
    district,
    round,
    pondCount,
    ponds,
    alerts,
    goodNews,
    recommendations,
    compareTables,
  };
}
