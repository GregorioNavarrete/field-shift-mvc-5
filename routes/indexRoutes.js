/**
 * @file routes/indexRoutes.js
 * @description Definición de rutas HTTP para la vista editorial y la API REST de cálculo.
 */

const express = require('express');
const router = express.Router();
const fieldShiftController = require('../controllers/fieldShiftController');

router.get('/', fieldShiftController.renderHome);
router.post('/api/satellite', fieldShiftController.analyzeSatellite);
router.post('/api/analyze', fieldShiftController.analyzeField);
router.get('/api/equations', fieldShiftController.getEquations);

module.exports = router;