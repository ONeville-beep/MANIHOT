/**
 * MANIHOT — Session Controller, Photothermal Simulator & Web Bluetooth (ESP32)
 */
window.Manihot = window.Manihot || {};

window.Manihot.Session = (() => {
  const { State, Modals, Physics, DB, Charts } = window.Manihot;
  let timerHandle = null;

  function formatHHMMSS(totalSec) {
    const sec = Math.max(0, Math.floor(totalSec));
    const h = String(Math.floor(sec / 3600)).padStart(2, '0');
    const m = String(Math.floor((sec % 3600) / 60)).padStart(2, '0');
    const s = String(sec % 60).padStart(2, '0');
    return `${h}:${m}:${s}`;
  }

  function getElapsedSeconds() {
    const s = State.session;
    const activeDelta = s.status === 'ACTIVE' ? (Date.now() - s.lastResumeMs) : 0;
    return Math.floor((s.accumulatedMs + activeDelta) / 1000);
  }

  function startWallClockTimer() {
    if (timerHandle) clearInterval(timerHandle);
    timerHandle = setInterval(() => {
      const elapsedSec = getElapsedSeconds();
      const formatted = formatHHMMSS(elapsedSec);
      const t1 = document.getElementById('sidebar-session-timer');
      const t2 = document.getElementById('overview-duration');
      if (t1) t1.textContent = formatted;
      if (t2) t2.textContent = formatted;
      window.Manihot.UI?.updatePatientTherapyProgress(elapsedSec);
    }, 500);
  }

  function initNewSession() {
    const now = Date.now();
    State.session = {
      sessionId: `ses_${now.toString(36)}`,
      status: 'ACTIVE',
      startedAtMs: now,
      accumulatedMs: 0,
      lastResumeMs: now,
      samplingIntervalMs: State.session?.samplingIntervalMs || 1000,
      totalPackets: 0,
      validPackets: 0,
      invalidPackets: 0,
      duplicatePackets: 0,
      warningCount: 0,
      lastSequence: null,
      lastPacketTimestampIso: null,
      lastValidSample: null,
      actualFreqHz: null,
      currentReadingsBuffer: []
    };
    window.Manihot.UI?.updateSessionControlsUI();
    window.Manihot.UI?.updateCountersAndStatus();
    startWallClockTimer();
  }

  function pauseSession() {
    if (State.session.status !== 'ACTIVE') return;
    State.session.accumulatedMs += Date.now() - State.session.lastResumeMs;
    State.session.status = 'PAUSED';
    window.Manihot.UI?.updateSessionControlsUI();
    Modals.showToast('Sesi pemantauan dijeda.', 'info');
  }

  function resumeSession() {
    if (State.session.status === 'ACTIVE') return;
    State.session.lastResumeMs = Date.now();
    State.session.status = 'ACTIVE';
    window.Manihot.UI?.updateSessionControlsUI();
    Modals.showToast('Sesi pemantauan dilanjutkan.', 'success');
  }

  function toggleStartPause() {
    if (State.session.status === 'ACTIVE') pauseSession();
    else resumeSession();
  }

  async function endAndSaveSession() {
    const s = State.session;
    const durationSec = getElapsedSeconds();
    const sessionRecord = {
      session_id: s.sessionId,
      user_id: State.activeUser?.user_id || 'usr_demo_01',
      started_at: new Date(s.startedAtMs).toISOString(),
      ended_at: new Date().toISOString(),
      device_id: document.getElementById('cfg-device-id')?.value || 'MANIHOT-PROTO-01',
      source_mode: State.sourceMode === 'ESP32_BLE' ? 'ESP32 BLE' : 'DEMO DATA',
      sampling_interval: s.samplingIntervalMs / 1000,
      duration_sec: durationSec,
      notes: `Sesi ${State.activeUser?.preferences?.focus_joint || 'Terapi Hangat'} (${s.validPackets} sampel valid)`
    };

    await DB.SessionRepository.save(sessionRecord);
    for (const r of s.currentReadingsBuffer) {
      await DB.SensorDataRepository.save(r);
    }

    await window.Manihot.UI?.refreshAllDatabaseViews();
    Modals.showToast('Sesi berhasil disimpan ke Riwayat!', 'success');
    initNewSession();
  }

  function setSamplingInterval(msVal) {
    const ms = parseInt(msVal, 10) || 1000;
    State.session.samplingIntervalMs = ms;
    const reqHz = (1000 / ms).toFixed(2);
    const reqEl = document.getElementById('stat-freq-req');
    if (reqEl) reqEl.textContent = `${reqHz} Hz`;

    const s1 = document.getElementById('monitoring-interval-select');
    const s2 = document.getElementById('cfg-sampling-select');
    if (s1 && s1.value !== String(ms)) s1.value = String(ms);
    if (s2 && s2.value !== String(ms)) s2.value = String(ms);

    if (State.sourceMode === 'SIMULATION') {
      window.Manihot.Simulation?.startLoop();
    }
    Modals.showToast(`Interval sampling diatur ke ${ms / 1000} detik (${reqHz} Hz).`, 'info');
  }

  function confirmResetCounters() {
    Modals.confirm(
      'Reset Statistik Tampilan?',
      'Penghitung paket sesi saat ini akan di-nolkan tanpa menghapus data riwayat penelitian di database.',
      () => {
        State.session.totalPackets = 0;
        State.session.validPackets = 0;
        State.session.invalidPackets = 0;
        State.session.duplicatePackets = 0;
        State.session.warningCount = 0;
        window.Manihot.UI?.updateCountersAndStatus();
        Modals.showToast('Counter statistik tampilan berhasil di-reset.', 'info');
      }
    );
  }

  function ingestPacket(rawPayload, sourceLabel = 'DEMO DATA') {
    if (State.session.status !== 'ACTIVE') return;
    const s = State.session;
    s.totalPackets += 1;

    let parsed = null;
    try {
      parsed = typeof rawPayload === 'string' ? JSON.parse(rawPayload) : rawPayload;
    } catch (_) {
      s.invalidPackets += 1;
      window.Manihot.UI?.updateCountersAndStatus();
      return;
    }

    const tSkin = Number(parsed?.t_skin);
    const tMat = Number(parsed?.t_material);
    const lux = Number(parsed?.lux);
    const seq = parsed?.sequence !== undefined ? Number(parsed.sequence) : null;

    if (!Number.isFinite(tSkin) || !Number.isFinite(tMat) || !Number.isFinite(lux) || tSkin < 10 || tSkin > 75 || lux < 0) {
      s.invalidPackets += 1;
      window.Manihot.UI?.updateCountersAndStatus();
      return;
    }

    if (seq !== null && s.lastSequence !== null && seq === s.lastSequence) {
      s.duplicatePackets += 1;
      window.Manihot.UI?.updateCountersAndStatus();
      return;
    }

    const nowMs = Date.now();
    const tsIso = parsed?.timestamp || new Date(nowMs).toISOString();
    let skinRate = null;
    let matRate = null;

    if (s.lastValidSample) {
      const prevMs = new Date(s.lastValidSample.timestamp).getTime();
      const dtSec = (nowMs - prevMs) / 1000;
      if (dtSec > 0.05) {
        s.actualFreqHz = 1 / dtSec;
      }
      skinRate = Physics.calculateTempRate(tSkin, s.lastValidSample.t_skin, nowMs, prevMs);
      matRate = Physics.calculateTempRate(tMat, s.lastValidSample.t_material, nowMs, prevMs);
    }

    const deltaT = Physics.calculateDeltaT(tMat, tSkin);
    const zone = Physics.classifyThermalZone(tSkin);

    if (zone.code === 'ELEVATED' || zone.code === 'CRITICAL') {
      s.warningCount += 1;
      const warnEl = document.getElementById('monitoring-last-warning-text');
      if (warnEl) {
        warnEl.textContent = `Peringatan terakhir: ${tSkin.toFixed(1)}°C (${new Date(tsIso).toLocaleTimeString('id-ID')})`;
      }
    }

    const readingRecord = {
      reading_id: `${s.sessionId}_${s.validPackets + 1}`,
      session_id: s.sessionId,
      timestamp: tsIso,
      t_skin: +tSkin.toFixed(2),
      t_material: +tMat.toFixed(2),
      lux: Math.round(lux),
      delta_t: +deltaT.toFixed(2),
      skin_temp_rate: skinRate !== null ? +skinRate.toFixed(4) : null,
      material_temp_rate: matRate !== null ? +matRate.toFixed(4) : null,
      warning_status: zone.code,
      sequence: seq ?? (s.validPackets + 1),
      source_mode: sourceLabel,
      quality_status: 'VALID'
    };

    s.validPackets += 1;
    s.lastSequence = readingRecord.sequence;
    s.lastPacketTimestampIso = tsIso;
    s.lastValidSample = readingRecord;
    s.currentReadingsBuffer.push(readingRecord);
    State.latestMetrics = readingRecord;

    window.Manihot.UI?.renderLiveTelemetry(readingRecord, zone);
    Charts.pushLivePoint(readingRecord);
  }

  return {
    formatHHMMSS,
    initNewSession,
    pauseSession,
    resumeSession,
    toggleStartPause,
    endAndSaveSession,
    setSamplingInterval,
    confirmResetCounters,
    ingestPacket
  };
})();

window.Manihot.Simulation = (() => {
  const { State, Modals, Session } = window.Manihot;
  let loopHandle = null;
  let simSeq = 100;
  let currentSkin = 39.2;
  let currentMat = 41.9;
  const simParams = {
    lux: 18500,
    ambient: 29.5,
    gain: 1.0,
    disturbance: 0.0,
    targetSkin: 39.4,
    targetMat: 42.1
  };

  function computeTargetsFromSliders() {
    const normLux = Math.min(1.5, simParams.lux / 20000);
    let rawMat = simParams.ambient + (12.5 * normLux * simParams.gain) + simParams.disturbance;
    if (rawMat > 41.2 && rawMat < 44.5) {
      rawMat = 41.2 + (rawMat - 41.2) * 0.45;
    }
    simParams.targetMat = Math.max(25.0, Math.min(52.0, rawMat));
    simParams.targetSkin = Math.max(33.5, Math.min(48.5, simParams.targetMat - 2.5 + simParams.disturbance * 0.25));
  }

  function stepSimulation() {
    if (State.sourceMode !== 'SIMULATION' || State.session.status !== 'ACTIVE') return;
    computeTargetsFromSliders();

    currentMat += (simParams.targetMat - currentMat) * 0.28 + (Math.random() - 0.5) * 0.08;
    currentSkin += (simParams.targetSkin - currentSkin) * 0.25 + (Math.random() - 0.5) * 0.06;
    const jitterLux = Math.max(0, simParams.lux + Math.round((Math.random() - 0.5) * 180));

    simSeq += 1;
    Session.ingestPacket({
      timestamp: new Date().toISOString(),
      t_skin: +currentSkin.toFixed(2),
      t_material: +currentMat.toFixed(2),
      lux: jitterLux,
      sequence: simSeq
    }, 'DEMO DATA');
  }

  function startLoop() {
    stopLoop();
    const interval = State.session.samplingIntervalMs || 1000;
    loopHandle = setInterval(stepSimulation, interval);
  }

  function stopLoop() {
    if (loopHandle) {
      clearInterval(loopHandle);
      loopHandle = null;
    }
  }

  function toggleMode() {
    if (State.sourceMode === 'SIMULATION') {
      State.sourceMode = 'STANDBY';
      stopLoop();
      Modals.showToast('Simulasi dimatikan (Mode Standby).', 'info');
    } else {
      State.sourceMode = 'SIMULATION';
      startLoop();
      Modals.showToast('Mode Simulasi (DEMO DATA) diaktifkan.', 'success');
    }
    window.Manihot.UI?.updateDataSourceIndicators();
  }

  function setScenario(key) {
    const presets = {
      warming: { label: 'Pemanasan Awal', lux: 3200, ambient: 27.0, gain: 0.85, disturbance: -1.0, jumpSkin: 36.6, jumpMat: 38.2 },
      optimal: { label: 'Target Stabil', lux: 18500, ambient: 29.5, gain: 1.0, disturbance: 0.0, jumpSkin: 39.4, jumpMat: 42.1 },
      elevated: { label: 'Suhu Meningkat', lux: 38000, ambient: 32.0, gain: 1.25, disturbance: 1.5, jumpSkin: 42.3, jumpMat: 45.1 },
      critical: { label: 'Overheating Kritis', lux: 55000, ambient: 34.5, gain: 1.5, disturbance: 4.5, jumpSkin: 44.6, jumpMat: 47.8 }
    };
    const p = presets[key] || presets.optimal;
    simParams.lux = p.lux;
    simParams.ambient = p.ambient;
    simParams.gain = p.gain;
    simParams.disturbance = p.disturbance;
    currentSkin = p.jumpSkin;
    currentMat = p.jumpMat;

    const setSlider = (id, val, txtId, txt) => {
      const el = document.getElementById(id);
      const tEl = document.getElementById(txtId);
      if (el) el.value = String(val);
      if (tEl) tEl.textContent = txt;
    };
    setSlider('slider-lux', p.lux, 'slider-lux-val', `${p.lux.toLocaleString('id-ID')} lx`);
    setSlider('slider-ambient', p.ambient, 'slider-ambient-val', `${p.ambient.toFixed(1)} °C`);
    setSlider('slider-gain', p.gain, 'slider-gain-val', `${p.gain.toFixed(2)}x`);
    setSlider('slider-disturbance', p.disturbance, 'slider-disturbance-val', `${p.disturbance >= 0 ? '+' : ''}${p.disturbance.toFixed(1)} °C`);

    const badge = document.getElementById('overview-active-scenario');
    if (badge) badge.textContent = p.label;

    if (State.sourceMode === 'SIMULATION') {
      stepSimulation();
    }
  }

  function updateFromSliders() {
    simParams.lux = parseFloat(document.getElementById('slider-lux')?.value || '18500');
    simParams.ambient = parseFloat(document.getElementById('slider-ambient')?.value || '29.5');
    simParams.gain = parseFloat(document.getElementById('slider-gain')?.value || '1.0');
    simParams.disturbance = parseFloat(document.getElementById('slider-disturbance')?.value || '0.0');

    const setT = (id, t) => { const e = document.getElementById(id); if (e) e.textContent = t; };
    setT('slider-lux-val', `${Math.round(simParams.lux).toLocaleString('id-ID')} lx`);
    setT('slider-ambient-val', `${simParams.ambient.toFixed(1)} °C`);
    setT('slider-gain-val', `${simParams.gain.toFixed(2)}x`);
    setT('slider-disturbance-val', `${simParams.disturbance >= 0 ? '+' : ''}${simParams.disturbance.toFixed(1)} °C`);
  }

  function injectCorruptPacket() {
    Session.ingestPacket('{"timestamp":"CORRUPT_JSON","t_skin":"NaN",', 'DEMO DATA');
    Modals.showToast('Paket rusak disuntikkan: ditolak otomatis oleh validator.', 'warning');
  }

  return {
    startLoop,
    stopLoop,
    toggleMode,
    setScenario,
    updateFromSliders,
    injectCorruptPacket
  };
})();

window.Manihot.BLE = (() => {
  const { Config, State, Modals, Session, Simulation } = window.Manihot;
  let bleDevice = null;
  let telemetryChar = null;

  function logDiag(msg) {
    const box = document.getElementById('ble-diagnostic-log');
    if (!box) return;
    const line = document.createElement('div');
    line.textContent = `[${new Date().toLocaleTimeString('id-ID', { hour12: false })}] ${msg}`;
    box.appendChild(line);
    box.scrollTop = box.scrollHeight;
  }

  async function handleConnectClick() {
    if (bleDevice && bleDevice.gatt?.connected) {
      disconnect();
      return;
    }
    await connect();
  }

  async function connect() {
    if (!navigator.bluetooth) {
      logDiag('Web Bluetooth API tidak didukung di browser ini.');
      Modals.showToast('Browser ini belum mendukung Web Bluetooth. Gunakan Chrome/Edge atau Mode Simulasi.', 'warning');
      return;
    }
    try {
      logDiag(`Memindai perangkat BLE dengan prefix "${Config.ble.deviceNamePrefix}"...`);
      bleDevice = await navigator.bluetooth.requestDevice({
        filters: [{ namePrefix: Config.ble.deviceNamePrefix }],
        optionalServices: [Config.ble.serviceUUID, 'battery_service']
      });

      bleDevice.addEventListener('gattserverdisconnected', () => {
        logDiag('Perangkat ESP32 terputus.');
        State.sourceMode = 'SIMULATION';
        window.Manihot.UI?.updateBLEStatusUI('DISCONNECTED');
        window.Manihot.UI?.updateDataSourceIndicators();
        Simulation.startLoop();
        Modals.showToast('Koneksi ESP32 terputus. Kembali ke Mode Simulasi.', 'warning');
      });

      const server = await bleDevice.gatt.connect();
      const service = await server.getPrimaryService(Config.ble.serviceUUID);
      telemetryChar = await service.getCharacteristic(Config.ble.telemetryCharUUID);

      await telemetryChar.startNotifications();
      telemetryChar.addEventListener('characteristicvaluechanged', (event) => {
        const decoder = new TextDecoder('utf-8');
        const rawText = decoder.decode(event.target.value);
        Session.ingestPacket(rawText, 'ESP32 BLE');
      });

      Simulation.stopLoop();
      State.sourceMode = 'ESP32_BLE';
      window.Manihot.UI?.updateBLEStatusUI('CONNECTED');
      window.Manihot.UI?.updateDataSourceIndicators();
      logDiag(`Terhubung ke ${bleDevice.name || 'ESP32'}. Notifikasi GATT aktif.`);
      Modals.showToast(`Terhubung ke ${bleDevice.name || 'ESP32'}!`, 'success');
    } catch (err) {
      logDiag(`Gagal terhubung BLE: ${err.message || err}`);
      Modals.showToast('Koneksi BLE dibatalkan atau tidak ditemukan. Mode Simulasi tetap aktif.', 'info');
    }
  }

  function disconnect() {
    if (bleDevice && bleDevice.gatt?.connected) {
      bleDevice.gatt.disconnect();
    }
    State.sourceMode = 'SIMULATION';
    window.Manihot.UI?.updateBLEStatusUI('DISCONNECTED');
    window.Manihot.UI?.updateDataSourceIndicators();
    Simulation.startLoop();
  }

  return { handleConnectClick, connect, disconnect, logDiag };
})();