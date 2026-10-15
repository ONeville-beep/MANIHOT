/**
 * MANIHOT — Physics & Scientific Calculations Module
 */
window.Manihot = window.Manihot || {};

window.Manihot.Physics = (() => {
  const { Config, State } = window.Manihot;

  function calculateDeltaT(tMaterial, tSkin) {
    if (!Number.isFinite(tMaterial) || !Number.isFinite(tSkin)) return null;
    return tMaterial - tSkin;
  }

  function calculateTempRate(currentTemp, prevTemp, currentTimeMs, prevTimeMs) {
    if (!Number.isFinite(currentTemp) || !Number.isFinite(prevTemp)) return null;
    const dtSeconds = (currentTimeMs - prevTimeMs) / 1000;
    if (dtSeconds <= 0.05) return null;
    return (currentTemp - prevTemp) / dtSeconds;
  }

  function classifyThermalZone(tSkin) {
    const { targetMin, targetMax, criticalMin } = Config.thresholds;
    if (tSkin >= criticalMin) {
      return {
        code: 'CRITICAL',
        shortBadge: 'TERLALU PANAS!',
        badgeClass: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200',
        ringColor: '#ef4444',
        title: `Suhu Kritis (≥ ${criticalMin.toFixed(1)}°C)`,
        desc: 'Segera hentikan pemakaian dan lepaskan manset dengan hati-hati.',
        boxClass: 'bg-red-50 border-red-300 text-red-950 dark:bg-red-950/60 dark:border-red-700 dark:text-red-100'
      };
    }
    if (tSkin > targetMax) {
      return {
        code: 'ELEVATED',
        shortBadge: 'Mulai Panas',
        badgeClass: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200',
        ringColor: '#f59e0b',
        title: `Suhu Meningkat (${targetMax.toFixed(1)}–${criticalMin.toFixed(1)}°C)`,
        desc: 'Suhu melebihi target hangat. Pantau kenyamanan kulit Anda.',
        boxClass: 'bg-amber-50 border-amber-300 text-amber-950 dark:bg-amber-950/50 dark:border-amber-700 dark:text-amber-100'
      };
    }
    if (tSkin >= targetMin) {
      return {
        code: 'TARGET',
        shortBadge: 'Hangat Nyaman',
        badgeClass: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300',
        ringColor: '#10b981',
        title: `Rentang Ideal (${targetMin.toFixed(1)}–${targetMax.toFixed(1)}°C)`,
        desc: 'Suhu berada pada zona hangat operasional prototipe.',
        boxClass: 'bg-emerald-50/70 border-emerald-200 text-emerald-950 dark:bg-emerald-950/40 dark:border-emerald-800/70 dark:text-emerald-100'
      };
    }
    return {
      code: 'WARMING',
      shortBadge: 'Pemanasan Awal',
      badgeClass: 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300',
      ringColor: '#38bdf8',
      title: `Pemanasan Awal (< ${targetMin.toFixed(1)}°C)`,
      desc: 'Perban sedang menyerap cahaya menuju suhu hangat.',
      boxClass: 'bg-sky-50/70 border-sky-200 text-sky-950 dark:bg-sky-950/40 dark:border-sky-800/70 dark:text-sky-100'
    };
  }

  function estimatePCMPhase(tMaterial) {
    const { pcmMeltMin, pcmMeltMax } = Config.thresholds;
    if (!Number.isFinite(tMaterial)) return { label: 'Tidak diketahui', colorClass: 'text-slate-400' };
    if (tMaterial < pcmMeltMin) return { label: 'Fase Padat (Siap Serap)', colorClass: 'text-teal-600 dark:text-teal-400' };
    if (tMaterial <= pcmMeltMax) return { label: 'Menyerap Kalor Laten (Aktif)', colorClass: 'text-emerald-600 dark:text-emerald-400' };
    return { label: 'Telah Melebur / Jenuh Panas', colorClass: 'text-amber-600 dark:text-amber-400' };
  }

  function classifyIlluminance(lux) {
    if (!Number.isFinite(lux) || lux < 0) return 'Tidak valid';
    if (lux < Config.lightCategories.dimMax) return 'Cahaya Redup';
    if (lux <= Config.lightCategories.moderateMax) return 'Cahaya Sedang';
    return 'Cahaya Terang';
  }

  function runPCMCalculator() {
    const m = parseFloat(document.getElementById('calc-pcm-mass')?.value);
    const lf = parseFloat(document.getElementById('calc-pcm-latent')?.value);
    const pnet = parseFloat(document.getElementById('calc-pcm-power')?.value);
    const mainOut = document.getElementById('calc-pcm-output-main');
    const subOut = document.getElementById('calc-pcm-output-sub');
    if (!mainOut || !subOut) return;

    if (!Number.isFinite(m) || m <= 0 || !Number.isFinite(lf) || lf <= 0 || !Number.isFinite(pnet) || pnet <= 0) {
      mainOut.textContent = 'Pastikan m > 0, L_f > 0, P_net > 0';
      subOut.textContent = 'Daya bersih P_net harus bernilai positif.';
      return;
    }
    const totalJoules = m * lf;
    const tmSec = totalJoules / pnet;
    mainOut.textContent = `${Math.round(tmSec).toLocaleString('id-ID')} dtk (~${Math.floor(tmSec / 60)} mnt)`;
    subOut.textContent = `Kapasitas kalor laten Q = ${totalJoules.toLocaleString('id-ID')} J.`;
  }

  function runEnergyBalanceCalculator() {
    const alpha = parseFloat(document.getElementById('calc-eb-alpha')?.value);
    const G = parseFloat(document.getElementById('calc-eb-g')?.value);
    const h = parseFloat(document.getElementById('calc-eb-h')?.value);
    const tInf = parseFloat(document.getElementById('calc-eb-tinf')?.value);
    const mainOut = document.getElementById('calc-eb-output-main');
    const compOut = document.getElementById('calc-eb-output-comparison');
    if (!mainOut || !compOut) return;

    if (!Number.isFinite(alpha) || alpha <= 0 || alpha > 1 || !Number.isFinite(G) || G < 0 || !Number.isFinite(h) || h <= 0 || !Number.isFinite(tInf)) {
      mainOut.textContent = 'Input tidak valid';
      return;
    }
    const flux = alpha * G;
    const tS = tInf + flux / h;
    mainOut.textContent = `T_s = ${tS.toFixed(2)} °C (Fluks: ${flux.toFixed(1)} W/m²)`;
    compOut.textContent = `Sensor T_material saat ini: ${State.latestMetrics.t_material.toFixed(1)}°C.`;
  }

  return {
    calculateDeltaT,
    calculateTempRate,
    classifyThermalZone,
    estimatePCMPhase,
    classifyIlluminance,
    runPCMCalculator,
    runEnergyBalanceCalculator
  };
})();