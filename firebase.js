// Thin wrapper around the Firebase modular SDK (loaded from CDN so no build step is needed).
// Firebase web config identifies the project (it is not a secret — access is enforced by
// Firestore security rules + Auth, not by hiding this value), so it's fine to ship it here
// directly rather than requiring a manual setup step.

const SDK_VERSION = '10.13.0';

const DEFAULT_CONFIG = {
  apiKey: "AIzaSyCvcR6a4LEKq-7TsSlrMYXP4bh3TwZY-NI",
  authDomain: "shrimp-farm-data.firebaseapp.com",
  databaseURL: "https://shrimp-farm-data-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "shrimp-farm-data",
  storageBucket: "shrimp-farm-data.firebasestorage.app",
  messagingSenderId: "105951477051",
  appId: "1:105951477051:web:de134a245b683625304b1e",
  measurementId: "G-X7GS4YD4WK",
};

let appInstance = null;
let dbInstance = null;
let authInstance = null;
let sdk = null;

export function getStoredConfig() {
  return DEFAULT_CONFIG;
}

async function loadSdk() {
  if (sdk) return sdk;
  const [appMod, fsMod, authMod] = await Promise.all([
    import(`https://www.gstatic.com/firebasejs/${SDK_VERSION}/firebase-app.js`),
    import(`https://www.gstatic.com/firebasejs/${SDK_VERSION}/firebase-firestore.js`),
    import(`https://www.gstatic.com/firebasejs/${SDK_VERSION}/firebase-auth.js`),
  ]);
  sdk = { ...appMod, ...fsMod, ...authMod };
  return sdk;
}

export async function connect(config) {
  const s = await loadSdk();
  appInstance = s.initializeApp(config);
  dbInstance = s.getFirestore(appInstance);
  authInstance = s.getAuth(appInstance);
  await new Promise((resolve, reject) => {
    s.onAuthStateChanged(authInstance, (user) => {
      if (user) resolve(user);
    });
    s.signInAnonymously(authInstance).catch(reject);
  });
  return true;
}

export function isConnected() {
  return !!dbInstance;
}

// Ponds are pre-registered by the existing farm-management app (collection `ponds`,
// each doc has a `name` field starting with "303" — farm digit + 2-digit pond number —
// but may carry a nickname suffix the farm app appends, e.g. "101(น้ำเตี้ย)". We match
// on that leading pond number only (a Firestore prefix range query), ignoring whatever
// comes after it, so pathogen results still attach to the right pond doc either way.
async function findPondIdByName(pondNo) {
  const s = await loadSdk();
  const prefix = String(pondNo);
  const q = s.query(
    s.collection(dbInstance, 'ponds'),
    s.where('name', '>=', prefix),
    s.where('name', '<', prefix + ''),
    s.limit(1)
  );
  const snap = await s.getDocs(q);
  return snap.empty ? null : snap.docs[0].id;
}

// Pathogen results live directly on the pond document — NOT in `records` (which is the
// other app's weekly growth/feed log, keyed by pondId+weekDate). Merging into `records`
// used to fabricate a growth-record row for the pathogen's date even when no growth data
// existed for that week, which showed up as a confusing all-dashes row in that app's
// history table. Attaching to the pond instead avoids touching that table at all:
//   ponds/{pondId}.pathogenStatus / .pathogenSeverity / .pathogenWorsened / .pathogenDate
//     — latest result, for quick badges/overview rows
//   ponds/{pondId}.pathogenHistory[]  — full log of every week's result, for trend views
async function attachPathogenToPond(pondId, p, reportId) {
  const s = await loadSdk();
  const ref = s.doc(dbInstance, 'ponds', pondId);
  const entry = {
    weekDate: p.dateISO || p.dateRaw || '',
    status: p.status,
    severity: p.severity,
    worsened: !!p.worsened,
    reportId: reportId || null,
  };
  await s.updateDoc(ref, {
    pathogenStatus: entry.status,
    pathogenSeverity: entry.severity,
    pathogenWorsened: entry.worsened,
    pathogenDate: entry.weekDate,
    pathogenReportId: entry.reportId,
    pathogenHistory: s.arrayUnion(entry),
  });
}

export async function saveReport(parsed) {
  const s = await loadSdk();
  if (!dbInstance) throw new Error('ยังไม่ได้เชื่อมต่อ Firebase');

  const reportsCol = s.collection(dbInstance, 'reports');
  const reportDoc = await s.addDoc(reportsCol, {
    createdAt: s.serverTimestamp(),
    title: parsed.title,
    district: parsed.district,
    round: parsed.round,
    pondCount: parsed.pondCount,
    ponds: parsed.ponds,
    alerts: parsed.alerts,
    goodNews: parsed.goodNews,
    recommendations: parsed.recommendations,
    compareTables: parsed.compareTables,
  });

  const unmatchedPonds = [];
  for (const p of parsed.ponds) {
    if (!p.dateISO) {
      unmatchedPonds.push(p.pondNo);
      continue;
    }
    const pondId = await findPondIdByName(p.pondNo);
    if (!pondId) {
      unmatchedPonds.push(p.pondNo);
      continue;
    }
    await attachPathogenToPond(pondId, p, reportDoc.id);
  }

  return { reportId: reportDoc.id, unmatchedPonds };
}

export async function listReports() {
  const s = await loadSdk();
  if (!dbInstance) throw new Error('ยังไม่ได้เชื่อมต่อ Firebase');
  const q = s.query(s.collection(dbInstance, 'reports'), s.orderBy('createdAt', 'desc'));
  const snap = await s.getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function listPonds() {
  const s = await loadSdk();
  if (!dbInstance) throw new Error('ยังไม่ได้เชื่อมต่อ Firebase');
  const snap = await s.getDocs(s.collection(dbInstance, 'ponds'));
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));
}

// Returns the pond's pathogenHistory array (oldest first), read straight off the pond doc.
export async function listPondHistory(pondId) {
  const s = await loadSdk();
  if (!dbInstance) throw new Error('ยังไม่ได้เชื่อมต่อ Firebase');
  const snap = await s.getDoc(s.doc(dbInstance, 'ponds', pondId));
  if (!snap.exists()) return [];
  const history = (snap.data().pathogenHistory || []).slice();
  return history.sort((a, b) => String(a.weekDate || '').localeCompare(String(b.weekDate || '')));
}

function recomputeLatestFields(history) {
  const sorted = history.slice().sort((a, b) => String(a.weekDate || '').localeCompare(String(b.weekDate || '')));
  const latest = sorted[sorted.length - 1];
  if (!latest) return null;
  return {
    pathogenStatus: latest.status,
    pathogenSeverity: latest.severity,
    pathogenWorsened: !!latest.worsened,
    pathogenDate: latest.weekDate,
    pathogenReportId: latest.reportId || null,
  };
}

function clearLatestFieldsUpdate(s) {
  return {
    pathogenStatus: s.deleteField(),
    pathogenSeverity: s.deleteField(),
    pathogenWorsened: s.deleteField(),
    pathogenDate: s.deleteField(),
    pathogenReportId: s.deleteField(),
  };
}

// Removes one entry (by its position in the array as currently displayed) from a pond's
// pathogen history, then recomputes the pond's "latest result" fields from what remains.
export async function deletePondPathogenEntry(pondId, index) {
  const s = await loadSdk();
  if (!dbInstance) throw new Error('ยังไม่ได้เชื่อมต่อ Firebase');
  const ref = s.doc(dbInstance, 'ponds', pondId);
  const snap = await s.getDoc(ref);
  if (!snap.exists()) return;
  const history = (snap.data().pathogenHistory || []).slice();
  const sorted = history.slice().sort((a, b) => String(a.weekDate || '').localeCompare(String(b.weekDate || '')));
  const target = sorted[index];
  const remaining = target ? history.filter((h) => h !== target) : history;

  const latestFields = recomputeLatestFields(remaining);
  await s.updateDoc(ref, {
    pathogenHistory: remaining,
    ...(latestFields || clearLatestFieldsUpdate(s)),
  });
}

export async function clearAllPathogenForPond(pondId) {
  const s = await loadSdk();
  if (!dbInstance) throw new Error('ยังไม่ได้เชื่อมต่อ Firebase');
  const ref = s.doc(dbInstance, 'ponds', pondId);
  const snap = await s.getDoc(ref);
  if (!snap.exists()) return 0;
  const count = (snap.data().pathogenHistory || []).length;
  if (!count) return 0;
  await s.updateDoc(ref, { pathogenHistory: [], ...clearLatestFieldsUpdate(s) });
  return count;
}

// Full reset: strips pathogen fields from every pond (across all farms) and deletes this
// app's own `reports` import log. Never touches growth/feed data in `records`.
export async function clearAllPathogenData() {
  const s = await loadSdk();
  if (!dbInstance) throw new Error('ยังไม่ได้เชื่อมต่อ Firebase');

  const pondsSnap = await s.getDocs(s.collection(dbInstance, 'ponds'));
  let recordsCleared = 0;
  for (const d of pondsSnap.docs) {
    const count = (d.data().pathogenHistory || []).length;
    if (!count) continue;
    recordsCleared += count;
    await s.updateDoc(d.ref, { pathogenHistory: [], ...clearLatestFieldsUpdate(s) });
  }

  const reportsSnap = await s.getDocs(s.collection(dbInstance, 'reports'));
  for (const d of reportsSnap.docs) {
    await s.deleteDoc(d.ref);
  }

  return { recordsCleared, reportsDeleted: reportsSnap.size };
}
