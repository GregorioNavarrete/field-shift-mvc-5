/**
 * @file models/extremesModel.js
 * @description Días de calor (Tmax > umbral) y de helada (Tmin < umbral) a partir de la serie DIARIA de NASA POWER
 * (T2M_MAX, T2M_MIN). Reemplaza las constantes dias_calor_35c = 14 y dias_helada_0c = 26.
 *
 * En lugar de guardar los ~7.000 días, se guardan curvas de excedencia por mes: "cuántos días por mes, en promedio,
 * superan cada umbral". Así se puede responder para cualquier calentamiento ΔT (escenarios) sin volver a consultar:
 *   días con Tmax > 35 °C bajo +ΔT  =  días con Tmax > (35 − ΔT) °C en la serie histórica.
 *   días con Tmin <  0 °C bajo +ΔT  =  días con Tmin < (0 − ΔT) °C en la serie histórica.
 * Es un desplazamiento uniforme de la distribución (no cambia la variabilidad), supuesto simple y explícito.
 */
'use strict';

const DAYS_IN_MONTH = [31, 28.25, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
/** Umbrales de calor guardados: Tmax > u, u = 25..45 °C. */
const HOT_THRESHOLDS_C = range(25, 45);
/** Umbrales de frío guardados: Tmin < u, u = -8..4 °C. */
const COLD_THRESHOLDS_C = range(-8, 4);

const isValid = (v) => typeof v === 'number' && Number.isFinite(v) && v > -900;

/**
 * Construye curvas empíricas de excedencia térmica mensual desde la serie diaria de NASA POWER.
 * @param {Object<string, number>} tmax - { 'YYYYMMDD': Tmax } tal como lo entrega POWER (faltantes = -999).
 * @param {Object<string, number>} tmin - { 'YYYYMMDD': Tmin }.
 * @returns {Object|null} estructura de extremos, o null si no hay datos suficientes.
 */
function buildExtremes(tmax, tmin) {
  const hot = Array.from({ length: 12 }, () => Array(HOT_THRESHOLDS_C.length).fill(0));
  const cold = Array.from({ length: 12 }, () => Array(COLD_THRESHOLDS_C.length).fill(0));
  const nHot = Array(12).fill(0);
  const nCold = Array(12).fill(0);
  const hotByYear = {};
  const frostByYear = {};
  const validYears = new Set();

  Object.keys(tmax || {}).forEach((d) => {
    const v = tmax[d];
    if (!isValid(v)) return;
    const m = Number(d.slice(4, 6)) - 1;
    const y = d.slice(0, 4);
    if (m < 0 || m > 11) return;
    nHot[m] += 1;
    validYears.add(y);
    HOT_THRESHOLDS_C.forEach((u, k) => { if (v > u) hot[m][k] += 1; });
    if (v > 35) hotByYear[y] = (hotByYear[y] || 0) + 1;
  });

  Object.keys(tmin || {}).forEach((d) => {
    const v = tmin[d];
    if (!isValid(v)) return;
    const m = Number(d.slice(4, 6)) - 1;
    const y = d.slice(0, 4);
    if (m < 0 || m > 11) return;
    nCold[m] += 1;
    COLD_THRESHOLDS_C.forEach((u, k) => { if (v < u) cold[m][k] += 1; });
    if (v < 0) frostByYear[y] = (frostByYear[y] || 0) + 1;
  });

  // Se exige al menos 5 años con datos y todos los meses cubiertos; si no, no se confía en la serie.
  if (validYears.size < 5 || nHot.some((n) => n < 100) || nCold.some((n) => n < 100)) return null;

  const toDays = (table, n) => table.map((row, m) => row.map((c) => Number(((c / n[m]) * DAYS_IN_MONTH[m]).toFixed(2))));
  const hotDays = toDays(hot, nHot);
  const coldDays = toDays(cold, nCold);
  const idx35 = HOT_THRESHOLDS_C.indexOf(35);
  const idx0 = COLD_THRESHOLDS_C.indexOf(0);
  const sumCol = (table, k) => Number(table.reduce((acc, row) => acc + row[k], 0).toFixed(1));
  const years = [...validYears].sort();

  return {
    anios: [Number(years[0]), Number(years[years.length - 1])],
    n_anios: years.length,
    calor: {
      umbrales_c: HOT_THRESHOLDS_C,
      dias_mes: hotDays,
      dias_anual_35: sumCol(hotDays, idx35),
      anual_por_anio: years.map((y) => hotByYear[y] || 0)
    },
    helada: {
      umbrales_c: COLD_THRESHOLDS_C,
      dias_mes: coldDays,
      dias_anual_0: sumCol(coldDays, idx0),
      anual_por_anio: years.map((y) => frostByYear[y] || 0)
    }
  };
}

/** Interpolación lineal de la curva de excedencia mensual en un umbral cualquiera. */
function interpolate(thresholds, values, u) {
  if (u <= thresholds[0]) return values[0];
  const last = thresholds.length - 1;
  if (u >= thresholds[last]) return values[last];
  const k = Math.floor(u - thresholds[0]);
  const f = (u - thresholds[k]) / (thresholds[k + 1] - thresholds[k]);
  return values[k] + f * (values[k + 1] - values[k]);
}

/** Días/mes con Tmax > base °C si el clima se calienta deltaC grados (mes 0-11). */
function hotDaysMonth(ext, month, deltaC = 0, base = 35) {
  const v = interpolate(ext.calor.umbrales_c, ext.calor.dias_mes[month], base - deltaC);
  return Math.max(0, v);
}

/** Días/mes con Tmin < base °C si el clima se calienta deltaC grados (mes 0-11). */
function frostDaysMonth(ext, month, deltaC = 0, base = 0) {
  const v = interpolate(ext.helada.umbrales_c, ext.helada.dias_mes[month], base - deltaC);
  return Math.max(0, v);
}

module.exports = {
  buildExtremes,
  hotDaysMonth,
  frostDaysMonth,
  HOT_THRESHOLDS_C,
  COLD_THRESHOLDS_C
};
