// Parses the weekly shrimp-farm lab report into structured data. Two report templates are
// supported since the generator has changed layouts between weeks:
//   Template A (original): .farm-divider / .farm-group-label mark a farm block, .pcard is one
//     pond's status, .severe/.alert are flagged ponds, .issue-grid is good news, .reco-item is
//     a recommendation, .compare-table is a multi-week table.
//   Template B (newer): .farm-block/.farm-label mark a farm block, .pond-card (with nested
//     .pond-params key/value rows) is one pond's status, .alert-card is a flagged pond
//     (.good-card variant = good news instead), no multi-week compare table.
// Template B extraction only runs as a fallback when Template A finds nothing, so a report
// using either layout parses correctly without needing to detect which one up front.

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

function sevFromClassA(el) {
  if (el.classList.contains('red')) return 'critical';
  if (el.classList.contains('amber')) return 'watch';
  if (el.classList.contains('green')) return 'normal';
  return 'unknown';
}

// Template B's .pond-status class is the authoritative severity label — a couple of real
// reports have a .pond-card whose own class disagrees with its nested .pond-status (e.g.
// class="pond-card warn" containing <div class="pond-status critical">วิกฤต</div>) — so this
// checks .pond-status first and only falls back to the card's own class if that's missing.
function sevFromStatusElB(card) {
  const target = card.querySelector('.pond-status') || card;
  if (target.classList.contains('critical')) return 'critical';
  if (target.classList.contains('warn')) return 'watch';
  if (target.classList.contains('ok')) return 'normal';
  return 'unknown';
}

// Best-effort extraction of water-quality readings when a report happens to mention them
// in a pond's status text or alert description (e.g. "แอมโมเนีย 0.5 mg/L"). Falls back to
// null (left blank for manual entry) when not found — callers only use this to fill in
// values not already found via a more structured source (per-pond params, a dedicated table).
function extractNumberAfterLabel(text, labelPattern) {
  const re = new RegExp(labelPattern + '[^0-9]{0,10}(\\d+(?:\\.\\d+)?)', 'i');
  const m = text.match(re);
  return m ? parseFloat(m[1]) : null;
}

function extractWaterQuality(text) {
  return {
    ammonia: extractNumberAfterLabel(text, 'แอมโมเนีย'),
    nitrite: extractNumberAfterLabel(text, 'ไนไตร(?:ท์)?'),
    ph: extractNumberAfterLabel(text, 'pH'),
    alkalinity: extractNumberAfterLabel(text, 'ด่าง|อัลค(?:าไลน์|\\.)?'),
    salinity: extractNumberAfterLabel(text, 'ความเค็ม|salinity'),
  };
}

export function parseReportHtml(htmlString) {
  const doc = new DOMParser().parseFromString(htmlString, 'text/html');
  const contextYearBE = currentBEYear();

  const title = doc.querySelector('title')?.textContent?.trim()
    || doc.querySelector('.hero h1')?.textContent?.trim()
    || doc.querySelector('.farm-name')?.textContent?.trim()
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
  // Template B fallback: district lives in .farm-sub ("เขตเหนือคลอง · จ.กระบี่"), and the
  // round/date range is only really available in the footer's summary sentence.
  if (!district) {
    const farmSub = doc.querySelector('.farm-sub')?.textContent?.replace(/\s+/g, ' ').trim() || '';
    const m = farmSub.match(/เขต\s*([^·]+)/);
    if (m) district = m[1].trim();
  }
  if (!round) {
    const footerText = doc.querySelector('.footer-bar')?.textContent?.replace(/\s+/g, ' ').trim() || '';
    const m = footerText.match(/\(([^)]+)\)/);
    if (m) round = m[1].trim();
  }

  // ---- Template A: walk the document in order, tracking "current farm" / "current date"
  // context so pond cards inherit the nearest preceding farm/date label. ----
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
          severity: sevFromClassA(el),
          worsened,
          dateRaw: currentDate.raw,
          dateISO: currentDate.iso,
        });
      }
    }
  });

  // ---- Template B fallback: .farm-block > .farm-label + .pond-card (only runs if Template A
  // found nothing). Pond cards nest a .pond-params list of {label, value} rows, which is
  // richer than Template A's single free-text status — joined into `status` for display, and
  // scanned directly for NH3/NO2 readings (more reliable than a generic text regex since the
  // label/value pairing is unambiguous). There's a single header-level date badge rather than
  // a per-farm one, so every Template B pond shares it. ----
  if (ponds.length === 0) {
    const dateBadgeText = doc.querySelector('.date-badge')?.textContent || '';
    const globalDate = extractFirstDate(dateBadgeText, contextYearBE) || { raw: '', iso: null };

    doc.querySelectorAll('.farm-block').forEach((farmBlock) => {
      const farmLabel = farmBlock.querySelector('.farm-label')?.textContent?.replace(/\s+/g, ' ').trim() || '';
      farmBlock.querySelectorAll('.pond-card').forEach((card) => {
        const pondNo = card.querySelector('.pond-num')?.textContent?.trim() || '';
        if (!pondNo) return;

        const params = Array.from(card.querySelectorAll('.param-row'))
          .map((row) => ({
            lbl: row.querySelector('.param-lbl')?.textContent?.trim() || '',
            val: row.querySelector('.param-val')?.textContent?.replace(/\s+/g, ' ').trim() || '',
          }))
          .filter((p) => p.lbl && p.val);

        const statusLabel = card.querySelector('.pond-status')?.textContent?.trim() || '';
        const status = params.length ? params.map((p) => `${p.lbl} ${p.val}`).join(', ') : statusLabel;

        let ammonia = null;
        let nitrite = null;
        let ph = null;
        let alkalinity = null;
        let salinity = null;
        params.forEach((p) => {
          const n = parseFloat(p.val.replace(/[^\d.]/g, ''));
          if (isNaN(n)) return;
          if (/(NH|แอมโมเนีย)/i.test(p.lbl)) ammonia = n;
          if (/(NO.?2|NO₂|ไนไตร)/i.test(p.lbl)) nitrite = n;
          if (/ph/i.test(p.lbl)) ph = n;
          if (/(ด่าง|อัลค|alk)/i.test(p.lbl)) alkalinity = n;
          if (/(ความเค็ม|salinity)/i.test(p.lbl)) salinity = n;
        });

        // An up-arrow defaults to "worse" (red) unless explicitly recolored — a couple of
        // parameters (e.g. calcium) style it green inline when going up is actually good.
        const worsened = Array.from(card.querySelectorAll('.arrow.arr-up')).some((a) => !a.getAttribute('style'));

        ponds.push({
          farm: farmLabel,
          pondNo,
          status,
          severity: sevFromStatusElB(card),
          worsened,
          dateRaw: globalDate.raw,
          dateISO: globalDate.iso,
          ammonia,
          nitrite,
          ph,
          alkalinity,
          salinity,
        });
      });
    });
  }

  // ---- Alerts: Template A (.severe/.alert) first, Template B (.alert-card, excluding its
  // .good-card variant which becomes good news instead) as a fallback. ----
  const alerts = [];
  doc.querySelectorAll('.severe, .alert').forEach((el) => {
    const pondNo = (el.querySelector('.pond')?.textContent || '').replace(/\s+/g, ' ').replace(/บ่อ/g, '').trim();
    const title = el.querySelector('.body .t, .t')?.textContent?.trim() || '';
    const desc = el.querySelector('.body .d, .d')?.textContent?.trim() || '';
    const tag = el.querySelector('.body .tag, .tag')?.textContent?.trim() || '';
    const stats = Array.from(el.querySelectorAll('.stat-chip')).map((s) => s.textContent.trim());
    if (title || desc) {
      alerts.push({ pondNo, level: el.classList.contains('severe') ? 'severe' : 'alert', title, desc, tag, stats });
    }
  });
  if (alerts.length === 0) {
    doc.querySelectorAll('.alert-card').forEach((el) => {
      if (el.classList.contains('good-card')) return;
      const pondNo = (el.querySelector('.alert-pond')?.textContent || '').replace(/\s+/g, ' ').replace(/บ่อ/g, '').trim();
      const title = el.querySelector('.alert-title')?.textContent?.trim() || '';
      const desc = el.querySelector('.alert-desc')?.textContent?.trim() || '';
      if (title || desc) {
        alerts.push({ pondNo, level: el.classList.contains('warn-card') ? 'alert' : 'severe', title, desc, tag: '', stats: [] });
      }
    });
  }

  // Merge in any water-quality readings mentioned in a pond's own status text or in an
  // alert about that pond (matched by pond number) — only fills gaps left by Template B's
  // more reliable per-pond param extraction above, never overwrites it.
  const alertTextByPond = {};
  alerts.forEach((a) => {
    if (!a.pondNo) return;
    alertTextByPond[a.pondNo] = `${alertTextByPond[a.pondNo] || ''} ${a.title} ${a.desc}`;
  });
  ponds.forEach((p) => {
    if (p.ammonia != null && p.nitrite != null && p.ph != null && p.alkalinity != null && p.salinity != null) return;
    const combinedText = `${p.status} ${alertTextByPond[p.pondNo] || ''}`;
    const wq = extractWaterQuality(combinedText);
    if (p.ammonia == null) p.ammonia = wq.ammonia;
    if (p.nitrite == null) p.nitrite = wq.nitrite;
    if (p.ph == null) p.ph = wq.ph;
    if (p.alkalinity == null) p.alkalinity = wq.alkalinity;
    if (p.salinity == null) p.salinity = wq.salinity;
  });

  // Some reports include a dedicated water-quality table (class `.wq-table`) instead of, or
  // in addition to, mentioning ammonia/nitrite/pH/alkalinity/salinity elsewhere — a header row
  // plus one data row per pond, with occasional colspan "farm group" header rows mixed in
  // (Template A) or one table per farm block (Template B). Column position is derived from the
  // header text rather than assumed fixed: when a report has both an "NH₃ รวม" (total) and
  // "NH₃ พิษ" (toxic) column, the total one is preferred; when there's just a single plain
  // "NH₃" column, that one is used directly. Not every report includes pH/alkalinity/salinity
  // columns at all — those simply stay null when absent. These readings win over anything
  // found elsewhere since a dedicated table is the most reliable source.
  const waterQualityByPond = {};
  doc.querySelectorAll('.wq-table').forEach((table) => {
    const headerCells = Array.from(table.querySelectorAll('thead th'));
    const headers = headerCells.map((th) => (th.firstChild ? th.firstChild.textContent : th.textContent).replace(/\s+/g, ' ').trim());
    const nh3Candidates = headers.map((h, i) => ({ h, i })).filter(({ h }) => /(NH|แอมโมเนีย)/i.test(h));
    let ammoniaCol = -1;
    if (nh3Candidates.length === 1) ammoniaCol = nh3Candidates[0].i;
    else if (nh3Candidates.length > 1) ammoniaCol = (nh3Candidates.find(({ h }) => /รวม/.test(h)) || nh3Candidates[0]).i;
    const nitriteCol = headers.findIndex((h) => /(NO.?2|NO₂|ไนไตร)/i.test(h));
    const phCol = headers.findIndex((h) => /pH|พีเอช/i.test(h));
    const alkalinityCol = headers.findIndex((h) => /(ด่าง|อัลค|alk)/i.test(h));
    const salinityCol = headers.findIndex((h) => /(ความเค็ม|salinity)/i.test(h));

    table.querySelectorAll('tbody tr').forEach((tr) => {
      if (tr.classList.contains('farm-row-header')) return;
      const cells = Array.from(tr.querySelectorAll('td'));
      if (!cells.length) return;
      const pondMatch = cells[0].textContent.match(/\d+/);
      if (!pondMatch) return;
      const parseCell = (idx) => {
        if (idx == null || idx < 0 || !cells[idx]) return null;
        const digits = cells[idx].textContent.replace(/[^\d.]/g, '');
        return digits ? parseFloat(digits) : null;
      };
      waterQualityByPond[pondMatch[0]] = {
        ammonia: parseCell(ammoniaCol),
        nitrite: parseCell(nitriteCol),
        ph: parseCell(phCol),
        alkalinity: parseCell(alkalinityCol),
        salinity: parseCell(salinityCol),
      };
    });
  });
  ponds.forEach((p) => {
    const wq = waterQualityByPond[p.pondNo];
    if (!wq) return;
    if (wq.ammonia != null) p.ammonia = wq.ammonia;
    if (wq.nitrite != null) p.nitrite = wq.nitrite;
    if (wq.ph != null) p.ph = wq.ph;
    if (wq.alkalinity != null) p.alkalinity = wq.alkalinity;
    if (wq.salinity != null) p.salinity = wq.salinity;
  });

  // Good news: Template A (.issue-grid .issue) first, Template B (.alert-card.good-card) as
  // a fallback.
  const goodNews = [];
  doc.querySelectorAll('.issue-grid .issue').forEach((el) => {
    const t = el.querySelector('.t')?.textContent?.trim() || '';
    const d = el.querySelector('.d')?.textContent?.trim() || '';
    if (t || d) goodNews.push({ title: t, desc: d });
  });
  if (goodNews.length === 0) {
    doc.querySelectorAll('.alert-card.good-card').forEach((el) => {
      const t = el.querySelector('.alert-title')?.textContent?.trim() || '';
      const d = el.querySelector('.alert-desc')?.textContent?.trim() || '';
      if (t || d) goodNews.push({ title: t, desc: d });
    });
  }

  // Recommendations (Template A only — Template B reports seen so far don't have an
  // equivalent section).
  const recommendations = [];
  doc.querySelectorAll('.reco .reco-item').forEach((el) => {
    const txt = el.querySelector('.txt')?.textContent?.trim() || '';
    const urgent = el.classList.contains('urgent');
    if (txt) recommendations.push({ text: txt, urgent });
  });

  // Multi-week comparison tables (Template A only) — kept as raw rows/headers rather than
  // semantically parsed, since column meaning (VA/VV/Vp/calcium/...) varies per table.
  // Each row is wrapped as { cells: [...] } rather than a bare array — Firestore rejects an
  // array whose direct elements are themselves arrays ("nested arrays").
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
