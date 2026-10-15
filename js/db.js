/**
 * MANIHOT — IndexedDB Local Repository & Initial Demo Seeder
 */
window.Manihot = window.Manihot || {};

window.Manihot.DB = (() => {
  const DB_NAME = 'ManihotResearchDB_v1';
  const DB_VERSION = 1;
  let dbInstance = null;
  let memoryFallback = { users: [], sessions: [], sensor_readings: [], effect_tracking: [] };
  let usingFallback = false;

  function openDB() {
    return new Promise((resolve) => {
      if (dbInstance) return resolve(dbInstance);
      if (!window.indexedDB) { usingFallback = true; return resolve(null); }
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('users')) db.createObjectStore('users', { keyPath: 'user_id' });
        if (!db.objectStoreNames.contains('sessions')) db.createObjectStore('sessions', { keyPath: 'session_id' });
        if (!db.objectStoreNames.contains('sensor_readings')) db.createObjectStore('sensor_readings', { keyPath: 'reading_id' });
        if (!db.objectStoreNames.contains('effect_tracking')) db.createObjectStore('effect_tracking', { keyPath: 'record_id' });
      };
      req.onsuccess = (e) => { dbInstance = e.target.result; resolve(dbInstance); };
      req.onerror = () => { usingFallback = true; resolve(null); };
    });
  }

  async function putRecord(storeName, record) {
    const db = await openDB();
    if (!db || usingFallback) {
      const key = { users: 'user_id', sessions: 'session_id', sensor_readings: 'reading_id', effect_tracking: 'record_id' }[storeName];
      const idx = memoryFallback[storeName].findIndex(i => i[key] === record[key]);
      if (idx >= 0) memoryFallback[storeName][idx] = record;
      else memoryFallback[storeName].push(record);
      return record;
    }
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      tx.objectStore(storeName).put(record);
      tx.oncomplete = () => resolve(record);
      tx.onerror = () => reject(tx.error);
    });
  }

  async function getAll(storeName) {
    const db = await openDB();
    if (!db || usingFallback) return [...memoryFallback[storeName]];
    return new Promise((resolve) => {
      const tx = db.transaction(storeName, 'readonly');
      const req = tx.objectStore(storeName).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => resolve([]);
    });
  }

  async function deleteRecord(storeName, keyVal) {
    const db = await openDB();
    if (!db || usingFallback) {
      const key = { users: 'user_id', sessions: 'session_id', sensor_readings: 'reading_id', effect_tracking: 'record_id' }[storeName];
      memoryFallback[storeName] = memoryFallback[storeName].filter(i => i[key] !== keyVal);
      return;
    }
    return new Promise((resolve) => {
      const tx = db.transaction(storeName, 'readwrite');
      tx.objectStore(storeName).delete(keyVal);
      tx.oncomplete = () => resolve();
    });
  }

  async function clearAllStores() {
    const db = await openDB();
    memoryFallback = { users: [], sessions: [], sensor_readings: [], effect_tracking: [] };
    if (!db || usingFallback) return;
    for (const s of ['users', 'sessions', 'sensor_readings', 'effect_tracking']) {
      await new Promise((r) => {
        const tx = db.transaction(s, 'readwrite');
        tx.objectStore(s).clear();
        tx.oncomplete = () => r();
      });
    }
  }

  async function seedInitialDemoDatabaseIfNeeded() {
    const users = await getAll('users');
    if (users.length > 0) {
      for (const u of users) {
        if (u.display_name.includes('Ibu Ratna') || u.display_name === '(Nama Pasien)') {
          u.display_name = 'Nama Pasien';
          u.preferences = { ...(u.preferences || {}), role: 'Pasien', access_level: 'PATIENT', focus_joint: 'Lutut Kanan', target_mins: 15 };
          await putRecord('users', u);
        }
      }
      return;
    }

    const now = Date.now();
    const day = 86400000;

    const u1 = {
      user_id: 'usr_demo_01',
      display_name: 'Nama Pasien',
      created_at: new Date(now - 3 * day).toISOString(),
      preferences: { role: 'Pasien', access_level: 'PATIENT', focus_joint: 'Lutut Kanan', target_mins: 15 }
    };
    const u2 = {
      user_id: 'usr_demo_02',
      display_name: 'Pasien Cadangan 2',
      created_at: new Date(now - 2 * day).toISOString(),
      preferences: { role: 'Pasien', access_level: 'PATIENT', focus_joint: 'Sendi Bahu', target_mins: 15 }
    };
    await putRecord('users', u1);
    await putRecord('users', u2);

    const s1 = 'ses_pagi_01';
    await putRecord('sessions', {
      session_id: s1,
      user_id: u1.user_id,
      started_at: new Date(now - day).toISOString(),
      ended_at: new Date(now - day + 900000).toISOString(),
      device_id: 'SIMULATOR-MANIHOT',
      source_mode: 'DEMO DATA',
      sampling_interval: 1,
      duration_sec: 900,
      notes: 'Pemakaian pagi di teras rumah'
    });

    for (let i = 0; i < 15; i++) {
      const tSkin = +(38.2 + Math.sin(i / 3) * 0.5).toFixed(2);
      const tMat = +(41.4 + Math.cos(i / 3) * 0.6).toFixed(2);
      await putRecord('sensor_readings', {
        reading_id: `${s1}_${i}`,
        session_id: s1,
        timestamp: new Date(now - day + i * 10000).toISOString(),
        t_skin: tSkin,
        t_material: tMat,
        lux: 16500,
        delta_t: +(tMat - tSkin).toFixed(2),
        skin_temp_rate: 0.005,
        material_temp_rate: 0.006,
        sequence: i + 1,
        source_mode: 'DEMO DATA',
        quality_status: 'VALID'
      });
    }

    await putRecord('effect_tracking', {
      record_id: 'eff_01',
      user_id: u1.user_id,
      session_id: s1,
      recorded_at: new Date(now - 2 * day).toISOString(),
      pain_score_before: 7,
      pain_score_after: 5,
      stiffness_score_before: 6,
      stiffness_score_after: 4,
      perceived_comfort: 'Nyaman & Hangat Stabil',
      duration_min: 15,
      body_part: 'Lutut Kanan',
      notes: 'Terasa hangat nyaman'
    });
    await putRecord('effect_tracking', {
      record_id: 'eff_02',
      user_id: u1.user_id,
      session_id: s1,
      recorded_at: new Date(now - day).toISOString(),
      pain_score_before: 6,
      pain_score_after: 4,
      stiffness_score_before: 5,
      stiffness_score_after: 3,
      perceived_comfort: 'Nyaman & Hangat Stabil',
      duration_min: 20,
      body_part: 'Lutut Kanan',
      notes: 'Sendi lebih rileks'
    });
  }

  return {
    UserRepository: { getAll: () => getAll('users'), save: (u) => putRecord('users', u), delete: (id) => deleteRecord('users', id) },
    SessionRepository: {
      getAll: () => getAll('sessions'),
      async getByUser(uid) { return (await getAll('sessions')).filter(s => s.user_id === uid).sort((a, b) => new Date(b.started_at) - new Date(a.started_at)); },
      save: (s) => putRecord('sessions', s),
      delete: (id) => deleteRecord('sessions', id)
    },
    SensorDataRepository: {
      getAll: () => getAll('sensor_readings'),
      async getBySession(sid) { return (await getAll('sensor_readings')).filter(r => r.session_id === sid).sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp)); },
      save: (r) => putRecord('sensor_readings', r),
      async deleteBySession(sid) {
        const list = await this.getBySession(sid);
        for (const r of list) await deleteRecord('sensor_readings', r.reading_id);
      }
    },
    EffectTrackingRepository: {
      getAll: () => getAll('effect_tracking'),
      async getByUser(uid) { return (await getAll('effect_tracking')).filter(e => e.user_id === uid).sort((a, b) => new Date(a.recorded_at) - new Date(b.recorded_at)); },
      save: (e) => putRecord('effect_tracking', e),
      delete: (id) => deleteRecord('effect_tracking', id)
    },
    clearAllStores,
    seedInitialDemoDatabaseIfNeeded
  };
})();