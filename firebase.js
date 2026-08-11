// Thin wrapper around the Firebase modular SDK (loaded from CDN so no build step is needed).
// Firebase config is supplied by the user at runtime via the Settings modal and kept only in
// localStorage — it is never hardcoded here, so nothing secret ends up committed to the repo.

const SDK_VERSION = '10.13.0';
const CONFIG_KEY = 'shrimpLog.firebaseConfig';

let appInstance = null;
let dbInstance = null;
let authInstance = null;
let sdk = null;

export function getStoredConfig() {
  const raw = localStorage.getItem(CONFIG_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
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

  // Denormalize into pondHistory/{pondNo}/entries so per-pond weekly trends
  // can be queried directly without scanning every report document.
  await Promise.all(
    parsed.ponds.map((p) => {
      const entriesCol = s.collection(dbInstance, 'pondHistory', String(p.pondNo), 'entries');
      return s.addDoc(entriesCol, {
        createdAt: s.serverTimestamp(),
        reportId: reportDoc.id,
        farm: p.farm,
        status: p.status,
        severity: p.severity,
        worsened: p.worsened,
        dateRaw: p.dateRaw,
        dateISO: p.dateISO,
      });
    })
  );

  return reportDoc.id;
}

export async function listReports() {
  const s = await loadSdk();
  if (!dbInstance) throw new Error('ยังไม่ได้เชื่อมต่อ Firebase');
  const q = s.query(s.collection(dbInstance, 'reports'), s.orderBy('createdAt', 'desc'));
  const snap = await s.getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function listPondHistory(pondNo) {
  const s = await loadSdk();
  if (!dbInstance) throw new Error('ยังไม่ได้เชื่อมต่อ Firebase');
  const q = s.query(
    s.collection(dbInstance, 'pondHistory', String(pondNo), 'entries'),
    s.orderBy('dateISO', 'asc')
  );
  const snap = await s.getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}
