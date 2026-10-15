/**
 * @file admin.js
 * @description Pengendali utama untuk Admin Dashboard (admin.html).
 * Mengoordinasikan koneksi Web Bluetooth ESP32, generator skenario simulasi DEMO,
 * pembaruan grafik Chart.js, tabel riwayat telemetri, ekspor CSV, log teknis,
 * dan validasi perubahan konfigurasi.
 */

import { dataStore } from './data-store.js';
import { evaluateSkinThermalStatus } from './calculations.js';
import { ManihotBleClient } from './bluetooth.js';
import { MockTelemetryGenerator, DEMO_SCENARIOS } from './mock-data.js';
import { ManihotChartsManager } from './charts.js';

const chartsManager = new ManihotChartsManager();

const bleClient = new ManihotBleClient({
  onSampleReceived: (sample) => {
    dataStore.ingestTelemetrySample(sample);
  },
  onStatusChange: (status, deviceName, message) => {
    const isSessionActive = status === 'CONNECTED';
    dataStore.updateSystemState({
      connectionStatus: status,
      deviceName: deviceName || null,
      sourceMode: status === 'CONNECTED' ? 'HARDWARE' : dataStore.getSnapshot().state.sourceMode,
      sessionActive: isSessionActive,
      sessionStartTime: isSessionActive ? Date.now() : dataStore.getSnapshot().state.sessionStartTime
    });
    updateHardwareBannerMessage(status, message);
  },
  onLog: (level, category, msg) => {
    dataStore.addLog(level, category, msg);
  }
});

const mockGenerator = new MockTelemetryGenerator({
  onSampleGenerated: (sample) => {
    dataStore.ingestTelemetrySample(sample);
  },
  onLog: (level, category, msg) => {
    dataStore.addLog(level, category, msg);
  }
});

let isLocalDemoRunning = false;
let staleWatchdogId = null;

function initAdminDashboard() {
  populateDemoScenarioDropdown();
  populateConfigForm(dataStore.getSnapshot().config);

  chartsManager.initCharts(
    {
      tempCanvasId: 'chartTemp',
      deltaCanvasId: 'chartDelta',
      rateCanvasId: 'chartRate',
      luxCanvasId: 'chartLux'
    },
    dataStore.getSnapshot().config
  );

  // Render awal berdasarkan state yang tersimpan
  const initialSnap = dataStore.getSnapshot();
  renderAdminDashboard(initialSnap);
  chartsManager.syncWithHistory(initialSnap.history, initialSnap.config);

  // Langganan perubahan state dari dataStore
  dataStore.subscribe((snapshot, eventType, payload) => {
    if (eventType === 'REMOTE_COMMAND' && payload) {
      handleRemoteCommandFromPatientTab(payload);
    }
    if (eventType === 'CONFIG_UPDATED') {
      populateConfigForm(snapshot.config);
      if (isLocalDemoRunning) {
        mockGenerator.updateInterval(snapshot.config.uiUpdateIntervalMs);
      }
      chartsManager.syncWithHistory(snapshot.history, snapshot.config);
    }
    if (eventType === 'SAMPLE_INGESTED' || eventType === 'HISTORY_CLEARED' || eventType === 'REMOTE_STATE_UPDATED') {
      chartsManager.syncWithHistory(snapshot.history, snapshot.config);
    }
    renderAdminDashboard(snapshot);
  });

  bindAdminEvents();

  // Watchdog setiap 1 detik untuk memantau usia data (stale detection)
  staleWatchdogId = window.setInterval(() => {
    renderAdminDashboard(dataStore.getSnapshot());
  }, 1000);

  window.addEventListener('beforeunload', () => {
    if (isLocalDemoRunning) {
      mockGenerator.stop();
    }
    if (bleClient.isConnected) {
      bleClient.disconnect();
    }
    if (staleWatchdogId) {
      window.clearInterval(staleWatchdogId);
    }
    chartsManager.destroyAll();
  });
}

function populateDemoScenarioDropdown() {
  const select = document.getElementById('selectDemoScenario');
  if (!select) return;
  select.innerHTML = '';
  Object.values(DEMO_SCENARIOS).forEach((sc) => {
    const opt = document.createElement('option');
    opt.value = sc.id;
    opt.textContent = sc.name;
    select.appendChild(opt);
  });
  select.value = dataStore.getSnapshot().state.demoScenario || 'NORMAL';
}

function bindAdminEvents() {
  const btnStartDemo = document.getElementById('btnStartDemo');
  const btnStopSession = document.getElementById('btnStopSession');
  const btnConnectBle = document.getElementById('btnConnectBle');
  const btnDisconnectBle = document.getElementById('btnDisconnectBle');
  const selectScenario = document.getElementById('selectDemoScenario');
  const btnExportCsv = document.getElementById('btnExportCsv');
  const btnClearHistory = document.getElementById('btnClearHistory');
  const configForm = document.getElementById('adminConfigForm');
  const btnResetConfig = document.getElementById('btnResetConfig');

  if (btnStartDemo) {
    btnStartDemo.addEventListener('click', () => {
      startDemoMode();
    });
  }

  if (btnStopSession) {
    btnStopSession.addEventListener('click', () => {
      stopActiveSession();
    });
  }

  if (selectScenario) {
    selectScenario.addEventListener('change', (e) => {
      const scenarioId = e.target.value;
      dataStore.updateSystemState({ demoScenario: scenarioId });
      if (isLocalDemoRunning) {
        mockGenerator.setScenario(scenarioId);
      }
    });
  }

  if (btnConnectBle) {
    btnConnectBle.addEventListener('click', async () => {
      // Hentikan mode DEMO terlebih dahulu jika sedang berjalan
      if (isLocalDemoRunning) {
        mockGenerator.stop();
        isLocalDemoRunning = false;
      }
      const snap = dataStore.getSnapshot();
      dataStore.updateSystemState({
        sourceMode: 'HARDWARE',
        sessionActive: false,
        connectionStatus: 'CONNECTING'
      });
      await bleClient.connect(snap.config);
    });
  }

  if (btnDisconnectBle) {
    btnDisconnectBle.addEventListener('click', () => {
      bleClient.disconnect();
      dataStore.updateSystemState({
        sessionActive: false,
        connectionStatus: 'DISCONNECTED'
      });
    });
  }

  if (btnExportCsv) {
    btnExportCsv.addEventListener('click', () => {
      const res = dataStore.exportHistoryToCsv();
      if (!res.success) {
        window.alert(res.message);
        return;
      }
      const blob = new Blob([res.csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', res.filename);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    });
  }

  if (btnClearHistory) {
    btnClearHistory.addEventListener('click', () => {
      const confirmed = window.confirm('Apakah Anda yakin ingin menghapus seluruh riwayat sampel pada sesi ini?');
      if (confirmed) {
        dataStore.clearSessionHistory();
      }
    });
  }

  if (configForm) {
    configForm.addEventListener('submit', (e) => {
      e.preventDefault();
      handleConfigFormSubmit();
    });
  }

  if (btnResetConfig) {
    btnResetConfig.addEventListener('click', () => {
      const confirmed = window.confirm('Kembalikan seluruh parameter konfigurasi ke nilai rancangan bawaan (default)?');
      if (confirmed) {
        dataStore.resetConfigToDefault();
      }
    });
  }
}

function startDemoMode() {
  if (bleClient.isConnected) {
    bleClient.disconnect();
  }
  const snap = dataStore.getSnapshot();
  const scenario = document.getElementById('selectDemoScenario')?.value || snap.state.demoScenario || 'NORMAL';

  isLocalDemoRunning = true;
  dataStore.updateSystemState({
    sessionActive: true,
    sessionStartTime: Date.now(),
    sourceMode: 'DEMO',
    demoScenario: scenario,
    connectionStatus: 'CONNECTED',
    deviceName: `Simulator MANIHOT (${scenario})`,
    controllerTabId: snap.tabId
  });

  mockGenerator.start(snap.config.uiUpdateIntervalMs, scenario);
  updateHardwareBannerMessage('DEMO_ACTIVE', 'Mode Simulasi DEMO sedang berjalan. Data yang tampil merupakan ilustrasi pengujian.');
}

function stopActiveSession() {
  if (isLocalDemoRunning) {
    mockGenerator.stop();
    isLocalDemoRunning = false;
  }
  if (bleClient.isConnected) {
    bleClient.disconnect();
  }
  dataStore.updateSystemState({
    sessionActive: false,
    connectionStatus: 'DISCONNECTED'
  });
  dataStore.addLog('INFO', 'SESI_ADMIN', 'Sesi pemantauan dihentikan oleh Administrator.');
}

function handleRemoteCommandFromPatientTab(cmd) {
  if (cmd.commandName === 'START_SESSION' && !dataStore.getSnapshot().state.sessionActive) {
    startDemoMode();
  } else if (cmd.commandName === 'STOP_SESSION' && dataStore.getSnapshot().state.sessionActive) {
    stopActiveSession();
  }
}

function updateHardwareBannerMessage(status, message) {
  const box = document.getElementById('adminHardwareStatusBox');
  const titleEl = document.getElementById('adminHardwareStatusTitle');
  const descEl = document.getElementById('adminHardwareStatusDesc');
  if (!box || !titleEl || !descEl) return;

  if (status === 'ERROR') {
    box.className = 'alert-box alert-danger';
    titleEl.textContent = 'Koneksi Perangkat Keras (HARDWARE) Gagal';
    descEl.textContent = `${message} Aplikasi TIDAK beralih otomatis ke data simulasi. Silakan periksa perangkat ESP32 atau aktifkan Mode DEMO secara sadar jika ingin menguji antarmuka tanpa sensor fisik.`;
  } else if (status === 'CONNECTED') {
    box.className = 'alert-box alert-info';
    titleEl.textContent = 'Mode HARDWARE Aktif (Koneksi BLE GATT Terhubung)';
    descEl.textContent = message;
  } else {
    box.className = 'alert-box hidden';
  }
}

function populateConfigForm(config) {
  const setVal = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.value = val;
  };
  setVal('cfgTempMin', config.tempMinDesign);
  setVal('cfgTempMax', config.tempMaxDesign);
  setVal('cfgInterval', config.uiUpdateIntervalMs);
  setVal('cfgStale', config.staleDataThresholdMs);
  setVal('cfgMaxChartPts', config.maxChartPoints);
  setVal('cfgMaxHistory', config.maxHistorySamples);
  setVal('cfgBlePrefix', config.bleDeviceNamePrefix);
  setVal('cfgBleService', config.bleServiceUuid);
  setVal('cfgBleChar', config.bleCharacteristicUuid);
}

function handleConfigFormSubmit() {
  const candidate = {
    tempMinDesign: Number(document.getElementById('cfgTempMin')?.value),
    tempMaxDesign: Number(document.getElementById('cfgTempMax')?.value),
    uiUpdateIntervalMs: Number(document.getElementById('cfgInterval')?.value),
    staleDataThresholdMs: Number(document.getElementById('cfgStale')?.value),
    maxChartPoints: Number(document.getElementById('cfgMaxChartPts')?.value),
    maxHistorySamples: Number(document.getElementById('cfgMaxHistory')?.value),
    bleDeviceNamePrefix: document.getElementById('cfgBlePrefix')?.value,
    bleServiceUuid: document.getElementById('cfgBleService')?.value,
    bleCharacteristicUuid: document.getElementById('cfgBleChar')?.value
  };

  const confirmed = window.confirm(
    `Terapkan perubahan parameter konfigurasi?\nRentang Rancangan Baru: ${candidate.tempMinDesign} \u2013 ${candidate.tempMaxDesign} \u00B0C\nInterval: ${candidate.uiUpdateIntervalMs} ms`
  );
  if (!confirmed) return;

  const res = dataStore.updateConfig(candidate);
  const feedbackEl = document.getElementById('configFeedbackMsg');
  if (!res.isValid) {
    if (feedbackEl) {
      feedbackEl.className = 'alert-box alert-danger';
      feedbackEl.textContent = `Validasi Gagal: ${res.errors.join(' ')}`;
    }
  } else if (feedbackEl) {
    feedbackEl.className = 'alert-box alert-info';
    feedbackEl.textContent = 'Konfigurasi berhasil divalidasi dan disinkronkan ke seluruh antarmuka.';
    window.setTimeout(() => {
      feedbackEl.className = 'alert-box hidden';
    }, 4000);
  }
}

function renderAdminDashboard(snapshot) {
  const { config, state, isStale, history, logs, stats } = snapshot;
  const sample = state.lastSample;

  // 1. Banner Mode DEMO
  const demoBanner = document.getElementById('adminDemoBanner');
  if (demoBanner) {
    if (state.sourceMode === 'DEMO' && state.sessionActive) {
      demoBanner.classList.remove('hidden');
    } else {
      demoBanner.classList.add('hidden');
    }
  }

  // 2. Status Tombol Toolbar
  const btnStartDemo = document.getElementById('btnStartDemo');
  const btnStopSession = document.getElementById('btnStopSession');
  const btnDisconnectBle = document.getElementById('btnDisconnectBle');
  if (btnStartDemo) btnStartDemo.disabled = state.sessionActive && state.sourceMode === 'DEMO';
  if (btnStopSession) btnStopSession.disabled = !state.sessionActive;
  if (btnDisconnectBle) btnDisconnectBle.disabled = !bleClient.isConnected;

  const modeBadge = document.getElementById('adminModeBadge');
  if (modeBadge) {
    if (state.sourceMode === 'HARDWARE') {
      modeBadge.className = 'badge badge-normal';
      modeBadge.textContent = 'MODE: HARDWARE (ESP32 BLE)';
    } else if (state.sourceMode === 'DEMO') {
      modeBadge.className = 'badge badge-warn';
      modeBadge.textContent = 'MODE: SIMULASI DEMO';
    } else {
      modeBadge.className = 'badge badge-neutral';
      modeBadge.textContent = 'MODE: IDLE (MENUNGGU)';
    }
  }

  // 3. Sembilan Kartu Ringkasan Telemetri
  const setText = (id, text) => {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  };

  const hasValidCurrent = sample && sample.isValid && !isStale;

  setText('valTempMaterial', hasValidCurrent && sample.tempMaterial !== null ? sample.tempMaterial.toFixed(2) : 'N/A');
  setText('valTempSkin', hasValidCurrent && sample.tempSkin !== null ? sample.tempSkin.toFixed(2) : 'N/A');
  setText('valDeltaTemp', hasValidCurrent && sample.deltaTemp !== null ? sample.deltaTemp.toFixed(2) : 'N/A');
  setText(
    'valHeatingRate',
    hasValidCurrent && sample.skinRatePerMin !== null ? sample.skinRatePerMin.toFixed(2) : 'N/A'
  );
  setText(
    'subHeatingRateSec',
    hasValidCurrent && sample.skinRatePerSec !== null
      ? `${sample.skinRatePerSec.toFixed(4)} \u00B0C/s (\u0394t = ${sample.dtSeconds} s)`
      : 'Menunggu >= 2 sampel berurutan'
  );
  setText('valIlluminance', hasValidCurrent && sample.illuminance !== null ? sample.illuminance.toFixed(1) : 'N/A');

  const thermalEval = evaluateSkinThermalStatus(sample, config, isStale);
  setText('subSkinStatus', thermalEval.label);

  setText('valBleStatus', state.connectionStatus);
  setText('subDeviceName', state.deviceName || 'Belum ada perangkat aktif');

  if (sample && sample.timestamp) {
    const timeStr = new Date(sample.timestamp).toLocaleTimeString('id-ID', { hour12: false });
    const ageSec = ((Date.now() - sample.timestamp) / 1000).toFixed(1);
    setText('valLastUpdate', timeStr);
    setText('subLastUpdateAge', isStale ? `Kedaluwarsa (${ageSec}s lalu)` : `Aktif (${ageSec}s lalu)`);
  } else {
    setText('valLastUpdate', '--:--:--');
    setText('subLastUpdateAge', 'Belum ada sampel');
  }

  setText('valSampleCount', `${stats.totalSamples}`);
  setText('subSampleCapacity', `Maks memori: ${config.maxHistorySamples} sampel`);

  if (!sample) {
    setText('valDataValidity', 'MENUNGGU');
    setText('subDataValidity', 'Belum ada paket diterima');
  } else if (isStale) {
    setText('valDataValidity', 'KEDALUWARSA');
    setText('subDataValidity', `Melebihi batas ${(config.staleDataThresholdMs / 1000).toFixed(1)}s`);
  } else if (sample.isValid) {
    setText('valDataValidity', 'VALID');
    setText('subDataValidity', `Kelengkapan sesi: ${stats.validityPercentage ?? 100}%`);
  } else {
    setText('valDataValidity', 'TIDAK VALID');
    setText('subDataValidity', sample.validationErrors[0] || 'Di luar rentang sensor');
  }

  // 4. Panel Statistik Sesi & Evaluasi Termal
  setText('statMaxSkin', stats.maxSkinTemp !== null ? `${stats.maxSkinTemp.toFixed(2)} \u00B0C` : 'N/A');
  setText('statMinSkin', stats.minSkinTemp !== null ? `${stats.minSkinTemp.toFixed(2)} \u00B0C` : 'N/A');
  setText('statMaxMat', stats.maxMaterialTemp !== null ? `${stats.maxMaterialTemp.toFixed(2)} \u00B0C` : 'N/A');
  setText('statMinMat', stats.minMaterialTemp !== null ? `${stats.minMaterialTemp.toFixed(2)} \u00B0C` : 'N/A');
  setText(
    'statTimeToReach',
    stats.timeToReachDesignSec !== null ? `${stats.timeToReachDesignSec.toFixed(1)} detik` : 'Belum tercapai / N/A'
  );
  setText('statDurationInRange', `${stats.durationInDesignRangeSec.toFixed(1)} detik`);
  setText('statOverThreshold', `${stats.overThresholdEvents} kejadian`);
  setText(
    'statDataQuality',
    stats.validityPercentage !== null
      ? `${stats.validityPercentage}% (${stats.validSamples}/${stats.totalSamples} valid)`
      : 'N/A'
  );

  // 5. Tabel Data Mentah (Tampilkan 50 sampel terbaru dengan urutan terbaru di atas)
  const tbody = document.getElementById('rawTableBody');
  if (tbody) {
    if (history.length === 0) {
      tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;color:#64748b;padding:1.25rem;">Belum ada data telemetri yang tercatat pada sesi ini.</td></tr>';
    } else {
      const recentRows = history.slice(-50).reverse();
      tbody.innerHTML = recentRows
        .map((item) => {
          const tStr = new Date(item.timestamp).toLocaleTimeString('id-ID', { hour12: false });
          const modeLabel = item.isSimulated ? 'DEMO' : 'HW';
          const validBadge = item.isValid
            ? '<span class="badge badge-normal">VALID</span>'
            : '<span class="badge badge-danger">INVALID</span>';
          return `<tr>
            <td class="mono">#${item.sampleNumber}</td>
            <td class="mono">${tStr}</td>
            <td><span class="badge ${item.isSimulated ? 'badge-warn' : 'badge-below'}">${modeLabel}</span></td>
            <td class="mono">${item.tempMaterial !== null ? item.tempMaterial.toFixed(2) : 'N/A'}</td>
            <td class="mono">${item.tempSkin !== null ? item.tempSkin.toFixed(2) : 'N/A'}</td>
            <td class="mono">${item.illuminance !== null ? item.illuminance.toFixed(1) : 'N/A'}</td>
            <td class="mono">${item.deltaTemp !== null ? item.deltaTemp.toFixed(2) : 'N/A'}</td>
            <td class="mono">${item.skinRatePerMin !== null ? item.skinRatePerMin.toFixed(2) : 'N/A'}</td>
            <td>${validBadge}</td>
          </tr>`;
        })
        .join('');
    }
  }

  // 6. Konsol Log Teknis
  const logConsole = document.getElementById('adminLogConsole');
  if (logConsole) {
    if (logs.length === 0) {
      logConsole.innerHTML = '<div class="log-entry">Sistem siap. Menunggu aktivitas koneksi atau simulasi...</div>';
    } else {
      const recentLogs = logs.slice(-80).reverse();
      logConsole.innerHTML = recentLogs
        .map((l) => {
          const tStr = new Date(l.timestamp).toLocaleTimeString('id-ID', { hour12: false });
          return `<div class="log-entry">
            <span class="log-time">[${tStr}]</span>
            <span class="log-level-${l.level}">[${l.level}]</span>
            <span>[${l.category}]</span>
            <span>${escapeHtml(l.message)}</span>
          </div>`;
        })
        .join('');
    }
  }
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

document.addEventListener('DOMContentLoaded', initAdminDashboard);