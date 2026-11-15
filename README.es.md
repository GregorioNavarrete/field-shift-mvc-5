<div align="center">

# Field Shift v4.0

**Herramienta Abierta de Apoyo a la Decisión Agroclimática para Rotaciones de Cultivos**

[![License](https://img.shields.io/badge/License-Apache_2.0-07503f.svg)](./LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-%E2%89%A518.0-07503f.svg)](https://nodejs.org/)
[![Express](https://img.shields.io/badge/Express-4.19-13795b.svg)](https://expressjs.com/)
[![NASA Space Apps 2026](https://img.shields.io/badge/NASA%20Space%20Apps%202026-Field%20Shift-13795b.svg)](https://www.spaceappschallenge.org/)
[![Contributions Welcome](https://img.shields.io/badge/contributions-welcome-brightgreen.svg)](./CONTRIBUTING.md)

[English](./README.md) · [Español](./README.es.md) · [Explorador Estático (GitHub Pages)](./docs/index.html)

</div>

---

## Tabla de Contenidos

- [Acerca del Proyecto](#acerca-del-proyecto)
- [Funcionalidades Principales](#funcionalidades-principales)
- [Origen de Datos y Transparencia Epistemológica](#origen-de-datos-y-transparencia-epistemológica)
- [Cadena Científica (3 Etapas)](#cadena-científica-3-etapas)
- [Arquitectura y Estructura del Repositorio](#arquitectura-y-estructura-del-repositorio)
- [Instalación y Puesta en Marcha](#instalación-y-puesta-en-marcha)
- [Uso y Endpoints REST](#uso-y-endpoints-rest)
- [Verificación](#verificación)
- [Despliegue](#despliegue)
- [Limitaciones y Aviso Agronómico](#limitaciones-y-aviso-agronómico)
- [Cómo Contribuir](#cómo-contribuir)
- [Licencia y Transparencia SI](#licencia-y-transparencia-si)
- [Referencias](#referencias)

---

## Acerca del Proyecto

Elegir una secuencia plurianual de cultivos requiere equilibrar humedad del suelo, carbono orgánico, corte de plagas, extremos térmicos, maquinaria disponible y liquidez financiera. Un cultivo que mejora la estructura del suelo en una región puede sufrir déficit hídrico o fallar sobre tosca somera en otra.

**Field Shift v4.0** es una aplicación web MVC de código abierto desarrollada para el desafío **NASA Space Apps Challenge 2026 ("Field Shift")** por el equipo universitario **Project UNSE**. En lugar de emitir prescripciones opacas, funciona como una **herramienta de caja blanca** para explorar horizontes de **1 a 6 años (12 a 72 meses)** exponiendo cada dato, ecuación, banda de incertidumbre y escenario climático.

---

## Funcionalidades Principales

- **Delimitación Espacial del Lote:** Marcación de polígonos sobre imágenes satelitales (Leaflet + Esri World Imagery) con cálculo geodésico WGS84 ($\text{m}^2$/ha) y centroide mediante Turf.js.
- **14 Estados Iniciales de Lote:** Configuran humedad inicial, cobertura de rastrojo, nitrógeno mineral y una grilla orientativa de 42 celdas NDVI ($7\times 6$) desde cultivos estivales en pie o rastrojos hasta pasturas o barbechos desnudos.
- **Ingesta Paralela de APIs Abiertas + Respaldo Offline:** Consulta **NASA POWER** (climatología y serie diaria de 20 años), **ISRIC SoilGrids v2.0** (`mean`, `Q0.05`, `Q0.95`) y **Georef AR** con caché TTL en memoria y respaldo automático en [`data/zona_guamini_10ha.json`](./data/zona_guamini_10ha.json).
- **Constructor de Estrategias:** Permite editar estrategias base o crear secuencias año por año combinando **11 cultivos de invierno** y **10 de verano**, con condiciones iniciales propias por estrategia.
- **Motor Biofísico y Multicriterio (3 Etapas):** Filtro de aptitud no compensatorio → balance hídrico FAO-56 en 3 sub-pasos por mes → función de rendimiento FAO-33 ($K_y$), extremos térmicos diarios y ranking **SAW-8**, **SAW-15** y **TOPSIS-15** con intervalos de confianza del 90%.
- **Pruebas de Estrés y Pedagogía:** Escenarios predefinidos (*Normal*, *Sequía La Niña `-30% lluvia / +2°C`*, *El Niño `+30%`*, *Crisis Económica*), sliders de prioridad, popups con ecuaciones en cada KPI, mini-tutoriales animados por paso, Modo Oscuro e idioma `ES | EN`.
- **Explorador Estático (`docs/`):** Single Page en HTML/CSS/JS puro listo para **GitHub Pages**, capaz de consultar en vivo las APIs CORS desde el navegador.

---

## Origen de Datos y Transparencia Epistemológica

| Capa / Variable | Fuente / Endpoint | Naturaleza en v4.0 | Caché / Respaldo |
| :--- | :--- | :--- | :--- |
| **Climatología Mensual** (`T2M`, `T2M_MAX`, `T2M_MIN`, `PRECTOTCORR`, `RH2M`, `WS2M`, `ALLSKY_SFC_SW_DWN`) | `power.larc.nasa.gov/api/temporal/climatology/point?community=AG` | **API abierta en vivo** | Caché 1 h; respaldo JSON offline |
| **Extremos Térmicos Diarios** ($T_{\max}>35\,^\circ\text{C}$, $T_{\min}<0\,^\circ\text{C}$) | `power.larc.nasa.gov/api/temporal/daily/point?community=AG` (20 años) | **API abierta en vivo** → curvas empíricas de excedencia | Caché 7 días por celda; respaldo Normal |
| **Propiedades del Suelo e Incertidumbre** (`soc`, `wv0033`, `wv1500`, `sand`, `silt`, `clay`, `0–30 cm`) | `rest.isric.org/soilgrids/v2.0/properties/query` (`mean`, `Q0.05`, `Q0.95`) | **API abierta en vivo** (250 m) | Caché 30 días; respaldo JSON offline |
| **Jurisdicción Territorial** | `apis.datos.gob.ar/georef/api/ubicacion` | **API pública oficial en vivo** (Argentina) | Caché 24 h; respaldo offline |
| **Rindes Históricos y CV** | `data/zona_guamini_10ha.json` (`estadisticas_magyp`) | **Estadística regional de referencia** (MAGyP/INDEC 10 años Guaminí) | Calibra $Y_{\text{pot}}$ y $C_{15}$ |
| **Grilla NDVI ($7\times 6$) y Humedad SMAP (62%)** | `getInitialFieldStates()` y `computeCellNdvi()` | **Capas paramétricas de referencia** ancladas al estado inicial y rangos Sentinel-2/SMAP | Editables en Pasos 1 y 2 |
| **Balances, Rindes y Puntajes** | `yieldModel.js`, `extremesModel.js`, `mcdaModel.js` | **Inferencias modeladas** | Requieren validación agronómica local |

---

## Cadena Científica (3 Etapas)

1. **Etapa 1 — Filtro de Aptitud No Compensatorio (`models/yieldModel.js`):** Contrasta los requerimientos mínimos de agua útil (`minAwReq`) y profundidad sin impedancia (`minToscaReq`) de cada cultivo contra `Q0.05` y `Q0.95` de SoilGrids escalados por tosca (`toscaCm / 100`), clasificando en `apto`, `dudoso` o `no_apto`.
2. **Etapa 2 — Balance Hídrico Mensual FAO-56 (`models/yieldModel.js` + `models/mcdaModel.js`):** Calcula $ET_0$ con **Penman-Monteith FAO-56** e integra el almacenamiento en 3 sub-pasos por mes ($S_t = \text{clamp}(S_{t-1} + P_{\text{ef}} - ET_a - D, 0, AW_{\max})$, $p=0.50$), registrando $K_s$, drenaje $D$, $\Delta SOC$ según labranza y flujo de caja.
3. **Etapa 3 — Rendimiento FAO-33, Extremos y Auditoría MCDA:** Aplica $K_y$ (FAO-33), descuenta días de calor ($>35\,^\circ\text{C}$) y heladas ($<0\,^\circ\text{C}$) mediante desplazamiento de curvas empíricas ($u - \Delta T$), calibra $Y_{\text{pot}}$ con MAGyP y calcula físicamente `C1`, `C7` y `C9` (etiqueta `FAO-33` en UI), comparando `SAW-8`, `SAW-15` y `TOPSIS-15` con banda de confianza del 90%.

---

## Arquitectura y Estructura del Repositorio

```text
field-shift-mvc-4/
├── server.js                      # Servidor Express, compresión, CORS, EJS y manejo de errores
├── package.json                   # Dependencias y scripts npm (Apache-2.0)
├── LICENSE                        # Licencia Apache 2.0
├── README.md                      # Documentación Open Source (Inglés)
├── README.es.md                   # Documentación Open Source (Español)
├── CONTRIBUTING.md                # Guía para colaboradores
├── CODE_OF_CONDUCT.md             # Código de Conducta (Contributor Covenant v2.1)
├── .gitignore                     # Excluye node_modules/ y .env
├── routes/indexRoutes.js          # Rutas GET /, POST /api/analyze, GET /api/equations
├── controllers/fieldShiftController.js
├── models/                        # agroModel.js, extremesModel.js, yieldModel.js, mcdaModel.js
├── data/zona_guamini_10ha.json    # Respaldo offline y estadísticas MAGyP (Guaminí)
├── views/index.ejs                # Interfaz guiada en 4 pasos y modales de auditoría
├── public/                        # css/styles.css y js/client.js
└── docs/                          # Explorador estático sin servidor para GitHub Pages
```

---

## Instalación y Puesta en Marcha

### Requisitos
- **Node.js** `>= 18.0` y **npm** `>= 9.0`

### Pasos
```bash
git clone https://github.com/GregorioNavarrete/field-shift-mvc-4.git
cd field-shift-mvc-4
npm install
npm start
```
Abrí `http://localhost:3000` (o usá `npm run dev` para recarga automática).

### Variables de Entorno Opcionales (`.env`)
| Variable | Por defecto | Descripción |
| :--- | :--- | :--- |
| `PORT` | `3000` | Puerto HTTP de Express |
| `NODE_ENV` | — | En `development`, expone detalle de error en respuestas 500 |
| `CACHE_TTL_CLIMA_MS` | `3600000` | TTL caché climatología NASA POWER (ms) |
| `CACHE_TTL_SUELO_MS` | `2592000000` | TTL caché ISRIC SoilGrids v2.0 (ms) |
| `CACHE_TTL_EXTREMOS_MS` | `604800000` | TTL caché extremos térmicos diarios (ms) |
| `POWER_EXTREMES_YEARS` | `20` | Años diarios consultados en NASA POWER |
| `POWER_DAILY_TIMEOUT_MS` | `4500` | Timeout para consulta diaria de NASA POWER (ms) |

---

## Uso y Endpoints REST

- `GET /`: renderiza la interfaz completa en EJS.
- `GET /api/equations`: devuelve los 16 metadatos explicativos, 14 estados iniciales, 11 cultivos de invierno + 10 de verano y 9 fichas fisiológicas.
- `POST /api/analyze`: recalcula contexto ambiental, aptitud y ranking para un lote/escenario personalizado.

---

## Verificación

```bash
node --check server.js
node --check routes/indexRoutes.js
node --check controllers/fieldShiftController.js
node --check models/agroModel.js
node --check models/extremesModel.js
node --check models/yieldModel.js
node --check models/mcdaModel.js
node --check public/js/client.js
node --check docs/app.js
```

---

## Despliegue

- **GitHub Pages (`docs/`):** en **Settings → Pages**, seleccionar **Deploy from a branch** → rama `main` → carpeta `/docs`.
- **Node.js (`server.js`):** compatible con Render, Railway, Fly.io o VPS (`npm install` / `npm start`, lee `process.env.PORT`).

---

## Limitaciones y Aviso Agronómico

> [!WARNING]
> Las salidas de Field Shift son inferencias de apoyo a la decisión para comparar estrategias y escenarios climáticos. Toda decisión agronómica debe ser validada en campo por un ingeniero agrónomo matriculado.

1. NASA POWER (~50 km) y SoilGrids (250 m) tienen resolución zonal y no reemplazan muestreos de suelo ni imágenes multiespectrales de lote.
2. El paso mensual en 3 sub-pasos simplifica eventos de escorrentía sub-diaria frente a modelos diarios completos como APSIM o DSSAT.
3. Los márgenes económicos y estadísticas MAGyP por defecto corresponden a Guaminí (Buenos Aires) y requieren recalibración para otras regiones.

---

## Cómo Contribuir

Las contribuciones de código, calibraciones regionales, nuevos cultivos y mejoras de documentación son bienvenidas. Consultá [CONTRIBUTING.md](./CONTRIBUTING.md) y el [Código de Conducta](./CODE_OF_CONDUCT.md).

---

## Licencia y Transparencia SI

- **Licencia:** [Apache License 2.0](./LICENSE).
- **Uso de Super Intelligence (SI — Space Apps 2026):** Se utilizaron herramientas basadas en modelos de lenguaje como apoyo en estructuración de código y redacción técnica bajo supervisión del equipo estudiantil **Project UNSE**, sin utilizar ni modificar logotipos o marcas de la NASA.

---

## Referencias

Ver la lista bibliográfica completa en [README.md](./README.md#references).
