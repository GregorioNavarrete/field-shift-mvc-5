/**
 * @file models/agroModel.js
 * @description Modelo de acceso a datos agroclimáticos, edáficos, satelitales (Sentinel-2 L2A) y territoriales.
 * Implementa consultas en paralelo a APIs abiertas (Planetary Computer STAC/Raster, NASA POWER climatología y reciente GWETROOT,
 * Open-Meteo humedad/altitud, ISRIC SoilGrids v2.0 5 profundidades, Georef AR + Nominatim global)
 * con caché en memoria, conmutación transparente a respaldo JSON offline y catálogos agronómicos completos.
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const yieldModel = require('./yieldModel');
const extremesModel = require('./extremesModel');

/** Altitud de respaldo del sitio [m] cuando Open-Meteo no responde. */
const DEFAULT_ALTITUDE_M = 100;

const FALLBACK_DATA = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'data', 'zona_guamini_10ha.json'), 'utf8')
);

const memoryCache = new Map();

function getFromCache(key) {
  const entry = memoryCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    memoryCache.delete(key);
    return null;
  }
  return entry.value;
}

function setInCache(key, value, ttlMs) {
  memoryCache.set(key, { value, expiresAt: Date.now() + ttlMs });
}

function clampVal(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

function isNearGuamini(lat, lon) {
  return Math.hypot(lat - FALLBACK_DATA.meta.coordenadas.lat, lon - FALLBACK_DATA.meta.coordenadas.lon) < 0.35;
}

function formatCoordFallback(lat, lon) {
  const latStr = `${Math.abs(lat).toFixed(3)}° ${lat >= 0 ? 'N' : 'S'}`;
  const lonStr = `${Math.abs(lon).toFixed(3)}° ${lon >= 0 ? 'E' : 'O'}`;
  return `${latStr}, ${lonStr}`;
}

/**
 * Consulta la API Georef Argentina y, fuera de Argentina, OpenStreetMap Nominatim
 * para identificar provincia/estado y partido/condado de cualquier coordenada global.
 */
async function fetchGeorefLocation(lat, lon) {
  const cacheKey = `georef:${lat.toFixed(3)},${lon.toFixed(3)}`;
  const cached = getFromCache(cacheKey);
  if (cached) return cached;

  // 1. Georef Argentina (máxima precisión administrativa en territorio AR)
  try {
    const url = `https://apis.datos.gob.ar/georef/api/ubicacion?lat=${lat}&lon=${lon}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
    if (res.ok) {
      const json = await res.json();
      const ub = json.ubicacion || {};
      if (ub.provincia && ub.provincia.nombre) {
        const depto = ub.departamento ? ub.departamento.nombre : 'Zona Rural';
        const result = {
          modo: 'live_api',
          pais: 'Argentina',
          provincia: ub.provincia.nombre,
          departamento: depto,
          etiqueta: `${depto}, ${ub.provincia.nombre}`,
          es_argentina: true
        };
        setInCache(cacheKey, result, 86400000);
        return result;
      }
    }
  } catch (_) {
    // Continúa a geocodificación global Nominatim
  }

  // 2. Fallback global OpenStreetMap Nominatim (para lotes fuera de Argentina o bordes)
  try {
    const nomUrl = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=jsonv2&zoom=10&accept-language=es`;
    const res = await fetch(nomUrl, {
      headers: { 'User-Agent': 'FieldShiftAgronomyApp/5.0 (open-source agroclimatology)' },
      signal: AbortSignal.timeout(3500)
    });
    if (res.ok) {
      const json = await res.json();
      const addr = json.address || {};
      const localName = addr.county || addr.city || addr.town || addr.village || addr.municipality || addr.state_district;
      const stateName = addr.state || addr.region || addr.province;
      const countryName = addr.country || '';
      const parts = [localName, stateName, countryName].filter(Boolean);
      if (parts.length > 0) {
        const result = {
          modo: 'live_nominatim',
          pais: countryName || 'Global',
          provincia: stateName || countryName || 'Global',
          departamento: localName || 'Área Rural',
          etiqueta: parts.join(', '),
          es_argentina: /argentina/i.test(countryName)
        };
        setInCache(cacheKey, result, 86400000);
        return result;
      }
    }
  } catch (_) {
    // Fallback offline transparente
  }

  if (isNearGuamini(lat, lon)) {
    return {
      modo: 'fallback_offline',
      pais: 'Argentina',
      provincia: 'Buenos Aires',
      departamento: 'Guaminí',
      etiqueta: FALLBACK_DATA.meta.zona,
      es_argentina: true
    };
  }

  return {
    modo: 'fallback_offline',
    pais: 'Global',
    provincia: 'Coordenada geolocalizada',
    departamento: formatCoordFallback(lat, lon),
    etiqueta: `Parcela en ${formatCoordFallback(lat, lon)} (sin servicio geográfico)`,
    es_argentina: false
  };
}

/**
 * Consulta humedad radicular y superficial reciente (NASA POWER Daily GWETROOT/GWETTOP + Open-Meteo)
 * junto con lluvia reciente (30 días) y elevación real del terreno.
 */
async function fetchRecentMoistureAndElevation(lat, lon) {
  const cacheKey = `moist:${lat.toFixed(2)},${lon.toFixed(2)}`;
  const cached = getFromCache(cacheKey);
  if (cached) return cached;

  const end = new Date(Date.now() - 3 * 86400000);
  const start = new Date(end.getTime() - 35 * 86400000);
  const fmt = (d) => d.toISOString().slice(0, 10).replace(/-/g, '');

  const powerRecentUrl =
    `https://power.larc.nasa.gov/api/temporal/daily/point?parameters=GWETROOT,GWETTOP,PRECTOTCORR,T2M` +
    `&community=AG&longitude=${lon}&latitude=${lat}&start=${fmt(start)}&end=${fmt(end)}&format=JSON`;
  const openMeteoUrl =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    `&hourly=soil_moisture_0_to_7cm,soil_moisture_7_to_28cm,soil_moisture_28_to_100cm&past_days=3&forecast_days=1`;

  const [powerRes, omRes] = await Promise.allSettled([
    fetch(powerRecentUrl, { signal: AbortSignal.timeout(4000) }).then((r) => (r.ok ? r.json() : null)),
    fetch(openMeteoUrl, { signal: AbortSignal.timeout(3500) }).then((r) => (r.ok ? r.json() : null))
  ]);

  let rootPct = null;
  let topPct = null;
  let rain30d = null;
  let latestDate = null;
  let gwetRootUsed = false;

  if (powerRes.status === 'fulfilled' && powerRes.value?.properties?.parameter) {
    const p = powerRes.value.properties.parameter;
    const gRoot = p.GWETROOT || {};
    const gTop = p.GWETTOP || {};
    const prec = p.PRECTOTCORR || {};

    const validDates = Object.keys(gRoot).filter((k) => Number.isFinite(gRoot[k]) && gRoot[k] >= 0 && gRoot[k] <= 1).sort();
    if (validDates.length > 0) {
      const lastKey = validDates[validDates.length - 1];
      rootPct = Math.round(clampVal(gRoot[lastKey] * 100, 12, 98));
      gwetRootUsed = true;
      latestDate = `${lastKey.slice(0, 4)}-${lastKey.slice(4, 6)}-${lastKey.slice(6, 8)}`;
      if (Number.isFinite(gTop[lastKey]) && gTop[lastKey] >= 0 && gTop[lastKey] <= 1) {
        topPct = Math.round(clampVal(gTop[lastKey] * 100, 8, 99));
      }
    }

    const rainKeys = Object.keys(prec).filter((k) => Number.isFinite(prec[k]) && prec[k] >= 0).sort().slice(-30);
    if (rainKeys.length > 0) {
      rain30d = Math.round(rainKeys.reduce((acc, k) => acc + prec[k], 0));
    }
  }

  let volMoisture = null;
  let volTopMoisture = null;
  let altitudM = DEFAULT_ALTITUDE_M;
  let omUsed = false;

  if (omRes.status === 'fulfilled' && omRes.value) {
    const om = omRes.value;
    if (Number.isFinite(om.elevation)) {
      altitudM = Math.round(om.elevation);
    }
    const h = om.hourly || {};
    const pickLastValid = (arr) => {
      if (!Array.isArray(arr)) return null;
      for (let i = arr.length - 1; i >= 0; i--) {
        if (Number.isFinite(arr[i]) && arr[i] >= 0) return arr[i];
      }
      return null;
    };
    const smTop = pickLastValid(h.soil_moisture_0_to_7cm);
    const smMid = pickLastValid(h.soil_moisture_7_to_28cm);
    const smDeep = pickLastValid(h.soil_moisture_28_to_100cm);
    if (smDeep !== null || smMid !== null) {
      const wVol = smDeep !== null && smMid !== null ? (0.3 * smMid + 0.7 * smDeep) : (smDeep ?? smMid);
      volMoisture = Number(wVol.toFixed(2));
      omUsed = true;
      if (rootPct === null) {
        // Fallback razonable si POWER GWETROOT no tuvo dato válido
        rootPct = Math.round(clampVal(((wVol - 0.10) / 0.34) * 100, 15, 95));
      }
    }
    if (smTop !== null) {
      volTopMoisture = Number(smTop.toFixed(2));
    }
    if (!latestDate && omUsed) {
      latestDate = new Date().toISOString().slice(0, 10);
    }
  }

  const modo = gwetRootUsed || omUsed ? 'live_api' : 'fallback_offline';
  const finalRootPct = rootPct !== null ? rootPct : 62;
  const finalVol = volMoisture !== null ? volMoisture : Number((0.10 + (finalRootPct / 100) * 0.24).toFixed(2));

  const fuentes = [];
  if (gwetRootUsed) fuentes.push('NASA POWER GWETROOT (MERRA-2)');
  if (omUsed) fuentes.push('Open-Meteo Suelo 0–100 cm');

  const result = {
    modo,
    fuente: fuentes.length > 0 ? fuentes.join(' + ') : 'Referencia SMAP L4 (Respaldo Offline)',
    humedad_smap_inicial_pct: finalRootPct,
    humedad_superficial_pct: topPct,
    humedad_volumetrica_m3: finalVol,
    humedad_superficial_m3: volTopMoisture,
    lluvia_ultimos_30d_mm: rain30d,
    altitud_m: altitudM,
    fecha_dato: latestDate
  };

  setInCache(cacheKey, result, modo === 'live_api' ? 1800000 : 120000);
  return result;
}

/**
 * Consulta NASA POWER Climatology API (community=AG) para precipitación, temperatura y ET0 calibrada INTA SIGA.
 */
async function fetchNasaPowerClimate(lat, lon, altitudeM = DEFAULT_ALTITUDE_M) {
  const altKey = Math.round(Number.isFinite(altitudeM) ? altitudeM : DEFAULT_ALTITUDE_M);
  const cacheKey = `power:${lat.toFixed(2)},${lon.toFixed(2)},${altKey}`;
  const cached = getFromCache(cacheKey);
  if (cached) return cached;

  try {
    const params = 'T2M,T2M_MAX,T2M_MIN,PRECTOTCORR,RH2M,WS2M,ALLSKY_SFC_SW_DWN';
    const url = `https://power.larc.nasa.gov/api/temporal/climatology/point?parameters=${params}&community=AG&longitude=${lon}&latitude=${lat}&format=JSON`;
    const res = await fetch(url, { signal: AbortSignal.timeout(4500) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const p = json.properties.parameter;

    const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
    const daysInMonth = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

    const precipMensual = months.map((m, idx) => Math.round((p.PRECTOTCORR[m] || 2.5) * daysInMonth[idx]));
    const tempMensual = months.map((m) => Number((p.T2M[m] || 15).toFixed(1)));

    const pick = (key, fallback) =>
      months.map((m) => (p[key] && Number.isFinite(p[key][m]) && p[key][m] > -900 ? p[key][m] : fallback));
    const tMeanArr = pick('T2M', 15);
    const tMaxArr = pick('T2M_MAX', 22);
    const tMinArr = pick('T2M_MIN', 8);
    const rhArr = pick('RH2M', 65);
    const u2Arr = pick('WS2M', 3);
    let rsArr = pick('ALLSKY_SFC_SW_DWN', 16);
    if (Math.max(...rsArr) < 10) rsArr = rsArr.map((v) => v * 3.6);

    let et0Mensual;
    try {
      et0Mensual = yieldModel.monthlyEt0Fao56(
        { tMean: tMeanArr, tMax: tMaxArr, tMin: tMinArr, rh: rhArr, u2: u2Arr, rs: rsArr },
        lat,
        altKey
      );
      const anual = et0Mensual.reduce((a, b) => a + b, 0);
      if (et0Mensual.some((v) => !Number.isFinite(v)) || anual < 200 || anual > 3200) {
        throw new Error('ET0 fuera de rango');
      }
    } catch (e) {
      et0Mensual = months.map((m, idx) => {
        const t = p.T2M[m] || 15;
        const rs = p.ALLSKY_SFC_SW_DWN[m] || 16;
        const et0Raw = (0.0023 * (t + 17.8) * Math.sqrt(Math.max(4, (p.T2M_MAX[m] - p.T2M_MIN[m]) || 10)) * (rs * 0.408)) * daysInMonth[idx];
        return Math.round(et0Raw * 0.903);
      });
    }

    const result = {
      modo: 'live_api',
      fuente: 'NASA POWER API (En vivo · Penman-Monteith FAO-56) + Sesgo INTA SIGA',
      precipitacion_mm: precipMensual,
      et0_calibrada_mm: et0Mensual,
      temp_media_c: tempMensual,
      tmax_media_c: tMaxArr,
      tmin_media_c: tMinArr,
      altitud_m: altKey,
      lluvia_anual_mm: precipMensual.reduce((a, b) => a + b, 0),
      et0_anual_mm: et0Mensual.reduce((a, b) => a + b, 0),
      dias_calor_35c: 14,
      dias_helada_0c: 26
    };

    setInCache(cacheKey, result, Number(process.env.CACHE_TTL_CLIMA_MS) || 3600000);
    return result;
  } catch (err) {
    const fb = FALLBACK_DATA.clima_mensual_guamini;
    return {
      modo: 'fallback_offline',
      fuente: `${fb.fuente} (Respaldo Offline)`,
      precipitacion_mm: fb.precipitacion_mm,
      et0_calibrada_mm: fb.et0_calibrada_mm,
      temp_media_c: fb.temp_media_c,
      altitud_m: altKey,
      lluvia_anual_mm: fb.precipitacion_mm.reduce((a, b) => a + b, 0),
      et0_anual_mm: fb.et0_calibrada_mm.reduce((a, b) => a + b, 0),
      dias_calor_35c: fb.dias_calor_35c,
      dias_helada_0c: fb.dias_helada_0c
    };
  }
}

const SOILGRIDS_DEPTH_WEIGHTS = {
  '0-5cm': 5,
  '5-15cm': 10,
  '15-30cm': 15,
  '30-60cm': 30,
  '60-100cm': 40
};

/**
 * Clasifica la clase textural USDA simplificada con los porcentajes granulométricos exactos.
 */
function classifyUsdaTexture(sandPct, siltPct, clayPct) {
  const s = Math.max(0, Math.round(sandPct));
  const si = Math.max(0, Math.round(siltPct));
  const c = Math.max(0, Math.round(clayPct));
  let cls = 'Franca';
  if (c >= 40) cls = s >= 45 ? 'Arcillo-arenosa' : (si >= 40 ? 'Arcillo-limosa' : 'Arcillosa');
  else if (c >= 27) cls = s >= 45 ? 'Franco-arcillo-arenosa' : (s <= 20 ? 'Franco-arcillo-limosa' : 'Franco-arcillosa');
  else if (s >= 70 && c < 15) cls = s >= 85 ? 'Arenosa' : 'Arenosa-franca';
  else if (si >= 50 && c < 27) cls = 'Franco-limosa';
  else if (s >= 52 && c < 20) cls = 'Franco-arenosa';
  return `${cls} (${s}% arena, ${si}% limo, ${c}% arcilla)`;
}

/**
 * Infiere taxonomía USDA/INTA regionalizada y profundidad útil estimada según coordenadas y granulometría.
 */
function inferRegionalTaxonomyAndDepth(lat, lon, socGKg, sandPct, siltPct, clayPct) {
  let tax = `Perfil geolocalizado ISRIC (${classifyUsdaTexture(sandPct, siltPct, clayPct).split(' (')[0]})`;
  let depthCm = 100;

  if (lat <= -31 && lat >= -40 && lon >= -66 && lon <= -57) {
    if (lat >= -35 && lon >= -62.5 && siltPct >= 45) {
      tax = 'Argiudol típico (Zona Núcleo / Pampa Ondulada)';
      depthCm = 100;
    } else if (lat <= -37.2 && lon >= -61.5) {
      tax = clayPct >= 26
        ? 'Argiudol típico / petrocálcico (Sudeste Bonaerense)'
        : 'Hapludol / Argiudol con posible tosca en subsuelo';
      depthCm = clayPct >= 28 ? 100 : 75;
    } else if (lon <= -61.5 && sandPct >= 48) {
      tax = lat >= -35
        ? 'Haplustol típico / éntico (Semiárido / Córdoba–La Pampa)'
        : 'Hapludol típico / éntico (Pampa Arenosa)';
      depthCm = 100;
    } else if (lon < -62.5) {
      tax = 'Haplustol típico / éntico (Subhúmedo–Semiárido)';
      depthCm = sandPct >= 60 ? 75 : 100;
    } else {
      tax = 'Molisol Pampeano geolocalizado ISRIC';
      depthCm = 100;
    }
  } else if (socGKg >= 20 && clayPct >= 18) {
    tax = 'Molisol / Chernozem fértil (ISRIC SoilGrids)';
    depthCm = 100;
  } else if (sandPct >= 68) {
    tax = 'Entisol / Inceptisol arenoso (ISRIC SoilGrids)';
    depthCm = 75;
  }

  return { taxonomia: tax, profundidad_util_cm: depthCm };
}

/**
 * Descarga un recorte GeoTIFF 250 m desde ISRIC SoilGrids v2.0 OGC WCS (maps.isric.org)
 * y decodifica los píxeles válidos Int16 (zlib + TIFF Predictor=2) en una ventana de ~1,6 km.
 */
async function fetchIsricWcsMean(prop, coverageId, lat, lon) {
  const d = 0.008;
  const url =
    `https://maps.isric.org/mapserv?map=/map/${prop}.map&SERVICE=WCS&VERSION=2.0.1&REQUEST=GetCoverage` +
    `&COVERAGEID=${coverageId}&FORMAT=image/tiff` +
    `&SUBSET=long(${(lon - d).toFixed(5)},${(lon + d).toFixed(5)})` +
    `&SUBSET=lat(${(lat - d).toFixed(5)},${(lat + d).toFixed(5)})` +
    `&SUBSETTINGCRS=http://www.opengis.net/def/crs/EPSG/0/4326` +
    `&OUTPUTCRS=http://www.opengis.net/def/crs/EPSG/0/4326`;

  const res = await fetch(url, { signal: AbortSignal.timeout(4800) });
  if (!res.ok) throw new Error(`WCS ${coverageId} HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 16) throw new Error(`WCS ${coverageId} respuesta vacía`);

  const isLE = buf.toString('ascii', 0, 2) === 'II';
  const r16 = (off) => (isLE ? buf.readUInt16LE(off) : buf.readUInt16BE(off));
  const r32 = (off) => (isLE ? buf.readUInt32LE(off) : buf.readUInt32BE(off));
  const ifdOff = r32(4);
  const numEntries = r16(ifdOff);

  let w = 1;
  let h = 1;
  let comp = 1;
  let predictor = 1;
  let tileW = 0;
  let dataOff = 0;
  let dataLen = 0;

  for (let i = 0; i < numEntries; i++) {
    const eOff = ifdOff + 2 + i * 12;
    const tag = r16(eOff);
    const type = r16(eOff + 2);
    const count = r32(eOff + 4);
    const val = (type === 3 && count === 1) ? r16(eOff + 8) : r32(eOff + 8);
    if (tag === 256) w = val;
    if (tag === 257) h = val;
    if (tag === 259) comp = val;
    if (tag === 317) predictor = val;
    if (tag === 322) tileW = val;
    if (tag === 273 || tag === 324) dataOff = val;
    if (tag === 279 || tag === 325) dataLen = val;
  }

  if (!dataOff || !dataLen) throw new Error(`WCS ${coverageId} sin payload TIFF`);
  const payload = buf.subarray(dataOff, dataOff + dataLen);
  const raw = comp === 8 ? zlib.inflateSync(payload) : payload;
  const rowStride = tileW || w;

  let sum = 0;
  let cnt = 0;
  for (let rIdx = 0; rIdx < h; rIdx++) {
    let acc = 0;
    for (let cIdx = 0; cIdx < w; cIdx++) {
      const off = (rIdx * rowStride + cIdx) * 2;
      if (off + 2 > raw.length) break;
      const delta = isLE ? raw.readInt16LE(off) : raw.readInt16BE(off);
      acc = predictor === 2 ? ((acc + delta) << 16 >> 16) : delta;
      if (acc > 0 && acc < 10000) {
        sum += acc;
        cnt += 1;
      }
    }
  }
  return cnt > 0 ? sum / cnt : 0;
}

/**
 * Consulta en vivo ISRIC SoilGrids v2.0 vía OGC WCS (maps.isric.org) por profundidades.
 */
async function fetchSoilGridsViaWcs(lat, lon) {
  const [soc5, soc15, soc30, soc60, fc30, fc60, wp30, wp60, sand15, silt15, clay15] = await Promise.all([
    fetchIsricWcsMean('soc', 'soc_0-5cm_mean', lat, lon),
    fetchIsricWcsMean('soc', 'soc_5-15cm_mean', lat, lon),
    fetchIsricWcsMean('soc', 'soc_15-30cm_mean', lat, lon),
    fetchIsricWcsMean('soc', 'soc_30-60cm_mean', lat, lon),
    fetchIsricWcsMean('wv0033', 'wv0033_15-30cm_mean', lat, lon),
    fetchIsricWcsMean('wv0033', 'wv0033_30-60cm_mean', lat, lon),
    fetchIsricWcsMean('wv1500', 'wv1500_15-30cm_mean', lat, lon),
    fetchIsricWcsMean('wv1500', 'wv1500_30-60cm_mean', lat, lon),
    fetchIsricWcsMean('sand', 'sand_5-15cm_mean', lat, lon),
    fetchIsricWcsMean('silt', 'silt_5-15cm_mean', lat, lon),
    fetchIsricWcsMean('clay', 'clay_5-15cm_mean', lat, lon)
  ]);

  const fcMean = (fc30 * 15 + fc60 * 30) / 45;
  const wpMean = (wp30 * 15 + wp60 * 30) / 45;
  if (!(fcMean > 0) || !(wpMean > 0)) {
    throw new Error('WCS sin cobertura edáfica válida');
  }

  const awMean = clampVal(Math.round(fcMean - wpMean), 45, 250);
  const awQ05 = Math.max(35, Math.round(awMean * 0.68));
  const awQ95 = Math.max(awMean + 12, Math.round(awMean * 1.32));

  const socRaw = (soc5 * 5 + soc15 * 10 + soc30 * 15 + soc60 * 30) / 60;
  const socMean = Number(clampVal((socRaw || 184) / 10, 4, 80).toFixed(1));
  const socQ05 = Number(Math.max(3, socMean * 0.68).toFixed(1));
  const socQ95 = Number(Math.min(90, socMean * 1.38).toFixed(1));

  const texSum = Math.max(1, sand15 + silt15 + clay15);
  const sandPct = Math.round((sand15 / texSum) * 100);
  const siltPct = Math.round((silt15 / texSum) * 100);
  const clayPct = Math.max(0, 100 - sandPct - siltPct);

  const regional = inferRegionalTaxonomyAndDepth(lat, lon, socMean, sandPct, siltPct, clayPct);

  return {
    modo: 'live_api',
    fuente: 'ISRIC SoilGrids v2.0 OGC WCS (En vivo · 250 m · perfil 0–60 cm)',
    taxonomia: regional.taxonomia,
    textura: classifyUsdaTexture(sandPct, siltPct, clayPct),
    profundidad_util_cm: regional.profundidad_util_cm,
    soc_g_kg: { media: socMean, q05: socQ05, q95: socQ95 },
    aw_mm_m: { media: awMean, q05: awQ05, q95: awQ95 },
    humedad_smap_inicial_pct: 62
  };
}

/**
 * Estimación edáfica regionalizada por coordenadas cuando REST y WCS de ISRIC no responden.
 */
function buildZonalSoilFallback(lat, lon) {
  const fb = FALLBACK_DATA.suelo_guamini;
  if (isNearGuamini(lat, lon)) {
    return {
      modo: 'fallback_offline',
      fuente: `${fb.fuente} (Respaldo Local Guaminí)`,
      taxonomia: fb.taxonomia,
      textura: fb.textura,
      profundidad_util_cm: 100,
      soc_g_kg: fb.soc_g_kg,
      aw_mm_m: fb.aw_mm_m,
      humedad_smap_inicial_pct: fb.humedad_smap_inicial_pct
    };
  }

  // Gradiente zonal coherente con latitud y longitud ante desconexión de ISRIC
  const absLat = Math.abs(lat);
  const tropicalFactor = clampVal(1 - Math.abs(absLat - 42) / 38, 0.2, 1.0);
  const westShift = clampVal((lon + 60) / 8, -1, 1);
  const sandPct = Math.round(clampVal(44 - westShift * 18 - (absLat > 34 && lon > -62 ? 10 : 0), 15, 78));
  const clayPct = Math.round(clampVal(24 + westShift * 6, 10, 42));
  const siltPct = Math.max(5, 100 - sandPct - clayPct);
  const awMean = Math.round(clampVal(105 + siltPct * 1.15 + clayPct * 0.45, 70, 210));
  const socMean = Number(clampVal(11 + tropicalFactor * 10 + clayPct * 0.12, 8, 45).toFixed(1));
  const regional = inferRegionalTaxonomyAndDepth(lat, lon, socMean, sandPct, siltPct, clayPct);

  return {
    modo: 'fallback_offline',
    fuente: 'Estimación edáfica zonal (ISRIC offline · calibración por coordenada)',
    taxonomia: `${regional.taxonomia} (Est. Zonal)`,
    textura: classifyUsdaTexture(sandPct, siltPct, clayPct),
    profundidad_util_cm: regional.profundidad_util_cm,
    soc_g_kg: {
      media: socMean,
      q05: Number((socMean * 0.68).toFixed(1)),
      q95: Number((socMean * 1.38).toFixed(1))
    },
    aw_mm_m: {
      media: awMean,
      q05: Math.round(awMean * 0.68),
      q95: Math.round(awMean * 1.32)
    },
    humedad_smap_inicial_pct: 62
  };
}

/**
 * Integra horizontalmente las profundidades SoilGrids 0–100 cm ponderadas por espesor d_l.
 */
function integrateSoilGridsDepths(layers, propName) {
  const layer = layers.find((l) => l.name === propName);
  if (!layer || !Array.isArray(layer.depths) || layer.depths.length === 0) return {};

  let wSum = 0;
  let meanAcc = 0;
  let q05Acc = 0;
  let q95Acc = 0;
  let hasQ05 = true;
  let hasQ95 = true;

  layer.depths.forEach((d) => {
    const val = d.values || {};
    if (!Number.isFinite(val.mean)) return;
    const w = SOILGRIDS_DEPTH_WEIGHTS[d.label] || (d.range ? (d.range.bottom_depth - d.range.top_depth) : 30) || 30;
    wSum += w;
    meanAcc += val.mean * w;
    if (Number.isFinite(val['Q0.05'])) q05Acc += val['Q0.05'] * w; else hasQ05 = false;
    if (Number.isFinite(val['Q0.95'])) q95Acc += val['Q0.95'] * w; else hasQ95 = false;
  });

  if (wSum === 0) return {};
  return {
    mean: meanAcc / wSum,
    'Q0.05': hasQ05 ? q05Acc / wSum : undefined,
    'Q0.95': hasQ95 ? q95Acc / wSum : undefined,
    depthSpanCm: wSum
  };
}

/**
 * Consulta ISRIC SoilGrids v2.0 (prioriza OGC WCS en vivo ~1.4 s; respaldo REST 5 profundidades y zonal).
 */
async function fetchSoilGridsData(lat, lon) {
  const cacheKey = `soil:${lat.toFixed(3)},${lon.toFixed(3)}`;
  const cached = getFromCache(cacheKey);
  if (cached) return cached.ok ? cached.value : cached.fallback;

  try {
    const wcsResult = await fetchSoilGridsViaWcs(lat, lon);
    setInCache(cacheKey, { ok: true, value: wcsResult }, Number(process.env.CACHE_TTL_SUELO_MS) || 2592000000);
    return wcsResult;
  } catch (wcsErr) {
    // Fallback al endpoint REST cuando WCS no está disponible
  }

  try {
    const depths = 'depth=0-5cm&depth=5-15cm&depth=15-30cm&depth=30-60cm&depth=60-100cm';
    const url = `https://rest.isric.org/soilgrids/v2.0/properties/query?lon=${lon}&lat=${lat}&property=soc&property=wv0033&property=wv1500&property=sand&property=silt&property=clay&${depths}&value=mean&value=Q0.05&value=Q0.95`;
    const res = await fetch(url, { signal: AbortSignal.timeout(Number(process.env.SOILGRIDS_TIMEOUT_MS) || 4000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const layers = json.properties?.layers || [];

    const soc = integrateSoilGridsDepths(layers, 'soc');
    const fc = integrateSoilGridsDepths(layers, 'wv0033');
    const wp = integrateSoilGridsDepths(layers, 'wv1500');
    const sand = integrateSoilGridsDepths(layers, 'sand');
    const silt = integrateSoilGridsDepths(layers, 'silt');
    const clay = integrateSoilGridsDepths(layers, 'clay');

    if (!Number.isFinite(fc.mean) || !Number.isFinite(wp.mean)) {
      throw new Error('Píxel sin cobertura edáfica en SoilGrids');
    }

    const awMean = Math.max(45, Math.round(fc.mean - wp.mean));
    const awQ05 = Math.max(35, Math.round((fc['Q0.05'] || fc.mean * 0.75) - (wp['Q0.05'] || wp.mean * 0.75)));
    const awQ95 = Math.max(awMean + 10, Math.round((fc['Q0.95'] || fc.mean * 1.25) - (wp['Q0.95'] || wp.mean * 1.25)));
    const depthSpan = fc.depthSpanCm || 100;
    const sandPct = Math.round((sand.mean || 500) / 10);
    const siltPct = Math.round((silt.mean || 300) / 10);
    const clayPct = Math.max(0, 100 - sandPct - siltPct);
    const socMean = Number(((soc.mean || 184) / 10).toFixed(1));
    const regional = inferRegionalTaxonomyAndDepth(lat, lon, socMean, sandPct, siltPct, clayPct);

    const result = {
      modo: 'live_api',
      fuente: `ISRIC SoilGrids v2.0 REST API (250 m · perfil 0–${depthSpan} cm)`,
      taxonomia: `${regional.taxonomia} (0–${depthSpan} cm)`,
      textura: classifyUsdaTexture(sandPct, siltPct, clayPct),
      profundidad_util_cm: regional.profundidad_util_cm,
      soc_g_kg: {
        media: socMean,
        q05: Number(((soc['Q0.05'] || 121) / 10).toFixed(1)),
        q95: Number(((soc['Q0.95'] || 258) / 10).toFixed(1))
      },
      aw_mm_m: { media: awMean, q05: awQ05, q95: awQ95 },
      humedad_smap_inicial_pct: 62
    };

    setInCache(cacheKey, { ok: true, value: result }, Number(process.env.CACHE_TTL_SUELO_MS) || 2592000000);
    return result;
  } catch (err) {
    const fallbackObj = buildZonalSoilFallback(lat, lon);
    setInCache(cacheKey, { ok: false, fallback: fallbackObj }, 2 * 60 * 1000);
    return fallbackObj;
  }
}

/**
 * Decodifica un archivo binario NumPy (.npy) devuelto por Planetary Computer Titiler Raster API.
 */
function parseNpyBuffer(buf) {
  if (!buf || buf.length < 10) throw new Error('Buffer NPY inválido');
  const magic = buf.subarray(0, 6).toString('latin1');
  if (magic !== '\x93NUMPY') throw new Error('Firma NPY ausente');
  const major = buf[6];
  const headerLen = major >= 2 ? buf.readUInt32LE(8) : buf.readUInt16LE(8);
  const headerStart = major >= 2 ? 12 : 10;
  const headerStr = buf.subarray(headerStart, headerStart + headerLen).toString('latin1');
  const descrMatch = headerStr.match(/'descr':\s*'([^']+)'/);
  const shapeMatch = headerStr.match(/'shape':\s*\(([^)]+)\)/);
  if (!descrMatch || !shapeMatch) throw new Error('Cabecera NPY incompleta');

  const descr = descrMatch[1];
  const shape = shapeMatch[1].split(',').map((s) => Number(s.trim())).filter((n) => Number.isFinite(n) && n > 0);
  const offset = headerStart + headerLen;
  const total = shape.reduce((a, b) => a * b, 1);
  const data = new Float64Array(total);

  for (let i = 0; i < total; i++) {
    if (descr === '<u2') data[i] = buf.readUInt16LE(offset + i * 2);
    else if (descr === '<i2') data[i] = buf.readInt16LE(offset + i * 2);
    else if (descr === '<u4') data[i] = buf.readUInt32LE(offset + i * 4);
    else if (descr === '<f4') data[i] = buf.readFloatLE(offset + i * 4);
    else if (descr === '<f8') data[i] = buf.readDoubleLE(offset + i * 8);
    else if (descr === '|u1' || descr === '<u1') data[i] = buf.readUInt8(offset + i);
    else throw new Error(`Formato NPY no soportado: ${descr}`);
  }
  return { shape, data, descr };
}

function classifySclCode(scl) {
  switch (Math.round(scl)) {
    case 4: return { code: 4, es: 'Vegetación activa', en: 'Active vegetation' };
    case 5: return { code: 5, es: 'Suelo desnudo / rastrojo', en: 'Bare soil / stubble' };
    case 6: return { code: 6, es: 'Agua superficial', en: 'Surface water' };
    case 7: return { code: 7, es: 'Vegetación baja / no clasificada', en: 'Low cover / unclassified' };
    case 3: return { code: 3, es: 'Sombra de nube', en: 'Cloud shadow' };
    case 8:
    case 9:
    case 10: return { code: Math.round(scl), es: 'Nubosidad / cirrus', en: 'Cloud / cirrus' };
    case 11: return { code: 11, es: 'Nieve / hielo', en: 'Snow / ice' };
    default: return { code: Math.round(scl), es: 'Mixto / suelo agrícola', en: 'Mixed agricultural surface' };
  }
}

/**
 * Deduce un diagnóstico agronómico objetivo desde las métricas satelitales reales observadas
 * (sin forzar cultivos predefinidos en el mapa).
 */
function inferObservedSatelliteSummary(meanNdvi, meanNdmi, vegSharePct, bareSharePct, cloudSharePct, obsDateStr) {
  const dateLabel = obsDateStr || 'reciente';
  if (cloudSharePct >= 55) {
    return {
      statusCode: 'cloudy',
      title_es: `Nubosidad parcial en la última pasada (${dateLabel})`,
      title_en: `Partial cloud cover in latest pass (${dateLabel})`,
      desc_es: `El ${cloudSharePct}% de las celdas del polígono presenta nube o sombra SCL. Se recomienda confirmar visualmente o seleccionar manualmente el estado inicial si necesitás simulación inmediata.`,
      desc_en: `${cloudSharePct}% of parcel pixels contain SCL cloud/shadow. Verify visually or select a manual initial crop state if immediate simulation is needed.`,
      residueCoverPct: 50,
      initN_kgHa: 35,
      cnRatio: 30,
      pestCarryover: 1.0
    };
  }
  if (meanNdvi < 0.22) {
    return {
      statusCode: 'bare_or_stubble',
      title_es: `Suelo desnudo o rastrojo seco observado (${dateLabel})`,
      title_en: `Bare soil or dry residue observed (${dateLabel})`,
      desc_es: `Sentinel-2 detecta muy baja actividad fotosintética (NDVI ${meanNdvi.toFixed(2)}, NDMI ${meanNdmi.toFixed(2)}, ${bareSharePct}% píxeles sin canopeo verde). Coincide con barbecho, suelo recién laboreado o rastrojo seco.`,
      desc_en: `Sentinel-2 observes minimal green canopy (NDVI ${meanNdvi.toFixed(2)}, NDMI ${meanNdmi.toFixed(2)}, ${bareSharePct}% non-vegetated pixels). Matches fallow, tilled soil, or dry stubble.`,
      residueCoverPct: meanNdvi < 0.16 ? 18 : 42,
      initN_kgHa: 30,
      cnRatio: 38,
      pestCarryover: 1.0
    };
  }
  if (meanNdvi < 0.42) {
    return {
      statusCode: 'low_emergence',
      title_es: `Emergencia temprana / rastrojo mixto observado (${dateLabel})`,
      title_en: `Early emergence / mixed residue observed (${dateLabel})`,
      desc_es: `Sentinel-2 registra vigor inicial bajo-moderado (NDVI ${meanNdvi.toFixed(2)}, NDMI ${meanNdmi.toFixed(2)}, ${vegSharePct}% píxeles vegetados). Compatible con cultivo en emergencia, cobertura rala o senescencia.`,
      desc_en: `Sentinel-2 sees low-to-moderate greenness (NDVI ${meanNdvi.toFixed(2)}, NDMI ${meanNdmi.toFixed(2)}, ${vegSharePct}% vegetated pixels). Consistent with emerging crop, thin cover, or senescence.`,
      residueCoverPct: 62,
      initN_kgHa: 36,
      cnRatio: 34,
      pestCarryover: 0.95
    };
  }
  if (meanNdvi < 0.65) {
    return {
      statusCode: 'active_canopy',
      title_es: `Cobertura o cultivo en crecimiento activo (${dateLabel})`,
      title_en: `Active growing canopy / cover (${dateLabel})`,
      desc_es: `Sentinel-2 observa vegetación activa cubriendo la parcela (NDVI ${meanNdvi.toFixed(2)}, NDMI ${meanNdmi.toFixed(2)}, ${vegSharePct}% píxeles vegetados). Buena intercepción de radiación y protección superficial.`,
      desc_en: `Sentinel-2 detects active green vegetation across the parcel (NDVI ${meanNdvi.toFixed(2)}, NDMI ${meanNdmi.toFixed(2)}, ${vegSharePct}% vegetated pixels). Solid light interception and soil shielding.`,
      residueCoverPct: 78,
      initN_kgHa: 45,
      cnRatio: 26,
      pestCarryover: 0.9
    };
  }
  return {
    statusCode: 'peak_vigor',
    title_es: `Canopeo denso en plenitud fotosintética (${dateLabel})`,
    title_en: `Dense canopy at peak photosynthetic vigor (${dateLabel})`,
    desc_es: `Sentinel-2 mide vigor vegetativo pleno en el lote (NDVI ${meanNdvi.toFixed(2)}, NDMI ${meanNdmi.toFixed(2)}, ${vegSharePct}% píxeles vegetados). Alta transpiración actual y máxima cobertura protectora.`,
    desc_en: `Sentinel-2 measures full canopy vigor across the field (NDVI ${meanNdvi.toFixed(2)}, NDMI ${meanNdmi.toFixed(2)}, ${vegSharePct}% vegetated pixels). High current transpiration and full soil shield.`,
    residueCoverPct: 90,
    initN_kgHa: 55,
    cnRatio: 24,
    pestCarryover: 0.85
  };
}

/**
 * Consulta en vivo la última imagen Sentinel-2 L2A libre de nubes (Planetary Computer STAC + Raster NPY),
 * extrae matriz real de NDVI / NDMI / reflectancias B04-B08-B11 / clasificación SCL para la parcela,
 * y reconstruye la serie reciente observada en el centroide del lote.
 */
async function fetchSatellitePlotState({ lat, lon, bbox, rows = 6, cols = 7 } = {}) {
  const safeLat = Number(lat);
  const safeLon = Number(lon);
  const box = Array.isArray(bbox) && bbox.length === 4 && bbox.every(Number.isFinite)
    ? bbox
    : [safeLon - 0.0022, safeLat - 0.0014, safeLon + 0.0022, safeLat + 0.0014];

  const bboxKey = box.map((v) => v.toFixed(4)).join(',');
  const cacheKey = `sat:${bboxKey}:${rows}x${cols}`;
  const cached = getFromCache(cacheKey);
  if (cached) return cached;

  try {
    // 1. Buscar las últimas escenas Sentinel-2 L2A sobre la parcela (<35% nube)
    const searchBody = {
      collections: ['sentinel-2-l2a'],
      intersects: { type: 'Point', coordinates: [safeLon, safeLat] },
      query: { 'eo:cloud_cover': { lt: 35 } },
      sortby: [{ field: 'properties.datetime', direction: 'desc' }],
      limit: 6
    };

    let stacRes = await fetch('https://planetarycomputer.microsoft.com/api/stac/v1/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(searchBody),
      signal: AbortSignal.timeout(4500)
    });
    let stacJson = stacRes.ok ? await stacRes.json() : null;
    let features = Array.isArray(stacJson?.features) ? stacJson.features : [];

    // Reintentar con umbral más permisivo si ninguna escena estuvo debajo de 35%
    if (features.length === 0) {
      searchBody.query = { 'eo:cloud_cover': { lt: 80 } };
      stacRes = await fetch('https://planetarycomputer.microsoft.com/api/stac/v1/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(searchBody),
        signal: AbortSignal.timeout(4000)
      });
      stacJson = stacRes.ok ? await stacRes.json() : null;
      features = Array.isArray(stacJson?.features) ? stacJson.features : [];
    }

    if (features.length === 0) {
      throw new Error('Sin escenas Sentinel-2 L2A recientes en Planetary Computer');
    }

    // Preferir la escena más reciente con <20% de nubes si existe entre las primeras 3
    const latest = features.slice(0, 3).find((f) => Number(f.properties?.['eo:cloud_cover']) < 20) || features[0];
    const itemId = latest.id;
    const obsIso = latest.properties?.datetime || '';
    const obsDate = obsIso.slice(0, 10);
    const cloudPctScene = Number((latest.properties?.['eo:cloud_cover'] ?? 0).toFixed(1));
    const baselineNum = parseFloat(latest.properties?.['s2:processing_baseline'] || '0');
    const boaOffset = baselineNum >= 4.0 ? 1000 : 0;

    // 2. Descargar grilla real B04 (Red), B08 (NIR), B11 (SWIR1) y SCL + historial puntual en paralelo
    const npyUrl =
      `https://planetarycomputer.microsoft.com/api/data/v1/item/bbox/${bboxKey}/${cols}x${rows}.npy` +
      `?collection=sentinel-2-l2a&item=${encodeURIComponent(itemId)}&assets=B04&assets=B08&assets=B11&assets=SCL`;

    const historyItems = features.slice(0, 4);
    const [npyRes, ...pointResults] = await Promise.allSettled([
      fetch(npyUrl, { signal: AbortSignal.timeout(5500) }).then(async (r) => {
        if (!r.ok) throw new Error(`Raster NPY HTTP ${r.status}`);
        return Buffer.from(await r.arrayBuffer());
      }),
      ...historyItems.map((it) => {
        const ptUrl =
          `https://planetarycomputer.microsoft.com/api/data/v1/item/point/${safeLon},${safeLat}` +
          `?collection=sentinel-2-l2a&item=${encodeURIComponent(it.id)}&assets=B04&assets=B08&assets=B11&assets=SCL`;
        return fetch(ptUrl, { signal: AbortSignal.timeout(3500) }).then(async (r) => {
          if (!r.ok) return null;
          const pj = await r.json();
          const vals = pj.values || [];
          const itBase = parseFloat(it.properties?.['s2:processing_baseline'] || '0');
          const itOff = itBase >= 4.0 ? 1000 : 0;
          const rVal = Math.max(0.001, (Number(vals[0]) - itOff) / 10000);
          const nVal = Math.max(0.001, (Number(vals[1]) - itOff) / 10000);
          const sVal = Math.max(0.001, (Number(vals[2]) - itOff) / 10000);
          const sclVal = Number(vals[3] ?? 0);
          if (!Number.isFinite(rVal) || !Number.isFinite(nVal) || Number(vals[0]) === 0) return null;
          return {
            itemId: it.id,
            date: (it.properties?.datetime || '').slice(0, 10),
            cloudPct: Number((it.properties?.['eo:cloud_cover'] ?? 0).toFixed(1)),
            ndvi: Number(clampVal((nVal - rVal) / (nVal + rVal), -0.2, 0.95).toFixed(2)),
            ndmi: Number(clampVal((nVal - sVal) / (nVal + sVal), -0.8, 0.85).toFixed(2)),
            scl: Math.round(sclVal)
          };
        });
      })
    ]);

    if (npyRes.status !== 'fulfilled') {
      throw new Error(npyRes.reason?.message || 'Error descargando bandas Sentinel-2');
    }

    const parsed = parseNpyBuffer(npyRes.value);
    const nRows = parsed.shape[1] || rows;
    const nCols = parsed.shape[2] || cols;
    const planeSize = nRows * nCols;

    // El grid del mapa recorre r = 0 (Sur/minY) .. rows-1 (Norte/maxY); el .npy viene row 0 = Norte
    const cells = [];
    let ndviSum = 0;
    let ndmiSum = 0;
    let validCount = 0;
    let vegCount = 0;
    let bareCount = 0;
    let cloudCellCount = 0;

    for (let mapR = 0; mapR < nRows; mapR++) {
      const npyR = nRows - 1 - mapR;
      const rowArr = [];
      for (let c = 0; c < nCols; c++) {
        const idx = npyR * nCols + c;
        const dnB04 = parsed.data[0 * planeSize + idx];
        const dnB08 = parsed.data[1 * planeSize + idx];
        const dnB11 = parsed.data[2 * planeSize + idx];
        const sclCode = Math.round(parsed.data[3 * planeSize + idx]);
        const maskVal = parsed.shape[0] >= 5 ? parsed.data[4 * planeSize + idx] : 255;

        const red = Number(Math.max(0.001, (dnB04 - boaOffset) / 10000).toFixed(3));
        const nir = Number(Math.max(0.001, (dnB08 - boaOffset) / 10000).toFixed(3));
        const swir1 = Number(Math.max(0.001, (dnB11 - boaOffset) / 10000).toFixed(3));
        const ndvi = Number(clampVal((nir - red) / (nir + red), -0.1, 0.92).toFixed(2));
        const ndmi = Number(clampVal((nir - swir1) / (nir + swir1), -0.7, 0.82).toFixed(2));
        const sclInfo = classifySclCode(sclCode);

        if (maskVal > 0 && (dnB04 > 0 || dnB08 > 0)) {
          ndviSum += ndvi;
          ndmiSum += ndmi;
          validCount++;
          if (sclCode === 4) vegCount++;
          else if (sclCode === 5 || sclCode === 7) bareCount++;
          else if (sclCode === 3 || sclCode === 8 || sclCode === 9 || sclCode === 10) cloudCellCount++;
        }

        rowArr.push({
          ndvi,
          ndmi,
          red,
          nir,
          swir1,
          scl: sclCode,
          sclLabel_es: sclInfo.es,
          sclLabel_en: sclInfo.en
        });
      }
      cells.push(rowArr);
    }

    const meanNdvi = validCount > 0 ? Number((ndviSum / validCount).toFixed(2)) : 0.25;
    const meanNdmi = validCount > 0 ? Number((ndmiSum / validCount).toFixed(2)) : 0.0;
    const vegSharePct = validCount > 0 ? Math.round((vegCount / validCount) * 100) : 0;
    const bareSharePct = validCount > 0 ? Math.round((bareCount / validCount) * 100) : 0;
    const cloudSharePct = validCount > 0 ? Math.round((cloudCellCount / validCount) * 100) : 0;

    const history = pointResults
      .filter((r) => r.status === 'fulfilled' && r.value)
      .map((r) => r.value)
      .sort((a, b) => a.date.localeCompare(b.date));

    const summary = inferObservedSatelliteSummary(meanNdvi, meanNdmi, vegSharePct, bareSharePct, cloudSharePct, obsDate);

    const satData = {
      modo: 'live_sentinel2',
      fuente: 'Microsoft Planetary Computer · ESA Sentinel-2 L2A (10 m/20 m)',
      itemId,
      baseline: latest.properties?.['s2:processing_baseline'] || 'N/A',
      date: obsDate,
      datetime: obsIso,
      cloudPct: cloudPctScene,
      rows: nRows,
      cols: nCols,
      meanNdvi,
      meanNdmi,
      vegSharePct,
      bareSharePct,
      cloudSharePct,
      summary,
      cells,
      history
    };

    setInCache(cacheKey, satData, Number(process.env.CACHE_TTL_SAT_MS) || 1800000);
    return satData;
  } catch (err) {
    return {
      modo: 'fallback_offline',
      fuente: 'Estimación paramétrica local (sin escena Sentinel-2 en vivo)',
      error: err.message,
      date: null,
      cloudPct: null,
      meanNdvi: null,
      meanNdmi: null,
      cells: null,
      history: []
    };
  }
}

/**
 * Consulta la serie diaria de NASA POWER (T2M_MAX, T2M_MIN) con caché de 7 días por celda
 * para calcular días de calor (>35 °C) y de helada (<0 °C) mediante curvas de excedencia empíricas.
 */
async function fetchNasaPowerExtremes(lat, lon) {
  const cellKey = `power-ext:${(Math.round(lat / 0.5) * 0.5).toFixed(1)},${(Math.round(lon / 0.625) * 0.625).toFixed(3)}`;
  const cached = getFromCache(cellKey);
  if (cached) return cached.ok ? cached.value : null;

  try {
    const years = Number(process.env.POWER_EXTREMES_YEARS) || 20;
    const endYear = new Date().getFullYear() - 1;
    const startYear = endYear - years + 1;
    const url =
      `https://power.larc.nasa.gov/api/temporal/daily/point?parameters=T2M_MAX,T2M_MIN&community=AG` +
      `&longitude=${lon}&latitude=${lat}&start=${startYear}0101&end=${endYear}1231&format=JSON`;
    const res = await fetch(url, { signal: AbortSignal.timeout(Number(process.env.POWER_DAILY_TIMEOUT_MS) || 4500) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const p = json.properties.parameter;
    const ext = extremesModel.buildExtremes(p.T2M_MAX, p.T2M_MIN);
    if (!ext) throw new Error('serie diaria insuficiente');
    ext.fuente = `NASA POWER serie diaria ${ext.anios[0]}–${ext.anios[1]} (T2M_MAX, T2M_MIN)`;
    setInCache(cellKey, { ok: true, value: ext }, Number(process.env.CACHE_TTL_EXTREMOS_MS) || 7 * 24 * 3600 * 1000);
    return ext;
  } catch (err) {
    setInCache(cellKey, { ok: false }, 5 * 60 * 1000);
    return null;
  }
}

async function getEnvironmentalContext(lat, lon, options = {}) {
  const moisture = await fetchRecentMoistureAndElevation(lat, lon);
  const [georef, climaBase, sueloBase, extremos] = await Promise.all([
    fetchGeorefLocation(lat, lon),
    fetchNasaPowerClimate(lat, lon, moisture.altitud_m),
    fetchSoilGridsData(lat, lon),
    fetchNasaPowerExtremes(lat, lon)
  ]);

  const clima = extremos
    ? {
        ...climaBase,
        extremos,
        dias_calor_35c: extremos.calor.dias_anual_35,
        dias_helada_0c: extremos.helada.dias_anual_0,
        extremos_fuente: extremos.fuente
      }
    : { ...climaBase, extremos_fuente: 'modelo normal calibrado sobre clima histórico (respaldo)' };

  const suelo = {
    ...sueloBase,
    humedad_smap_inicial_pct: moisture.humedad_smap_inicial_pct,
    humedad_volumetrica_m3: moisture.humedad_volumetrica_m3,
    humedad_superficial_pct: moisture.humedad_superficial_pct,
    humedad_fuente: moisture.fuente,
    humedad_modo: moisture.modo,
    humedad_fecha: moisture.fecha_dato,
    lluvia_ultimos_30d_mm: moisture.lluvia_ultimos_30d_mm
  };

  const isLocalMagyp = georef.es_argentina !== false && (isNearGuamini(lat, lon) || /buenos aires|la pampa|córdoba|santa fe/i.test(georef.provincia || ''));
  const estadisticas_magyp = {
    ...FALLBACK_DATA.estadisticas_magyp,
    es_local: isLocalMagyp,
    ambito_es: isLocalMagyp
      ? FALLBACK_DATA.estadisticas_magyp.fuente
      : 'Curva de calibración de referencia pampeana (Guaminí · MAGyP)',
    ambito_en: isLocalMagyp
      ? 'Regional 10-year district statistics (Guaminí · MAGyP)'
      : 'Pampean calibration reference curve (Guaminí benchmark · outside local district)'
  };

  const satellite = options.includeSatellite
    ? await fetchSatellitePlotState({ lat, lon, bbox: options.bbox, rows: options.rows, cols: options.cols })
    : undefined;

  return {
    georef,
    clima,
    suelo,
    estadisticas_magyp,
    ...(satellite ? { satellite } : {})
  };
}

/**
 * Estados Iniciales y Cultivos de Partida del Lote (Paso 1).
 * Incluye observación satelital real en vivo + 14 estados agronómicos opcionales.
 */
function getInitialFieldStates() {
  return [
    {
      id: 'satelite_actual',
      group: 'satelite',
      category_es: '📡 Observación Satelital Actual (Sin cultivo predefinido)',
      category_en: '📡 Live Satellite Field Observation (Auto-detected)',
      name_es: '📡 Usar observación actual del satélite (Sentinel-2 + NASA humedad)',
      name_en: '📡 Use live satellite observation (Sentinel-2 + NASA moisture)',
      baseNdvi: 0.25,
      ndviSpatialPattern: 'satellite_real',
      initMoisturePct: 62,
      residueCoverPct: 50,
      initN_kgHa: 36,
      cnRatio: 32,
      pestCarryover: 0.95,
      desc_es: 'Lee la última escena Sentinel-2 L2A sin nubes y la humedad radicular reciente (NASA POWER / Open-Meteo) directamente sobre tu polígono, sin imponer un cultivo predefinido.',
      desc_en: 'Reads the latest cloud-free Sentinel-2 L2A imagery and recent NASA/Open-Meteo root-zone moisture directly over your drawn polygon without forcing a preset crop.'
    },
    {
      id: 'soja_1ra',
      group: 'estival',
      category_es: 'Cultivos Estivales en Curso',
      category_en: 'Active Summer Cash Crops',
      name_es: 'Soja de 1ra (llenado / cosecha mar–abr)',
      name_en: '1st-Crop Soybean (grain fill / harvest Mar–Apr)',
      baseNdvi: 0.68,
      ndviSpatialPattern: 'headland_stress',
      initMoisturePct: 62,
      residueCoverPct: 55,
      initN_kgHa: 42,
      cnRatio: 22,
      pestCarryover: 1.0,
      desc_es: 'Lote saliendo de soja temprana. Rastrojo de rápida descomposición (C:N = 22:1), nitrógeno superficial moderado y alta necesidad de cobertura invernal para evitar erosión.',
      desc_en: 'Plot exiting early soybean. Fast-decomposing residue (C:N = 22:1), moderate topsoil N, high need for winter cover to prevent erosion.'
    },
    {
      id: 'soja_2da',
      group: 'estival',
      category_es: 'Cultivos Estivales en Curso',
      category_en: 'Active Summer Cash Crops',
      name_es: 'Soja de 2da sobre trigo (cosecha abr–may)',
      name_en: '2nd-Crop Soybean over wheat (harvest Apr–May)',
      baseNdvi: 0.62,
      ndviSpatialPattern: 'headland_stress',
      initMoisturePct: 54,
      residueCoverPct: 70,
      initN_kgHa: 38,
      cnRatio: 28,
      pestCarryover: 0.95,
      desc_es: 'Doble cultivo reciente. Conserva rastrojo mixto trigo+soja (70% cobertura), pero arranca con menor humedad residual (-8%) tras dos cultivos continuos.',
      desc_en: 'Recent double crop. Keeps mixed wheat+soy stubble (70% cover), starts with lower residual moisture (-8%) after two back-to-back crops.'
    },
    {
      id: 'maiz_temprano',
      group: 'estival',
      category_es: 'Cultivos Estivales en Curso',
      category_en: 'Active Summer Cash Crops',
      name_es: 'Maíz temprano (madurez / cosecha mar)',
      name_en: 'Early Maize (maturity / harvest Mar)',
      baseNdvi: 0.58,
      ndviSpatialPattern: 'headland_stress',
      initMoisturePct: 58,
      residueCoverPct: 85,
      initN_kgHa: 28,
      cnRatio: 55,
      pestCarryover: 0.9,
      desc_es: 'Deja abundante rastrojo carbonado (85% cobertura, C:N = 55:1) que frena la erosión e inmoviliza nitrógeno temporalmente.',
      desc_en: 'Leaves abundant high-carbon stover (85% cover, C:N = 55:1) protecting topsoil while temporarily immobilizing mineral N.'
    },
    {
      id: 'maiz_tardio',
      group: 'estival',
      category_es: 'Cultivos Estivales en Curso',
      category_en: 'Active Summer Cash Crops',
      name_es: 'Maíz tardío (floración / cosecha jun)',
      name_en: 'Late Maize (flowering / harvest Jun)',
      baseNdvi: 0.78,
      ndviSpatialPattern: 'uniform',
      initMoisturePct: 55,
      residueCoverPct: 80,
      initN_kgHa: 35,
      cnRatio: 52,
      pestCarryover: 0.9,
      desc_es: 'Canopeo de alto vigor estival tardío (NDVI 0,78). Demora la ventana de siembra invernal hasta junio–julio.',
      desc_en: 'High-vigor late summer canopy (NDVI 0.78). Delays winter sowing window until June–July.'
    },
    {
      id: 'sorgo_granifero',
      group: 'estival',
      category_es: 'Cultivos Estivales en Curso',
      category_en: 'Active Summer Cash Crops',
      name_es: 'Sorgo granífero / forrajero (rastrojo denso)',
      name_en: 'Grain / Forage Sorghum (dense residue)',
      baseNdvi: 0.66,
      ndviSpatialPattern: 'uniform',
      initMoisturePct: 64,
      residueCoverPct: 85,
      initN_kgHa: 30,
      cnRatio: 50,
      pestCarryover: 0.85,
      desc_es: 'Excelente aporte de raíces fibrosas en profundidad y rastrojo persistente con mayor humedad residual.',
      desc_en: 'Strong deep fibrous root mass and persistent residue with favorable soil moisture.'
    },
    {
      id: 'girasol',
      group: 'estival',
      category_es: 'Cultivos Estivales en Curso',
      category_en: 'Active Summer Cash Crops',
      name_es: 'Girasol (cosecha feb–mar · rastrojo medio)',
      name_en: 'Sunflower (harvest Feb–Mar · medium residue)',
      baseNdvi: 0.38,
      ndviSpatialPattern: 'patchy',
      initMoisturePct: 60,
      residueCoverPct: 40,
      initN_kgHa: 34,
      cnRatio: 45,
      pestCarryover: 1.05,
      desc_es: 'Cosecha temprana que libera el lote en febrero, permitiendo siembra anticipada de vicia/centeno o trigo.',
      desc_en: 'Early harvest frees the plot in February, enabling early cover crop or winter cereal establishment.'
    },
    {
      id: 'mani',
      group: 'estival',
      category_es: 'Cultivos Estivales en Curso',
      category_en: 'Active Summer Cash Crops',
      name_es: 'Maní arrancado (suelo removido · alta vulnerabilidad)',
      name_en: 'Harvested Peanut (disturbed soil · high erosion risk)',
      baseNdvi: 0.24,
      ndviSpatialPattern: 'low_bare',
      initMoisturePct: 56,
      residueCoverPct: 22,
      initN_kgHa: 48,
      cnRatio: 20,
      pestCarryover: 1.1,
      desc_es: 'El arrancado deja el suelo muy suelto con <25% cobertura. Exige implante inmediato de centeno para evitar voladuras.',
      desc_en: 'Digging leaves loose topsoil with <25% cover. Requires immediate rye cover establishment to prevent wind erosion.'
    },
    {
      id: 'trigo_rastrojo',
      group: 'invernal_perenne',
      category_es: 'Rastrojos Invernales, Coberturas y Pasturas',
      category_en: 'Winter Stubble, Covers & Pastures',
      name_es: 'Rastrojo de Trigo / Cebada (post-cosecha dic)',
      name_en: 'Wheat / Barley Stubble (post-harvest Dec)',
      baseNdvi: 0.28,
      ndviSpatialPattern: 'patchy',
      initMoisturePct: 68,
      residueCoverPct: 78,
      initN_kgHa: 32,
      cnRatio: 65,
      pestCarryover: 0.85,
      desc_es: 'Lote cubierto por rastrojo denso de cereal invernal y alta eficiencia de captación de lluvias de verano.',
      desc_en: 'Plot protected by dense winter cereal stubble with high summer rainfall infiltration.'
    },
    {
      id: 'cobertura_vicia_centeno',
      group: 'invernal_perenne',
      category_es: 'Rastrojos Invernales, Coberturas y Pasturas',
      category_en: 'Winter Stubble, Covers & Pastures',
      name_es: 'Cobertura viva activa (Vicia + Centeno)',
      name_en: 'Active Living Cover (Vetch + Rye)',
      baseNdvi: 0.76,
      ndviSpatialPattern: 'uniform',
      initMoisturePct: 65,
      residueCoverPct: 92,
      initN_kgHa: 95,
      cnRatio: 24,
      pestCarryover: 0.75,
      desc_es: 'Máxima protección edáfica y aporte biológico de nitrógeno activo en superficie.',
      desc_en: 'Maximum topsoil protection and active biological nitrogen fixation.'
    },
    {
      id: 'pastura_alfalfa',
      group: 'invernal_perenne',
      category_es: 'Rastrojos Invernales, Coberturas y Pasturas',
      category_en: 'Winter Stubble, Covers & Pastures',
      name_es: 'Pastura consociada activa (Alfalfa + Festuca)',
      name_en: 'Active Perennial Pasture (Alfalfa + Fescue)',
      baseNdvi: 0.82,
      ndviSpatialPattern: 'uniform',
      initMoisturePct: 70,
      residueCoverPct: 95,
      initN_kgHa: 120,
      cnRatio: 18,
      pestCarryover: 0.65,
      desc_es: 'Lote en rotación ganadero-agrícola con alta macroporosidad, máxima infiltración y balance positivo de carbono.',
      desc_en: 'Integrated pasture plot with deep biopores, top infiltration, and positive carbon balance.'
    },
    {
      id: 'campo_natural',
      group: 'invernal_perenne',
      category_es: 'Rastrojos Invernales, Coberturas y Pasturas',
      category_en: 'Winter Stubble, Covers & Pastures',
      name_es: 'Campo natural / Pastizal pampeano heterogéneo',
      name_en: 'Native Grassland / Heterogeneous Pampas Pasture',
      baseNdvi: 0.60,
      ndviSpatialPattern: 'wet_lowland',
      initMoisturePct: 66,
      residueCoverPct: 88,
      initN_kgHa: 55,
      cnRatio: 32,
      pestCarryover: 0.70,
      desc_es: 'Lote con gradientes micro-topográficos entre loma y bajo húmedo; referencia ecológica de suelo estructurado.',
      desc_en: 'Plot with natural micro-topographic moisture gradients; ecological benchmark for soil structure.'
    },
    {
      id: 'barbecho_rastrojo',
      group: 'barbecho_critico',
      category_es: 'Barbechos y Estados Críticos de Suelo',
      category_en: 'Fallows & Critical Soil States',
      name_es: 'Barbecho químico con rastrojo denso (>60% cubierto)',
      name_en: 'Chemical Fallow with dense stubble (>60% cover)',
      baseNdvi: 0.22,
      ndviSpatialPattern: 'patchy',
      initMoisturePct: 74,
      residueCoverPct: 75,
      initN_kgHa: 46,
      cnRatio: 50,
      pestCarryover: 0.90,
      desc_es: 'Suelo sin cultivo vivo (NDVI ~0,22), pero protegido por rastrojo seco (NDTI alto) y perfil recargado al 74%.',
      desc_en: 'No living canopy (NDVI ~0.22), but shielded by dry stubble (high NDTI) and recharged moisture (74%).'
    },
    {
      id: 'barbecho_desnudo',
      group: 'barbecho_critico',
      category_es: 'Barbechos y Estados Críticos de Suelo',
      category_en: 'Fallows & Critical Soil States',
      name_es: 'Barbecho desnudo / Labranza convencional (<15% rastrojo)',
      name_en: 'Bare Soil Fallow / Conventional Tillage (<15% residue)',
      baseNdvi: 0.13,
      ndviSpatialPattern: 'low_bare',
      initMoisturePct: 50,
      residueCoverPct: 12,
      initN_kgHa: 26,
      cnRatio: 30,
      pestCarryover: 1.10,
      desc_es: 'Alerta roja: suelo expuesto directamente a lluvia y viento (NDVI 0,13). Alta pérdida por escorrentía y voladura.',
      desc_en: 'Red alert: bare exposed soil (NDVI 0.13). Severe runoff, crusting, and wind erosion exposure.'
    },
    {
      id: 'lote_degradado',
      group: 'barbecho_critico',
      category_es: 'Barbechos y Estados Críticos de Suelo',
      category_en: 'Fallows & Critical Soil States',
      name_es: 'Lote degradado por monocultivo continuo (suelo planchado)',
      name_en: 'Degraded Continuous-Monocropping Plot (crusted topsoil)',
      baseNdvi: 0.16,
      ndviSpatialPattern: 'low_bare',
      initMoisturePct: 48,
      residueCoverPct: 20,
      initN_kgHa: 22,
      cnRatio: 22,
      pestCarryover: 1.25,
      desc_es: 'Baja materia orgánica, escasa infiltración, encostramiento superficial y alta presión de malezas resistentes.',
      desc_en: 'Depleted organic matter, surface crusting, reduced infiltration, and elevated herbicide-resistant weed pressure.'
    }
  ];
}

/**
 * Catálogo completo de cultivos estacionales para el Constructor de Estrategias (Otoño-Invierno y Primavera-Verano).
 */
function getSeasonCropsCatalog() {
  return {
    winter: [
      { id: 'barbecho_desnudo', name_es: 'Barbecho desnudo (sin cobertura)', name_en: 'Bare fallow (no cover)', stageType: 'bare', kc: 0.22, ndvi: 0.14, nFix: 0, nLeach: 7, cn: 25, socDeltaYear: -0.20, factorC: 0.44, pestBreak: 0.25, costHa: 45, revHa: 0, thermalTol: 0.55, waterUseFactor: 0.50 },
      { id: 'barbecho_rastrojo', name_es: 'Barbecho químico c/ rastrojo', name_en: 'Chemical fallow w/ stubble', stageType: 'stubble', kc: 0.28, ndvi: 0.22, nFix: 0, nLeach: 4, cn: 50, socDeltaYear: -0.05, factorC: 0.22, pestBreak: 0.45, costHa: 40, revHa: 0, thermalTol: 0.65, waterUseFactor: 0.55 },
      { id: 'vicia_villosa', name_es: 'Vicia villosa (Cobertura N)', name_en: 'Hairy Vetch (N Cover)', stageType: 'cover', kc: 0.62, ndvi: 0.72, nFix: 118, nLeach: 1, cn: 15, socDeltaYear: 0.14, factorC: 0.10, pestBreak: 0.78, costHa: 85, revHa: 0, thermalTol: 0.72, waterUseFactor: 0.85 },
      { id: 'centeno_cobertura', name_es: 'Centeno (Cobertura carbono/malezas)', name_en: 'Cereal Rye (Carbon/Weed cover)', stageType: 'cover', kc: 0.58, ndvi: 0.68, nFix: 0, nLeach: 1, cn: 44, socDeltaYear: 0.18, factorC: 0.08, pestBreak: 0.80, costHa: 75, revHa: 0, thermalTol: 0.78, waterUseFactor: 0.80 },
      { id: 'centeno_vicia', name_es: 'Centeno + Vicia villosa (Consociada)', name_en: 'Rye + Vetch Mix (Cover)', stageType: 'cover', kc: 0.68, ndvi: 0.76, nFix: 92, nLeach: 1, cn: 26, socDeltaYear: 0.24, factorC: 0.07, pestBreak: 0.84, costHa: 95, revHa: 0, thermalTol: 0.78, waterUseFactor: 0.90 },
      { id: 'avena_cobertura', name_es: 'Avena blanca / negra (Cobertura/Verdeo)', name_en: 'Oats (Cover / Forage)', stageType: 'cover', kc: 0.64, ndvi: 0.70, nFix: 0, nLeach: 1, cn: 38, socDeltaYear: 0.16, factorC: 0.09, pestBreak: 0.75, costHa: 78, revHa: 90, thermalTol: 0.74, waterUseFactor: 0.88 },
      { id: 'nabo_forrajero', name_es: 'Nabo forrajero (Crucífera descompactadora)', name_en: 'Forage Radish (Bio-driller)', stageType: 'cover', kc: 0.66, ndvi: 0.71, nFix: 0, nLeach: 1, cn: 19, socDeltaYear: 0.15, factorC: 0.11, pestBreak: 0.88, costHa: 80, revHa: 0, thermalTol: 0.70, waterUseFactor: 0.86 },
      { id: 'trigo_pan', name_es: 'Trigo pan (Cereal de renta)', name_en: 'Bread Wheat (Cash grain)', stageType: 'commercial', kc: 0.85, ndvi: 0.77, nFix: 0, nLeach: 3, cn: 65, socDeltaYear: 0.12, factorC: 0.12, pestBreak: 0.72, costHa: 250, revHa: 495, thermalTol: 0.68, waterUseFactor: 1.05 },
      { id: 'cebada_cervecera', name_es: 'Cebada cervecera (Ciclo corto)', name_en: 'Malting Barley (Short winter grain)', stageType: 'commercial', kc: 0.82, ndvi: 0.75, nFix: 0, nLeach: 3, cn: 60, socDeltaYear: 0.11, factorC: 0.12, pestBreak: 0.74, costHa: 235, revHa: 470, thermalTol: 0.70, waterUseFactor: 0.98 },
      { id: 'arveja_invernal', name_es: 'Arveja invernal (Leguminosa grano)', name_en: 'Field Pea (Grain legume)', stageType: 'commercial', kc: 0.74, ndvi: 0.69, nFix: 65, nLeach: 2, cn: 18, socDeltaYear: 0.08, factorC: 0.16, pestBreak: 0.82, costHa: 210, revHa: 420, thermalTol: 0.62, waterUseFactor: 0.90 },
      { id: 'pastura_inv', name_es: 'Alfalfa + Festuca (Perenne Invierno)', name_en: 'Alfalfa + Fescue (Winter Perennial)', stageType: 'cover', kc: 0.84, ndvi: 0.81, nFix: 110, nLeach: 1, cn: 20, socDeltaYear: 0.28, factorC: 0.05, pestBreak: 0.90, costHa: 160, revHa: 280, thermalTol: 0.82, waterUseFactor: 1.10 }
    ],
    summer: [
      { id: 'soja_1ra', name_es: 'Soja 1ra', name_en: '1st-Crop Soybean', stageType: 'commercial', kc: 0.98, ndvi: 0.75, nFix: 65, nLeach: 3, cn: 22, socDeltaYear: -0.04, factorC: 0.18, pestBreak: 0.45, costHa: 240, revHa: 540, thermalTol: 0.60, waterUseFactor: 1.00 },
      { id: 'soja_2da', name_es: 'Soja 2da (sobre cereal invernal)', name_en: '2nd-Crop Soybean', stageType: 'commercial', kc: 0.94, ndvi: 0.71, nFix: 55, nLeach: 2, cn: 22, socDeltaYear: -0.02, factorC: 0.16, pestBreak: 0.58, costHa: 210, revHa: 440, thermalTol: 0.64, waterUseFactor: 0.95 },
      { id: 'maiz_1ra', name_es: 'Maíz temprano (1ra)', name_en: 'Early Maize', stageType: 'commercial', kc: 1.08, ndvi: 0.83, nFix: 0, nLeach: 4, cn: 55, socDeltaYear: 0.12, factorC: 0.14, pestBreak: 0.65, costHa: 340, revHa: 720, thermalTol: 0.50, waterUseFactor: 1.15 },
      { id: 'maiz_tardio', name_es: 'Maíz tardío (siembra diciembre)', name_en: 'Late Maize (December)', stageType: 'commercial', kc: 1.02, ndvi: 0.81, nFix: 0, nLeach: 3, cn: 52, socDeltaYear: 0.14, factorC: 0.13, pestBreak: 0.72, costHa: 310, revHa: 680, thermalTol: 0.76, waterUseFactor: 1.04 },
      { id: 'sorgo_granifero', name_es: 'Sorgo granífero (resiliente sequía)', name_en: 'Grain Sorghum (drought tolerant)', stageType: 'commercial', kc: 0.84, ndvi: 0.74, nFix: 0, nLeach: 2, cn: 50, socDeltaYear: 0.13, factorC: 0.13, pestBreak: 0.74, costHa: 220, revHa: 515, thermalTol: 0.90, waterUseFactor: 0.80 },
      { id: 'sorgo_forrajero', name_es: 'Sorgo forrajero / silero', name_en: 'Forage / Silage Sorghum', stageType: 'commercial', kc: 0.88, ndvi: 0.78, nFix: 0, nLeach: 2, cn: 48, socDeltaYear: 0.15, factorC: 0.11, pestBreak: 0.76, costHa: 205, revHa: 470, thermalTol: 0.88, waterUseFactor: 0.84 },
      { id: 'girasol', name_es: 'Girasol', name_en: 'Sunflower', stageType: 'commercial', kc: 0.86, ndvi: 0.70, nFix: 0, nLeach: 3, cn: 45, socDeltaYear: 0.03, factorC: 0.22, pestBreak: 0.80, costHa: 230, revHa: 505, thermalTol: 0.82, waterUseFactor: 0.86 },
      { id: 'mani', name_es: 'Maní', name_en: 'Peanut', stageType: 'commercial', kc: 0.88, ndvi: 0.68, nFix: 70, nLeach: 4, cn: 20, socDeltaYear: -0.10, factorC: 0.34, pestBreak: 0.70, costHa: 390, revHa: 760, thermalTol: 0.74, waterUseFactor: 0.94 },
      { id: 'pastura_est', name_es: 'Alfalfa + Festuca (Perenne Verano)', name_en: 'Alfalfa + Fescue (Summer Perennial)', stageType: 'cover', kc: 0.92, ndvi: 0.83, nFix: 120, nLeach: 1, cn: 18, socDeltaYear: 0.24, factorC: 0.05, pestBreak: 0.92, costHa: 140, revHa: 310, thermalTol: 0.80, waterUseFactor: 1.05 },
      { id: 'barbecho_estival', name_es: 'Barbecho estival c/ rastrojo (Descanso)', name_en: 'Summer Stubble Fallow (Water recharge)', stageType: 'stubble', kc: 0.26, ndvi: 0.20, nFix: 0, nLeach: 5, cn: 50, socDeltaYear: -0.06, factorC: 0.24, pestBreak: 0.60, costHa: 35, revHa: 0, thermalTol: 0.75, waterUseFactor: 0.45 }
    ]
  };
}

/**
 * Registro parametrizado de especies vegetales mostradas en las fichas del Paso 4.
 */
function getCropCatalog() {
  return [
    { id: 'maiz', name: 'Maíz (Zea mays)', family: 'Gramínea (C4)', kc: '0,30 – 1,20', cn: '55:1', bfn: '0 kg N/ha', stress: 'Sensible >35°C en floración (R1); la fecha tardía evade picos de calor', card: 'card-sage' },
    { id: 'soja', name: 'Soja 1ra / 2da (Glycine max)', family: 'Leguminosa (C3)', kc: '0,40 – 1,15', cn: '22:1', bfn: '60–90 kg N/ha', stress: 'Sensible a déficit hídrico en R3–R5; rastrojo lábil C:N bajo', card: 'card-peach' },
    { id: 'trigo', name: 'Trigo / Cebada (Cereales Inv.)', family: 'Gramínea invernal', kc: '0,35 – 1,15', cn: '65:1', bfn: '0 kg N/ha', stress: 'Escapa al calor estival; helada tardía en espigazón (<0°C)', card: 'card-sky' },
    { id: 'sorgo', name: 'Sorgo granífero / forrajero', family: 'Gramínea (C4)', kc: '0,30 – 1,05', cn: '50:1', bfn: '0 kg N/ha', stress: 'Máxima tolerancia a sequía y golpes térmicos >38°C (CV 17%)', card: 'card-peach' },
    { id: 'vicia', name: 'Vicia villosa + Centeno', family: 'Mix Leguminosa/Gramínea', kc: '0,35 – 0,95', cn: '15–44:1', bfn: '92–118 kg N/ha', stress: 'Secar en sept. para conservar agua; mitiga N₂O con mezcla C:N > 26', card: 'card-sky' },
    { id: 'alfalfa', name: 'Alfalfa + Festuca (Perenne)', family: 'Consociación Perenne', kc: '0,40 – 1,05', cn: '18:1 – 35:1', bfn: '150–250 kg N/ha', stress: 'Raíz profunda (2 m); máxima infiltración y captura de carbono', card: 'card-sage' },
    { id: 'girasol', name: 'Girasol (Helianthus annuus)', family: 'Asterácea (C3)', kc: '0,35 – 1,05', cn: '45:1', bfn: '0 kg N/ha', stress: 'Corta ciclo de plagas gramíneas/soja; raíz pivotante profunda', card: 'card-ash' },
    { id: 'nabo', name: 'Nabo forrajero (Brassica)', family: 'Crucífera Invernal', kc: '0,35 – 0,90', cn: '19:1', bfn: '0 kg N/ha (Captura N)', stress: 'Descompactación biológica de capas superficiales y reciclaje de NO₃⁻', card: 'card-sage' },
    { id: 'mani', name: 'Maní (Arachis hypogaea)', family: 'Leguminosa Rastrera', kc: '0,40 – 1,10', cn: '20:1', bfn: '70 kg N/ha', stress: 'Alto margen bruto pero exige cobertura inmediata post-arrancado', card: 'card-peach' }
  ];
}

/**
 * Base documental bilingüe completa para popups explicativos "Caja Blanca" + Lenguaje Simple.
 */
function getEquationsMetadata() {
  return {
    general: {
      title_es: 'Arquitectura Multicriterio Auditada (SAW-8, SAW-15 y TOPSIS-15)',
      title_en: 'Audited Multi-Criteria Architecture (SAW-8, SAW-15 & TOPSIS-15)',
      plain_es: 'Evaluamos cada rotación con 15 notas independientes de 0 a 100 (agua, carbono del suelo, erosión, plagas y dinero). Primero sumamos con pesos (SAW) como un boletín escolar; luego aplicamos TOPSIS, un filtro más exigente que castiga fuerte si un método saca "muy buena plata" pero destruye el suelo.',
      plain_en: 'We grade each rotation across 15 indicators from 0 to 100 (water, soil carbon, erosion, pests, and cash flow). First we compute a weighted average (SAW); then we run TOPSIS, a non-compensatory check that penalizes making quick cash by degrading the soil.',
      formula: 'SAW_15(j) = Σ_{i=1..15} w_i · C_{i,j}\nC_{i,j} = clamp( 100 · (X_{i,j} - X_min) / (X_max - X_min), 0, 100 )\nTOPSIS(j) = [ D_j⁻ / (D_j⁺ + D_j⁻) ] × 100',
      interp_es: 'Un puntaje SAW > 70 indica rotación equilibrada. Si TOPSIS es mucho menor que SAW (ej. E0 cae ~25 pts), significa que la estrategia oculta una falla grave en suelo desnudo o erosión.',
      interp_en: 'A SAW score > 70 shows balanced performance. If TOPSIS drops sharply below SAW (e.g., E0 drops ~25 pts), cash gains are hiding severe bare-soil or erosion risks.',
      source: 'Allen et al. (FAO-56), Hwang & Yoon (TOPSIS), Poggio et al. (SoilGrids 2.0), Novelli et al. (2017), MAGyP/INDEC.'
    },
    area: {
      title_es: 'Cálculo Geodésico de Superficie del Polígono (m² y ha)',
      title_en: 'Geodesic Polygon Area Calculation (m² & ha)',
      plain_es: 'Toma las esquinas que marcaste en el mapa satelital (latitud y longitud sobre la curvatura real de la Tierra) y calcula los metros cuadrados y hectáreas exactas de tu lote.',
      plain_en: 'Takes the corners you clicked on the satellite map (latitude and longitude over Earth curvature) and calculates exact square meters and hectares for your plot.',
      formula: 'Área (m²) = (R² / 2) · | Σ (λ_{i+1} - λ_{i-1}) · sin(φ_i) |   (R = 6.378.137 m)\nSuperficie (ha) = Área (m²) / 10.000',
      interp_es: 'Esta superficie escala las toneladas de carbono capturadas por el lote completo (t C) y el flujo de caja total del establecimiento.',
      interp_en: 'This area scales total captured soil carbon (metric tons C) and total plot cash flow.',
      source: 'Elipsoide WGS84 · Turf.js Geodesic Area · API Georef Argentina.'
    },
    ndvi: {
      title_es: 'Índice de Vegetación NDVI (Cuadros Internos Sentinel-2) e Intensidad ISI',
      title_en: 'NDVI Vegetation Index (Sentinel-2 Grid Cells) & Intensity Index (ISI)',
      plain_es: 'Las plantas sanas absorben la luz roja para hacer fotosíntesis y reflejan mucha luz infrarroja. Comparando ambas luces en cada cuadro de 10 m de tu lote obtenemos el NDVI de 0 a 1: debajo de 0,20 el suelo está desnudo y vulnerable; encima de 0,60 el cultivo cubre y protege el suelo.',
      plain_en: 'Healthy plants absorb red light and reflect near-infrared (NIR) light. Comparing both bands inside every 10 m grid cell gives NDVI from 0 to 1: below 0.20 soil is bare and exposed; above 0.60 crop canopy actively protects soil.',
      formula: 'NDVI = (NIR - RED) / (NIR + RED)\nNDTI = (SWIR1 - SWIR2) / (SWIR1 + SWIR2)  [rastrojo seco]\nISI = Días_con_NDVI_vivo / Días_totales_del_ciclo',
      interp_es: 'Terracota (<0,20): suelo desnudo; Ocre (0,20–0,45): cobertura rala o rastrojo; Salvia (0,45–0,70): cultivo en crecimiento; Verde bosque (>0,70): vigor pleno.',
      interp_en: 'Terracotta (<0.20): bare soil; Ochre (0.20–0.45): low cover/stubble; Sage (0.45–0.70): growing crop; Forest green (>0.70): peak canopy vigor.',
      source: 'ESA Sentinel-2 (10 m, 5 días) · NASA Landsat/HLS (30 m) · CONAE L89 Desmezclado Espectral.'
    },
    et0: {
      title_es: 'Demanda Atmosférica (ET₀ Penman-Monteith) y Propagación Taylor 14,1%',
      title_en: 'Atmospheric Demand (ET₀ Penman-Monteith) & 14.1% Taylor Error',
      plain_es: 'Estima cuántos milímetros de agua "pide" la atmósfera por día según temperatura, sol, humedad y viento. Como NASA POWER mira bloques de ~50 km y suele sobrestimar el viento, lo corregimos con estaciones INTA SIGA. Además usamos Series de Taylor ("regla de la lupa") para saber cuánto error (±0,81 mm/día = 14,1%) causan los sensores satelitales.',
      plain_en: 'Estimates daily millimeters of water demanded by air temperature, solar radiation, humidity, and wind. Since NASA POWER has ~50 km pixels and overestimates wind speed, we bias-correct it against INTA SIGA stations and apply Taylor variance propagation (±0.81 mm/day = 14.1%).',
      formula: 'ET₀ = [0,408·Δ·(Rn - G) + γ·(900/(T+273))·u₂·(es - ea)] / [Δ + γ·(1 + 0,34·u₂)]\nσ²(ET₀) = Σ (∂ET₀/∂x_i · σ_xi)² = 0,6506 ⇒ σ_ET₀ = ±0,81 mm/día (14,1%)\nX_cal = μ_INTA + (σ_INTA / σ_POWER) · (X_POWER - μ_POWER)',
      interp_es: 'El 69,6% del error de ET₀ viene de la radiación solar bajo nubes (35,8%) y de la temperatura máxima (33,8%). El consumo real del cultivo es ET_c = K_c × ET₀.',
      interp_en: 'Solar radiation under clouds (35.8%) and Tmax (33.8%) account for 69.6% of ET₀ uncertainty. Actual crop demand scales by crop coefficient: ET_c = K_c × ET₀.',
      source: 'NASA POWER (community=AG) + Allen et al. (FAO-56) + Red INTA SIGA.'
    },
    aw: {
      title_es: 'Agua Disponible en el Suelo (AW) e Intervalo de Confianza Q0.05–Q0.95',
      title_en: 'Soil Available Water (AW) & 90% Confidence Interval (Q0.05–Q0.95)',
      plain_es: 'Tu suelo funciona como una esponja o tanque de agua. El agua disponible (AW) es la diferencia entre cuánta agua retiene después de una lluvia (Capacidad de Campo) y el punto donde la raíz ya no puede absorberla (Marchitez). Si ingresás un análisis local de tu campo, el margen de error cae de ±32,5 mm/m a menos de la mitad.',
      plain_en: 'Your soil acts as a water sponge/tank. Available water (AW) is the gap between field capacity (-33 kPa) and permanent wilting point (-1500 kPa). Entering your own lab/depth data cuts estimation uncertainty sharply.',
      formula: 'AW = Σ_{l=1..5} (d_l / 100) · (wv0033_l - wv1500_l) · Profundidad_útil\nσ_AW = √( σ_FC² + σ_WP² - 2·ρ·σ_FC·σ_WP )  con ρ = 0,65 ⇒ ±32,5 mm/m',
      interp_es: 'La presencia de tosca a 50 cm o 75 cm recorta el tamaño del tanque hídrico proporcionalmente (-50% o -25%), volviendo mucho más arriesgados los cultivos de verano largos sin cobertura.',
      interp_en: 'Petrocalcic hardpan at 50 or 75 cm shrinks the root water tank (-50% or -25%), raising drought risk for long-cycle summer crops.',
      source: 'ISRIC SoilGrids v2.0 (wv0033, wv1500) + Cartas GeoINTA + Saxton & Rawls (2006).'
    },
    smap: {
      title_es: 'Humedad Radicular Inicial (NASA POWER GWETROOT + Open-Meteo / SMAP)',
      title_en: 'Initial Root-Zone Soil Moisture (NASA POWER GWETROOT + Open-Meteo)',
      plain_es: 'Combinamos el producto satelital/reanálisis NASA POWER GWETROOT (MERRA-2 zona radicular) con la humedad profunda 0–100 cm de Open-Meteo y asimilación SMAP. Lo expresamos en porcentaje de llenado del tanque (0–100%) para que el balance hídrico arranque desde la humedad real reciente del perfil.',
      plain_en: 'Combines NASA POWER GWETROOT (MERRA-2 root-zone wetness) with Open-Meteo 0–100 cm volumetric soil moisture. Expressed as profile tank fill (0–100%), it anchors Month 0–1 water balance to current conditions.',
      formula: 'GWETROOT = frac_llenado(0..100 cm)  |  θ_vol (m³/m³) = soil_moisture_28_to_100cm\nAgua Inicial (mm) = AW_máx × (Humedad_Inicial_% / 100)',
      interp_es: 'Arrancar con <40% de humedad útil dispara alerta temprana de déficit hídrico y favorece coberturas de secado temprano o sorgo.',
      interp_en: 'Starting below 40% tank fill signals dry profile conditions, favoring early-terminated covers or sorghum.',
      source: 'NASA POWER GWETROOT (MERRA-2) + Open-Meteo Soil Moisture + SMAP L4 ref.'
    },
    magyp: {
      title_es: 'Riesgo Histórico de Rendimiento (Ratio de Sharpe / CV MAGyP)',
      title_en: 'Historical Yield Stability (Sharpe Margin / MAGyP 10-Year CV)',
      plain_es: 'No alcanza con mirar cuánto rinde un cultivo en un año bueno; importa cuánto oscila de un año a otro. Usando 10 años de estadísticas reales de tu partido/departamento medimos el Coeficiente de Variación (CV) y el retorno ajustado por riesgo (Ratio de Sharpe).',
      plain_en: 'High average yields mean little if returns swing wildly. Using 10-year district statistics we track Yield Coefficient of Variation (CV) and risk-adjusted return (Sharpe Ratio).',
      formula: 'CV(%) = (σ_rinde / μ_rinde) × 100\nSharpe_lote = (Margen_esperado - Costo_oportunidad) / σ_margen',
      interp_es: 'En la Pampa Arenosa, el sorgo (CV 17%) y el trigo (CV 20,9%) estabilizan mucho más el ingreso que la soja de 2da (CV 33,7%) o el maíz temprano en años Niña.',
      interp_en: 'In sandy Pampas soils, sorghum (CV 17%) and wheat (CV 20.9%) buffer inter-annual volatility far better than late 2nd soybean (CV 33.7%).',
      source: 'MAGyP / INDEC Estimaciones Agrícolas · USDA NASS QuickStats & AMS Market News.'
    },
    rusle: {
      title_es: 'Erosión Hídrica y Eólica (Ecuación RUSLE + SRTM + GPM IMERG)',
      title_en: 'Water & Wind Erosion Model (RUSLE + SRTM + GPM IMERG)',
      plain_es: 'Calcula cuántas toneladas de suelo fértil se pierden por hectárea cada año cuando el lote queda desnudo bajo lluvia intensa (GPM IMERG) o viento, considerando la pendiente del terreno (SRTM 30 m) y cuánto rastrojo cubre la superficie.',
      plain_en: 'Estimates metric tons of topsoil lost per hectare per year when exposed to intense rain (GPM IMERG) and slope runoff (SRTM 30 m), modulated by canopy and residue cover factor C.',
      formula: 'A [t/ha/año] = R_GPM · K_SoilGrids · LS_SRTM · C_(NDVI,NDTI) · P',
      interp_es: 'Dejar el suelo desnudo eleva C ≈ 0,44 y supera el umbral tolerable de erosión. Usar centeno/vicia o pasturas baja C a 0,05–0,10, frenando la pérdida de suelo.',
      interp_en: 'Bare soil pushes cover factor C to ~0.44, breaching soil loss tolerance. Rye/vetch covers or pastures drop C to 0.05–0.10.',
      source: 'NASA GPM IMERG · SRTM (30 m) · SoilGrids · FAO/USDA RUSLE.'
    },
    soc_gei: {
      title_es: 'Balance de Carbono Orgánico (ΔSOC) y Huella de Gases (N₂O / CO₂-eq)',
      title_en: 'Soil Organic Carbon Balance (ΔSOC) & GHG Footprint (CO₂-eq)',
      plain_es: 'Estima si tu rotación está "cargando" materia orgánica viva al suelo (raíces de gramíneas, pasturas y coberturas) o si se está oxidando por barbechos largos. Además, calcula los gases N₂O: las mezclas equilibradas (centeno + vicia, C:N > 26) evitan emisiones pico de N₂O.',
      plain_en: 'Tracks whether the sequence builds soil organic carbon via living roots/residues or depletes it during long fallows. Balanced rye+vetch mixes (C:N > 26) curb nitrous oxide (N₂O) spikes.',
      formula: 'GEI_neto = -ΔSOC · (44/12) + (N_fert·EF₁ + N_res·EF_res(C:N)) · (44/28) · 298',
      interp_es: 'Un ΔSOC positivo (+0,15 a +0,55 Mg C/ha/año) mejora la fertilidad física y la capacidad de retener agua del suelo para las próximas décadas.',
      interp_en: 'Positive ΔSOC (+0.15 to +0.55 Mg C/ha/yr) builds long-term fertility and water-holding resilience.',
      source: 'Abdalla et al. (2019) · Abalos et al. (2022) · IPCC Tier 1/2 · INTA.'
    },
    timeline: {
      title_es: 'Balance Dinámico Mensual FAO-56 con Estrés Hídrico (12 a 72 Meses)',
      title_en: 'Monthly Dynamic FAO-56 Water-Stress Simulation (12 to 72 Months)',
      plain_es: 'En lugar de dar una sola nota final "mágica", el sistema avanza mes por mes en 3 sub-pasos: calcula lluvia efectiva, evapotranspiración potencial (ET_c), el coeficiente de estrés hídrico Ks, la evapotranspiración real (ET_a = Ks · ET_c) y el drenaje profundo D, acumulando carbono y flujo de caja.',
      plain_en: 'Instead of returning an opaque score, the engine steps month by month in 3 sub-steps: computing effective rain, potential crop ET (ET_c), water-stress factor Ks, actual ET (ET_a = Ks · ET_c), deep drainage D, carbon sequestration, and cash flow.',
      formula: 'S_t = clamp( S_{t-1} + P_ef - ET_a - D, 0, AW_máx )\nET_a = K_s · ET_c  |  K_s = min(1, S / ((1 - p) · AW_máx)), p = 0,50\nΔSOC_lote (t C) = Σ (ΔSOC_mes) × Superficie (ha)',
      interp_es: 'Hacé clic en cualquier mes rojo (suelo desnudo) o verde/azul en la grilla para ver ET_a, estrés hídrico Ks y drenaje acumulado.',
      interp_en: 'Click any bare-soil or cropped month tile to inspect ET_a, water stress factor Ks, and drainage.',
      source: 'Motor Balance Agroclimático FAO-56 / Field Shift v5.0 · Calibración Pampa Húmeda / Arenosa.'
    },
    fao33_yield: {
      title_es: 'Función de Producción FAO-33 (Ky), Extremos Térmicos y Calibración MAGyP',
      title_en: 'FAO-33 Water-Yield Function (Ky), Thermal Extremes & MAGyP Calibration',
      plain_es: 'Conecta el agua real consumida por cada cultivo con su rendimiento final usando la sensibilidad al déficit hídrico (Ky de FAO-33) y restando días de calor (>35 °C) en floración o heladas (<0 °C). El rendimiento potencial Y_pot se calibra automáticamente con las estadísticas de los últimos 10 años del partido (MAGyP).',
      plain_en: 'Links actual transpired water (ET_a / ET_c) to crop yield via FAO-33 water sensitivity (Ky), then deducts heat (>35°C) and frost (<0°C) days from daily exceedance curves. Potential yield Y_pot auto-calibrates to 10-year district MAGyP yields.',
      formula: 'Y / Y_pot = [1 - K_y · (1 - ET_a / ET_c)] · (1 - φ_calor) · (1 - φ_helada)\nC1 = 100·clamp(1 - déficit_rel/0,5, 0, 1)  |  C9 = WUE [5..22 kg MS/ha/mm]',
      interp_es: 'Al variar la lluvia o temperatura en los escenarios, C1, C7 y C9 se recalculan desde la física del balance mensual, haciendo que Maíz (Ky=1,25) caiga más rápido que Sorgo (Ky=0,90) en sequía.',
      interp_en: 'Under climate stress scenarios, C1, C7, and C9 recompute directly from physical ETa/ETc and thermal curves, making Maize (Ky=1.25) drop faster than Sorghum (Ky=0.90) in drought.',
      source: 'Doorenbos & Kassam (FAO-33) · NASA POWER serie diaria T2M_MAX/T2M_MIN · MAGyP.'
    },
    aptitude: {
      title_es: 'Filtro de Aptitud No Compensatorio (Cuantiles Q0.05 – Q0.95)',
      title_en: 'Non-Compensatory Aptitude Filter (Quantiles Q0.05 – Q0.95)',
      plain_es: 'Antes de premiar una rotación, verifica si cada cultivo tolera las limitantes del perfil usando tanto la estimación pesimista (Q0.05) como la optimista (Q0.95) de SoilGrids y la profundidad de tosca del productor. Clasifica cada estrategia en Apto, Dudoso ("medir en el lote") o No Apto.',
      plain_en: 'Before ranking a rotation, verifies crop water and root-depth tolerances across SoilGrids pessimistic (Q0.05) and optimistic (Q0.95) quantiles plus hardpan depth (tosca), flagging strategies as Suitable, Uncertain ("measure on-farm"), or Unsuitable.',
      formula: 'No Apto: falla requisito incluso con AW_Q0.95 o tosca < umbral\nApto: supera todos los requisitos incluso con AW_Q0.05\nDudoso: caso intermedio → requiere validación a campo',
      interp_es: 'La aptitud de la rotación completa está determinada por el eslabón más exigente o restrictivo de su secuencia.',
      interp_en: 'Overall rotation aptitude is governed by the most water- or depth-sensitive crop in the sequence.',
      source: 'Etapa 1 Cadena Agroclimática Field Shift v5.0 · ISRIC SoilGrids v2.0 Q0.05/Q0.95.'
    },
    mcda: {
      title_es: 'Auditoría Matemática: SAW-8, SAW-15, TOPSIS-15 y Monte Carlo',
      title_en: 'Mathematical Audit: SAW-8, SAW-15, TOPSIS-15 & Monte Carlo',
      plain_es: 'SAW-8 era el modelo preliminar de 8 criterios (aquí auditado y corregido). SAW-15 amplía el boletín a 15 criterios (con C1, C7 y C9 calculados dinámicamente vía FAO-56 / FAO-33). TOPSIS-15 evita que un buen año económico oculte destrucción del suelo. Monte Carlo reporta un rango de confianza 90%.',
      plain_en: 'SAW-8 is the audited 8-criteria baseline. SAW-15 expands weights across 15 criteria (with C1, C7, and C9 physically computed via FAO-56 / FAO-33). TOPSIS-15 prevents high cash flow from hiding severe soil failure, and Monte Carlo reports a 90% confidence band.',
      formula: 'SAW = Σ w_i·C_{i,j}  |  D⁺ = √Σ(v_{i,j}-v_i⁺)²  |  D⁻ = √Σ(v_{i,j}-v_i⁻)²\nTOPSIS = 100·D⁻/(D⁺+D⁻)  |  IC 90% = SAW ± 1,645·√Σ(w_i·σ_i)²',
      interp_es: 'Cuando dos rotaciones empatan dentro del rango de confianza Monte Carlo [IC 90%], la decisión final debe apoyarse en el criterio local del ingeniero agrónomo.',
      interp_en: 'When two rotations overlap within their 90% Monte Carlo confidence intervals, local agronomist validation breaks the tie.',
      source: 'Auditoría Estadística Field Shift v5.0 (Hwang & Yoon, AHP Saaty, FAO-33/56, N=10.000).'
    },
    cycle_years: {
      title_es: 'Duración del Ciclo de Rotación Evaluado (1 a 6 Años)',
      title_en: 'Evaluated Rotation Cycle Duration (1 to 6 Years)',
      plain_es: 'Podés analizar desde una sola campaña anual (1 año / 12 meses) hasta una rotación completa de 6 años (72 meses / 2.190 días, estándar de ensayos largos del INTA y FAO). Ciclos más largos muestran con claridad cómo se acumula o degrada la materia orgánica del suelo.',
      plain_en: 'Analyze anything from a single 1-year campaign (12 months) up to a full 6-year multi-crop rotation (72 months / 2,190 days, INTA/FAO long-term benchmark). Longer horizons reveal cumulative organic carbon buildup or depletion.',
      formula: 'T_meses = Duración_años × 12   ∈ {12, 24, 36, 48, 60, 72}',
      interp_es: '1–2 años sirve para decisiones de alquiler corto; 4–6 años muestra el verdadero efecto sobre carbono, malezas y estabilidad climática.',
      interp_en: '1–2 years suits short-term leases; 4–6 years reveals true soil carbon, weed suppression, and climate resilience trends.',
      source: 'Metodología de Rotaciones Plurianuales INTA / NASA Field Shift.'
    },
    prev_crop: {
      title_es: 'Estado Satelital Actual o Cultivo Inicial del Lote',
      title_en: 'Live Satellite State or Initial Standing Crop',
      plain_es: 'Detecta automáticamente cómo está tu lote HOY usando Sentinel-2 L2A (bandas B04/B08/B11/SCL a 10 m) y humedad superficial NASA POWER / Open-Meteo, o permite elegir manualmente un estado/cultivo de partida. Define el mapa espectral inicial, la humedad al Mes 0, la cobertura protectora y el nitrógeno residual.',
      plain_en: 'Automatically detects your field condition TODAY from Sentinel-2 L2A (B04/B08/B11/SCL at 10 m) and NASA POWER / Open-Meteo surface moisture, or lets you pick a manual baseline state. Sets Month-0 spectral grid, initial moisture, residue cover, and residual N.',
      formula: 'NDVI = (B08 − B04) / (B08 + B04)   |   NDMI = (B08 − B11) / (B08 + B11)\nS(0) = AW_máx × Humedad_inicial_% / 100',
      interp_es: 'Cuando existe escena Sentinel-2 libre de nubes, cada píxel del polígono refleja el NDVI/NDMI observado real. Partir de suelo desnudo o bajo NDVI inicial eleva el riesgo erosivo del Año 1.',
      interp_en: 'When a cloud-free Sentinel-2 scene is available, each parcel cell displays real observed NDVI/NDMI. Starting bare or low-NDVI raises Year-1 erosion risk.',
      source: 'Microsoft Planetary Computer Sentinel-2 L2A (10 m) + NASA POWER GWETROOT + Open-Meteo / SMAP L4.'
    },
    strategy_builder: {
      title_es: 'Constructor y Configurador de Estrategias de Rotación',
      title_en: 'Crop Rotation Strategy Builder & Configurator',
      plain_es: 'Aquí definís qué estrategias querés comparar. Cada estrategia tiene su propia secuencia de cultivos (Otoño-Invierno y Primavera-Verano para cada año del ciclo) y sus propios datos iniciales (humedad de arranque, tipo de labranza, tosca, carbono o manejo). Podés editar las existentes o crear rotaciones nuevas desde cero.',
      plain_en: 'Define the exact candidate strategies to compare. Each strategy holds its own multi-year crop sequence (Winter + Summer per year) and optional custom initial soil/management conditions. Edit presets or build custom rotations from scratch.',
      formula: 'Estrategia(j) = { Duración_N_años, Secuencia[(Inv_y, Ver_y)]_{y=1..N}, Condiciones_Iniciales_j }',
      interp_es: 'Podés comparar por ejemplo un escenario "Siembra Directa + Centeno/Vicia" contra "Labranza Convencional sin Cobertura" partiendo desde el mismo lote.',
      interp_en: 'Compare for example "No-Till + Rye/Vetch Cover" against "Conventional Tillage Bare Fallow" on the exact same plot.',
      source: 'Arquitectura Multicriterio Interactiva Field Shift v5.0.'
    }
  };
}

module.exports = {
  FALLBACK_DATA,
  getEnvironmentalContext,
  fetchSatellitePlotState,
  getInitialFieldStates,
  getSeasonCropsCatalog,
  getCropCatalog,
  getEquationsMetadata
};
