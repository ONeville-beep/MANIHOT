/**
 * @file config.js
 * @description Konfigurasi terpusat untuk aplikasi pemantauan prototipe MANIHOT.
 * Seluruh ambang suhu rancangan, batas validitas sensor, parameter memori,
 * serta profil BLE GATT disimpan di modul ini agar konsisten di seluruh antarmuka.
 */

export const STORAGE_KEYS = Object.freeze({
  CONFIG: 'manihot_config_v1',
  STATE_SNAPSHOT: 'manihot_state_snapshot_v1',
  HISTORY: 'manihot_telemetry_history_v1',
  LOGS: 'manihot_system_logs_v1',
  CONTROLLER_LEASE: 'manihot_controller_lease_v1'
});

export const BROADCAST_CHANNEL_NAME = 'manihot_iot_sync_channel_v1';

export const DEFAULT_CONFIG = Object.freeze({
  projectName: 'MANIHOT',
  projectSubtitle: 'Komposit Fototermal Hydrochar Kulit Singkong & PCM Berbasis IoT',
  appVersion: '1.2.0-prototype',
  releaseNotes: 'Arsitektur ES Module terpisah, sinkronisasi BroadcastChannel, validasi dT/dt berbasis timestamp aktual, dan pemisahan tegas mode DEMO vs HARDWARE.',

  // Rentang suhu rancangan Phase Change Material (PCM) asam lemak nabati (degC)
  tempMinDesign: 38.0,
  tempMaxDesign: 41.0,

  // Rentang validitas pembacaan fisik sensor suhu TMP117 (degC)
  sensorTempValidMin: 15.0,
  sensorTempValidMax: 75.0,

  // Rentang validitas pembacaan sensor iluminansi BH1750 (lux)
  sensorLuxValidMin: 0.0,
  sensorLuxValidMax: 100000.0,

  // Interval pembaruan & batas kedaluwarsa data (ms)
  uiUpdateIntervalMs: 1000,
  staleDataThresholdMs: 5000,

  // Pembatasan kapasitas memori pada browser
  maxChartPoints: 60,
  maxHistorySamples: 300,
  maxLogEntries: 150,

  // Konfigurasi BLE GATT ESP32 (Disesuaikan dengan protokol firmware aktual)
  bleDeviceNamePrefix: 'MANIHOT',
  bleServiceUuid: '0000ffe0-0000-1000-8000-00805f9b34fb',
  bleCharacteristicUuid: '0000ffe1-0000-1000-8000-00805f9b34fb'
});

/**
 * Memuat konfigurasi aktif dari localStorage yang digabungkan dengan DEFAULT_CONFIG.
 * @returns {Object} Konfigurasi aktif yang telah divalidasi
 */
export function loadActiveConfig() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.CONFIG);
    if (!raw) {
      return { ...DEFAULT_CONFIG };
    }
    const parsed = JSON.parse(raw);
    const merged = { ...DEFAULT_CONFIG, ...parsed };
    const validation = validateConfig(merged);
    return validation.isValid ? merged : { ...DEFAULT_CONFIG };
  } catch (err) {
    return { ...DEFAULT_CONFIG };
  }
}

/**
 * Memvalidasi parameter konfigurasi yang diubah oleh administrator.
 * @param {Object} candidate Objek konfigurasi baru
 * @returns {{isValid: boolean, errors: string[], sanitized: Object}}
 */
export function validateConfig(candidate) {
  const errors = [];
  const sanitized = { ...DEFAULT_CONFIG, ...candidate };

  const tMin = Number(sanitized.tempMinDesign);
  const tMax = Number(sanitized.tempMaxDesign);
  const interval = Number(sanitized.uiUpdateIntervalMs);
  const stale = Number(sanitized.staleDataThresholdMs);
  const maxPts = Number(sanitized.maxChartPoints);
  const maxHist = Number(sanitized.maxHistorySamples);

  if (!Number.isFinite(tMin) || tMin < 25 || tMin > 45) {
    errors.push('Batas bawah suhu rancangan harus berupa angka antara 25.0 hingga 45.0 \u00B0C.');
  }
  if (!Number.isFinite(tMax) || tMax < 30 || tMax > 50) {
    errors.push('Batas atas suhu rancangan harus berupa angka antara 30.0 hingga 50.0 \u00B0C.');
  }
  if (Number.isFinite(tMin) && Number.isFinite(tMax) && tMin >= tMax) {
    errors.push('Batas bawah suhu rancangan harus lebih kecil daripada batas atas suhu rancangan.');
  }
  if (!Number.isFinite(interval) || interval < 250 || interval > 10000) {
    errors.push('Interval pembaruan harus berada di antara 250 ms hingga 10000 ms.');
  }
  if (!Number.isFinite(stale) || stale < interval * 1.5 || stale > 60000) {
    errors.push('Batas waktu data kedaluwarsa harus minimal 1.5x interval pembaruan dan maksimal 60000 ms.');
  }
  if (!Number.isInteger(maxPts) || maxPts < 10 || maxPts > 300) {
    errors.push('Jumlah titik maksimum grafik harus bilangan bulat antara 10 hingga 300.');
  }
  if (!Number.isInteger(maxHist) || maxHist < 20 || maxHist > 2000) {
    errors.push('Kapasitas maksimum riwayat sampel harus bilangan bulat antara 20 hingga 2000.');
  }

  sanitized.tempMinDesign = Number(tMin.toFixed(2));
  sanitized.tempMaxDesign = Number(tMax.toFixed(2));
  sanitized.uiUpdateIntervalMs = Math.round(interval);
  sanitized.staleDataThresholdMs = Math.round(stale);
  sanitized.maxChartPoints = Math.round(maxPts);
  sanitized.maxHistorySamples = Math.round(maxHist);
  sanitized.bleServiceUuid = String(sanitized.bleServiceUuid || DEFAULT_CONFIG.bleServiceUuid).trim();
  sanitized.bleCharacteristicUuid = String(sanitized.bleCharacteristicUuid || DEFAULT_CONFIG.bleCharacteristicUuid).trim();

  return {
    isValid: errors.length === 0,
    errors,
    sanitized
  };
}