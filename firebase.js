// Thin wrapper around the Firebase modular SDK (loaded from CDN so no build step is needed).
// Firebase web config identifies the project (it is not a secret — access is enforced by
// Firestore security rules + Auth, not by hiding this value), so it's fine to ship a default
// here. Users can still override it per-browser via the Settings modal (kept in localStorage).

const SDK_VERSION = '10.13.0';
const CONFIG_KEY = 'shrimpLog.firebaseConfig';

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
  const raw = localStorage.getItem(CONFIG_KEY);
  if (!raw) return DEFAULT_CONFIG;
  try {
    return JSON.parse(raw);
  } catch {
    return DEFAULT_CONFIG;
  }
}

export function storeConfig(config) {
  localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
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
// each doc has a `name` field like "303" — farm digit + 2-digit pond number). We look
// up that doc id so pathogen results attach to the same pond record the other app uses.
async function findPondIdByName(pondNo) {
  const s = await loadSdk();
  const q = s.query(s.collection(dbInstance, 'ponds'), s.where('name', '==', String(pondNo)), s.limit(1));
  const snap = await s.getDocs(q);
  return snap.empty ? null : snap.docs[0].id;
}

// Weekly records already exist per pond+week (growth/feed data) in `records`. Pathogen
// results are merged into that same weekly doc when one exists for the pond+date, or
// create a new one otherwise — so the existing app's per-pond/week list picks it up
// without needing a separate query.
async function upsertPathogenFields(pondId, weekDate, fields) {
  const s = await loadSdk();
  const recordsCol = s.collection(dbInstance, 'records');
  const q = s.query(recordsCol, s.where('pondId', '==', pondId), s.where('weekDate', '==', weekDate), s.limit(1));
  const snap = await s.getDocs(q);
  if (!snap.empty) {
    await s.updateDoc(snap.docs[0].ref, { ...fields, updatedAt: Date.now() });
  } else {
    await s.addDoc(recordsCol, { pondId, weekDate, ...fields, createdAt: s.serverTimestamp(), updatedAt: Date.now() });
  }
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

  // Merge each pond's pathogen status into the matching `records` doc (by pondId + weekDate)
  // so the existing farm app's weekly-record view shows it alongside growth/feed data.
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
    await upsertPathogenFields(pondId, p.dateISO, {
      pathogenStatus: p.status,
      pathogenSeverity: p.severity,
      pathogenWorsened: p.worsened,
      pathogenReportId: reportDoc.id,
    });
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

export async function listPondHistory(pondId) {
  const s = await loadSdk();
  if (!dbInstance) throw new Error('ยังไม่ได้เชื่อมต่อ Firebase');
  // Sorted client-side (rather than orderBy in the query) so this doesn't need a
  // composite Firestore index — an equality filter + orderBy on a different field
  // would otherwise require one to be created manually in the console.
  const q = s.query(s.collection(dbInstance, 'records'), s.where('pondId', '==', pondId));
  const snap = await s.getDocs(q);
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => String(a.weekDate || '').localeCompare(String(b.weekDate || '')));
}

function hasGrowthData(entry) {
  return entry.sizeCount != null || entry.feedPerDay != null || entry.survivalRate != null || !!(entry.note && entry.note.trim());
}

// Removes just the pathogen fields from a weekly `records` doc, leaving any growth/feed
// data (sizeCount/feedPerDay/...) the other app wrote untouched. If the doc has no growth
// data either, it was created purely to hold this pathogen result, so the whole doc is
// deleted instead of leaving an empty leftover record behind.
export async function deletePathogenResult(entry) {
  const s = await loadSdk();
  if (!dbInstance) throw new Error('ยังไม่ได้เชื่อมต่อ Firebase');
  const ref = s.doc(dbInstance, 'records', entry.id);
  if (hasGrowthData(entry)) {
    await s.updateDoc(ref, {
      pathogenStatus: s.deleteField(),
      pathogenSeverity: s.deleteField(),
      pathogenWorsened: s.deleteField(),
      pathogenReportId: s.deleteField(),
      updatedAt: Date.now(),
    });
  } else {
    await s.deleteDoc(ref);
  }
}

export async function clearAllPathogenForPond(pondId) {
  const entries = await listPondHistory(pondId);
  const withPathogen = entries.filter((e) => e.pathogenSeverity || e.pathogenStatus);
  for (const entry of withPathogen) {
    await deletePathogenResult(entry);
  }
  return withPathogen.length;
}
