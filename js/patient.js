/**
 * @file patient.js
 * @description Pengendali logika untuk Patient Interface (patient.html).
 * Menyajikan suhu antarmuka kulit secara jelas, status terhadap rentang rancangan,
 * peringatan keselamatan, serta mendeteksi kedaluwarsa data secara otomatis.
 */

import { dataStore } from './data-store.js';
import { evaluateSkinThermalStatus } from './calculations.js';
import { MockTelemetryGenerator } from './mock-data.js';

// Generator simulasi lokal cadangan apabila halaman pasien dijalankan mandiri tanpa tab Admin terbuka
const fallbackGenerator = new MockTelemetryGenerator({
  onSampleGenerated: (sample) => dataStore.ingestTelemetrySample(sample),
  onLog: (level, cat, msg) => dataStore.addLog(level, cat, msg)
});

let localGeneratorRunning = false;
let staleCheckIntervalId = null;

function initPatientInterface() {
  const elements = {
    demoBanner: document.getElementById('patientDemoBanner'),
    safetyAlertBox: document.getElementById('patientSafetyAlert'),
    safetyAlertTitle: document.getElementById('patientSafetyAlertTitle'),
    safetyAlertDesc: document.getElementById('patientSafetyAlertDesc'),
    tempCard: document.getElementById('patientTempCard'),
    skinTempValue: document.getElementById('patientSkinTempValue'),
    skinStatusBadge: document.getElementById('patientSkinStatusBadge'),
    skinGuidanceText: document.getElementById('patientSkinGuidanceText'),
    designRangeLabel: document.getElementById('patientDesignRangeLabel'),
    connectionStatusText: document.getElementById('patientConnectionStatus'),
    lastUpdateText: document.getElementById('patientLastUpdate'),
    sessionStatusText: document.getElementById('patientSessionStatus'),
    btnStartSession: document.getElementById('btnPatientStartSession'),
    btnStopSession: document.getElementById('btnPatientStopSession'),
    btnToggleDeviceInfo: document.getElementById('btnPatientToggleDevice'),
    deviceModalPanel: document.getElementById('patientDevicePanel'),
    devSourceMode: document.getElementById('patientDevSourceMode'),
    devName: document.getElementById('patientDevName'),
    devSampleAge: document.getElementById('patientDevSampleAge')
  };

  // Render awal
  renderPatientView(dataStore.getSnapshot(), elements);

  // Berlangganan pembaruan dari dataStore (termasuk dari BroadcastChannel tab Admin)
  dataStore.subscribe((snapshot, eventType, payload) => {
    if (eventType === 'REMOTE_COMMAND' && payload && payload.requestedBy !== snapshot.tabId) {
      if (payload.commandName === 'STOP_SESSION' && localGeneratorRunning) {
        fallbackGenerator.stop();
        localGeneratorRunning = false;
      }
    }
    renderPatientView(snapshot, elements);
  });

  // Tombol Mulai Sesi Pemantauan
  if (elements.btnStartSession) {
    elements.btnStartSession.addEventListener('click', () => {
      const snap = dataStore.getSnapshot();
      // Kirim sinyal ke Admin Dashboard jika terbuka
      dataStore.sendCommand('START_SESSION', { preferredMode: 'DEMO' });

      // Jika dalam 300ms belum ada tab Admin yang mengambil alih sesi, jalankan DEMO lokal
      window.setTimeout(() => {
        const latest = dataStore.getSnapshot();
        if (!latest.state.sessionActive) {
          localGeneratorRunning = true;
          dataStore.updateSystemState({
            sessionActive: true,
            sessionStartTime: Date.now(),
            sourceMode: 'DEMO',
            connectionStatus: 'CONNECTED',
            deviceName: 'Simulator Prototipe (DEMO Pasien)',
            controllerTabId: latest.tabId
          });
          fallbackGenerator.start(latest.config.uiUpdateIntervalMs, 'NORMAL');
        }
      }, 250);
    });
  }

  // Tombol Hentikan Sesi Pemantauan
  if (elements.btnStopSession) {
    elements.btnStopSession.addEventListener('click', () => {
      if (localGeneratorRunning) {
        fallbackGenerator.stop();
        localGeneratorRunning = false;
      }
      dataStore.sendCommand('STOP_SESSION', {});
      dataStore.updateSystemState({
        sessionActive: false,
        connectionStatus: dataStore.getSnapshot().state.sourceMode === 'HARDWARE' ? 'CONNECTED' : 'DISCONNECTED'
      });
      dataStore.addLog('INFO', 'SESI_PASIEN', 'Sesi pemantauan dihentikan melalui Patient Interface.');
    });
  }

  // Tombol Lihat Status Perangkat
  if (elements.btnToggleDeviceInfo && elements.deviceModalPanel) {
    elements.btnToggleDeviceInfo.addEventListener('click', () => {
      elements.deviceModalPanel.classList.toggle('hidden');
    });
  }

  // Timer pemeriksa kedaluwarsa data setiap 1 detik agar tampilan tidak membeku di status normal
  staleCheckIntervalId = window.setInterval(() => {
    renderPatientView(dataStore.getSnapshot(), elements);
  }, 1000);

  window.addEventListener('beforeunload', () => {
    if (localGeneratorRunning) {
      fallbackGenerator.stop();
    }
    if (staleCheckIntervalId) {
      window.clearInterval(staleCheckIntervalId);
    }
  });
}

function renderPatientView(snapshot, el) {
  const { config, state, isStale } = snapshot;
  const sample = state.lastSample;

  // 1. Banner Mode DEMO
  if (el.demoBanner) {
    if (state.sourceMode === 'DEMO' && state.sessionActive) {
      el.demoBanner.classList.remove('hidden');
    } else {
      el.demoBanner.classList.add('hidden');
    }
  }

  // 2. Evaluasi Status Suhu Antarmuka Kulit
  const thermalEval = evaluateSkinThermalStatus(sample, config, isStale);

  if (el.skinTempValue) {
    if (sample && sample.isValid && !isStale && sample.tempSkin !== null) {
      el.skinTempValue.textContent = sample.tempSkin.toFixed(1);
    } else {
      el.skinTempValue.textContent = '--.-';
    }
  }

  if (el.tempCard) {
    el.tempCard.className = `patient-temp-card ${thermalEval.cardStateClass}`;
  }

  if (el.skinStatusBadge) {
    el.skinStatusBadge.className = `temp-status-pill ${thermalEval.badgeClass}`;
    el.skinStatusBadge.textContent = thermalEval.label;
  }

  if (el.skinGuidanceText) {
    el.skinGuidanceText.textContent = thermalEval.guidance;
  }

  if (el.designRangeLabel) {
    el.designRangeLabel.textContent = `${config.tempMinDesign.toFixed(1)} \u2013 ${config.tempMaxDesign.toFixed(1)} \u00B0C`;
  }

  // 3. Kotak Peringatan Keselamatan atau Sensor Tidak Tersedia
  if (el.safetyAlertBox) {
    if (thermalEval.code === 'ABOVE_RANGE') {
      el.safetyAlertBox.className = 'alert-box alert-danger';
      el.safetyAlertTitle.textContent = `Peringatan Suhu Melebihi Batas Atas Rancangan (> ${config.tempMaxDesign.toFixed(1)} \u00B0C)`;
      el.safetyAlertDesc.textContent =
        'Harap segera menghentikan sesi pengujian, lepaskan perban prototipe, dan ikuti prosedur keselamatan yang ditetapkan tim peneliti. Ambang ini merupakan batas rancangan penelitian, bukan jaminan batas medis universal.';
    } else if (state.sessionActive && (isStale || (sample && !sample.isValid))) {
      el.safetyAlertBox.className = 'alert-box alert-warn';
      el.safetyAlertTitle.textContent = 'Peringatan Pembacaan Sensor Tidak Tersedia / Kedaluwarsa';
      el.safetyAlertDesc.textContent =
        'Aplikasi tidak menerima pembaruan data sensor yang valid dalam batas waktu yang ditentukan. Periksa apakah perangkat masih menyala dan berada dalam jangkauan Bluetooth.';
    } else {
      el.safetyAlertBox.className = 'alert-box hidden';
    }
  }

  // 4. Status Koneksi, Waktu Pembaruan Terakhir, dan Status Sesi
  if (el.connectionStatusText) {
    const connMap = {
      CONNECTED: state.sourceMode === 'DEMO' ? 'Terhubung (Simulasi DEMO)' : 'Terhubung (Perangkat BLE)',
      CONNECTING: 'Menghubungkan perangkat...',
      DISCONNECTED: 'Terputus / Menunggu Koneksi',
      ERROR: 'Gangguan Koneksi Perangkat'
    };
    el.connectionStatusText.textContent = connMap[state.connectionStatus] || 'Menunggu Data';
  }

  if (el.lastUpdateText) {
    if (sample && sample.timestamp) {
      const timeStr = new Date(sample.timestamp).toLocaleTimeString('id-ID', { hour12: false });
      const ageSec = Math.max(0, Math.round((Date.now() - sample.timestamp) / 1000));
      el.lastUpdateText.textContent = isStale
        ? `${timeStr} (${ageSec} dtk lalu - Data Lama)`
        : `${timeStr} (${ageSec} dtk lalu)`;
    } else {
      el.lastUpdateText.textContent = 'Belum ada data';
    }
  }

  if (el.sessionStatusText) {
    el.sessionStatusText.textContent = state.sessionActive ? 'Sesi Aktif' : 'Sesi Berhenti';
  }

  // 5. Status Tombol Kontrol
  if (el.btnStartSession && el.btnStopSession) {
    el.btnStartSession.disabled = Boolean(state.sessionActive);
    el.btnStopSession.disabled = !state.sessionActive;
  }

  // 6. Panel Detail Status Perangkat
  if (el.devSourceMode) {
    el.devSourceMode.textContent = state.sourceMode === 'HARDWARE'
      ? 'Perangkat Keras Fisik (ESP32 BLE)'
      : state.sourceMode === 'DEMO'
      ? 'Simulasi Demonstrasi (DEMO)'
      : 'Belum Aktif';
  }
  if (el.devName) {
    el.devName.textContent = state.deviceName || 'Tidak ada perangkat terhubung';
  }
  if (el.devSampleAge) {
    if (sample && sample.timestamp) {
      const ageMs = Date.now() - sample.timestamp;
      el.devSampleAge.textContent = `${(ageMs / 1000).toFixed(1)} detik (Batas: ${(config.staleDataThresholdMs / 1000).toFixed(1)} detik)`;
    } else {
      el.devSampleAge.textContent = 'N/A';
    }
  }
}

document.addEventListener('DOMContentLoaded', initPatientInterface);