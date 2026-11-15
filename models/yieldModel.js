/**
 * @file models/yieldModel.js
 * @description Etapas 1 y 3 del motor científico Field Shift v4.0:
 *  - Etapa 1: Filtro de Aptitud No Compensatorio usando cuantiles Q0.05–Q0.95 (SoilGrids), tosca y estrés térmico.
 *  - Etapa 3: ET0 Penman-Monteith FAO-56, estrés hídrico FAO-33 (Ky), pérdida térmica por calor/helada,
 *    calibración departamental Ypot contra MAGyP y cálculo físico de criterios C1, C7 y C9.
 */
'use strict';

const extremes = require('./extremesModel');

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const normUp = (x, xmin, xopt) => 100 * clamp((x - xmin) / (xopt - xmin), 0, 1);
const normDown = (x, xopt, xmax) => 100 * clamp((xmax - x) / (xmax - xopt), 0, 1);

/* ------------------------------------------------------------------ */
/* 1. Evapotranspiración de referencia: Penman-Monteith FAO-56         */
/* ------------------------------------------------------------------ */

const e0 = (T) => 0.6108 * Math.exp((17.27 * T) / (T + 237.3));

/** Radiación extraterrestre Ra [MJ m-2 día-1] (FAO-56, ec. 21). */
function extraterrestrialRadiation(latDeg, doy) {
  const phi = (latDeg * Math.PI) / 180;
  const dr = 1 + 0.033 * Math.cos((2 * Math.PI * doy) / 365);
  const delta = 0.409 * Math.sin((2 * Math.PI * doy) / 365 - 1.39);
  const ws = Math.acos(clamp(-Math.tan(phi) * Math.tan(delta), -1, 1));
  return (
    ((24 * 60) / Math.PI) * 0.082 * dr *
    (ws * Math.sin(phi) * Math.sin(delta) + Math.cos(phi) * Math.cos(delta) * Math.sin(ws))
  );
}

/** ET0 diaria [mm/día] Penman-Monteith FAO-56. rs en MJ m-2 día-1, u2 en m/s, rh en %, z en m. */
function et0PenmanMonteith({ tMean, tMax, tMin, rh, u2, rs, latDeg, doy, z = 100 }) {
  const P = 101.3 * Math.pow((293 - 0.0065 * z) / 293, 5.26);
  const gamma = 0.000665 * P;
  const es = (e0(tMax) + e0(tMin)) / 2;
  const ea = (es * rh) / 100;
  const delta = (4098 * e0(tMean)) / Math.pow(tMean + 237.3, 2);
  const ra = extraterrestrialRadiation(latDeg, doy);
  const rso = (0.75 + 2e-5 * z) * ra;
  const rns = 0.77 * rs;
  const sigma = 4.903e-9;
  const rnl =
    sigma * ((Math.pow(tMax + 273.16, 4) + Math.pow(tMin + 273.16, 4)) / 2) *
    (0.34 - 0.14 * Math.sqrt(Math.max(0.01, ea))) * (1.35 * Math.min(rs / Math.max(0.1, rso), 1) - 0.35);
  const rn = rns - rnl;
  const num = 0.408 * delta * rn + ((gamma * 900) / (tMean + 273)) * u2 * (es - ea);
  return Math.max(0, num / (delta + gamma * (1 + 0.34 * u2)));
}

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/** ET0 mensual [mm/mes] a partir de climatología mensual (arreglos de 12 valores). */
function monthlyEt0Fao56({ tMean, tMax, tMin, rh, u2, rs }, latDeg, z = 100) {
  return tMean.map((_, m) => {
    const doy = Math.round(15.2 + 30.4 * m);
    const daily = et0PenmanMonteith({
      tMean: tMean[m], tMax: tMax[m], tMin: tMin[m], rh: rh[m], u2: u2[m], rs: rs[m], latDeg, doy, z
    });
    return Math.round(daily * DAYS_IN_MONTH[m]);
  });
}

/* ------------------------------------------------------------------ */
/* 2. Días de calor (Tmax > 35 °C) y de helada (Tmin < 0 °C)           */
/* ------------------------------------------------------------------ */

function normalCdf(z) {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp((-z * z) / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return z > 0 ? 1 - p : p;
}

const HOT_THRESHOLD_C = 35;
const FROST_THRESHOLD_C = 0;
const FALLBACK_DTR_C = 13;

/** Calibra sigma de una Normal para que el total anual de días extremos coincida con el dato objetivo. */
function calibrateSigma(daysFn, target) {
  let lo = 0.5;
  let hi = 15;
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2;
    const total = Array.from({ length: 12 }, (_, m) => daysFn(m, mid)).reduce((a, b) => a + b, 0);
    if (total < target) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

/**
 * Modelo de días extremos por mes (serie diaria NASA POWER o respaldo normal calibrado).
 */
function makeExtremesModel(clima) {
  const tBase = clima.temp_media_c;

  if (clima.extremos && clima.extremos.calor && clima.extremos.helada) {
    const ext = clima.extremos;
    return {
      source: 'serie diaria POWER',
      hotDays: (m, t) => extremes.hotDaysMonth(ext, m, t - tBase[m], HOT_THRESHOLD_C),
      frostDays: (m, t) => extremes.frostDaysMonth(ext, m, t - tBase[m], FROST_THRESHOLD_C)
    };
  }

  const dtr =
    clima.tmax_media_c && clima.tmin_media_c
      ? clima.tmax_media_c.map((v, i) => v - clima.tmin_media_c[i])
      : Array(12).fill(FALLBACK_DTR_C);
  const hotFn = (m, t, sg) => 30.4 * (1 - normalCdf((HOT_THRESHOLD_C - (t + dtr[m] / 2)) / sg));
  const frostFn = (m, t, sg) => 30.4 * normalCdf((FROST_THRESHOLD_C - (t - dtr[m] / 2)) / sg);
  const hotTarget = Number.isFinite(clima.dias_calor_35c) ? clima.dias_calor_35c : 14;
  const frostTarget = Number.isFinite(clima.dias_helada_0c) ? clima.dias_helada_0c : 26;
  const sigmaHot = calibrateSigma((m, sg) => hotFn(m, tBase[m], sg), hotTarget);
  const sigmaFrost = calibrateSigma((m, sg) => frostFn(m, tBase[m], sg), frostTarget);
  return {
    source: 'modelo normal calibrado (sin serie diaria)',
    sigmaHot,
    sigmaFrost,
    hotDays: (m, t) => hotFn(m, t, sigmaHot),
    frostDays: (m, t) => frostFn(m, t, sigmaFrost)
  };
}

/* ------------------------------------------------------------------ */
/* 3. Parámetros de cultivo FAO-33 + Soporte catálogo v3/v4            */
/* ------------------------------------------------------------------ */

const CROP_PARAMS = {
  maiz:    { ky: 1.25, hi: 0.50, heatLossPerDay: 0.025, frostWindow: 'emergence', frostLossPerDay: 0.015, ypotDefault: 9000,  magyp: 'Maíz', calib: 'Maíz', minAwReq: 95, minToscaReq: 70 },
  soja1:   { ky: 0.85, hi: 0.40, heatLossPerDay: 0.012, frostWindow: 'emergence', frostLossPerDay: 0.015, ypotDefault: 3600,  magyp: 'Soja 1ra', calib: 'Soja 1ra', minAwReq: 80, minToscaReq: 60 },
  soja2:   { ky: 0.85, hi: 0.40, heatLossPerDay: 0.012, frostWindow: 'emergence', frostLossPerDay: 0.015, ypotDefault: 2600,  magyp: 'Soja 2da', calib: 'Soja 2da', minAwReq: 75, minToscaReq: 55 },
  trigo:   { ky: 1.00, hi: 0.42, heatLossPerDay: 0.010, frostWindow: 'flowering', frostLossPerDay: 0.030, ypotDefault: 4500,  magyp: 'Trigo pan', calib: 'Trigo pan', minAwReq: 75, minToscaReq: 55 },
  cebada:  { ky: 0.95, hi: 0.44, heatLossPerDay: 0.010, frostWindow: 'flowering', frostLossPerDay: 0.025, ypotDefault: 4400,  magyp: 'Trigo pan', calib: null, minAwReq: 70, minToscaReq: 50 },
  arveja:  { ky: 0.95, hi: 0.45, heatLossPerDay: 0.014, frostWindow: 'flowering', frostLossPerDay: 0.028, ypotDefault: 2600,  magyp: null, calib: null, minAwReq: 75, minToscaReq: 55 },
  sorgo:   { ky: 0.90, hi: 0.45, heatLossPerDay: 0.006, frostWindow: 'emergence', frostLossPerDay: 0.020, ypotDefault: 7000,  magyp: 'Sorgo granífero', calib: 'Sorgo granífero', minAwReq: 58, minToscaReq: 45 },
  girasol: { ky: 0.95, hi: 0.36, heatLossPerDay: 0.009, frostWindow: 'emergence', frostLossPerDay: 0.018, ypotDefault: 2800,  magyp: null, calib: null, minAwReq: 72, minToscaReq: 65 },
  mani:    { ky: 0.80, hi: 0.42, heatLossPerDay: 0.010, frostWindow: 'emergence', frostLossPerDay: 0.020, ypotDefault: 3800,  magyp: null, calib: null, minAwReq: 85, minToscaReq: 60 },
  alfalfa: { ky: 1.10, hi: 1.00, heatLossPerDay: 0.003, frostWindow: null,        frostLossPerDay: 0,     ypotDefault: 11000, magyp: null, calib: null, minAwReq: 85, minToscaReq: 75 }
};

const COVER_WUE_KG_MS_PER_MM = 12;
const WUE_RANGE = [5, 22];
const DEFICIT_MAX = 0.5;
const EXTREME_LOSS_REF = 0.4;

/** Clasifica una etapa mensual por cropId (preferente) o etiqueta en cultivo comercial, cobertura o barbecho. */
function classifyLabel(label, cropId) {
  const id = String(cropId || '').toLowerCase();
  if (id === 'soja_2da') return { type: 'commercial', id: 'soja2' };
  if (id.startsWith('soja')) return { type: 'commercial', id: 'soja1' };
  if (id.startsWith('maiz')) return { type: 'commercial', id: 'maiz' };
  if (id.startsWith('trigo')) return { type: 'commercial', id: 'trigo' };
  if (id.startsWith('cebada')) return { type: 'commercial', id: 'cebada' };
  if (id.startsWith('arveja')) return { type: 'commercial', id: 'arveja' };
  if (id.startsWith('sorgo')) return { type: 'commercial', id: 'sorgo' };
  if (id.startsWith('girasol')) return { type: 'commercial', id: 'girasol' };
  if (id.startsWith('mani')) return { type: 'commercial', id: 'mani' };
  if (id.startsWith('pastura')) return { type: 'commercial', id: 'alfalfa' };
  if (/vicia|centeno|avena|nabo/.test(id)) return { type: 'cover', id: 'cover' };
  if (id.startsWith('barbecho')) return { type: 'fallow', id: 'fallow' };

  const l = String(label || '').toLowerCase();
  if (l.startsWith('soja 2da')) return { type: 'commercial', id: 'soja2' };
  if (l.startsWith('soja')) return { type: 'commercial', id: 'soja1' };
  if (l.startsWith('maíz') || l.startsWith('maiz')) return { type: 'commercial', id: 'maiz' };
  if (l.startsWith('trigo')) return { type: 'commercial', id: 'trigo' };
  if (l.startsWith('cebada')) return { type: 'commercial', id: 'cebada' };
  if (l.startsWith('arveja')) return { type: 'commercial', id: 'arveja' };
  if (l.startsWith('sorgo')) return { type: 'commercial', id: 'sorgo' };
  if (l.startsWith('girasol')) return { type: 'commercial', id: 'girasol' };
  if (l.startsWith('maní') || l.startsWith('mani')) return { type: 'commercial', id: 'mani' };
  if (l.startsWith('alfalfa')) return { type: 'commercial', id: 'alfalfa' };
  if (/centeno|vicia|avena|nabo/.test(l)) return { type: 'cover', id: 'cover' };
  return { type: 'fallow', id: 'fallow' };
}

/* ------------------------------------------------------------------ */
/* 4. Análisis de un cronograma mensual (Etapa 3)                      */
/* ------------------------------------------------------------------ */

const sum = (arr, f) => arr.reduce((a, x) => a + f(x), 0);

/** Agrupa meses contiguos del mismo cultivo en campañas. */
function groupBlocks(timeline) {
  const blocks = [];
  timeline.forEach((m, idx) => {
    const cls = m.isInitialClosure ? { type: 'closing', id: 'init' } : classifyLabel(m.cropLabel, m.cropId);
    const key = `${cls.type}:${cls.id}`;
    const last = blocks[blocks.length - 1];
    if (last && last.key === key) last.months.push(m);
    else blocks.push({ key, type: cls.type, id: cls.id, startIndex: idx, months: [m] });
  });
  // Los meses iniciales de cierre previo no se evalúan como campaña nueva de la rotación.
  const hasExplicitClosure = timeline.some((m) => m.isInitialClosure);
  blocks.forEach((b) => {
    b.closing = b.type === 'closing' || (!hasExplicitClosure && b.startIndex === 0);
  });
  return blocks;
}

/**
 * Calcula estrés hídrico FAO-33, pérdidas por calor y heladas, rindes estimados y criterios C1, C7 y C9.
 */
function analyzeTimeline(timeline, ctx) {
  const { ypot, years } = ctx;
  const ext = ctx.ext || ctx.heat;
  const blocks = groupBlocks(timeline).filter((b) => !b.closing);
  const seasons = [];
  let dhSum = 0;
  let etcCrop = 0;
  let etaAll = 0;
  let etcAll = 0;
  let drainAll = 0;
  let biomass = 0;

  blocks.forEach((b) => {
    const etc = sum(b.months, (m) => m.etcPot);
    const eta = sum(b.months, (m) => m.eta);
    etaAll += eta;
    etcAll += etc;
    drainAll += sum(b.months, (m) => m.drainage);

    if (b.type === 'fallow') return;
    dhSum += sum(b.months, (m) => Math.max(0, m.etcPot - m.eta));
    etcCrop += etc;

    if (b.type === 'cover') {
      biomass += COVER_WUE_KG_MS_PER_MM * eta;
      return;
    }

    const p = CROP_PARAMS[b.id];
    if (!p) return;

    const ratio = etc > 0 ? Math.min(1, eta / etc) : 1;
    const yfWater = clamp(1 - p.ky * (1 - ratio), 0, 1);

    const kcMax = Math.max(...b.months.map((m) => m.kc || 0.5));
    const flowering = b.months.filter((m) => (m.kc || 0) >= 0.9 * kcMax);
    const spanYears = Math.max(1, b.months.length / 12);
    const hotDays = sum(flowering, (m) => ext.hotDays(m.calMonth, m.tempMean)) / spanYears;
    const heatLoss = Math.min(0.4, p.heatLossPerDay * hotDays);

    let frostDays = 0;
    if (p.frostWindow) {
      const win = p.frostWindow === 'flowering' ? flowering : [b.months[0]];
      frostDays = sum(win, (m) => ext.frostDays(m.calMonth, m.tempMean)) / spanYears;
    }
    const frostLoss = Math.min(0.4, p.frostLossPerDay * frostDays);
    const yf = yfWater * (1 - heatLoss) * (1 - frostLoss);

    const potential = ypot && ypot[b.id] ? ypot[b.id] : p.ypotDefault;
    const perYear = potential * yf;
    const isCompleteSeason = b.id === 'alfalfa' || b.months.length >= 4;
    const seasonFrac = b.id === 'alfalfa'
      ? (b.months.length / 12)
      : (b.months.length >= 5 ? 1 : (b.months.length / 6) * 0.65);
    const totalYield = perYear * seasonFrac;
    biomass += b.id === 'alfalfa' ? totalYield : totalYield / p.hi;

    if (isCompleteSeason) {
      seasons.push({
        cropId: b.id,
        label: b.months[0].cropLabel,
        months: b.months.length,
        etcMm: Math.round(etc),
        etaMm: Math.round(eta),
        waterRatio: Number(ratio.toFixed(3)),
        yieldFracWater: Number(yfWater.toFixed(3)),
        hotDaysFlowering: Number(hotDays.toFixed(1)),
        heatLoss: Number(heatLoss.toFixed(3)),
        frostDays: Number(frostDays.toFixed(1)),
        frostLoss: Number(frostLoss.toFixed(3)),
        yieldFrac: Number(yf.toFixed(3)),
        yieldKgHa: Math.round(perYear)
      });
    }
  });

  const safeYears = Math.max(1, years || 1);
  const dhMmYear = dhSum / safeYears;
  const deficitFrac = etcCrop > 0 ? dhSum / etcCrop : 0;
  const wue = etaAll > 0 ? biomass / etaAll : 0;
  const meanHeatLoss = seasons.length ? sum(seasons, (s) => s.heatLoss) / seasons.length : 0;
  const meanFrostLoss = seasons.length ? sum(seasons, (s) => s.frostLoss) / seasons.length : 0;
  const meanExtremeLoss = seasons.length ? sum(seasons, (s) => 1 - (1 - s.heatLoss) * (1 - s.frostLoss)) / seasons.length : 0;

  return {
    seasons,
    dhMmYear: Number(dhMmYear.toFixed(1)),
    deficitFrac: Number(deficitFrac.toFixed(3)),
    wueKgMsHaMm: Number(wue.toFixed(2)),
    meanHeatLoss: Number(meanHeatLoss.toFixed(3)),
    meanFrostLoss: Number(meanFrostLoss.toFixed(3)),
    meanExtremeLoss: Number(meanExtremeLoss.toFixed(3)),
    extremesSource: ext.source,
    etaMm: Math.round(etaAll),
    etcMm: Math.round(etcAll),
    drainageMm: Math.round(drainAll),
    criteria: {
      c1: normDown(deficitFrac, 0, DEFICIT_MAX),
      c7: 100 * clamp(1 - meanExtremeLoss / EXTREME_LOSS_REF, 0, 1),
      c9: normUp(wue, WUE_RANGE[0], WUE_RANGE[1])
    }
  };
}

/** Calibra Ypot por cultivo para reproducir el rinde medio histórico MAGyP del partido. */
function calibrateYpot(referenceSeasons, magyp) {
  const stats = (magyp && magyp.cultivos) || [];
  const isLocalMagyp = !magyp || magyp.es_local !== false;
  const ypot = {};
  const info = {};
  Object.entries(CROP_PARAMS).forEach(([id, p]) => {
    const own = referenceSeasons.filter((s) => s.cropId === id && p.calib && s.label.startsWith(p.calib));
    const hist = isLocalMagyp && p.magyp ? stats.find((c) => c.nombre === p.magyp) : null;
    if (!own.length || !hist) {
      ypot[id] = p.ypotDefault;
      info[id] = {
        origen: isLocalMagyp ? 'valor por defecto (supuesto)' : 'referencia FAO-33 (fuera de jurisdicción MAGyP)',
        ypotKgHa: p.ypotDefault
      };
      return;
    }
    const meanYf = sum(own, (s) => s.yieldFrac) / own.length;
    ypot[id] = Math.round(hist.rinde_kg_ha / Math.max(0.35, meanYf));
    info[id] = {
      origen: 'calibrado con MAGyP',
      rindeHistorico: hist.rinde_kg_ha,
      yieldFracBase: Number(meanYf.toFixed(3)),
      ypotKgHa: ypot[id]
    };
  });
  return { ypot, info };
}

/* ------------------------------------------------------------------ */
/* 5. Etapa 1: Filtro de Aptitud No Compensatorio (Q0.05 – Q0.95)      */
/* ------------------------------------------------------------------ */

/**
 * Evalúa la aptitud agronómica de una estrategia respecto a agua disponible (Q0.05–Q0.95) y tosca.
 * Devuelve: { status: 'apto' | 'dudoso' | 'no_apto', label_es, label_en, reason_es, reason_en }
 */
function evaluateStrategyAptitude(strategyConfig, envContext) {
  const awStats = (envContext && envContext.suelo && envContext.suelo.aw_mm_m) || { q05: 84, media: 130, q95: 176 };
  const ic = strategyConfig.effectiveInit || {};
  const toscaCm = Number(ic.toscaCm) || 100;
  const depthFactor = toscaCm / 100;

  // Cuando el usuario cargó medición propia o usó valor puntual, Q05 y Q95 reflejan la incertidumbre edáfica escalada por tosca
  const awQ05 = Math.round((awStats.q05 || 84) * depthFactor);
  const awQ95 = Math.round((awStats.q95 || 176) * depthFactor);
  const awLocal = Math.round((Number(ic.awMmM) || awStats.media || 130) * depthFactor);

  let worstStatus = 'apto';
  const bottlenecks = [];

  (strategyConfig.sequence || []).forEach((yr) => {
    [yr.wCrop, yr.sCrop].forEach((crop) => {
      if (!crop || crop.stageType === 'bare' || crop.stageType === 'stubble') return;
      const cls = classifyLabel(crop.name_es, crop.id);
      const cp = CROP_PARAMS[cls.id];
      if (!cp) return;

      const reqAw = cp.minAwReq || 70;
      const reqTosca = cp.minToscaReq || 50;

      if (toscaCm < reqTosca || awQ95 < reqAw) {
        worstStatus = 'no_apto';
        bottlenecks.push(`${crop.name_es} (req. ${reqAw} mm / ${reqTosca} cm)`);
      } else if (awQ05 < reqAw && worstStatus !== 'no_apto') {
        worstStatus = 'dudoso';
        bottlenecks.push(`${crop.name_es} (Q0.05=${awQ05} mm < ${reqAw} mm)`);
      }
    });
  });

  if (worstStatus === 'no_apto') {
    return {
      status: 'no_apto',
      awLocal,
      awRange: [awQ05, awQ95],
      label_es: 'No Apto (Limitante severa)',
      label_en: 'Unsuitable (Severe constraint)',
      reason_es: `Incluso en el escenario edáfico optimista (Q0.95 = ${awQ95} mm, tosca ${toscaCm} cm), falla requisito de: ${[...new Set(bottlenecks)].join(', ')}.`,
      reason_en: `Even under optimistic soil quantile (Q0.95 = ${awQ95} mm, pan ${toscaCm} cm), fails depth/water check for: ${[...new Set(bottlenecks)].join(', ')}.`
    };
  }
  if (worstStatus === 'dudoso') {
    return {
      status: 'dudoso',
      awLocal,
      awRange: [awQ05, awQ95],
      label_es: 'Dudoso · Medir en el lote',
      label_en: 'Uncertain · Measure on-farm',
      reason_es: `El cuantil pesimista de SoilGrids (Q0.05 = ${awQ05} mm) cae debajo del umbral en: ${[...new Set(bottlenecks)].join(', ')}. Conviene validar tosca y agua útil en campo.`,
      reason_en: `SoilGrids pessimistic quantile (Q0.05 = ${awQ05} mm) dips below crop threshold for: ${[...new Set(bottlenecks)].join(', ')}. On-farm measurement recommended.`
    };
  }
  return {
    status: 'apto',
    awLocal,
    awRange: [awQ05, awQ95],
    label_es: 'Apto (Validado Q0.05–Q0.95)',
    label_en: 'Suitable (Q0.05–Q0.95 passed)',
    reason_es: `Todos los cultivos superan el filtro incluso bajo el escenario edáfico pesimista (Q0.05 = ${awQ05} mm útil, tosca ${toscaCm} cm).`,
    reason_en: `All crops in the sequence pass even under pessimistic soil quantile (Q0.05 = ${awQ05} mm, pan ${toscaCm} cm).`
  };
}

module.exports = {
  et0PenmanMonteith,
  monthlyEt0Fao56,
  extraterrestrialRadiation,
  makeExtremesModel,
  makeHeatModel: makeExtremesModel,
  analyzeTimeline,
  calibrateYpot,
  evaluateStrategyAptitude,
  classifyLabel,
  CROP_PARAMS,
  normUp,
  normDown
};
