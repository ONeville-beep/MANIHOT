/**
 * @file calculations.js
 * @description Modul perhitungan matematis, validasi pembacaan sensor,
 * evaluasi status rentang termal, dan agregasi statistik sesi penelitian MANIHOT.
 */

/**
 * Memvalidasi satu sampel pembacaan sensor mentah terhadap rentang fisik yang masuk akal.
 * @param {Object} rawData Data mentah { timestamp, tempMaterial, tempSkin, illuminance }
 * @param {Object} config Konfigurasi sistem aktif
 * @returns {{isValid: boolean, errors: string[]}}
 */
export function validateSensorSample(rawData, config) {
  const errors = [];

  if (!rawData || typeof rawData !== 'object') {
    return { isValid: false, errors: ['Objek sampel telemetri kosong atau rusak.'] };
  }

  const ts = Number(rawData.timestamp);
  const tMat = Number(rawData.tempMaterial);
  const tSkin = Number(rawData.tempSkin);
  const lux = Number(rawData.illuminance);

  if (!Number.isFinite(ts) || ts <= 0) {
    errors.push('Timestamp tidak valid.');
  }
  if (!Number.isFinite(tMat) || tMat < config.sensorTempValidMin || tMat > config.sensorTempValidMax) {
    errors.push(`Suhu lapisan fototermal di luar rentang sensor TMP117 (${config.sensorTempValidMin}\u2013${config.sensorTempValidMax} \u00B0C).`);
  }
  if (!Number.isFinite(tSkin) || tSkin < config.sensorTempValidMin || tSkin > config.sensorTempValidMax) {
    errors.push(`Suhu antarmuka kulit di luar rentang sensor TMP117 (${config.sensorTempValidMin}\u2013${config.sensorTempValidMax} \u00B0C).`);
  }
  if (!Number.isFinite(lux) || lux < config.sensorLuxValidMin || lux > config.sensorLuxValidMax) {
    errors.push(`Iluminansi di luar rentang sensor BH1750 (${config.sensorLuxValidMin}\u2013${config.sensorLuxValidMax} lux).`);
  }

  return {
    isValid: errors.length === 0,
    errors
  };
}

/**
 * Menghitung selisih suhu antara lapisan komposit fototermal dan antarmuka kulit:
 * \Delta T = T_material - T_kulit
 * @param {number} tempMaterial Suhu lapisan fototermal (\u00B0C)
 * @param {number} tempSkin Suhu antarmuka kulit (\u00B0C)
 * @returns {number|null} Selisih suhu dalam \u00B0C atau null jika input tidak valid
 */
export function calculateDeltaTemp(tempMaterial, tempSkin) {
  const tMat = Number(tempMaterial);
  const tSkin = Number(tempSkin);
  if (!Number.isFinite(tMat) || !Number.isFinite(tSkin)) {
    return null;
  }
  return Number((tMat - tSkin).toFixed(3));
}

/**
 * Menghitung laju perubahan suhu (dT/dt) menggunakan selisih timestamp aktual:
 * dT/dt \approx (T(t) - T(t - \Delta t)) / \Delta t
 * @param {number} currentTemp Suhu saat ini (\u00B0C)
 * @param {number} previousTemp Suhu pada sampel sebelumnya (\u00B0C)
 * @param {number} currentTimestampMs Timestamp saat ini (ms)
 * @param {number} previousTimestampMs Timestamp sebelumnya (ms)
 * @returns {{perSecond: number|null, perMinute: number|null, dtSeconds: number|null}}
 */
export function calculateHeatingRate(currentTemp, previousTemp, currentTimestampMs, previousTimestampMs) {
  const tNow = Number(currentTemp);
  const tPrev = Number(previousTemp);
  const tsNow = Number(currentTimestampMs);
  const tsPrev = Number(previousTimestampMs);

  if (
    !Number.isFinite(tNow) ||
    !Number.isFinite(tPrev) ||
    !Number.isFinite(tsNow) ||
    !Number.isFinite(tsPrev)
  ) {
    return { perSecond: null, perMinute: null, dtSeconds: null };
  }

  const dtSeconds = (tsNow - tsPrev) / 1000;
  // Tolak perhitungan apabila interval waktu nol, negatif, atau terlalu jauh (>30 detik jeda)
  if (dtSeconds <= 0.05 || dtSeconds > 30) {
    return { perSecond: null, perMinute: null, dtSeconds: null };
  }

  const ratePerSec = (tNow - tPrev) / dtSeconds;
  const ratePerMin = ratePerSec * 60;

  return {
    perSecond: Number(ratePerSec.toFixed(4)),
    perMinute: Number(ratePerMin.toFixed(3)),
    dtSeconds: Number(dtSeconds.toFixed(3))
  };
}

/**
 * Mengevaluasi status suhu antarmuka kulit terhadap rentang rancangan PCM (38-41 \u00B0C).
 * @param {Object|null} sample Sampel telemetri terakhir
 * @param {Object} config Konfigurasi aktif
 * @param {boolean} isStale Apakah data sudah melewati batas waktu kedaluwarsa
 * @returns {{code: string, label: string, badgeClass: string, cardStateClass: string, guidance: string, isAlert: boolean}}
 */
export function evaluateSkinThermalStatus(sample, config, isStale) {
  if (!sample || !sample.isValid || isStale) {
    const reason = isStale
      ? 'Pembacaan terakhir sudah kedaluwarsa (melewati batas waktu pembaruan). Periksa koneksi perangkat atau mulai sesi baru.'
      : 'Data sensor belum tersedia atau pembacaan sensor tidak valid.';
    return {
      code: 'UNAVAILABLE',
      label: isStale ? 'Data sensor kedaluwarsa / tidak aktif' : 'Data sensor tidak tersedia',
      badgeClass: 'badge-neutral',
      cardStateClass: 'state-unavailable',
      guidance: reason,
      isAlert: isStale
    };
  }

  const tSkin = Number(sample.tempSkin);
  const minD = Number(config.tempMinDesign);
  const maxD = Number(config.tempMaxDesign);

  if (tSkin < minD) {
    return {
      code: 'BELOW_RANGE',
      label: 'Di bawah rentang rancangan',
      badgeClass: 'badge-below',
      cardStateClass: 'state-below',
      guidance: `Suhu antarmuka kulit berada di bawah rentang rancangan penelitian (${minD.toFixed(1)}\u2013${maxD.toFixed(1)} \u00B0C). Komposit dalam fase penyerapan kalor pasif.`,
      isAlert: false
    };
  }

  if (tSkin <= maxD) {
    return {
      code: 'IN_RANGE',
      label: 'Dalam rentang rancangan',
      badgeClass: 'badge-normal',
      cardStateClass: 'state-normal',
      guidance: `Suhu antarmuka kulit berada di dalam rentang rancangan PCM (${minD.toFixed(1)}\u2013${maxD.toFixed(1)} \u00B0C). Pantau kenyamanan pengguna secara berkala.`,
      isAlert: false
    };
  }

  return {
    code: 'ABOVE_RANGE',
    label: 'Melebihi batas atas rancangan',
    badgeClass: 'badge-danger',
    cardStateClass: 'state-above',
    guidance: `PERINGATAN: Suhu antarmuka kulit melebihi batas atas rancangan (${maxD.toFixed(1)} \u00B0C). Segera hentikan sesi pengujian, lepaskan perban prototipe dari permukaan uji/kulit, dan ikuti prosedur keselamatan tim peneliti.`,
    isAlert: true
  };
}

/**
 * Menghitung ringkasan statistik selama sesi pemantauan berlangsung.
 * @param {Array<Object>} history Daftar sampel telemetri selama sesi
 * @param {Object} config Konfigurasi aktif
 * @returns {Object} Ringkasan metrik sesi
 */
export function computeSessionStatistics(history, config) {
  if (!Array.isArray(history) || history.length === 0) {
    return {
      totalSamples: 0,
      validSamples: 0,
      validityPercentage: null,
      maxSkinTemp: null,
      minSkinTemp: null,
      maxMaterialTemp: null,
      minMaterialTemp: null,
      timeToReachDesignSec: null,
      durationInDesignRangeSec: 0,
      overThresholdEvents: 0
    };
  }

  const minD = Number(config.tempMinDesign);
  const maxD = Number(config.tempMaxDesign);

  let validCount = 0;
  let maxSkin = -Infinity;
  let minSkin = Infinity;
  let maxMat = -Infinity;
  let minMat = Infinity;
  let firstTimestamp = null;
  let firstReachedTimestamp = null;
  let durationInRangeSec = 0;
  let overThresholdCount = 0;

  for (let i = 0; i < history.length; i++) {
    const item = history[i];
    if (firstTimestamp === null && Number.isFinite(item.timestamp)) {
      firstTimestamp = item.timestamp;
    }

    if (!item.isValid) {
      continue;
    }

    validCount++;
    const tSkin = Number(item.tempSkin);
    const tMat = Number(item.tempMaterial);

    if (tSkin > maxSkin) maxSkin = tSkin;
    if (tSkin < minSkin) minSkin = tSkin;
    if (tMat > maxMat) maxMat = tMat;
    if (tMat < minMat) minMat = tMat;

    const isInRange = tSkin >= minD && tSkin <= maxD;
    if (isInRange && firstReachedTimestamp === null) {
      firstReachedTimestamp = item.timestamp;
    }

    if (tSkin > maxD) {
      overThresholdCount++;
    }

    if (i > 0) {
      const prev = history[i - 1];
      if (prev && prev.isValid) {
        const dtSec = (item.timestamp - prev.timestamp) / 1000;
        const prevInRange = prev.tempSkin >= minD && prev.tempSkin <= maxD;
        if (dtSec > 0 && dtSec <= 30 && isInRange && prevInRange) {
          durationInRangeSec += dtSec;
        }
      }
    }
  }

  const validityPct = history.length > 0 ? (validCount / history.length) * 100 : null;
  const timeToReachSec =
    firstTimestamp !== null && firstReachedTimestamp !== null
      ? Math.max(0, (firstReachedTimestamp - firstTimestamp) / 1000)
      : null;

  return {
    totalSamples: history.length,
    validSamples: validCount,
    validityPercentage: validityPct !== null ? Number(validityPct.toFixed(1)) : null,
    maxSkinTemp: validCount > 0 ? Number(maxSkin.toFixed(2)) : null,
    minSkinTemp: validCount > 0 ? Number(minSkin.toFixed(2)) : null,
    maxMaterialTemp: validCount > 0 ? Number(maxMat.toFixed(2)) : null,
    minMaterialTemp: validCount > 0 ? Number(minMat.toFixed(2)) : null,
    timeToReachDesignSec: timeToReachSec !== null ? Number(timeToReachSec.toFixed(1)) : null,
    durationInDesignRangeSec: Number(durationInRangeSec.toFixed(1)),
    overThresholdEvents: overThresholdCount
  };
}