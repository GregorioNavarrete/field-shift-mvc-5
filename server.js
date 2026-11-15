/**
 * @file server.js
 * @description Punto de entrada del servidor Express para Field Shift v5.0 (Arquitectura MVC).
 * Configura middlewares de compresión, CORS, parseo JSON, motor de plantillas EJS,
 * archivos estáticos y rutas de la aplicación.
 */

require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');
const compression = require('compression');

const indexRoutes = require('./routes/indexRoutes');

const app = express();
const PORT = process.env.PORT || 3000;

// Middlewares globales
app.use(compression());
app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

// Configuración del motor de vistas EJS (Capa View)
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Recursos estáticos (CSS editorial, JS cliente y datos públicos)
app.use(express.static(path.join(__dirname, 'public')));

// Enrutamiento principal MVC
app.use('/', indexRoutes);

// Manejador de errores global para endpoints API
app.use((err, req, res, next) => {
  console.error('[FieldShift Error]:', err.stack);
  res.status(500).json({
    ok: false,
    error: 'Error interno en el motor de simulación agroclimática.',
    detalle: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

app.listen(PORT, () => {
  console.log(`\n🌱 Field Shift v5.0 (MVC) ejecutándose en http://localhost:${PORT}`);
  console.log(`📡 Endpoints activos: GET / | POST /api/satellite | POST /api/analyze | GET /api/equations\n`);
});