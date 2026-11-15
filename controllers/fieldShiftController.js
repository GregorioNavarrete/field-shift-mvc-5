/**
 * @file controllers/fieldShiftController.js
 * @description Controlador principal MVC. Coordina las peticiones HTTP entre la vista EJS,
 * los conectores de datos (agroModel) y el motor matemático multicriterio (mcdaModel).
 */

const agroModel = require('../models/agroModel');
const mcdaModel = require('../models/mcdaModel');

function parseFinite(val, fallback) {
  if (val === undefined || val === null || val === '') return fallback;
  const n = Number(val);
  return Number.isFinite(n) ? n : fallback;
}

function extractSocNumeric(rawSoc, fallback = 18.4) {
  const candidate = (rawSoc && typeof rawSoc === 'object') ? rawSoc.media : rawSoc;
  return parseFinite(candidate, fallback);
}

function bboxFromPolygon(polygon, lat, lon) {
  if (Array.isArray(polygon) && polygon.length >= 3) {
    const lats = polygon.map((p) => Number(Array.isArray(p) ? p[0] : p?.lat)).filter(Number.isFinite);
    const lons = polygon.map((p) => Number(Array.isArray(p) ? p[1] : p?.lon ?? p?.lng)).filter(Number.isFinite);
    if (lats.length >= 3 && lons.length >= 3) {
      return [Math.min(...lons), Math.min(...lats), Math.max(...lons), Math.max(...lats)];
    }
  }
  return [lon - 0.0025, lat - 0.002, lon + 0.0025, lat + 0.002];
}

function buildSatelliteInitFromContext(sat) {
  if (!sat || sat.modo !== 'live_sentinel2' || !sat.summary) return null;
  const sSum = sat.summary;
  return {
    ndvi: sat.meanNdvi,
    ndmi: sat.meanNdmi,
    date: sat.date,
    title_es: sSum.title_es,
    title_en: sSum.title_en,
    desc_es: sSum.desc_es,
    desc_en: sSum.desc_en,
    residueCoverPct: sSum.residueCoverPct,
    initN_kgHa: sSum.initN_kgHa,
    cnRatio: sSum.cnRatio,
    pestCarryover: sSum.pestCarryover
  };
}

/**
 * Renderiza la vista principal (GET /) con observación satelital real en vivo y catálogos v5.0.
 */
async function renderHome(req, res, next) {
  try {
    const meta = agroModel.FALLBACK_DATA.meta;
    const defaultBbox = bboxFromPolygon(meta.poligono_default, meta.coordenadas.lat, meta.coordenadas.lon);
    const envContext = await agroModel.getEnvironmentalContext(meta.coordenadas.lat, meta.coordenadas.lon, {
      includeSatellite: true,
      bbox: defaultBbox,
      rows: 6,
      cols: 7
    });

    const defaultParams = {
      lat: meta.coordenadas.lat,
      lon: meta.coordenadas.lon,
      areaM2: meta.area_m2,
      startDate: meta.ciclo.inicio,
      cycleYears: 2,
      prevCrop: 'satelite_actual',
      tillage: 'siembra_directa',
      awMmM: envContext.suelo?.aw_mm_m?.media || 130,
      toscaCm: parseFinite(envContext.suelo?.profundidad_util_cm, 100),
      initMoisturePct: parseFinite(envContext.suelo?.humedad_smap_inicial_pct, 62),
      socGKg: extractSocNumeric(envContext.suelo?.soc_g_kg, 18.4),
      isLocalOverride: false,
      rainDeltaPct: 0,
      tempDeltaC: 0,
      economicCrisis: false,
      wWaterPct: 30,
      wEconPct: 20,
      machinery: 'contratista_grano',
      satelliteInit: buildSatelliteInitFromContext(envContext.satellite)
    };

    const simulation = mcdaModel.runFullSimulation(defaultParams, envContext);

    res.render('index', {
      initialData: {
        meta,
        params: defaultParams,
        envContext,
        simulation,
        initialFieldStates: agroModel.getInitialFieldStates(),
        seasonCrops: agroModel.getSeasonCropsCatalog(),
        cropCatalog: agroModel.getCropCatalog(),
        equations: agroModel.getEquationsMetadata()
      }
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Endpoint REST (POST /api/analyze) que recalcula en tiempo real al delimitar el lote,
 * cambiar el estado inicial o duración del ciclo (1–6 años), editar/crear estrategias
 * en el Paso 2, sobrescribir datos de laboratorio o aplicar escenarios ENSO/crisis.
 */
async function analyzeField(req, res, next) {
  try {
    const body = req.body || {};
    const lat = parseFinite(body.lat, -36.805506);
    const lon = parseFinite(body.lon, -62.026496);
    const cycleYears = Math.min(6, Math.max(1, Math.round(parseFinite(body.cycleYears, 2))));
    const prevCrop = body.prevCrop || 'satelite_actual';

    const bbox = Array.isArray(body.bbox) && body.bbox.length === 4 ? body.bbox.map(Number) : null;
    const needsLiveSat = prevCrop === 'satelite_actual' && !body.satelliteInit;
    const envContext = await agroModel.getEnvironmentalContext(lat, lon, {
      includeSatellite: needsLiveSat,
      bbox: bbox || bboxFromPolygon(body.polygon, lat, lon),
      rows: 6,
      cols: 7
    });

    const satAw = parseFinite(envContext.suelo?.aw_mm_m?.media, 130);
    const satSoc = extractSocNumeric(envContext.suelo?.soc_g_kg, 18.4);
    const satTosca = parseFinite(envContext.suelo?.profundidad_util_cm, 100);
    const satMoist = parseFinite(envContext.suelo?.humedad_smap_inicial_pct, 62);
    const isSatAuthoritative = body.isLocalOverride === false;

    const params = {
      lat,
      lon,
      areaM2: Math.max(1000, parseFinite(body.areaM2, 100000)),
      startDate: body.startDate || '2026-02-15',
      cycleYears,
      prevCrop,
      tillage: body.tillage || 'siembra_directa',
      awMmM: isSatAuthoritative ? satAw : parseFinite(body.awMmM, satAw),
      toscaCm: isSatAuthoritative ? satTosca : parseFinite(body.toscaCm, satTosca),
      initMoisturePct: isSatAuthoritative
        ? (prevCrop === 'satelite_actual' ? satMoist : parseFinite(body.initMoisturePct, satMoist))
        : parseFinite(body.initMoisturePct, satMoist),
      socGKg: isSatAuthoritative ? satSoc : extractSocNumeric(body.socGKg, satSoc),
      isLocalOverride: Boolean(body.isLocalOverride),
      rainDeltaPct: parseFinite(body.rainDeltaPct, 0),
      tempDeltaC: parseFinite(body.tempDeltaC, 0),
      economicCrisis: Boolean(body.economicCrisis),
      wWaterPct: parseFinite(body.wWaterPct, 30),
      wEconPct: parseFinite(body.wEconPct, 20),
      machinery: body.machinery || 'contratista_grano',
      satelliteInit: body.satelliteInit || buildSatelliteInitFromContext(envContext.satellite),
      strategies: Array.isArray(body.strategies) ? body.strategies : undefined
    };

    const simulation = mcdaModel.runFullSimulation(params, envContext);

    res.json({
      ok: true,
      timestamp: new Date().toISOString(),
      params,
      envContext,
      simulation
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Endpoint ligero para Paso 1 (POST /api/satellite): consulta escena Sentinel-2 L2A real en la grilla
 * del polígono trazado junto con humedad reciente NASA/Open-Meteo y geocodificación inversa.
 */
async function analyzeSatellite(req, res, next) {
  try {
    const body = req.body || {};
    const lat = parseFinite(body.lat, -36.805506);
    const lon = parseFinite(body.lon, -62.026496);
    const bbox = Array.isArray(body.bbox) && body.bbox.length === 4 ? body.bbox.map(Number) : bboxFromPolygon(body.polygon, lat, lon);
    const rows = Math.min(12, Math.max(4, Math.round(parseFinite(body.rows, 6))));
    const cols = Math.min(12, Math.max(4, Math.round(parseFinite(body.cols, 7))));

    const envContext = await agroModel.getEnvironmentalContext(lat, lon, {
      includeSatellite: true,
      bbox,
      rows,
      cols
    });

    res.json({
      ok: true,
      timestamp: new Date().toISOString(),
      georef: envContext.georef,
      suelo: envContext.suelo,
      clima: envContext.clima,
      estadisticas_magyp: envContext.estadisticas_magyp,
      satellite: envContext.satellite || null
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Devuelve la documentación de ecuaciones, estados iniciales y cultivos estacionales (GET /api/equations).
 */
function getEquations(req, res) {
  res.json({
    ok: true,
    equations: agroModel.getEquationsMetadata(),
    initialFieldStates: agroModel.getInitialFieldStates(),
    seasonCrops: agroModel.getSeasonCropsCatalog(),
    cropCatalog: agroModel.getCropCatalog()
  });
}

module.exports = {
  renderHome,
  analyzeSatellite,
  analyzeField,
  getEquations
};
