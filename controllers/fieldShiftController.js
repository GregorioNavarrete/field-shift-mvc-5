/**
 * @file controllers/fieldShiftController.js
 * @description Controlador principal MVC. Coordina las peticiones HTTP entre la vista EJS,
 * los conectores de datos (agroModel) y el motor matemático multicriterio (mcdaModel).
 */

const agroModel = require('../models/agroModel');
const mcdaModel = require('../models/mcdaModel');

/**
 * Renderiza la vista principal (GET /) con el caso de uso de Guaminí y los catálogos v3.0.
 */
async function renderHome(req, res, next) {
  try {
    const meta = agroModel.FALLBACK_DATA.meta;
    const defaultParams = {
      lat: meta.coordenadas.lat,
      lon: meta.coordenadas.lon,
      areaM2: meta.area_m2,
      startDate: meta.ciclo.inicio,
      cycleYears: 2,
      prevCrop: 'soja_1ra',
      tillage: 'siembra_directa',
      awMmM: 130,
      toscaCm: 100,
      initMoisturePct: 62,
      socGKg: 18.4,
      isLocalOverride: false,
      rainDeltaPct: 0,
      tempDeltaC: 0,
      economicCrisis: false,
      wWaterPct: 30,
      wEconPct: 20,
      machinery: 'contratista_grano'
    };

    const envContext = await agroModel.getEnvironmentalContext(defaultParams.lat, defaultParams.lon);
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
    const lat = Number(body.lat) || -36.805506;
    const lon = Number(body.lon) || -62.026496;
    const cycleYears = Math.min(6, Math.max(1, Math.round(Number(body.cycleYears) || 2)));

    const params = {
      lat,
      lon,
      areaM2: Number(body.areaM2) || 100000,
      startDate: body.startDate || '2026-02-15',
      cycleYears,
      prevCrop: body.prevCrop || 'soja_1ra',
      tillage: body.tillage || 'siembra_directa',
      awMmM: Number(body.awMmM) || 130,
      toscaCm: Number(body.toscaCm) || 100,
      initMoisturePct: Number(body.initMoisturePct) || 62,
      socGKg: Number(body.socGKg) || 18.4,
      isLocalOverride: Boolean(body.isLocalOverride),
      rainDeltaPct: Number(body.rainDeltaPct) || 0,
      tempDeltaC: Number(body.tempDeltaC) || 0,
      economicCrisis: Boolean(body.economicCrisis),
      wWaterPct: Number(body.wWaterPct) || 30,
      wEconPct: Number(body.wEconPct) || 20,
      machinery: body.machinery || 'contratista_grano',
      strategies: Array.isArray(body.strategies) ? body.strategies : undefined
    };

    const envContext = await agroModel.getEnvironmentalContext(lat, lon);
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
  analyzeField,
  getEquations
};
