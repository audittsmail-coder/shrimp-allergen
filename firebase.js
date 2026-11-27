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

// Pathogen results live directly on the pond document — NOT in `records` (which is the
// other app's weekly growth/feed log, keyed by pondId+weekDate) — so viewing them here never
// touches that table:
//   ponds/{pondId}.pathogenStatus / .pathogenSeverity / .pathogenWorsened / .pathogenDate / ...
//     — latest result, for the home-grid badge
//   ponds/{pondId}.pathogenHistory[]  — full log of every week's result, for the detail view
// Results are written directly to Firestore outside this app (this app is a read-only
// viewer plus per-entry cleanup) — see README for how a weekly report gets in.

// When a pond's current crop is harvested, the farm-management app sets `closedAt` on that
// pond doc and a brand-new doc (same pond number, new releaseDate) is created for the next
// cycle — the closed doc is kept around for that app's own records, not deleted. Filtered out
// here so a harvested cycle's old doc doesn't show up as a stale duplicate tile alongside the
// pond's current one.
export async function listPonds() {
  const s = await loadSdk();
  if (!dbInstance) throw new Error('ยังไม่ได้เชื่อมต่อ Firebase');
  const snap = await s.getDocs(s.collection(dbInstance, 'ponds'));
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((p) => !p.closedAt)
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
    pathogenAmmonia: latest.ammonia ?? null,
    pathogenNitrite: latest.nitrite ?? null,
    pathogenPh: latest.ph ?? null,
    pathogenAlkalinity: latest.alkalinity ?? null,
    pathogenSalinity: latest.salinity ?? null,
    pathogenReportId: latest.reportId || null,
  };
}

function clearLatestFieldsUpdate(s) {
  return {
    pathogenStatus: s.deleteField(),
    pathogenSeverity: s.deleteField(),
    pathogenWorsened: s.deleteField(),
    pathogenDate: s.deleteField(),
    pathogenAmmonia: s.deleteField(),
    pathogenNitrite: s.deleteField(),
    pathogenPh: s.deleteField(),
    pathogenAlkalinity: s.deleteField(),
    pathogenSalinity: s.deleteField(),
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
