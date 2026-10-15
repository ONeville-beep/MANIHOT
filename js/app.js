/**
 * MANIHOT — Main Application Controller, UI Renderer, Users, Impact & FAQ
 */
window.Manihot = window.Manihot || {};

window.App = (() => {
  'use strict';

  const {
    Config, State, Modals, Physics, DB, Charts, Session, Simulation, BLE, escapeHtml
  } = window.Manihot;

  const StealthAdmin = (() => {
    let tapCount = 0;
    let tapTimer = null;
    const SECRET_PASSWORDS = ['MANIHOT2026', 'manihot2026'];

    function handleSecretLogoTap() {
      tapCount += 1;
      if (tapTimer) clearTimeout(tapTimer);
      if (tapCount >= 5) {
        tapCount = 0;
        openModal();
        return;
      }
      tapTimer = setTimeout(() => { tapCount = 0; }, 2200);
    }

    function openModal() {
      const modal = document.getElementById('stealth-admin-modal');
      const input = document.getElementById('stealth-admin-password');
      const err = document.getElementById('stealth-admin-error');
      if (!modal) return;
      err?.classList.add('hidden');
      if (input) input.value = '';
      modal.classList.remove('hidden');
      setTimeout(() => input?.focus(), 60);
    }

    function closeModal() {
      document.getElementById('stealth-admin-modal')?.classList.add('hidden');
    }

    function verifyPassword(e) {
      e.preventDefault();
      const input = document.getElementById('stealth-admin-password');
      const err = document.getElementById('stealth-admin-error');
      const val = (input?.value || '').trim();
      if (SECRET_PASSWORDS.includes(val)) {
        closeModal();
        State.activeRole = 'ADMIN';
        UI.applyRoleExperience();
        UI.renderProfilesView();
        Modals.showToast('🔓 Konsol Admin & Peneliti berhasil dibuka.', 'success');
      } else {
        err?.classList.remove('hidden');
      }
    }

    function lockAdminMode() {
      State.activeRole = 'PATIENT';
      if (State.currentView === 'settings' || State.currentView === 'profile') {
        navigateTo('overview');
      }
      UI.applyRoleExperience();
      UI.renderProfilesView();
      Modals.showToast('🔒 Mode Admin dikunci. Kembali ke tampilan Pasien.', 'info');
    }

    return { handleSecretLogoTap, openModal, closeModal, verifyPassword, lockAdminMode };
  })();

  const Users = {
    async loadUsersAndActiveProfile() {
      State.usersList = await DB.UserRepository.getAll();
      const savedId = localStorage.getItem(Config.storageKeys.activeUserId);
      State.activeUser = State.usersList.find(u => u.user_id === savedId) || State.usersList[0];
      State.activeRole = 'PATIENT';
      UI.applyRoleExperience();
      UI.renderActiveUserBadges();
      UI.renderProfilesView();
    },

    async switchUser(uid) {
      const found = State.usersList.find(u => u.user_id === uid);
      if (!found) return;
      State.activeUser = found;
      localStorage.setItem(Config.storageKeys.activeUserId, found.user_id);
      UI.renderActiveUserBadges();
      UI.renderProfilesView();
      await UI.refreshAllDatabaseViews();
      closeRoleModal();
      Modals.showToast(`Profil aktif: ${found.display_name}`, 'success');
    },

    async handleQuickRenamePatient(e) {
      e.preventDefault();
      if (!State.activeUser) return;
      const newName = document.getElementById('quick-patient-name-input')?.value.trim();
      if (!newName) return;
      State.activeUser.display_name = newName;
      await DB.UserRepository.save(State.activeUser);
      await this.loadUsersAndActiveProfile();
      await UI.refreshAllDatabaseViews();
      closeRoleModal();
      Modals.showToast(`Nama pasien diubah menjadi: ${newName}`, 'success');
    },

    async handleCreateUser(e) {
      e.preventDefault();
      const name = document.getElementById('new-user-name')?.value.trim();
      const joint = document.getElementById('new-user-joint')?.value.trim() || 'Sendi Lutut';
      const targetMins = parseInt(document.getElementById('new-user-target')?.value || '15', 10) || 15;
      if (!name) return;
      const u = {
        user_id: `usr_${Date.now().toString(36)}`,
        display_name: name,
        created_at: new Date().toISOString(),
        preferences: { role: 'Pasien', access_level: 'PATIENT', focus_joint: joint, target_mins: targetMins }
      };
      await DB.UserRepository.save(u);
      document.getElementById('new-user-name').value = '';
      State.usersList = await DB.UserRepository.getAll();
      await this.switchUser(u.user_id);
    },

    async deleteUser(uid) {
      if (State.usersList.length <= 1) {
        Modals.showToast('Minimal harus ada 1 profil pasien.', 'warning');
        return;
      }
      Modals.confirm('Hapus Profil?', 'Seluruh riwayat sesi profil ini akan dihapus.', async () => {
        await DB.UserRepository.delete(uid);
        await this.loadUsersAndActiveProfile();
        await UI.refreshAllDatabaseViews();
      });
    }
  };

  const Impact = {
    setFilter(range) {
      State.impactFilter = range;
      ['7d', '30d', 'all'].forEach(k => {
        const b = document.getElementById(`filter-btn-${k}`);
        if (b) b.className = k === range ? 'px-3 py-1 rounded-full text-xs font-bold bg-white dark:bg-slate-900 shadow-sm' : 'px-3 py-1 rounded-full text-xs font-bold';
      });
      this.renderImpactDashboard();
    },

    async handleSubmit(e) {
      e.preventDefault();
      if (!State.activeUser) return;
      const pB = parseInt(document.getElementById('impact-pain-before').value, 10);
      const pA = parseInt(document.getElementById('impact-pain-after').value, 10);
      const sB = parseInt(document.getElementById('impact-stiff-before').value, 10);
      const sA = parseInt(document.getElementById('impact-stiff-after').value, 10);
      const durRaw = document.getElementById('impact-duration-min').value.trim();

      await DB.EffectTrackingRepository.save({
        record_id: `eff_${Date.now().toString(36)}`,
        user_id: State.activeUser.user_id,
        session_id: document.getElementById('impact-session-select').value,
        recorded_at: new Date().toISOString(),
        pain_score_before: pB,
        pain_score_after: pA,
        stiffness_score_before: sB,
        stiffness_score_after: sA,
        perceived_comfort: document.getElementById('impact-comfort').value || null,
        duration_min: durRaw ? parseInt(durRaw, 10) : null,
        body_part: document.getElementById('impact-body-part').value.trim() || null,
        notes: document.getElementById('impact-notes').value.trim() || null
      });
      document.getElementById('impact-notes').value = '';
      await UI.refreshAllDatabaseViews();
      Modals.showToast('Catatan kondisi berhasil disimpan!', 'success');
    },

    async renderImpactDashboard() {
      if (!State.activeUser) return;
      const all = await DB.EffectTrackingRepository.getByUser(State.activeUser.user_id);
      const now = Date.now();
      const filtered = all.filter(r => {
        const days = (now - new Date(r.recorded_at).getTime()) / 86400000;
        if (State.impactFilter === '7d') return days <= 7;
        if (State.impactFilter === '30d') return days <= 30;
        return true;
      });

      document.getElementById('impact-stat-count').textContent = filtered.length;
      if (filtered.length > 0) {
        const dp = filtered.reduce((a, r) => a + (r.pain_score_after - r.pain_score_before), 0) / filtered.length;
        const ds = filtered.reduce((a, r) => a + (r.stiffness_score_after - r.stiffness_score_before), 0) / filtered.length;
        const mins = filtered.reduce((a, r) => a + (r.duration_min || 0), 0);
        document.getElementById('impact-stat-dpain').textContent = `${dp > 0 ? '+' : ''}${dp.toFixed(1)}`;
        document.getElementById('impact-stat-dstiff').textContent = `${ds > 0 ? '+' : ''}${ds.toFixed(1)}`;
        document.getElementById('impact-stat-duration').textContent = `${mins} mnt`;
      }
      const notice = document.getElementById('impact-insufficient-notice');
      if (notice) notice.classList.toggle('hidden', filtered.length >= 2);
      Charts.renderImpactChart(filtered);

      const list = document.getElementById('impact-records-list');
      if (list) {
        list.innerHTML = filtered.map(r => {
          const dp = r.pain_score_after - r.pain_score_before;
          return `
            <div class="p-3 rounded-2xl bg-slate-50 dark:bg-slate-800/60 flex items-center justify-between text-xs">
              <div>
                <div class="font-bold">${escapeHtml(r.body_part || 'Sendi')} • ${new Date(r.recorded_at).toLocaleDateString('id-ID')}</div>
                <div class="text-slate-400">${escapeHtml(r.perceived_comfort || 'Tanpa catatan')}</div>
              </div>
              <div class="font-mono font-bold text-emerald-600 dark:text-emerald-400">
                Nyeri ${r.pain_score_before}&rarr;${r.pain_score_after} (${dp > 0 ? '+' + dp : dp})
              </div>
            </div>
          `;
        }).join('');
      }
    }
  };

  const FAQ = (() => {
    let cat = 'ALL';
    const items = [
      { q: '1. Apa itu MANIHOT dan bagaimana hydrochar kulit singkong menyerap cahaya menjadi kalor?', cat: 'Material & HTC', a: 'MANIHOT adalah prototipe perban fototermal pasif berbahan hydrochar limbah kulit singkong, katun Majalaya, dan PCM asam lemak nabati. Partikel karbon gelap menyerap cahaya dan mengubahnya menjadi hangat lembut.' },
      { q: '2. Apa peran HTC (Hydrothermal Carbonization) dalam membuat hydrochar?', cat: 'Material & HTC', a: 'HTC memproses limbah kulit singkong basah pada suhu moderat (180–250°C) dalam reaktor bertekanan tanpa pengeringan berenergi tinggi, menghasilkan karbon berpori yang mudah menyatu dengan serat katun.' },
      { q: '3. Bagaimana energi cahaya yang diserap berubah menjadi panas?', cat: 'Material & HTC', a: 'Foton cahaya mengeksitasi elektron pada ikatan karbon terkonjugasi, lalu melepaskan energi vibrasi kisi (kalor) melalui relaksasi non-radiatif.' },
      { q: '4. Bagaimana PCM menyerap kalor laten saat berubah fase?', cat: 'Termodinamika & PCM', a: 'Saat suhu mencapai titik leburnya, PCM asam lemak menyerap panas berlebih untuk mengubah fase dari padat ke cair (kalor laten) sehingga menahan lonjakan suhu.' },
      { q: '5. Mengapa suhu kulit (T_skin) dan suhu perban (T_material) diukur terpisah?', cat: 'Sensor & Telemetri', a: 'Agar kita mengetahui panas yang diserap lapisan luar sekaligus memastikan suhu yang menyentuh kulit tetap aman (38–41°C).' },
      { q: '6. Kapan pemakaian perban harus dihentikan?', cat: 'Keselamatan & Data', a: 'Saat suhu mencapai ≥44°C atau kapan pun kulit terasa terlalu panas/tidak nyaman meskipun angka di layar masih di bawah 41°C.' },
      { q: '7. Bagaimana mencuci kain perca katun Majalaya tanpa merusak sensor?', cat: 'Keselamatan & Data', a: 'Modul elektronik ESP32 dan sensor dirancang dapat dilepas (modular) sebelum bagian kain dibersihkan.' },
      { q: '8. Bagaimana data dan profil pasien disimpan?', cat: 'Keselamatan & Data', a: 'Data disimpan secara lokal di perangkat Anda (IndexedDB) terpisah untuk setiap profil pasien, dan dapat diunduh sebagai CSV/JSON.' }
    ];

    function setCategory(c) {
      cat = c;
      document.querySelectorAll('.faq-cat-btn').forEach(b => {
        b.className = b.getAttribute('data-cat') === c
          ? 'faq-cat-btn px-3 py-1.5 rounded-full text-xs font-bold bg-emerald-600 text-white'
          : 'faq-cat-btn px-3 py-1.5 rounded-full text-xs font-semibold bg-slate-100 dark:bg-slate-800';
      });
      render();
    }

    function render() {
      const box = document.getElementById('faq-accordion-container');
      if (!box) return;
      const q = (document.getElementById('faq-search-input')?.value || '').toLowerCase();
      const list = items.filter(i => (cat === 'ALL' || i.cat === cat) && (!q || i.q.toLowerCase().includes(q) || i.a.toLowerCase().includes(q)));
      box.innerHTML = list.map((i, idx) => `
        <details class="health-card p-4" ${idx === 0 ? 'open' : ''}>
          <summary class="cursor-pointer font-bold text-xs sm:text-sm flex justify-between items-center gap-2">
            <span>${escapeHtml(i.q)}</span>
            <span class="text-emerald-600">&#9662;</span>
          </summary>
          <p class="mt-2 pt-2 border-t border-slate-100 dark:border-slate-800 text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
            ${escapeHtml(i.a)}
          </p>
        </details>
      `).join('');
    }

    return { setCategory, render };
  })();

  const Export = {
    downloadSessionCSV(meta, readings) {
      if (!readings || readings.length === 0) {
        Modals.showToast('Belum ada sampel untuk diekspor.', 'warning');
        return;
      }
      const headers = ['user_id', 'session_id', 'timestamp', 'source_mode', 't_skin_c', 't_material_c', 'illuminance_lux', 'delta_t_c', 'skin_temp_rate_c_per_s', 'material_temp_rate_c_per_s', 'warning_status', 'sequence', 'quality_status'];
      const rows = readings.map(r => [
        meta.user_id || State.activeUser?.user_id || 'anon',
        meta.session_id || r.session_id,
        r.timestamp,
        r.source_mode || 'DEMO DATA',
        r.t_skin,
        r.t_material,
        r.lux,
        r.delta_t,
        r.skin_temp_rate ?? '',
        r.material_temp_rate ?? '',
        r.warning_status || 'TARGET',
        r.sequence ?? '',
        r.quality_status || 'VALID'
      ].map(c => `"${String(c)}"`).join(','));

      const blob = new Blob(['\uFEFF' + [headers.join(','), ...rows].join('\r\n')], { type: 'text/csv;charset=utf-8;' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `MANIHOT_${meta.session_id || 'sesi'}.csv`;
      a.click();
      Modals.showToast('File CSV berhasil diunduh!', 'success');
    },
    downloadCurrentCSV() {
      this.downloadSessionCSV({ user_id: State.activeUser?.user_id, session_id: State.session.sessionId }, State.session.currentReadingsBuffer);
    },
    async exportAllProfileJSON() {
      if (!State.activeUser) return;
      const sessions = await DB.SessionRepository.getByUser(State.activeUser.user_id);
      const effects = await DB.EffectTrackingRepository.getByUser(State.activeUser.user_id);
      this.triggerJSON({ user: State.activeUser, sessions, effects }, `MANIHOT_${State.activeUser.user_id}.json`);
    },
    async exportFullResearchDatabaseJSON() {
      this.triggerJSON({
        users: await DB.UserRepository.getAll(),
        sessions: await DB.SessionRepository.getAll(),
        sensor_readings: await DB.SensorDataRepository.getAll(),
        effect_tracking: await DB.EffectTrackingRepository.getAll()
      }, 'MANIHOT_Dataset_Penelitian.json');
    },
    triggerJSON(obj, name) {
      const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = name;
      a.click();
      Modals.showToast('File JSON berhasil diunduh.', 'success');
    },
    async importJSONFile(e) {
      const f = e.target.files?.[0];
      if (!f) return;
      try {
        const data = JSON.parse(await f.text());
        if (Array.isArray(data.users)) for (const u of data.users) await DB.UserRepository.save(u);
        if (Array.isArray(data.sessions)) for (const s of data.sessions) await DB.SessionRepository.save(s);
        if (Array.isArray(data.effect_tracking)) for (const ef of data.effect_tracking) await DB.EffectTrackingRepository.save(ef);
        await Users.loadUsersAndActiveProfile();
        await UI.refreshAllDatabaseViews();
        Modals.showToast('Cadangan JSON berhasil dipulihkan!', 'success');
      } catch (_) {
        Modals.showToast('File JSON tidak valid.', 'error');
      }
    }
  };

  const Settings = {
    loadSavedSettings() {
      try {
        const t = JSON.parse(localStorage.getItem(Config.storageKeys.thresholds) || 'null');
        if (t && Number.isFinite(t.targetMin)) Object.assign(Config.thresholds, t);
      } catch (_) {}
    },
    saveThresholds() {
      const tMin = parseFloat(document.getElementById('cfg-target-min').value);
      const tMax = parseFloat(document.getElementById('cfg-target-max').value);
      const cMin = parseFloat(document.getElementById('cfg-critical-min').value);
      const pMin = parseFloat(document.getElementById('cfg-pcm-min').value);
      const pMax = parseFloat(document.getElementById('cfg-pcm-max').value);
      if (tMin >= tMax || tMax >= cMin) {
        Modals.showToast('Urutan ambang suhu tidak valid.', 'error');
        return;
      }
      Config.thresholds = { targetMin: tMin, targetMax: tMax, criticalMin: cMin, pcmMeltMin: pMin, pcmMeltMax: pMax };
      localStorage.setItem(Config.storageKeys.thresholds, JSON.stringify(Config.thresholds));
      Modals.showToast('Ambang peringatan suhu disimpan.', 'success');
    },
    resetDefaultThresholds() {
      Config.thresholds = { targetMin: 38.0, targetMax: 41.0, criticalMin: 44.0, pcmMeltMin: 41.0, pcmMeltMax: 44.5 };
      localStorage.removeItem(Config.storageKeys.thresholds);
      Modals.showToast('Ambang suhu dikembalikan ke default.', 'info');
    },
    saveBLEConfig() {
      Config.ble.deviceNamePrefix = document.getElementById('cfg-ble-prefix').value.trim() || 'MANIHOT';
      Config.ble.serviceUUID = document.getElementById('cfg-ble-service').value.trim();
      Config.ble.telemetryCharUUID = document.getElementById('cfg-ble-char-tx').value.trim();
      Modals.showToast('Konfigurasi UUID BLE disimpan.', 'success');
    },
    saveDeviceIdentity(v) {
      Modals.showToast(`ID Perangkat: ${v}`, 'info');
    },
    testCloudAdapter() {
      Modals.showToast('Menggunakan Local Database (IndexedDB) untuk keamanan offline.', 'info');
    },
    confirmClearAllLocalData() {
      Modals.confirm('Reset Semua Data?', 'Mengembalikan seluruh profil dan sesi ke contoh awal.', async () => {
        await DB.clearAllStores();
        await DB.seedInitialDemoDatabaseIfNeeded();
        await Users.loadUsersAndActiveProfile();
        await UI.refreshAllDatabaseViews();
        Modals.showToast('Data berhasil di-reset.', 'info');
      });
    }
  };

  const Walkthrough = (() => {
    let idx = 0;
    let active = false;
    const steps = [
      { targetId: 'walkthrough-step-thermal-hero', view: 'overview', title: '1. Lingkaran Suhu & Sub-Metrik', body: 'Angka besar di tengah menunjukkan suhu kulit Anda. Warna hijau berarti hangat nyaman (38–41°C).' },
      { targetId: 'walkthrough-step-session', view: 'overview', title: '2. Kontrol Sesi & Simpan', body: 'Gunakan kartu hijau ini untuk menjeda atau menyimpan sesi pemakaian ke riwayat.' },
      { targetId: 'walkthrough-step-connection', view: 'overview', title: '3. Koneksi Alat / Simulasi', body: 'Aplikasi otomatis berjalan dalam Mode Simulasi. Klik "Hubungkan Perban" jika ESP32 menyala.' },
      { targetId: 'btn-please-help', view: 'overview', title: '4. Tombol Bantuan Darurat', body: 'Klik kapan saja jika perban terasa terlalu panas atau butuh panduan pemakaian.' }
    ];

    function render() {
      document.querySelectorAll('.walkthrough-highlight').forEach(e => e.classList.remove('walkthrough-highlight'));
      const s = steps[idx];
      navigateTo(s.view);
      const el = document.getElementById(s.targetId);
      if (el) {
        el.classList.add('walkthrough-highlight');
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
      document.getElementById('walkthrough-step-counter').textContent = `Langkah ${idx + 1} / ${steps.length}`;
      document.getElementById('walkthrough-title').textContent = s.title;
      document.getElementById('walkthrough-body').textContent = s.body;
    }

    return {
      start() { active = true; idx = 0; document.getElementById('walkthrough-card').classList.remove('hidden'); render(); },
      next() { if (idx < steps.length - 1) { idx++; render(); } else this.stop(); },
      prev() { if (idx > 0) { idx--; render(); } },
      stop() { active = false; document.querySelectorAll('.walkthrough-highlight').forEach(e => e.classList.remove('walkthrough-highlight')); document.getElementById('walkthrough-card').classList.add('hidden'); },
      isActive: () => active
    };
  })();

  const UI = {
    renderLiveTelemetry(rec, zone) {
      const setT = (id, t) => { const e = document.getElementById(id); if (e) e.textContent = t; };
      setT('metric-tskin', rec.t_skin.toFixed(1));
      setT('metric-tmaterial', rec.t_material.toFixed(1));
      setT('metric-deltat', `${rec.delta_t >= 0 ? '+' : ''}${rec.delta_t.toFixed(1)}°C`);
      setT('metric-lux', Math.round(rec.lux).toLocaleString('id-ID'));
      setT('metric-lux-category', Physics.classifyIlluminance(rec.lux));

      const ring = document.getElementById('smartwatch-ring-circle');
      if (ring) {
        const ratio = Math.max(0.08, Math.min(1, (rec.t_skin - 34) / (46 - 34)));
        ring.style.strokeDashoffset = String(Math.round(578 * (1 - ratio)));
        ring.style.stroke = zone.ringColor;
      }

      const badge = document.getElementById('zone-pill-badge');
      if (badge) {
        badge.textContent = zone.shortBadge;
        badge.className = `mt-1 px-3 py-0.5 rounded-full text-[11px] font-extrabold ${zone.badgeClass}`;
      }

      if (rec.skin_temp_rate !== null) {
        const perMin = rec.skin_temp_rate * 60;
        setT('metric-dtskin', `Laju: ${perMin >= 0 ? '+' : ''}${perMin.toFixed(1)} °C/mnt`);
      }

      const pcm = Physics.estimatePCMPhase(rec.t_material);
      const pcmEl = document.getElementById('metric-pcm-phase');
      if (pcmEl) {
        pcmEl.textContent = pcm.label;
        pcmEl.className = `text-xs sm:text-sm font-extrabold truncate ${pcm.colorClass}`;
      }

      const zoneBox = document.getElementById('zone-status-box');
      if (zoneBox) zoneBox.className = `mt-3 w-full max-w-md p-3 rounded-2xl border flex items-center gap-2.5 ${zone.boxClass}`;
      setT('zone-status-title', zone.title);
      setT('zone-status-desc', zone.desc);

      const pct = Math.max(3, Math.min(97, ((rec.t_skin - 34) / 12) * 100));
      const needle = document.getElementById('thermal-scale-needle');
      if (needle) needle.style.left = `${pct.toFixed(1)}%`;

      const banner = document.getElementById('critical-thermal-banner');
      if (banner) {
        banner.classList.toggle('hidden', zone.code !== 'CRITICAL');
        setT('banner-critical-temp', rec.t_skin.toFixed(1));
      }

      this.updateCountersAndStatus();
      Physics.runEnergyBalanceCalculator();
    },

    updateCountersAndStatus() {
      const s = State.session;
      const setT = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
      setT('sidebar-packet-count', s.validPackets);
      setT('stat-pkt-total', s.totalPackets);
      setT('stat-pkt-valid', s.validPackets);
      setT('stat-pkt-invalid', s.invalidPackets);
      setT('stat-pkt-dup', s.duplicatePackets);
      setT('monitoring-warning-count', s.warningCount);
      setT('stat-last-seq', s.lastSequence !== null ? `#${s.lastSequence}` : '#--');
      if (s.lastPacketTimestampIso) {
        setT('overview-last-packet-time', new Date(s.lastPacketTimestampIso).toLocaleTimeString('id-ID', { hour12: false }));
      }
      if (s.actualFreqHz) setT('stat-freq-actual', `${s.actualFreqHz.toFixed(2)} Hz`);
    },

    updateSessionControlsUI() {
      const act = State.session.status === 'ACTIVE';
      const b = document.getElementById('sidebar-session-badge');
      const t = document.getElementById('btn-sidebar-start-pause-text');
      if (b) b.textContent = act ? 'AKTIF' : 'DIJEDA';
      if (t) t.textContent = act ? 'Jeda' : 'Lanjut';
    },

    updateDataSourceIndicators() {
      const isSim = State.sourceMode === 'SIMULATION';
      const isBle = State.sourceMode === 'ESP32_BLE';
      const setT = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
      setT('header-source-text', isBle ? 'ESP32 AKTIF' : (isSim ? 'DEMO DATA' : 'STANDBY'));
      setT('hero-data-label', isBle ? 'ESP32 BLE' : 'DEMO DATA');
      setT('btn-toggle-sim-text', isSim ? 'Simulasi: ON' : 'Simulasi: OFF');
      setT('settings-datamode-label', isSim ? 'Simulasi (DEMO)' : 'Bluetooth ESP32');
    },

    updateBLEStatusUI(st) {
      const pill = document.getElementById('overview-ble-status-pill');
      const btn = document.getElementById('btn-connect-ble-text');
      if (pill) pill.textContent = st === 'CONNECTED' ? 'Terhubung ke ESP32' : 'Mode Simulasi Aktif';
      if (btn) btn.textContent = st === 'CONNECTED' ? 'Putuskan Alat' : 'Hubungkan Perban';
    },

    renderActiveUserBadges() {
      const name = State.activeUser?.display_name || 'Nama Pasien';
      const h = document.getElementById('header-active-user');
      const hi = document.getElementById('history-active-user-name');
      const greet = document.getElementById('patient-greeting-name');
      const targetEl = document.getElementById('patient-target-mins');
      const quickInput = document.getElementById('quick-patient-name-input');
      if (h) h.textContent = name;
      if (hi) hi.textContent = name;
      if (greet) greet.textContent = name;
      if (targetEl) targetEl.textContent = State.activeUser?.preferences?.target_mins || 15;
      if (quickInput) quickInput.value = name;
    },

    applyRoleExperience() {
      const isAdmin = State.activeRole === 'ADMIN';
      document.body.setAttribute('data-role', isAdmin ? 'ADMIN' : 'PATIENT');

      const subText = document.getElementById('header-subtitle-text');
      const brandIcon = document.getElementById('header-brand-icon');

      if (brandIcon) {
        brandIcon.className = isAdmin
          ? 'w-10 h-10 sm:w-11 sm:h-11 rounded-2xl bg-gradient-to-tr from-indigo-600 to-teal-500 flex items-center justify-center text-white shadow-md shadow-indigo-500/20 shrink-0 cursor-pointer select-none'
          : 'w-10 h-10 sm:w-11 sm:h-11 rounded-2xl bg-gradient-to-tr from-emerald-600 to-teal-400 flex items-center justify-center text-white shadow-md shadow-emerald-500/20 shrink-0 cursor-pointer select-none';
      }

      if (subText) {
        subText.innerHTML = isAdmin
          ? 'Laboratorium Telemetri &amp; Evaluasi Ilmiah • <span id="header-db-text">IndexedDB</span>'
          : 'Pendamping Terapi Hangat Mandiri • <span id="header-db-text">Nyaman &amp; Aman</span>';
      }

      Charts.toggleSeries(2, isAdmin);
    },

    updatePatientTherapyProgress(elapsedSec) {
      const targetMins = State.activeUser?.preferences?.target_mins || 15;
      const targetSec = targetMins * 60;
      const pct = Math.min(100, Math.round((elapsedSec / targetSec) * 100));
      const pctEl = document.getElementById('patient-goal-pct');
      const barEl = document.getElementById('patient-goal-bar');
      const statusEl = document.getElementById('patient-goal-status');
      if (pctEl) pctEl.textContent = `${pct}%`;
      if (barEl) barEl.style.width = `${Math.max(4, pct)}%`;
      if (statusEl) {
        if (pct >= 100) {
          statusEl.textContent = '🎉 Target waktu terapi hari ini telah tercapai!';
        } else {
          const remMin = Math.max(1, Math.ceil((targetSec - elapsedSec) / 60));
          statusEl.textContent = `Sekitar ${remMin} menit lagi menuju target harian.`;
        }
      }
    },

    renderProfilesView() {
      const box = document.getElementById('profile-list-container');
      const modalList = document.getElementById('modal-account-list');
      const htmlCards = State.usersList.map(u => {
        const act = State.activeUser?.user_id === u.user_id;
        return `
          <div class="p-4 rounded-2xl border ${act ? 'border-emerald-500 bg-emerald-50/40 dark:bg-emerald-950/30' : 'border-slate-200 dark:border-slate-800'} flex items-center justify-between gap-2">
            <div>
              <span class="font-bold text-sm text-slate-900 dark:text-white">${escapeHtml(u.display_name)}</span>
              <div class="text-xs text-slate-400 mt-0.5">
                ${escapeHtml(u.preferences?.focus_joint || 'Sendi Lutut')} • Target ${u.preferences?.target_mins || 15} mnt
              </div>
            </div>
            <div class="flex items-center gap-1.5 shrink-0">
              ${!act ? `<button onclick="App.Users.switchUser('${u.user_id}')" class="px-3 py-1.5 rounded-xl bg-emerald-600 text-white text-xs font-bold">Gunakan</button>` : '<span class="px-2.5 py-1 rounded-full bg-emerald-600 text-white text-[10px] font-bold">AKTIF</span>'}
              <button onclick="App.Users.deleteUser('${u.user_id}')" class="px-2.5 py-1.5 rounded-xl bg-red-50 dark:bg-red-950/50 text-red-600 text-xs font-bold">Hapus</button>
            </div>
          </div>
        `;
      }).join('');

      if (box) box.innerHTML = htmlCards;
      if (modalList) {
        modalList.innerHTML = State.usersList.map(u => {
          const act = State.activeUser?.user_id === u.user_id;
          return `
            <button onclick="App.Users.switchUser('${u.user_id}')" class="w-full text-left p-3.5 rounded-2xl border transition flex items-center justify-between gap-3 ${act ? 'border-emerald-500 bg-emerald-50/50 dark:bg-emerald-950/40' : 'border-slate-200 dark:border-slate-800 hover:border-emerald-400'}">
              <div>
                <div class="font-extrabold text-sm text-slate-900 dark:text-white">${escapeHtml(u.display_name)}</div>
                <div class="text-[11px] text-slate-400">${escapeHtml(u.preferences?.focus_joint || 'Terapi Hangat')} • Target ${u.preferences?.target_mins || 15} mnt</div>
              </div>
              <span class="px-3 py-1 rounded-xl text-xs font-bold ${act ? 'bg-emerald-600 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200'}">
                ${act ? 'Aktif' : 'Pilih'}
              </span>
            </button>
          `;
        }).join('');
      }
    },

    async refreshAllDatabaseViews() {
      if (!State.activeUser) return;
      const uid = State.activeUser.user_id;
      const sessions = await DB.SessionRepository.getByUser(uid);
      const effects = await DB.EffectTrackingRepository.getByUser(uid);

      const lastBox = document.getElementById('overview-last-session-content');
      const lastSrc = document.getElementById('overview-last-session-source');
      if (lastBox) {
        if (sessions.length === 0) {
          lastBox.innerHTML = `<p class="text-slate-400">Belum ada sesi yang disimpan.</p>`;
        } else {
          const s = sessions[0];
          const r = await DB.SensorDataRepository.getBySession(s.session_id);
          const avg = r.length ? (r.reduce((a, b) => a + b.t_skin, 0) / r.length).toFixed(1) : '--';
          const ef = effects[0];
          if (lastSrc) lastSrc.textContent = s.source_mode;
          lastBox.innerHTML = `
            <div class="flex justify-between py-1 border-b border-slate-100 dark:border-slate-800">
              <span class="text-slate-400">Waktu Sesi:</span>
              <span class="font-bold">${new Date(s.started_at).toLocaleDateString('id-ID')}</span>
            </div>
            <div class="flex justify-between py-1 border-b border-slate-100 dark:border-slate-800">
              <span class="text-slate-400">Rerata Suhu Kulit:</span>
              <span class="font-mono font-bold text-emerald-600">${avg} °C</span>
            </div>
            <div class="flex justify-between py-1">
              <span class="text-slate-400">Perubahan Nyeri:</span>
              <span class="font-bold">${ef ? (ef.pain_score_after - ef.pain_score_before) + ' poin' : 'Belum dicatat'}</span>
            </div>
          `;
        }
      }

      const tbody = document.getElementById('history-table-body');
      if (tbody) {
        if (sessions.length === 0) {
          tbody.innerHTML = `<tr><td colspan="6" class="py-6 text-center text-slate-400">Belum ada riwayat sesi.</td></tr>`;
        } else {
          const html = [];
          for (const s of sessions) {
            const r = await DB.SensorDataRepository.getBySession(s.session_id);
            const avg = r.length ? (r.reduce((a, b) => a + b.t_skin, 0) / r.length).toFixed(1) : '--';
            html.push(`
              <tr>
                <td class="py-3 px-3 font-bold">${new Date(s.started_at).toLocaleString('id-ID')}</td>
                <td class="py-3 px-3"><span class="px-2 py-0.5 rounded-full text-[10px] bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300 font-bold">${escapeHtml(s.source_mode)}</span></td>
                <td class="py-3 px-3 font-mono">${Session.formatHHMMSS(s.duration_sec || 0)}</td>
                <td class="py-3 px-3 font-mono font-bold text-emerald-600">${avg}°C</td>
                <td class="py-3 px-3 text-slate-400">${escapeHtml(s.notes || '-')}</td>
                <td class="py-3 px-3 text-right space-x-1">
                  <button onclick="App.replaySavedSession('${s.session_id}')" class="px-2.5 py-1 rounded-xl bg-emerald-600 text-white text-xs font-bold">Grafik</button>
                  <button onclick="App.exportSavedSession('${s.session_id}')" class="px-2.5 py-1 rounded-xl bg-slate-100 dark:bg-slate-800 text-xs font-bold">CSV</button>
                  <button onclick="App.deleteSavedSession('${s.session_id}')" class="px-2.5 py-1 rounded-xl text-red-500 text-xs font-bold">Hapus</button>
                </td>
              </tr>
            `);
          }
          tbody.innerHTML = html.join('');
        }
      }

      await Impact.renderImpactDashboard();
      const allU = await DB.UserRepository.getAll();
      const allS = await DB.SessionRepository.getAll();
      const allR = await DB.SensorDataRepository.getAll();
      const allE = await DB.EffectTrackingRepository.getAll();
      document.getElementById('res-total-users').textContent = allU.length;
      document.getElementById('res-total-sessions').textContent = allS.length;
      document.getElementById('res-total-readings').textContent = allR.length;

      const cohortBody = document.getElementById('admin-cohort-table-body');
      if (cohortBody) {
        cohortBody.innerHTML = allU.map(u => {
          const uSes = allS.filter(s => s.user_id === u.user_id);
          const uEff = allE.filter(e => e.user_id === u.user_id);
          const avgPainDelta = uEff.length
            ? (uEff.reduce((acc, e) => acc + (e.pain_score_after - e.pain_score_before), 0) / uEff.length).toFixed(1)
            : '--';
          return `
            <tr>
              <td class="py-3 px-3 font-bold text-slate-900 dark:text-white">${escapeHtml(u.display_name)}</td>
              <td class="py-3 px-3">
                <span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                  Pasien
                </span>
              </td>
              <td class="py-3 px-3 text-slate-500">${escapeHtml(u.preferences?.focus_joint || '-')} (${u.preferences?.target_mins || 15} mnt)</td>
              <td class="py-3 px-3 font-mono font-bold">${uSes.length} sesi</td>
              <td class="py-3 px-3 font-mono font-bold text-emerald-600">${avgPainDelta !== '--' ? avgPainDelta + ' poin' : 'Belum ada'}</td>
              <td class="py-3 px-3 text-right">
                <button onclick="App.Users.switchUser('${u.user_id}')" class="px-2.5 py-1 rounded-xl bg-slate-100 hover:bg-emerald-600 hover:text-white dark:bg-slate-800 text-xs font-bold transition">
                  Buka Profil
                </button>
              </td>
            </tr>
          `;
        }).join('');
      }
    }
  };

  window.Manihot.UI = UI;

  function navigateTo(view) {
    State.currentView = view;
    document.querySelectorAll('.app-view').forEach(s => s.classList.add('hidden'));
    document.getElementById(`view-${view}`)?.classList.remove('hidden');

    document.querySelectorAll('.nav-btn').forEach(b => {
      const act = b.getAttribute('data-nav') === view;
      b.className = act
        ? 'nav-btn px-4 py-2 rounded-full text-xs font-extrabold bg-emerald-600 text-white shadow-sm transition flex items-center gap-2'
        : 'nav-btn px-4 py-2 rounded-full text-xs font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition flex items-center gap-2';
    });

    document.querySelectorAll('.mobile-nav-btn').forEach(b => {
      const act = b.getAttribute('data-nav-mobile') === view;
      b.className = act
        ? 'mobile-nav-btn touch-target flex flex-col items-center justify-center py-1 rounded-2xl text-[10px] font-extrabold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/50'
        : 'mobile-nav-btn touch-target flex flex-col items-center justify-center py-1 rounded-2xl text-[10px] font-semibold text-slate-400';
    });
  }

  function applyTheme(theme) {
    const isDark = theme === 'dark';
    document.documentElement.classList.toggle('dark', isDark);
    document.getElementById('theme-icon-sun')?.classList.toggle('hidden', !isDark);
    document.getElementById('theme-icon-moon')?.classList.toggle('hidden', isDark);
  }

  function toggleTheme() {
    const next = document.documentElement.classList.contains('dark') ? 'light' : 'dark';
    localStorage.setItem(Config.storageKeys.theme, next);
    applyTheme(next);
  }

  function openHelpModal(tab = 'thermal') {
    document.getElementById('help-modal')?.classList.remove('hidden');
    switchHelpTab(tab);
  }

  function closeHelpModal() {
    document.getElementById('help-modal')?.classList.add('hidden');
  }

  function openRoleModal() {
    UI.renderProfilesView();
    document.getElementById('role-modal')?.classList.remove('hidden');
  }

  function closeRoleModal() {
    document.getElementById('role-modal')?.classList.add('hidden');
  }

  function switchHelpTab(tab) {
    ['thermal', 'setup', 'troubleshoot'].forEach(t => {
      document.getElementById(`help-tab-${t}`)?.classList.toggle('hidden', t !== tab);
      const b = document.getElementById(`help-tab-btn-${t}`);
      if (b) {
        b.className = t === tab
          ? 'help-tab-btn px-3.5 py-2 rounded-t-2xl font-bold text-xs border-b-2 border-rose-500 text-rose-600 shrink-0'
          : 'help-tab-btn px-3.5 py-2 rounded-t-2xl font-semibold text-xs border-b-2 border-transparent text-slate-500 shrink-0';
      }
    });
  }

  async function replaySavedSession(sid) {
    const all = await DB.SessionRepository.getAll();
    const ses = all.find(s => s.session_id === sid);
    if (!ses) return;
    const r = await DB.SensorDataRepository.getBySession(sid);
    Charts.renderReplayChart(ses, r);
  }

  async function exportSavedSession(sid) {
    const all = await DB.SessionRepository.getAll();
    const ses = all.find(s => s.session_id === sid);
    if (!ses) return;
    const r = await DB.SensorDataRepository.getBySession(sid);
    Export.downloadSessionCSV(ses, r);
  }

  function deleteSavedSession(sid) {
    Modals.confirm('Hapus Sesi Ini?', 'Data sesi ini akan dihapus dari riwayat.', async () => {
      await DB.SensorDataRepository.deleteBySession(sid);
      await DB.SessionRepository.delete(sid);
      await UI.refreshAllDatabaseViews();
    });
  }

  async function init() {
    if (window.lucide) window.lucide.createIcons();
    const savedTheme = localStorage.getItem(Config.storageKeys.theme);
    applyTheme(savedTheme || 'light');
    Settings.loadSavedSettings();
    Charts.initCharts();
    Physics.runPCMCalculator();
    Physics.runEnergyBalanceCalculator();
    FAQ.render();

    await DB.seedInitialDemoDatabaseIfNeeded();
    await Users.loadUsersAndActiveProfile();

    Session.initNewSession();
    navigateTo('overview');
    Simulation.setScenario('optimal');
    Simulation.startLoop();
    await UI.refreshAllDatabaseViews();

    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        closeHelpModal();
        closeRoleModal();
        StealthAdmin.closeModal();
        Modals.closeConfirm();
        if (Walkthrough.isActive()) Walkthrough.stop();
      }
      if (e.ctrlKey && e.shiftKey && (e.key === 'A' || e.key === 'a')) {
        e.preventDefault();
        StealthAdmin.openModal();
      }
    });
  }

  return {
    Config, State, Modals, Physics, Simulation, BLE, Session, Charts, Users, StealthAdmin, Impact, FAQ, Export, Settings, Walkthrough,
    navigateTo, toggleTheme, openHelpModal, closeHelpModal, openRoleModal, closeRoleModal, switchHelpTab, replaySavedSession, exportSavedSession, deleteSavedSession, init
  };
})();

window.addEventListener('DOMContentLoaded', () => window.App.init());