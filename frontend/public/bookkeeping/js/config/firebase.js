// ==================== FIREBASE CONFIGURATION ====================
// Uses Firebase compat (script tag) to avoid CORS when loading as ES modules in dev.
// Expect: firebase-app-compat, firebase-firestore-compat, firebase-auth-compat loaded in HTML.

const firebase = typeof window !== 'undefined' && window.firebase;
if (!firebase) {
  throw new Error('Firebase compat scripts not loaded. Add firebase-app-compat, firestore-compat, auth-compat in HTML.');
}

// Application Configuration
export const CONFIG = {
  firebase: {
    apiKey: "AIzaSyDY7rPoNA6MzVKHE6obBj-tr4HMUpIdOPI",
    authDomain: "bookkeeping-211e6.firebaseapp.com",
    projectId: "bookkeeping-211e6",
    storageBucket: "bookkeeping-211e6.firebasestorage.app",
    messagingSenderId: "572507957762",
    appId: "1:572507957762:web:1537249285d8af025d151b"
  },
  defaults: {
    currency: 'GHS (₵)',
    currencySymbol: '₵'
  },
  emailJS: {
    publicKey: "2JkO3-Ju6GCVuteLC"
  }
};

// Firebase Initialization (compat API)
export const firebaseApp = firebase.initializeApp(CONFIG.firebase);
// Compat API uses default database; named DB would require modular SDK
export const db = firebaseApp.firestore();
export const auth = firebaseApp.auth();

// Secondary App (for creating users without logging them in)
export const secondaryApp = firebase.initializeApp(CONFIG.firebase, 'Secondary');
export const secondaryAuth = secondaryApp.auth();

// Offline persistence — clear corrupted cache on internal errors and retry once
if (typeof db.enablePersistence === 'function') {
  db.enablePersistence({ synchronizeTabs: true }).catch(async (err) => {
    if (err.code === 'failed-precondition') {
      console.warn('Persistence: multiple tabs open, only one can enable persistence.');
    } else if (err.code === 'unimplemented') {
      console.warn('Persistence: not available in this browser.');
    } else {
      console.warn('Persistence error, clearing corrupted IndexedDB cache...', err.code || err.message);
      try {
        const dbs = await indexedDB.databases();
        for (const dbInfo of dbs) {
          if (dbInfo.name && dbInfo.name.startsWith('firestore')) {
            indexedDB.deleteDatabase(dbInfo.name);
          }
        }
        console.info('Firestore cache cleared. Reload the page for a clean start.');
      } catch (clearErr) {
        console.warn('Could not clear IndexedDB:', clearErr);
      }
    }
  });
}

// Re-export modular-style API for existing code
function getFirestore(app) {
  return app.firestore();
}
function getAuth(app) {
  return app.auth();
}
// Modular API: collection(db, 'users', uid, 'outlets', outletId, 'consignments') - variadic path segments
function collection(dbOrRef, pathOrFirstSegment, ...restSegments) {
  if (restSegments.length === 0) return dbOrRef.collection(pathOrFirstSegment);
  // Build nested path: col.doc.col.doc.col...
  let ref = dbOrRef.collection(pathOrFirstSegment);
  for (let i = 0; i < restSegments.length; i += 2) {
    ref = ref.doc(restSegments[i]);
    if (i + 1 < restSegments.length) ref = ref.collection(restSegments[i + 1]);
  }
  return ref;
}
// Modular API: doc(db, 'users', uid, 'outlets', outletId, 'settlements', period) - variadic path segments
// Also: doc(collectionRef) for new document with auto-ID
function doc(dbOrRef, pathOrCol, pathOrId, ...restSegments) {
  // Single argument: collection ref → new document ref (auto-ID)
  if (arguments.length === 1 && dbOrRef && typeof dbOrRef.doc === 'function') {
    return dbOrRef.doc();
  }
  if (restSegments.length === 0) {
    if (arguments.length === 2) return dbOrRef.doc(pathOrCol);
    return dbOrRef.collection(pathOrCol).doc(pathOrId);
  }
  // Build nested path: col.doc.col.doc.col.doc...
  let ref = dbOrRef.collection(pathOrCol).doc(pathOrId);
  for (let i = 0; i < restSegments.length; i += 2) {
    ref = ref.collection(restSegments[i]);
    if (i + 1 < restSegments.length) ref = ref.doc(restSegments[i + 1]);
  }
  return ref;
}

// Compat uses .exists (property); modular uses .exists() (method). Wrap so callers can use .exists().
function wrapDocSnap(snap) {
  if (!snap) return snap;
  if (typeof snap.exists === 'function') return snap;
  return {
    exists() { return snap.exists; },
    data() { return snap.data(); },
    get id() { return snap.id; },
    get ref() { return snap.ref; }
  };
}

async function getDoc(ref) {
  const snap = await ref.get();
  return wrapDocSnap(snap);
}
function setDoc(ref, data, options) {
  return ref.set(data, options);
}
function addDoc(colRef, data) {
  return colRef.add(data);
}
function updateDoc(ref, data) {
  return ref.update(data);
}
function deleteDoc(ref) {
  return ref.delete();
}
async function getDocs(refOrQuery) {
  const snap = await refOrQuery.get();
  if (!snap || !snap.docs) return snap;
  const wrappedDocs = snap.docs.map(d => wrapDocSnap(d));
  return {
    get docs() { return wrappedDocs; },
    get empty() { return snap.empty; },
    get size() { return snap.size; },
    forEach(cb) { wrappedDocs.forEach(cb); }
  };
}
function onSnapshot(refOrQuery, onNext, onError) {
  return refOrQuery.onSnapshot(onNext, onError);
}
function query(refOrQuery, ...queryConstraints) {
  let q = refOrQuery;
  for (const c of queryConstraints) {
    if (c.type === 'orderBy') q = q.orderBy(c.field, c.direction);
    else if (c.type === 'where') q = q.where(c.field, c.op, c.value);
    else if (c.type === 'limit') q = q.limit(c.limit);
  }
  return q;
}
function orderBy(field, direction) {
  return { type: 'orderBy', field, direction: direction || 'asc' };
}
function limit(n) {
  return { type: 'limit', limit: n };
}
function where(field, op, value) {
  return { type: 'where', field, op, value };
}
function writeBatch(dbInstance) {
  return dbInstance.batch();
}
function enableIndexedDbPersistence(dbInstance, options) {
  return typeof dbInstance.enablePersistence === 'function'
    ? dbInstance.enablePersistence(options || {})
    : Promise.reject(new Error('Persistence not available'));
}
function serverTimestamp() {
  return firebase.firestore.FieldValue.serverTimestamp();
}
function increment(n) {
  return firebase.firestore.FieldValue.increment(n);
}

// Auth: modular API is (authInstance, ...args), compat is authInstance.method(...args)
export function onAuthStateChanged(authInstance, nextOrObserver, errorCb) {
  return authInstance.onAuthStateChanged(nextOrObserver, errorCb);
}
export function signInWithEmailAndPassword(authInstance, email, password) {
  return authInstance.signInWithEmailAndPassword(email, password);
}
export function createUserWithEmailAndPassword(authInstance, email, password) {
  return authInstance.createUserWithEmailAndPassword(email, password);
}
export function signOut(authInstance) {
  return authInstance.signOut();
}

export {
  getFirestore,
  collection,
  doc,
  getDoc,
  setDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  getDocs,
  onSnapshot,
  query,
  orderBy,
  limit,
  where,
  writeBatch,
  serverTimestamp,
  increment
};
