/* ==========================================================================
   FIELD SHIFT v5.0 — STATIC EXPLORER & BROWSER BIO-ENGINE (docs/app.js)
   Apache 2.0 · Ports FAO-56, FAO-33, Aptitude Q0.05–Q0.95 & MCDA to Browser
   ========================================================================== */
'use strict';

const FALLBACK_GUAMINI = {
  meta: {
    zona: 'Partido de Guaminí, Buenos Aires (Pampa Arenosa · EEA INTA Bordenave)',
    coordenadas: { lat: -36.805506, lon: -62.026496 }
  },
  clima: {
    modo: 'fallback_offline',
    fuente: 'NASA POWER (community=AG) + Calibración INTA SIGA EEA Bordenave (Respaldo Offline)',
    precipitacion_mm: [95, 86, 98, 72, 44, 28, 26, 32, 54, 84, 94, 99],
    et0_calibrada_mm: [148, 122, 98, 66, 44, 32, 35, 50, 74, 102, 128, 146],
    temp_media_c: [22.8, 21.6, 18.9, 14.8, 11.2, 8.1, 7.6, 9.5, 12.1, 15.4, 18.8, 21.5],
    dias_calor_35c: 14,
    dias_helada_0c: 26
  },
  suelo: {
    modo: 'fallback_offline',
    fuente: 'ISRIC SoilGrids v2.0 (250 m) + Cartas GeoINTA WFS (Respaldo Offline)',
    taxonomia: 'Hapludol típico / éntico',
    textura: 'Franco-arenosa (56% arena, 26% limo, 18% arcilla)',
    soc_g_kg: { media: 18.4, q05: 12.1, q95: 25.8 },
    aw_mm_m: { media: 130, q05: 84.3, q95: 175.7 },
    humedad_smap_inicial_pct: 62
  },
  georef: {
    modo: 'fallback_offline',
    etiqueta: 'Guaminí, Buenos Aires'
  }
};

const STATE = {
  lang: 'es',
  theme: 'light',
  workflowStep: 1,
  lat: -36.805506,
  lon: -62.026496,
  env: JSON.parse(JSON.stringify(FALLBACK_GUAMINI)),
  rawPower: null,
  rawSoil: null,
  simMode: 'normal',
  economicCrisis: false,
  critFilter: 'all',
  climateChart: null,
  rankingChart: null
};

const MONTHS_ES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
const MONTHS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

const I18N = {
  es: {
    top_strip: 'Field Shift v5.0 · Licencia Abierta Apache 2.0 · NASA Space Apps 2026 (Project UNSE) · Explorador interactivo estático para GitHub Pages',
    nav_flow: 'Cómo funciona',
    nav_data: 'Datos y APIs',
    nav_sim: 'Simulador',
    nav_crit: '15 Criterios',
    nav_arch: 'Código Abierto',
    btn_dark: 'Oscuro',
    btn_light: 'Claro',
    hero_eyebrow: 'Observación Terrestre + Agronomía · Caja Blanca Apache 2.0',
    hero_title: 'Cómo funciona Field Shift v5.0 y qué datos satelitales reales procesa',
    hero_lead: 'Esta página estática explica la arquitectura de Field Shift v5.0 y permite consultar en tiempo real las APIs abiertas (NASA POWER clima + GWETROOT, ISRIC SoilGrids 5 profundidades y Georef AR / Nominatim), calcular ET₀ Penman-Monteith FAO-56 en tu navegador y probar el ranking SAW-15 / TOPSIS-15.',
    hero_cta_api: 'Probar APIs en vivo ↓',
    hero_cta_sim: 'Simular escenarios ↓',
    hero_cta_repo: 'Repositorio GitHub ↗',
    hero_panel_title: 'Motor Científico en 3 Etapas',
    hs_1: 'Horizonte configurable (12–72 meses)',
    hs_2: 'Criterios (C1, C7, C9 vía FAO-56/33)',
    hs_3: 'Estados iniciales y cultivos Inv/Ver',
    hs_4: 'Filtro no compensatorio + IC 90%',
    s1_kicker: '1. Flujo de la Aplicación MVC',
    s1_title: '¿Cómo transforma Field Shift un clic en el mapa en un ranking explicable?',
    s1_sub: 'La aplicación completa en Express/EJS guía al productor o asesor en 4 pasos secuenciales con mini-tutoriales animados. Explorá cada etapa abajo:',
    wt_1: 'Paso 1 · Lote y Grilla NDVI',
    wt_2: 'Paso 2 · Suelo y Estrategias',
    wt_3: 'Paso 3 · Balance FAO-56 Mes a Mes',
    wt_4: 'Paso 4 · Auditoría SAW-15 / TOPSIS-15',
    ndvi_demo_title: 'Vista previa de Grilla NDVI (7×6 celdas · Paso 1)',
    ndvi_epist: 'Nota metodológica: la grilla interna de 42 celdas aplica patrones espaciales paramétricos (computeCellNdvi) anclados al estado inicial elegido y rangos Sentinel-2, sin sustituir imágenes multiespectrales de campo.',
    s2_kicker: '2. Fuentes Abiertas y Trazabilidad',
    s2_title: 'Los datos exactos que usa Field Shift (consulta en vivo desde tu navegador)',
    s2_sub: 'Las tres APIs abiertas principales (NASA POWER, ISRIC SoilGrids v2.0 y Georef AR) permiten consultas directas por CORS. Elegí una coordenada para traer datos reales o cargá el respaldo offline de Guaminí (EEA INTA Bordenave).',
    lbl_preset: 'Sitio de prueba',
    lbl_lat: 'Latitud',
    lbl_lon: 'Longitud',
    btn_fetch: '📡 Consultar NASA POWER + SoilGrids en vivo',
    btn_fallback: 'Usar Respaldo Guaminí JSON',
    chart_clima_title: 'Precipitación mensual vs. ET₀ Penman-Monteith FAO-56 (mm/mes)',
    json_title: 'Payload JSON real recibido y transformado',
    th_src: 'Fuente / Dataset',
    th_vars: 'Variables Extraídas',
    th_type: 'Naturaleza Epistemológica',
    th_use: 'Rol en el Motor v5.0',
    s3_kicker: '3. Laboratorio Interactivo (Mismas Ecuaciones de yieldModel.js y mcdaModel.js)',
    s3_title: 'Probá escenarios climáticos, profundidad de tosca y pesos de decisión',
    s3_sub: 'Este simulador ejecuta en tu navegador el Filtro de Aptitud Q0.05–Q0.95, el balance hídrico mensual en 3 sub-pasos, las penalizaciones FAO-33 (Ky) y la comparación entre SAW-15 y el índice no compensatorio TOPSIS-15 usando el clima y suelo cargados arriba.',
    pre_norm: 'Clima Normal',
    pre_nina: 'Sequía La Niña (-30% · +2°C)',
    pre_nino: 'El Niño (+30% lluvia)',
    pre_crisis: 'Crisis Económica',
    lbl_tosca: 'Profundidad útil (tosca):',
    sl_rain: 'Lluvia (Δ%)',
    sl_temp: 'Temperatura (+°C)',
    sl_water: 'Peso Agua',
    sl_econ: 'Peso Economía',
    chart_rank_title: 'Comparación SAW-15 vs. TOPSIS-15 (No Compensatorio)',
    th_strat: 'Estrategia (2 años)',
    th_apt: 'Aptitud',
    s4_kicker: '4. Auditoría Transparente',
    s4_title: 'Los 15 criterios (C1–C15) y parámetros de cultivo FAO-33',
    s4_sub: 'Cada criterio normaliza variables físicas en una escala de 0 a 100. Los marcados con la etiqueta FAO-33 se calculan dinámicamente a partir del balance hídrico real y extremos térmicos; los restantes combinan tasas agronómicas parametrizadas.',
    flt_all: 'Todos (15)',
    flt_water: 'Agua y Clima',
    flt_soil: 'Suelo y Cobertura',
    flt_bio: 'Biología y GEI',
    flt_econ: 'Economía y Riesgo',
    th_crop: 'Cultivo',
    th_hi: 'Índice Cosecha (HI)',
    th_minaw: 'AW mín. (mm)',
    th_mintosca: 'Tosca mín. (cm)',
    th_ypot: 'Ypot base (kg/ha)',
    s5_kicker: '5. Arquitectura Abierta (Apache 2.0)',
    s5_title: 'Estructura MVC, endpoints REST y cómo desplegarlo',
    s5_sub: 'El proyecto completo corre en Node.js + Express sin base de datos externa ni claves API obligatorias, y separa limpiamente conectores de datos, física de cultivos, análisis multicriterio y vistas.',
    dep_local_title: 'Ejecución local del sistema completo (Node.js)',
    arch_1: 'Orquesta la carga inicial SSR (GET /), metadatos (GET /api/equations) y recálculos dinámicos (POST /api/analyze).',
    arch_2: 'Consulta en paralelo NASA POWER (climatología + serie diaria), SoilGrids v2.0 y Georef AR con caché TTL y fallback JSON.',
    arch_3: 'Penman-Monteith FAO-56, curvas de excedencia térmica, función de rinde FAO-33, calibración MAGyP y filtro Q0.05–Q0.95.',
    arch_4: 'Simula 12–72 meses en 3 sub-pasos, evalúa SAW-8/SAW-15/TOPSIS-15 y renderiza Leaflet, Turf.js, Chart.js y mini-tutoriales.',
    dep_pages_title: 'Despliegue de este Explorador en GitHub Pages',
    dep_pages_desc: '1. Subir el repositorio a GitHub (rama main). 2. Ir a Settings → Pages → Build and deployment. 3. Elegir Deploy from a branch → main → /docs. 4. Esta página estática funciona sin servidor gracias a que NASA POWER, SoilGrids y Georef AR habilitan CORS abierto.',
    disclaimer_badge: 'Aviso: toda decisión agronómica requiere validación de un ingeniero agrónomo local.',
    ft_desc: 'Herramienta abierta de apoyo a la decisión en rotaciones agrícolas (Licencia Apache 2.0). Los resultados son inferencias modeladas para comparar alternativas y explorar riesgos climáticos; no reemplazan la prescripción profesional en campo.',
    ft_si: 'Transparencia SI (Space Apps 2026): Se utilizó asistencia de modelos de lenguaje (Super Intelligence) en la estructuración de código y documentación técnica bajo supervisión estudiantil; sin uso ni alteración de logotipos NASA.',
    ft_refs: 'Referencias Científicas Clave',
    ft_links: 'Fuentes Oficiales'
  },
  en: {
    top_strip: 'Field Shift v5.0 · Open Source Apache 2.0 · NASA Space Apps 2026 (Project UNSE) · Static GitHub Pages Interactive Explorer',
    nav_flow: 'How It Works',
    nav_data: 'Data & APIs',
    nav_sim: 'Simulator',
    nav_crit: '15 Criteria',
    nav_arch: 'Open Source',
    btn_dark: 'Dark',
    btn_light: 'Light',
    hero_eyebrow: 'Earth Observation + Agronomy · White-Box Apache 2.0',
    hero_title: 'How Field Shift v5.0 works and what open satellite data it processes',
    hero_lead: 'This static explorer documents the Field Shift v5.0 architecture and queries open APIs (NASA POWER + GWETROOT, 5-depth ISRIC SoilGrids v2.0, and Georef AR / Nominatim) directly from your browser—computing FAO-56 Penman-Monteith ET₀ and running SAW-15 / TOPSIS-15 comparisons.',
    hero_cta_api: 'Query Live APIs ↓',
    hero_cta_sim: 'Run Simulator ↓',
    hero_cta_repo: 'GitHub Repository ↗',
    hero_panel_title: '3-Stage Scientific Engine',
    hs_1: 'Configurable horizon (12–72 months)',
    hs_2: 'Criteria (C1, C7, C9 via FAO-56/33)',
    hs_3: 'Initial field states & Winter/Summer crops',
    hs_4: 'Non-compensatory filter + 90% CI',
    s1_kicker: '1. MVC Application Workflow',
    s1_title: 'How Field Shift turns a map click into an auditable crop-rotation ranking',
    s1_sub: 'The full Express/EJS app guides farmers and agronomists through 4 structured steps with animated mini-tutorials. Explore each stage below:',
    wt_1: 'Step 1 · Plot & NDVI Grid',
    wt_2: 'Step 2 · Soil & Strategy Builder',
    wt_3: 'Step 3 · Monthly FAO-56 Balance',
    wt_4: 'Step 4 · SAW-15 / TOPSIS-15 Audit',
    ndvi_demo_title: 'NDVI Spatial Grid Preview (7×6 cells · Step 1)',
    ndvi_epist: 'Methodological note: the 42-cell grid applies parametric spatial patterns (computeCellNdvi) anchored to the selected initial field state and Sentinel-2 NDVI ranges; it does not replace on-farm multispectral imagery.',
    s2_kicker: '2. Open Data Sources & Traceability',
    s2_title: 'The exact datasets used by Field Shift (live query from your browser)',
    s2_sub: 'The three main open APIs (NASA POWER, ISRIC SoilGrids v2.0, and Georef AR) support open CORS requests. Pick a coordinate to fetch real data or load the offline Guaminí fallback (EEA INTA Bordenave).',
    lbl_preset: 'Test location',
    lbl_lat: 'Latitude',
    lbl_lon: 'Longitude',
    btn_fetch: '📡 Fetch Live NASA POWER + SoilGrids',
    btn_fallback: 'Load Offline Guaminí JSON',
    chart_clima_title: 'Monthly Rainfall vs. FAO-56 Penman-Monteith ET₀ (mm/month)',
    json_title: 'Actual JSON payload received & transformed',
    th_src: 'Source / Dataset',
    th_vars: 'Extracted Variables',
    th_type: 'Epistemological Status',
    th_use: 'Role in v5.0 Engine',
    s3_kicker: '3. Interactive Lab (Ported from yieldModel.js & mcdaModel.js)',
    s3_title: 'Stress-test climate shocks, hardpan depth, and farmer priority weights',
    s3_sub: 'This client-side simulator executes the Q0.05–Q0.95 Aptitude Filter, 3-substep monthly soil water balance, FAO-33 (Ky) yield penalties, and SAW-15 vs. non-compensatory TOPSIS-15 scoring on the climate & soil data loaded above.',
    pre_norm: 'Normal Climate',
    pre_nina: 'La Niña Drought (-30% · +2°C)',
    pre_nino: 'El Niño (+30% rain)',
    pre_crisis: 'Economic Shock',
    lbl_tosca: 'Effective soil depth (hardpan):',
    sl_rain: 'Rainfall (Δ%)',
    sl_temp: 'Warming (+°C)',
    sl_water: 'Water Weight',
    sl_econ: 'Economy Weight',
    chart_rank_title: 'SAW-15 vs. Non-Compensatory TOPSIS-15 Comparison',
    th_strat: 'Strategy (2-yr cycle)',
    th_apt: 'Aptitude',
    s4_kicker: '4. White-Box Audit',
    s4_title: 'All 15 criteria (C1–C15) and FAO-33 crop parameters',
    s4_sub: 'Each criterion normalizes physical outputs onto a 0–100 scale. Criteria tagged FAO-33 compute dynamically from physical water balance and thermal exceedance; remaining criteria evaluate parameterized agronomic rates.',
    flt_all: 'All (15)',
    flt_water: 'Water & Climate',
    flt_soil: 'Soil & Cover',
    flt_bio: 'Biology & GHG',
    flt_econ: 'Economy & Risk',
    th_crop: 'Crop',
    th_hi: 'Harvest Index (HI)',
    th_minaw: 'Min AW (mm)',
    th_mintosca: 'Min Depth (cm)',
    th_ypot: 'Base Ypot (kg/ha)',
    s5_kicker: '5. Open-Source Architecture (Apache 2.0)',
    s5_title: 'MVC structure, REST endpoints, and deployment guide',
    s5_sub: 'The full Node.js + Express application runs without an external database or paid API keys, cleanly separating data connectors, crop physics, MCDA evaluation, and UI views.',
    dep_local_title: 'Run the full Node.js application locally',
    arch_1: 'Orchestrates SSR home rendering (GET /), metadata (GET /api/equations), and live recalculations (POST /api/analyze).',
    arch_2: 'Fetches NASA POWER (climatology + daily series), SoilGrids v2.0, and Georef AR in parallel with TTL cache & JSON fallback.',
    arch_3: 'FAO-56 Penman-Monteith, thermal exceedance curves, FAO-33 yield response, MAGyP calibration & Q0.05–Q0.95 filter.',
    arch_4: 'Runs 12–72 month 3-substep simulation, SAW-8/SAW-15/TOPSIS-15 scoring, and Leaflet, Turf.js, Chart.js & guided tutorials.',
    dep_pages_title: 'Deploy this Static Explorer on GitHub Pages',
    dep_pages_desc: '1. Push the repository to GitHub (main branch). 2. Open Settings → Pages → Build and deployment. 3. Select Deploy from a branch → main → /docs. 4. Works serverless because NASA POWER, SoilGrids, and Georef AR enable open CORS.',
    disclaimer_badge: 'Notice: agronomic decisions must always be validated with a local certified agronomist.',
    ft_desc: 'Open-source decision-support tool for adaptive crop rotations (Apache 2.0 License). Outputs are modeled inferences designed to compare options and climate risks—not standalone field prescriptions.',
    ft_si: 'SI Disclosure (Space Apps 2026): Language-model assistance (Super Intelligence) supported code structuring and documentation under student supervision; no NASA logos or branding were used or modified.',
    ft_refs: 'Key Scientific References',
    ft_links: 'Official Data Links'
  }
};

const WORKFLOW_STEPS = {
  1: {
    badge_es: 'Paso 1 · Delimitación Espacial y Estado Inicial',
    badge_en: 'Step 1 · Spatial Plot & Initial Field State',
    title_es: 'Polígono geodésico WGS84, Grilla NDVI y horizonte 1–6 años',
    title_en: 'WGS84 Geodesic Polygon, NDVI Grid & 1–6 Year Horizon',
    body_es: 'El usuario marca las esquinas de su lote sobre imágenes satelitales (Leaflet + Esri World Imagery). Turf.js calcula área exacta (m²/ha) y centroide. Luego elige la duración del ciclo (12 a 72 meses) y cuál de los 14 estados iniciales describe hoy el lote (soja, maíz, rastrojo de trigo, pastura, barbecho desnudo o maní arrancado).',
    body_en: 'Users outline parcel corners on satellite imagery (Leaflet + Esri World Imagery). Turf.js computes exact WGS84 area (m²/ha) and centroid. Users pick horizon length (12–72 months) and one of 14 starting field states (standing crops, wheat stubble, perennial pasture, bare fallow, or harvested peanut).',
    files: 'views/index.ejs · public/js/client.js · agroModel.getInitialFieldStates()'
  },
  2: {
    badge_es: 'Paso 2 · APIs Abiertas y Constructor de Estrategias',
    badge_en: 'Step 2 · Open APIs & Rotation Strategy Builder',
    title_es: 'Ingesta en paralelo (NASA POWER, SoilGrids, Georef) + Secuencias Inv/Ver',
    title_en: 'Parallel API Ingestion + Custom Winter/Summer Sequences',
    body_es: 'El backend consulta en paralelo NASA POWER (climatología + serie diaria), SoilGrids v2.0 (SOC, wv0033, wv1500, textura y cuantiles Q0.05–Q0.95) y Georef AR. Si el productor posee análisis de laboratorio o profundidad de tosca local, puede sobrescribirlos (reduciendo la incertidumbre en C2/C3). Además edita o crea estrategias año por año combinando 11 cultivos invernales y 10 estivales.',
    body_en: 'The backend queries NASA POWER (climatology + daily series), SoilGrids v2.0 (SOC, wv0033, wv1500, texture & Q0.05–Q0.95 quantiles), and Georef AR in parallel. Farmers can override soil water, SOC, hardpan depth, tenure, and machinery, and build custom year-by-year rotations from 11 winter + 10 summer crops.',
    files: 'models/agroModel.js · controllers/fieldShiftController.js'
  },
  3: {
    badge_es: 'Paso 3 · Simulación Mensual en 3 Sub-pasos',
    badge_en: 'Step 3 · 3-Substep Monthly Dynamic Simulation',
    title_es: 'Tanque de agua útil FAO-56, estrés Ks, ΔSOC y flujo de caja',
    title_en: 'FAO-56 Soil Water Tank, Ks Stress, ΔSOC & Cash Flow',
    body_es: 'En lugar de arrojar un número opaco, el motor simula cada mes (12 a 72 meses) en 3 sub-pasos hídricos: calcula precipitación efectiva según cobertura/labranza, ETc potencial, coeficiente de estrés hídrico Ks (p = 0.50), ETa real y drenaje profundo D. Cada celda de la línea de tiempo explica qué ocurre y cómo impacta el puntaje.',
    body_en: 'Instead of returning a black-box score, the engine steps month by month (12–72 months) in 3 hydrological sub-steps: effective rainfall by residue/tillage, potential ETc, FAO-56 water-stress factor Ks (p = 0.50), actual ETa, and deep drainage D—updating soil carbon and cumulative cash flow.',
    files: 'models/mcdaModel.js · simulateStrategyBiophysics()'
  },
  4: {
    badge_es: 'Paso 4 · Aptitud, FAO-33 y Auditoría Multicriterio',
    badge_en: 'Step 4 · Aptitude Filter, FAO-33 & MCDA Audit',
    title_es: 'Filtro Q0.05–Q0.95, extremos térmicos, SAW-15 y TOPSIS-15',
    title_en: 'Q0.05–Q0.95 Filter, Daily Extremes, SAW-15 & TOPSIS-15',
    body_es: 'Primero evalúa la aptitud física (Apto / Dudoso / No Apto). Luego aplica FAO-33 (Ky) más días de calor (>35 °C) y heladas (<0 °C) desde curvas empíricas de NASA POWER, calibrando Ypot contra estadísticas MAGyP de 10 años. Finalmente compara SAW-8, SAW-15 y el índice no compensatorio TOPSIS-15 bajo escenarios como Sequía La Niña o Crisis Económica.',
    body_en: 'Stage 1 runs the non-compensatory Aptitude Filter (Suitable / Uncertain / Unsuitable). Stage 3 applies FAO-33 Ky yield losses plus heat (>35°C) and frost (<0°C) days from POWER daily curves calibrated to 10-year MAGyP yields. Finally, SAW-8, SAW-15, and TOPSIS-15 rank strategies under live climate/price sliders.',
    files: 'models/yieldModel.js · models/extremesModel.js · models/mcdaModel.js'
  }
};

const NDVI_STATES = {
  soja_1ra: { base: 0.68, pat: 'headland_stress', note_es: 'Patrón: cabeceras compactadas (borde -0.18) y centro vigoroso.', note_en: 'Pattern: compacted headlands (-0.18 edge) with vigorous interior.' },
  soja_2da: { base: 0.62, pat: 'headland_stress', note_es: 'Doble cultivo sobre trigo; menor humedad de arranque (-8%).', note_en: 'Double crop over wheat stubble; lower initial profile moisture.' },
  maiz_temprano: { base: 0.72, pat: 'headland_stress', note_es: 'Gramínea de alto volumen de rastrojo C4 (C:N 55:1) y fuerte extracción.', note_en: 'High-biomass C4 grass leaving persistent stubble (C:N 55:1).' },
  maiz_tardio: { base: 0.66, pat: 'headland_stress', note_es: 'Maíz sembrado en diciembre esquivando golpe térmico de enero.', note_en: 'Late-planted maize shifting flowering away from Jan heat waves.' },
  sorgo_granifero: { base: 0.64, pat: 'uniform', note_es: 'Alta tolerancia térmica y rastrojo fibroso de lenta descomposición.', note_en: 'High heat resilience and durable fibrous residue cover.' },
  girasol: { base: 0.60, pat: 'uniform', note_es: 'Raíz pivotante profunda; deja baja cobertura tras cosecha.', note_en: 'Deep taproot; leaves sparse protective residue after harvest.' },
  mani: { base: 0.24, pat: 'low_bare', note_es: 'Patrón: suelo removido post-arrancado; requiere cobertura inmediata.', note_en: 'Pattern: disturbed soil post-digging; urgent winter cover needed.' },
  rastrojo_trigo: { base: 0.28, pat: 'uniform', note_es: '85% cobertura muerta protegiendo humedad contra evaporación.', note_en: '85% dense surface stubble shielding topsoil moisture.' },
  pastura_alfalfa: { base: 0.82, pat: 'uniform', note_es: 'Patrón: cobertura perenne densa y uniforme en todo el lote.', note_en: 'Pattern: dense, uniform perennial canopy across the plot.' },
  campo_natural: { base: 0.60, pat: 'wet_lowland', note_es: 'Patrón: gradiente micro-topográfico de loma a bajo húmedo.', note_en: 'Pattern: natural topographic gradient from upland to wet lowland.' },
  cobertura_vicia_centeno: { base: 0.74, pat: 'uniform', note_es: 'Fijación biológica + supresión de malezas previa a siembra estival.', note_en: 'Biological N fixation + active weed suppression before summer planting.' },
  barbecho_quimico: { base: 0.19, pat: 'low_bare', note_es: 'Sin raíces vivas consumiendo agua; riesgo moderado de lixiviación.', note_en: 'No active roots; moderate nitrate leaching risk.' },
  barbecho_desnudo: { base: 0.13, pat: 'low_bare', note_es: 'Patrón: suelo desnudo expuesto (<0.20) con alto riesgo erosivo.', note_en: 'Pattern: bare exposed soil (<0.20) with high erosion exposure.' },
  degradado_compactado: { base: 0.14, pat: 'low_bare', note_es: 'Pérdida de estructura superficial y encostramiento tras labranza.', note_en: 'Topsoil crusting and low infiltration after heavy tillage.' }
};

const EPIST_DATA = [
  {
    src: 'NASA POWER Climatology (community=AG)',
    vars: 'T2M, T2M_MAX, T2M_MIN, PRECTOTCORR, RH2M, WS2M, ALLSKY_SFC_SW_DWN',
    type_es: '🟢 Observación satelital/reanálisis en vivo (~50 km)',
    type_en: '🟢 Live satellite/reanalysis observation (~50 km)',
    use_es: 'Calcula ET₀ mensual Penman-Monteith FAO-56 y lluvia base para cualquier coordenada global.',
    use_en: 'Computes monthly FAO-56 Penman-Monteith ET₀ and rainfall baseline for any global coordinate.'
  },
  {
    src: 'NASA POWER Daily Series (20 años)',
    vars: 'T2M_MAX, T2M_MIN (YYYYMMDD)',
    type_es: '🟢 Serie histórica diaria en vivo (curvas de excedencia)',
    type_en: '🟢 Live 20-year daily time series (exceedance curves)',
    use_es: 'Modela días de calor (>35 °C en floración) y heladas (<0 °C) incluso bajo +ΔT climático.',
    use_en: 'Quantifies heat (>35°C at flowering) and frost (<0°C) days including +ΔT warming shifts.'
  },
  {
    src: 'ISRIC SoilGrids v2.0 REST API',
    vars: 'soc, wv0033, wv1500, sand, silt, clay (0–30 cm · mean, Q0.05, Q0.95)',
    type_es: '🟢 Cartografía edáfica digital en vivo (250 m) con cuantiles',
    type_en: '🟢 Live digital soil mapping (250 m) with quantiles',
    use_es: 'Determina Agua Útil (AW = wv0033 − wv1500), línea base SOC y Filtro de Aptitud Etapa 1.',
    use_en: 'Derives Available Water (AW = wv0033 − wv1500), baseline SOC, and Stage 1 Aptitude Filter.'
  },
  {
    src: 'Georef AR API (datos.gob.ar)',
    vars: 'provincia.nombre, departamento.nombre',
    type_es: '🟢 Servicio público oficial en vivo (Argentina)',
    type_en: '🟢 Live official territorial API (Argentina)',
    use_es: 'Normaliza provincia y partido/departamento del centroide del polígono.',
    use_en: 'Resolves province and district/department name from polygon centroid.'
  },
  {
    src: 'MAGyP / INDEC + INTA SIGA (EEA Bordenave)',
    vars: 'Rindes 10 años, desvío, CV% (Maíz, Trigo, Soja 1ra/2da, Sorgo)',
    type_es: '🟡 Estadística histórica regional + respaldo JSON offline',
    type_en: '🟡 Regional historical statistics + offline JSON fallback',
    use_es: 'Calibra Ypot departamental en yieldModel.js y parametriza riesgo económico C15.',
    use_en: 'Auto-calibrates district Ypot in yieldModel.js and sets yield-volatility risk (C15).'
  },
  {
    src: 'Sentinel-2 NDVI (7×6) & SMAP L4 (62%)',
    vars: 'NDVI inicial espacializado + llenado radicular 0–100 cm',
    type_es: '🔵 Capa paramétrica de referencia (anclada al estado inicial)',
    type_en: '🔵 Parameterized reference layer (anchored to initial state)',
    use_es: 'Inicializa mes 0 del balance hídrico y muestra heterogeneidad espacial orientativa.',
    use_en: 'Seeds Month 0 water balance and visualizes illustrative intra-field spatial patterns.'
  }
];

const CRITERIA_LIST = [
  { id: 'C1', dim: 'water', w: 10, computed: true, name_es: 'C1 Balance hídrico (ETa/ETc)', name_en: 'C1 Water Balance (ETa/ETc)', formula: 'C1 = 100 · clamp((0.50 − DH/ETc) / 0.50, 0, 1)', src: 'NASA POWER + FAO-56/33' },
  { id: 'C2', dim: 'water', w: 5, computed: false, name_es: 'C2 Retención edáfica (AW)', name_en: 'C2 Soil Retention (AW)', formula: 'C2 = f(AW_perfil × tosca/100 + Δ_bioporos)', src: 'ISRIC SoilGrids + Tosca' },
  { id: 'C3', dim: 'soil', w: 9, computed: false, name_es: 'C3 Carbono orgánico (ΔSOC)', name_en: 'C3 Soil Organic Carbon (ΔSOC)', formula: 'C3 = clamp(100 · (ΔSOC_anual + 0.35)/0.88, 8, 98)', src: 'SoilGrids + Meta-análisis Pampa' },
  { id: 'C4', dim: 'soil', w: 7, computed: false, name_es: 'C4 Cobertura viva (NDVI/ISI)', name_en: 'C4 Living Cover (NDVI/ISI)', formula: 'ISI = Días_vivos / Días_totales | C4 = f(ISI, NDVI)', src: 'Sentinel-2 ref. + Fenología' },
  { id: 'C5', dim: 'bio', w: 6, computed: false, name_es: 'C5 Interrupción de plagas', name_en: 'C5 Pest & Weed Break', formula: 'C5 = 100 · (0.45·Diversidad_familias + 0.55·Corte)', src: 'Tamburini et al. (2020) / INTA' },
  { id: 'C6', dim: 'soil', w: 6, computed: false, name_es: 'C6 Fijación biológica N (BFN)', name_en: 'C6 Biological N Fixation', formula: 'C6 = clamp(10 + 88 · BFN_anual / 195, 8, 98)', src: 'Frontiers in Agronomy (2023)' },
  { id: 'C7', dim: 'water', w: 7, computed: true, name_es: 'C7 Resiliencia térmica (>35°C/<0°C)', name_en: 'C7 Thermal & Frost Resilience', formula: 'C7 = 100 · clamp(1 − Pérdida_extremos / 0.40, 0, 1)', src: 'NASA POWER Serie Diaria' },
  { id: 'C8', dim: 'econ', w: 7, computed: false, name_es: 'C8 Liquidez y mercado', name_en: 'C8 Cash Liquidity', formula: 'C8 = f(Proporción_grano, Ingreso/Costo, Maquinaria)', src: 'MAGyP / BCR / Usuario' },
  { id: 'C9', dim: 'water', w: 8, computed: true, name_es: 'C9 Productividad del agua (WUE)', name_en: 'C9 Water Use Efficiency (WUE)', formula: 'WUE = Biomasa / ETa | C9 = norm([5..22] kg MS/ha/mm)', src: 'FAO-33 + Caviglia et al.' },
  { id: 'C10', dim: 'bio', w: 5, computed: false, name_es: 'C10 Retención de nitrógeno', name_en: 'C10 Anti-Leaching N', formula: 'C10 = clamp(95 − N_lixiviado_anual × 1.15, 8, 98)', src: 'Restovich et al. (2012)' },
  { id: 'C11', dim: 'soil', w: 8, computed: false, name_es: 'C11 Control de erosión (RUSLE)', name_en: 'C11 Erosion Control (RUSLE)', formula: 'A = R·K·LS·C·P | C11 = clamp(99 − A × 7.8, 8, 98)', src: 'GPM / SRTM / SoilGrids ref.' },
  { id: 'C12', dim: 'bio', w: 5, computed: false, name_es: 'C12 Balance neto GEI (CO₂-eq)', name_en: 'C12 Net GHG Balance', formula: 'GEI = −ΔSOC·(44/12) + N₂O_eq | C12 = f(GEI)', src: 'Abdalla et al. (2019) / Abalos (2022)' },
  { id: 'C13', dim: 'bio', w: 4, computed: false, name_es: 'C13 Carga ecotoxicológica', name_en: 'C13 Low Chemical Load', formula: 'C13 = clamp(94 − Aplicaciones_eq × 10.5, 8, 98)', src: 'Davis et al. (2012)' },
  { id: 'C14', dim: 'econ', w: 5, computed: false, name_es: 'C14 Simplicidad operativa', name_en: 'C14 Operational Simplicity', formula: 'C14 = f(Maquinaria, Labranza, Ventanas)', src: 'Logística del Productor' },
  { id: 'C15', dim: 'econ', w: 8, computed: false, name_es: 'C15 Margen ajustado por riesgo', name_en: 'C15 Sharpe Risk-Adjusted Margin', formula: 'C15 = f(Margen_neto, Volatilidad_flujos, Crisis)', src: 'MAGyP 10-yr CV / Sharpe' }
];

const CROP_PARAMS = {
  maiz:    { label: 'Maíz (1ra / Tardío)', ky: 1.25, hi: 0.50, minAw: 95, minTosca: 70, ypot: 9000, heatLoss: 0.025, frostLoss: 0.015 },
  soja1:   { label: 'Soja 1ra', ky: 0.85, hi: 0.40, minAw: 80, minTosca: 60, ypot: 3600, heatLoss: 0.012, frostLoss: 0.015 },
  soja2:   { label: 'Soja 2da', ky: 0.85, hi: 0.40, minAw: 75, minTosca: 55, ypot: 2600, heatLoss: 0.012, frostLoss: 0.015 },
  trigo:   { label: 'Trigo pan', ky: 1.00, hi: 0.42, minAw: 75, minTosca: 55, ypot: 4500, heatLoss: 0.010, frostLoss: 0.030 },
  cebada:  { label: 'Cebada cervecera', ky: 0.95, hi: 0.44, minAw: 70, minTosca: 50, ypot: 4400, heatLoss: 0.010, frostLoss: 0.025 },
  arveja:  { label: 'Arveja invernal', ky: 0.95, hi: 0.45, minAw: 75, minTosca: 55, ypot: 2600, heatLoss: 0.014, frostLoss: 0.028 },
  sorgo:   { label: 'Sorgo granífero', ky: 0.90, hi: 0.45, minAw: 58, minTosca: 45, ypot: 7000, heatLoss: 0.006, frostLoss: 0.020 },
  girasol: { label: 'Girasol', ky: 0.95, hi: 0.36, minAw: 72, minTosca: 65, ypot: 2800, heatLoss: 0.009, frostLoss: 0.018 },
  mani:    { label: 'Maní', ky: 0.80, hi: 0.42, minAw: 85, minTosca: 60, ypot: 3800, heatLoss: 0.010, frostLoss: 0.020 },
  alfalfa: { label: 'Alfalfa + Festuca', ky: 1.10, hi: 1.00, minAw: 85, minTosca: 75, ypot: 11000, heatLoss: 0.003, frostLoss: 0 }
};

/* --- Estrategias 2 años (fieles a mcdaModel.js getDefaultStrategies) --- */
const STRATEGIES = [
  {
    id: 'E0_Base', short: 'E0 Actual', name_es: 'Testigo Actual (Maíz / Soja + Barbecho desnudo)', name_en: 'Current Baseline (Maize / Soy + Bare Fallow)',
    pairs: [{ w: 'bare', s: 'maiz' }, { w: 'bare', s: 'soja1' }],
    cropsUsed: ['maiz', 'soja1'],
    staticScores: { c2: 48, c3: 18, c4: 24, c5: 38, c6: 26, c8: 64, c10: 28, c11: 22, c12: 24, c13: 32, c14: 88, c15: 44 }
  },
  {
    id: 'E1_Cob', short: 'E1 Cob. Inv.', name_es: 'Cobertura de Invierno (Centeno+Vicia → Maíz → Centeno → Soja)', name_en: 'Winter Cover Rotation (Rye+Vetch → Maize → Rye → Soy)',
    pairs: [{ w: 'cover', s: 'maiz' }, { w: 'cover', s: 'soja1' }],
    cropsUsed: ['maiz', 'soja1'],
    staticScores: { c2: 72, c3: 78, c4: 84, c5: 76, c6: 62, c8: 62, c10: 86, c11: 84, c12: 78, c13: 78, c14: 74, c15: 71 }
  },
  {
    id: 'E2_CerInv', short: 'E2 Cer. Inv.', name_es: 'Cereales Invernales + 2da (Trigo/Soja 2da → Rastrojo/Maíz Tardío)', name_en: 'Winter Cereal + 2nd Soy (Wheat/2nd Soy → Stubble/Late Maize)',
    pairs: [{ w: 'trigo', s: 'soja2' }, { w: 'stubble', s: 'maiz' }],
    cropsUsed: ['trigo', 'soja2', 'maiz'],
    staticScores: { c2: 64, c3: 58, c4: 72, c5: 72, c6: 38, c8: 74, c10: 66, c11: 72, c12: 56, c13: 60, c14: 80, c15: 68 }
  },
  {
    id: 'E3_Past', short: 'E3 Pastura', name_es: 'Pastura Perenne Consociada (Alfalfa + Festuca continua)', name_en: 'Perennial Mixed Pasture (Continuous Alfalfa + Fescue)',
    pairs: [{ w: 'alfalfa', s: 'alfalfa' }, { w: 'alfalfa', s: 'alfalfa' }],
    cropsUsed: ['alfalfa'],
    staticScores: { c2: 88, c3: 92, c4: 94, c5: 88, c6: 90, c8: 44, c10: 94, c11: 95, c12: 90, c13: 92, c14: 50, c15: 62 }
  },
  {
    id: 'E4_Nina', short: 'E4 Sequía', name_es: 'Resiliente a Sequía (Vicia/Sorgo → Centeno/Soja)', name_en: 'Drought-Resilient (Vetch/Sorghum → Rye/Soy)',
    pairs: [{ w: 'cover', s: 'sorgo' }, { w: 'cover', s: 'soja1' }],
    cropsUsed: ['sorgo', 'soja1'],
    staticScores: { c2: 74, c3: 76, c4: 80, c5: 80, c6: 74, c8: 66, c10: 84, c11: 82, c12: 76, c13: 76, c14: 76, c15: 79 }
  },
  {
    id: 'E5_Nino', short: 'E5 El Niño', name_es: 'Captura Excedentes (Trigo/Soja 2da → Centeno+Vicia/Maíz)', name_en: 'Surplus Capture (Wheat/2nd Soy → Rye+Vetch/Maize)',
    pairs: [{ w: 'trigo', s: 'soja2' }, { w: 'cover', s: 'maiz' }],
    cropsUsed: ['trigo', 'soja2', 'maiz'],
    staticScores: { c2: 70, c3: 74, c4: 86, c5: 78, c6: 64, c8: 76, c10: 78, c11: 80, c12: 70, c13: 70, c14: 76, c15: 73 }
  }
];

/* ==========================================================================
   PENMAN-MONTEITH FAO-56 (Portado directamente de models/yieldModel.js)
   ========================================================================== */
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const e0 = (T) => 0.6108 * Math.exp((17.27 * T) / (T + 237.3));

function extraterrestrialRadiation(latDeg, doy) {
  const phi = (latDeg * Math.PI) / 180;
  const dr = 1 + 0.033 * Math.cos((2 * Math.PI * doy) / 365);
  const delta = 0.409 * Math.sin((2 * Math.PI * doy) / 365 - 1.39);
  const ws = Math.acos(clamp(-Math.tan(phi) * Math.tan(delta), -1, 1));
  return ((24 * 60) / Math.PI) * 0.082 * dr *
    (ws * Math.sin(phi) * Math.sin(delta) + Math.cos(phi) * Math.cos(delta) * Math.sin(ws));
}

function et0PenmanMonteith({ tMean, tMax, tMin, rh, u2, rs, latDeg, doy, z = 100 }) {
  const P = 101.3 * Math.pow((293 - 0.0065 * z) / 293, 5.26);
  const gamma = 0.000665 * P;
  const es = (e0(tMax) + e0(tMin)) / 2;
  const ea = (es * rh) / 100;
  const delta = (4098 * e0(tMean)) / Math.pow(tMean + 237.3, 2);
  const ra = extraterrestrialRadiation(latDeg, doy);
  const rso = (0.75 + 2e-5 * z) * ra;
  const rns = 0.77 * rs;
  const rnl = 4.903e-9 * ((Math.pow(tMax + 273.16, 4) + Math.pow(tMin + 273.16, 4)) / 2) *
    (0.34 - 0.14 * Math.sqrt(Math.max(0.01, ea))) * (1.35 * Math.min(rs / Math.max(0.1, rso), 1) - 0.35);
  const rn = rns - rnl;
  const num = 0.408 * delta * rn + ((gamma * 900) / (tMean + 273)) * u2 * (es - ea);
  return Math.max(0, num / (delta + gamma * (1 + 0.34 * u2)));
}

/* ==========================================================================
   CONSULTA EN VIVO A APIS ABIERTAS CON CORS (POWER + SOILGRIDS + GEOREF)
   ========================================================================== */
async function fetchWithTimeout(url, ms = 7500) {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(id);
  }
}

function onSitePresetChange() {
  const [lat, lon] = document.getElementById('presetSiteSelect').value.split(',').map(Number);
  document.getElementById('latInput').value = lat.toFixed(4);
  document.getElementById('lonInput').value = lon.toFixed(4);
  fetchLiveApis();
}

async function fetchLiveApis() {
  const lat = Number(document.getElementById('latInput').value) || -36.8055;
  const lon = Number(document.getElementById('lonInput').value) || -62.0265;
  STATE.lat = lat;
  STATE.lon = lon;

  const badge = document.getElementById('apiStatusBadge');
  const btn = document.getElementById('fetchBtn');
  badge.className = 'badge badge-mid';
  badge.textContent = STATE.lang === 'es' ? 'Consultando APIs...' : 'Fetching live APIs...';
  btn.disabled = true;

  const powerUrl = `https://power.larc.nasa.gov/api/temporal/climatology/point?parameters=T2M,T2M_MAX,T2M_MIN,PRECTOTCORR,RH2M,WS2M,ALLSKY_SFC_SW_DWN&community=AG&longitude=${lon}&latitude=${lat}&format=JSON`;
  const soilUrl = `https://rest.isric.org/soilgrids/v2.0/properties/query?lon=${lon}&lat=${lat}&property=soc&property=wv0033&property=wv1500&property=sand&property=silt&property=clay&depth=0-5cm&depth=5-15cm&depth=15-30cm&depth=30-60cm&depth=60-100cm&value=mean&value=Q0.05&value=Q0.95`;
  const georefUrl = `https://apis.datos.gob.ar/georef/api/ubicacion?lat=${lat}&lon=${lon}`;
  const endDt = new Date(Date.now() - 2 * 86400000);
  const startDt = new Date(endDt.getTime() - 32 * 86400000);
  const ymd = (d) => d.toISOString().slice(0, 10).replace(/-/g, '');
  const recentUrl = `https://power.larc.nasa.gov/api/temporal/daily/point?parameters=GWETROOT&community=AG&longitude=${lon}&latitude=${lat}&start=${ymd(startDt)}&end=${ymd(endDt)}&format=JSON`;
  const meteoUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=soil_moisture_28_to_100cm`;

  const [pRes, sRes, gRes, rRes, mRes] = await Promise.allSettled([
    fetchWithTimeout(powerUrl, 8000),
    fetchWithTimeout(soilUrl, 8500),
    fetchWithTimeout(georefUrl, 4500),
    fetchWithTimeout(recentUrl, 6000),
    fetchWithTimeout(meteoUrl, 5000)
  ]);

  let liveCount = 0;
  const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

  if (pRes.status === 'fulfilled' && pRes.value?.properties?.parameter) {
    liveCount++;
    STATE.rawPower = pRes.value;
    const p = pRes.value.properties.parameter;
    const pick = (k, fb) => months.map((m) => (p[k] && Number.isFinite(p[k][m]) && p[k][m] > -900 ? p[k][m] : fb));
    const tMean = pick('T2M', 15);
    const tMax = pick('T2M_MAX', 22);
    const tMin = pick('T2M_MIN', 8);
    const rh = pick('RH2M', 65);
    const u2 = pick('WS2M', 3);
    let rs = pick('ALLSKY_SFC_SW_DWN', 16);
    if (Math.max(...rs) < 10) rs = rs.map((v) => v * 3.6);

    const rain = months.map((m, i) => Math.round((p.PRECTOTCORR?.[m] ?? 2.2) * DAYS_IN_MONTH[i]));
    const et0 = tMean.map((_, m) => Math.round(et0PenmanMonteith({
      tMean: tMean[m], tMax: tMax[m], tMin: tMin[m], rh: rh[m], u2: u2[m], rs: rs[m],
      latDeg: lat, doy: Math.round(15.2 + 30.4 * m), z: 100
    }) * DAYS_IN_MONTH[m]));

    STATE.env.clima = {
      modo: 'live_api',
      fuente: 'NASA POWER API (En vivo · Penman-Monteith FAO-56)',
      precipitacion_mm: rain,
      et0_calibrada_mm: et0,
      temp_media_c: tMean.map((v) => Number(v.toFixed(1))),
      dias_calor_35c: Math.max(2, Math.round(tMax.filter((v) => v > 30).length * 4.5)),
      dias_helada_0c: Math.max(0, Math.round(tMin.filter((v) => v < 6).length * 6))
    };
  }

  let liveMoistPct = 62;
  if (rRes.status === 'fulfilled' && rRes.value?.properties?.parameter?.GWETROOT) {
    const vals = Object.values(rRes.value.properties.parameter.GWETROOT).filter((v) => Number.isFinite(v) && v >= 0 && v <= 1);
    if (vals.length) liveMoistPct = Math.round(vals[vals.length - 1] * 100);
  } else if (mRes.status === 'fulfilled' && Number.isFinite(mRes.value?.current?.soil_moisture_28_to_100cm)) {
    liveMoistPct = Math.round(clamp((mRes.value.current.soil_moisture_28_to_100cm / 0.45) * 100, 10, 98));
  }

  if (sRes.status === 'fulfilled' && sRes.value?.properties?.layers) {
    const layers = sRes.value.properties.layers;
    const weights = { '0-5cm': 5, '5-15cm': 10, '15-30cm': 15, '30-60cm': 30, '60-100cm': 40 };
    const integ = (name) => {
      const depths = layers.find((l) => l.name === name)?.depths || [];
      let wSum = 0; const acc = { mean: 0, 'Q0.05': 0, 'Q0.95': 0 };
      depths.forEach((d) => {
        const w = weights[d.label] || 0;
        if (w > 0 && Number.isFinite(d.values?.mean)) {
          wSum += w;
          acc.mean += d.values.mean * w;
          acc['Q0.05'] += (d.values['Q0.05'] ?? d.values.mean * 0.75) * w;
          acc['Q0.95'] += (d.values['Q0.95'] ?? d.values.mean * 1.25) * w;
        }
      });
      if (!wSum) return depths[0]?.values || {};
      return { mean: acc.mean / wSum, 'Q0.05': acc['Q0.05'] / wSum, 'Q0.95': acc['Q0.95'] / wSum };
    };
    const fc = integ('wv0033');
    const wp = integ('wv1500');
    const soc = integ('soc');
    const sand = integ('sand');
    const silt = integ('silt');
    const clay = integ('clay');
    if (fc.mean && wp.mean) {
      liveCount++;
      STATE.rawSoil = sRes.value;
      STATE.env.suelo = {
        modo: 'live_api',
        fuente: 'ISRIC SoilGrids v2.0 (250 m · perfil 0–100 cm en 5 capas)',
        taxonomia: 'Perfil integrado ISRIC 0–100 cm',
        textura: `Arena ${Math.round((sand.mean || 500) / 10)}% · Limo ${Math.round((silt.mean || 300) / 10)}% · Arcilla ${Math.round((clay.mean || 200) / 10)}%`,
        soc_g_kg: {
          media: Number(((soc.mean || 184) / 10).toFixed(1)),
          q05: Number(((soc['Q0.05'] || 121) / 10).toFixed(1)),
          q95: Number(((soc['Q0.95'] || 258) / 10).toFixed(1))
        },
        aw_mm_m: {
          media: Math.max(55, Math.round(fc.mean - wp.mean)),
          q05: Math.max(40, Math.round((fc['Q0.05'] || fc.mean * 0.75) - (wp['Q0.05'] || wp.mean * 0.75))),
          q95: Math.max(70, Math.round((fc['Q0.95'] || fc.mean * 1.25) - (wp['Q0.95'] || wp.mean * 1.25)))
        },
        humedad_smap_inicial_pct: liveMoistPct
      };
    }
  } else {
    STATE.env.suelo.humedad_smap_inicial_pct = liveMoistPct;
  }

  if (gRes.status === 'fulfilled' && gRes.value?.ubicacion?.provincia?.nombre) {
    const u = gRes.value.ubicacion;
    STATE.env.georef = {
      modo: 'live_api',
      etiqueta: `${u.departamento ? u.departamento.nombre : 'Zona Rural'}, ${u.provincia.nombre}`
    };
  } else {
    try {
      const nom = await fetchWithTimeout(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=jsonv2&zoom=10&accept-language=es`, 3500);
      const a = nom?.address || {};
      const lbl = [a.county || a.city || a.town || a.village, a.state, a.country].filter(Boolean).slice(0, 2).join(', ');
      STATE.env.georef = { modo: lbl ? 'nominatim' : 'coord_global', etiqueta: lbl || `${Math.abs(lat).toFixed(2)}° ${lat >= 0 ? 'N' : 'S'}, ${Math.abs(lon).toFixed(2)}° ${lon >= 0 ? 'E' : 'O'}` };
    } catch (_) {
      STATE.env.georef = { modo: 'coord_global', etiqueta: `${Math.abs(lat).toFixed(2)}° ${lat >= 0 ? 'N' : 'S'}, ${Math.abs(lon).toFixed(2)}° ${lon >= 0 ? 'E' : 'O'}` };
    }
  }

  btn.disabled = false;
  if (liveCount > 0) {
    badge.className = 'badge badge-live';
    badge.textContent = STATE.lang === 'es' ? `APIs en vivo OK (${liveCount}/2 principales)` : `Live APIs OK (${liveCount}/2 core)`;
  } else {
    loadOfflineFallback();
    badge.className = 'badge badge-low';
    badge.textContent = STATE.lang === 'es' ? 'Sin conexión/CORS → Respaldo Guaminí' : 'Offline → Guaminí Fallback';
    return;
  }

  renderAllDataViews();
}

function loadOfflineFallback() {
  STATE.env = JSON.parse(JSON.stringify(FALLBACK_GUAMINI));
  STATE.rawPower = null;
  STATE.rawSoil = null;
  STATE.lat = FALLBACK_GUAMINI.meta.coordenadas.lat;
  STATE.lon = FALLBACK_GUAMINI.meta.coordenadas.lon;
  document.getElementById('latInput').value = STATE.lat.toFixed(4);
  document.getElementById('lonInput').value = STATE.lon.toFixed(4);
  const badge = document.getElementById('apiStatusBadge');
  badge.className = 'badge badge-mid';
  badge.textContent = STATE.lang === 'es' ? 'Respaldo Offline Guaminí' : 'Guaminí Offline Fallback';
  renderAllDataViews();
}

/* ==========================================================================
   SIMULACIÓN EN NAVEGADOR (APTITUD Q0.05-Q0.95 + 3 SUBPASOS + FAO-33 + TOPSIS)
   ========================================================================== */
function applySimPreset(mode) {
  STATE.simMode = mode;
  STATE.economicCrisis = mode === 'crisis';
  const r = document.getElementById('simRain');
  const t = document.getElementById('simTemp');
  const w = document.getElementById('simWater');
  const e = document.getElementById('simEcon');

  if (mode === 'normal') { r.value = 0; t.value = 0; w.value = 30; e.value = 20; }
  else if (mode === 'nina') { r.value = -30; t.value = 2.0; w.value = 35; e.value = 20; }
  else if (mode === 'nino') { r.value = 30; t.value = 0; w.value = 25; e.value = 20; }
  else if (mode === 'crisis') { r.value = -10; t.value = 1.0; w.value = 25; e.value = 35; }

  ['simPreNormal', 'simPreNina', 'simPreNino', 'simPreCrisis'].forEach((id) => {
    const el = document.getElementById(id);
    el.classList.remove('btn-forest');
    el.classList.add('btn-outline');
  });
  const activeId = { normal: 'simPreNormal', nina: 'simPreNina', nino: 'simPreNino', crisis: 'simPreCrisis' }[mode];
  document.getElementById(activeId).classList.replace('btn-outline', 'btn-forest');
  runBrowserSimulation();
}

function evaluateAptitude(st, toscaCm) {
  const awStats = STATE.env.suelo.aw_mm_m;
  const depthFactor = toscaCm / 100;
  const awQ05 = Math.round(awStats.q05 * depthFactor);
  const awQ95 = Math.round(awStats.q95 * depthFactor);
  let status = 'apto';
  const notes = [];

  st.cropsUsed.forEach((cid) => {
    const p = CROP_PARAMS[cid];
    if (!p) return;
    if (toscaCm < p.minTosca || awQ95 < p.minAw) {
      status = 'no_apto';
      notes.push(`${p.label} (<${p.minAw}mm/${p.minTosca}cm)`);
    } else if (awQ05 < p.minAw && status !== 'no_apto') {
      status = 'dudoso';
      notes.push(`${p.label} (Q0.05=${awQ05}mm)`);
    }
  });
  return { status, awQ05, awQ95, notes };
}

function runBrowserSimulation() {
  const rainDelta = Number(document.getElementById('simRain').value);
  const tempDelta = Number(document.getElementById('simTemp').value);
  const wWaterPct = Number(document.getElementById('simWater').value);
  const wEconPct = Number(document.getElementById('simEcon').value);
  const toscaCm = Number(document.getElementById('simTosca').value);

  document.getElementById('simRainLbl').textContent = `${rainDelta > 0 ? '+' : ''}${rainDelta}%`;
  document.getElementById('simTempLbl').textContent = `+${tempDelta.toFixed(1)} °C`;
  document.getElementById('simWaterLbl').textContent = `${wWaterPct}%`;
  document.getElementById('simEconLbl').textContent = `${wEconPct}%`;

  const wWater = wWaterPct / 100;
  const wEcon = wEconPct / 100;
  const rem = Math.max(0.10, 1 - wWater - wEcon);
  const wSoil = rem * 0.60;
  const wBio = rem * 0.40;
  const rawW = CRITERIA_LIST.map((c) => {
    if (c.dim === 'water') return c.w * (wWater / 0.30);
    if (c.dim === 'econ') return c.w * (wEcon / 0.20);
    if (c.dim === 'soil') return c.w * (wSoil / 0.30);
    return c.w * (wBio / 0.20);
  });
  const wSum = rawW.reduce((a, b) => a + b, 0);
  const weights = rawW.map((x) => x / wSum);

  const awMax = Math.max(40, Math.round(STATE.env.suelo.aw_mm_m.media * (toscaCm / 100)));
  const rainArr = STATE.env.clima.precipitacion_mm;
  const et0Arr = STATE.env.clima.et0_calibrada_mm;
  const tArr = STATE.env.clima.temp_media_c;

  const kcMap = { bare: 0.22, stubble: 0.28, cover: 0.66, trigo: 0.85, alfalfa: 0.88, maiz: 1.06, soja1: 0.96, soja2: 0.92, sorgo: 0.84 };
  const infiltMap = { bare: 0.70, stubble: 0.82, cover: 0.90, trigo: 0.90, alfalfa: 0.92, maiz: 0.90, soja1: 0.90, soja2: 0.90, sorgo: 0.90 };

  const results = STRATEGIES.map((st) => {
    let soilWater = Math.round(awMax * 0.62);
    let dhCrop = 0;
    let etcCrop = 0;
    let etaAll = 0;
    let biomass = 0;
    let seasonLosses = [];

    for (let y = 0; y < 2; y++) {
      const pair = st.pairs[y];
      [
        { id: pair.w, months: [4, 5, 6, 7, 8, 9] },
        { id: pair.s, months: [10, 11, 0, 1, 2, 3] }
      ].forEach((blk) => {
        let bEta = 0;
        let bEtc = 0;
        blk.months.forEach((m) => {
          const pEf = rainArr[m] * (1 + rainDelta / 100) * (infiltMap[blk.id] || 0.9);
          const etc = et0Arr[m] * (kcMap[blk.id] || 0.8) * (1 + tempDelta * 0.035);
          for (let k = 0; k < 3; k++) {
            soilWater += pEf / 3;
            if (soilWater > awMax) soilWater = awMax;
            const ks = Math.min(1, soilWater / (0.5 * awMax));
            const eta = Math.min(soilWater, ks * (etc / 3));
            soilWater -= eta;
            bEta += eta;
            etaAll += eta;
          }
          bEtc += etc;
        });

        if (blk.id === 'bare' || blk.id === 'stubble') return;
        dhCrop += Math.max(0, bEtc - bEta);
        etcCrop += bEtc;
        if (blk.id === 'cover') {
          biomass += 12 * bEta;
          return;
        }
        const cp = CROP_PARAMS[blk.id];
        const ratio = bEtc > 0 ? Math.min(1, bEta / bEtc) : 1;
        const yfWater = clamp(1 - cp.ky * (1 - ratio), 0, 1);
        const peakT = Math.max(...blk.months.map((m) => tArr[m])) + tempDelta;
        const hotDays = peakT > 21 ? (peakT - 20) * 1.4 : 0.8;
        const heatLoss = Math.min(0.4, cp.heatLoss * hotDays);
        const yf = yfWater * (1 - heatLoss);
        biomass += (cp.ypot * yf) / cp.hi;
        seasonLosses.push(heatLoss);
      });
    }

    const deficitFrac = etcCrop > 0 ? dhCrop / etcCrop : 0;
    const wue = etaAll > 0 ? biomass / etaAll : 0;
    const meanLoss = seasonLosses.length ? seasonLosses.reduce((a, b) => a + b, 0) / seasonLosses.length : 0;

    const c1 = Math.round(100 * clamp((0.50 - deficitFrac) / 0.50, 0, 1));
    const c7 = Math.round(100 * clamp(1 - meanLoss / 0.40, 0, 1));
    const c9 = Math.round(100 * clamp((wue - 5) / 17, 0, 1));

    const s = st.staticScores;
    const c2Adj = Math.round(clamp(s.c2 * (toscaCm / 100), 12, 98));
    const c15Adj = STATE.economicCrisis ? Math.max(15, s.c15 - 12) : s.c15;
    const c8Adj = STATE.economicCrisis ? Math.max(18, s.c8 - 10) : s.c8;

    const scores = [c1, c2Adj, s.c3, s.c4, s.c5, s.c6, c7, c8Adj, c9, s.c10, s.c11, s.c12, s.c13, s.c14, c15Adj];
    const saw15 = scores.reduce((acc, v, i) => acc + weights[i] * v, 0);
    const aptitude = evaluateAptitude(st, toscaCm);
    return { ...st, scores, c1, c7, c9, saw15, aptitude };
  });

  // TOPSIS-15 vectorial
  const denoms = CRITERIA_LIST.map((_, i) => Math.sqrt(results.reduce((a, r) => a + r.scores[i] * r.scores[i], 0)) || 1);
  const wNorm = results.map((r) => r.scores.map((v, i) => weights[i] * (v / denoms[i])));
  const idealP = CRITERIA_LIST.map((_, i) => Math.max(...wNorm.map((row) => row[i])));
  const idealN = CRITERIA_LIST.map((_, i) => Math.min(...wNorm.map((row) => row[i])));
  results.forEach((r, idx) => {
    let dp = 0; let dn = 0;
    wNorm[idx].forEach((v, i) => {
      dp += Math.pow(v - idealP[i], 2);
      dn += Math.pow(v - idealN[i], 2);
    });
    dp = Math.sqrt(dp); dn = Math.sqrt(dn);
    r.topsis15 = dp + dn > 0 ? (dn / (dp + dn)) * 100 : r.saw15;
  });

  const sorted = [...results].sort((a, b) => b.topsis15 - a.topsis15);
  renderSimulatorOutputs(sorted, results);
}

/* ==========================================================================
   RENDERIZADORES DE UI Y GRÁFICOS
   ========================================================================== */
function renderWorkflowStep() {
  const s = WORKFLOW_STEPS[STATE.workflowStep];
  const isEs = STATE.lang === 'es';
  document.getElementById('workflowDetailCard').innerHTML = `
    <span class="badge badge-live">${isEs ? s.badge_es : s.badge_en}</span>
    <h3 class="card-title-serif" style="margin-top:10px;">${isEs ? s.title_es : s.title_en}</h3>
    <p style="font-size:14px; color:var(--graphite); margin-bottom:12px;">${isEs ? s.body_es : s.body_en}</p>
    <div class="formula-inline"><strong>${isEs ? 'Módulos:' : 'Modules:'}</strong> ${s.files}</div>
  `;
}

function selectWorkflowStep(n) {
  STATE.workflowStep = n;
  [1, 2, 3, 4].forEach((i) => {
    document.getElementById(`wTab${i}`).classList.toggle('active', i === n);
  });
  renderWorkflowStep();
}

function getNdviColor(val) {
  if (val < 0.16) return '#9e2a2b';
  if (val < 0.24) return '#c85a17';
  if (val < 0.34) return '#e08e45';
  if (val < 0.46) return '#e9c46a';
  if (val < 0.58) return '#a3b18a';
  if (val < 0.70) return '#588157';
  if (val < 0.79) return '#2d6a4f';
  return '#07503f';
}

function renderNdviPreview() {
  const key = document.getElementById('ndviStateSelect').value;
  const st = NDVI_STATES[key];
  const isEs = STATE.lang === 'es';
  document.getElementById('ndviStateNote').textContent = isEs ? st.note_es : st.note_en;

  const rows = 6; const cols = 7;
  let html = '';
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const edge = Math.min(r, rows - 1 - r, c, cols - 1 - c);
      let offset = Math.sin(r * 1.45 + c * 1.15) * 0.065 + Math.cos(r * 0.7 - c * 1.6) * 0.035;
      if (st.pat === 'headland_stress') offset += (edge === 0 ? -0.18 : (edge === 1 ? -0.04 : 0.11));
      else if (st.pat === 'low_bare') offset += (edge === 0 ? -0.04 : 0.03) + offset * 0.2;
      else if (st.pat === 'wet_lowland') offset += (((r / 5 + c / 6) / 2) - 0.5) * 0.26;
      else offset += (edge === 0 ? -0.05 : 0.03);
      const val = clamp(st.base + offset, 0.10, 0.89);
      html += `<div class="ndvi-cell" style="background:${getNdviColor(val)};">${val.toFixed(2)}</div>`;
    }
  }
  document.getElementById('ndviGridPreview').innerHTML = html;
}

function renderJsonPreview() {
  const mode = document.getElementById('jsonTabSelect').value;
  const box = document.getElementById('jsonPreviewBox');
  let obj = STATE.env;
  if (mode === 'power') obj = STATE.rawPower || { info: 'Usando respaldo offline (clic en Consultar APIs para ver JSON crudo de NASA POWER)' };
  if (mode === 'soil') obj = STATE.rawSoil || { info: 'Usando respaldo offline (clic en Consultar APIs para ver JSON crudo de SoilGrids v2.0)' };
  box.textContent = JSON.stringify(obj, null, 2).slice(0, 6500);
}

function renderEpistTable() {
  const isEs = STATE.lang === 'es';
  document.getElementById('epistTableBody').innerHTML = EPIST_DATA.map((row) => `
    <tr>
      <td><strong>${row.src}</strong></td>
      <td><code>${row.vars}</code></td>
      <td>${isEs ? row.type_es : row.type_en}</td>
      <td>${isEs ? row.use_es : row.use_en}</td>
    </tr>
  `).join('');
}

function renderSimulatorOutputs(sorted, all) {
  const isEs = STATE.lang === 'es';
  const aptLabel = (a) => {
    if (a.status === 'apto') return `<span class="badge badge-live">${isEs ? 'Apto' : 'Suitable'}</span>`;
    if (a.status === 'dudoso') return `<span class="badge badge-mid">${isEs ? 'Dudoso' : 'Uncertain'}</span>`;
    return `<span class="badge badge-low">${isEs ? 'No Apto' : 'Unsuitable'}</span>`;
  };

  document.getElementById('simPodiumGrid').innerHTML = sorted.slice(0, 3).map((r, idx) => `
    <div class="podium-card ${idx === 0 ? 'rank-1' : ''}">
      <div style="display:flex; justify-content:space-between; align-items:center; gap:6px; margin-bottom:8px;">
        <strong>#${idx + 1} · ${r.short}</strong>
        ${aptLabel(r.aptitude)}
      </div>
      <div style="font-size:12.5px; color:var(--pewter); min-height:36px;">${isEs ? r.name_es : r.name_en}</div>
      <div style="display:flex; gap:14px; margin-top:10px; font-size:13px;">
        <span>TOPSIS-15: <strong style="color:var(--forest-ink); font-size:17px;">${r.topsis15.toFixed(1)}</strong></span>
        <span>SAW-15: <strong>${r.saw15.toFixed(1)}</strong></span>
      </div>
      <div class="muted" style="margin-top:6px; font-size:11.5px;">C1 (ETa): ${r.c1} · C7 (T°): ${r.c7} · C9 (WUE): ${r.c9}</div>
    </div>
  `).join('');

  document.getElementById('simTableBody').innerHTML = all.map((r) => `
    <tr>
      <td><strong>${r.short}</strong></td>
      <td>${aptLabel(r.aptitude)}</td>
      <td>${r.c1}</td>
      <td>${r.c7}</td>
      <td>${r.c9}</td>
      <td>${r.saw15.toFixed(1)}</td>
      <td><strong>${r.topsis15.toFixed(1)}</strong></td>
    </tr>
  `).join('');

  drawRankingChart(all);
}

function renderCriteriaGrid() {
  const isEs = STATE.lang === 'es';
  const filtered = STATE.critFilter === 'all' ? CRITERIA_LIST : CRITERIA_LIST.filter((c) => c.dim === STATE.critFilter);
  document.getElementById('criteriaGrid').innerHTML = filtered.map((c) => `
    <div class="crit-card">
      <div style="display:flex; justify-content:space-between; align-items:center; gap:6px; margin-bottom:6px;">
        <strong style="font-size:13.5px;">${isEs ? c.name_es : c.name_en}</strong>
        ${c.computed ? '<span class="badge badge-fao">FAO-33</span>' : `<span class="badge badge-live">${c.w}%</span>`}
      </div>
      <div class="muted" style="font-size:11.5px;">${isEs ? 'Fuente:' : 'Source:'} ${c.src}</div>
      <div class="formula-inline">${c.formula}</div>
    </div>
  `).join('');
}

function filterCriteria(dim, btn) {
  STATE.critFilter = dim;
  btn.parentElement.querySelectorAll('.step-tab').forEach((b) => b.classList.remove('active'));
  btn.classList.add('active');
  renderCriteriaGrid();
}

function renderCropTable() {
  document.getElementById('cropParamsBody').innerHTML = Object.values(CROP_PARAMS).map((c) => `
    <tr>
      <td><strong>${c.label}</strong></td>
      <td>${c.ky.toFixed(2)}</td>
      <td>${c.hi.toFixed(2)}</td>
      <td>${c.minAw} mm</td>
      <td>${c.minTosca} cm</td>
      <td>${c.ypot.toLocaleString()} kg/ha</td>
    </tr>
  `).join('');
}

/* --- Charts (Chart.js + fallback Canvas nativo si CDN no está disponible) --- */
function drawClimateChart() {
  const canvas = document.getElementById('climateChart');
  const rain = STATE.env.clima.precipitacion_mm;
  const et0 = STATE.env.clima.et0_calibrada_mm;
  const labels = STATE.lang === 'es' ? MONTHS_ES : MONTHS_EN;
  const isDark = STATE.theme === 'dark';
  const tickColor = isDark ? '#cad9d3' : '#353535';

  if (typeof Chart === 'undefined') {
    const ctx = canvas.getContext('2d');
    const w = canvas.width = canvas.parentElement.clientWidth || 480;
    const h = canvas.height = 250;
    ctx.clearRect(0, 0, w, h);
    const maxV = Math.max(...rain, ...et0, 150);
    const stepX = (w - 40) / 12;
    rain.forEach((v, i) => {
      const x = 24 + i * stepX;
      const bh = (v / maxV) * (h - 50);
      ctx.fillStyle = '#588157';
      ctx.fillRect(x, h - 28 - bh, 14, bh);
      ctx.fillStyle = tickColor;
      ctx.font = '10px sans-serif';
      ctx.fillText(labels[i], x, h - 10);
    });
    // Curva naranja ET0 FAO-56 sobre las barras
    ctx.strokeStyle = '#d97706';
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    et0.forEach((eVal, i) => {
      const ex = 24 + i * stepX + 7;
      const ey = h - 28 - (eVal / maxV) * (h - 50);
      if (i === 0) ctx.moveTo(ex, ey);
      else ctx.lineTo(ex, ey);
    });
    ctx.stroke();
    return;
  }

  if (STATE.climateChart) STATE.climateChart.destroy();
  STATE.climateChart = new Chart(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: STATE.lang === 'es' ? 'Precipitación (mm)' : 'Rainfall (mm)', data: rain, backgroundColor: '#588157', borderRadius: 6 },
        { label: 'ET₀ FAO-56 (mm)', data: et0, type: 'line', borderColor: '#d97706', backgroundColor: '#d97706', tension: 0.3, borderWidth: 2.5 }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { labels: { color: tickColor } } },
      scales: {
        x: { ticks: { color: tickColor } },
        y: { beginAtZero: true, ticks: { color: tickColor } }
      }
    }
  });
}

function drawRankingChart(all) {
  const canvas = document.getElementById('rankingChart');
  const labels = all.map((r) => r.short);
  const isDark = STATE.theme === 'dark';
  const tickColor = isDark ? '#cad9d3' : '#353535';

  if (typeof Chart === 'undefined') return;
  if (STATE.rankingChart) STATE.rankingChart.destroy();
  STATE.rankingChart = new Chart(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: 'SAW-15', data: all.map((r) => Number(r.saw15.toFixed(1))), backgroundColor: '#588157', borderRadius: 6 },
        { label: 'TOPSIS-15', data: all.map((r) => Number(r.topsis15.toFixed(1))), backgroundColor: isDark ? '#82e6a8' : '#07503f', borderRadius: 6 }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { labels: { color: tickColor } } },
      scales: {
        x: { ticks: { color: tickColor } },
        y: { beginAtZero: true, max: 100, ticks: { color: tickColor } }
      }
    }
  });
}

function renderAllDataViews() {
  const c = STATE.env.clima;
  const s = STATE.env.suelo;
  const isEs = STATE.lang === 'es';
  const rainSum = c.precipitacion_mm.reduce((a, b) => a + b, 0);
  const et0Sum = c.et0_calibrada_mm.reduce((a, b) => a + b, 0);

  document.getElementById('kpiRain').textContent = `${rainSum} mm/${isEs ? 'año' : 'yr'}`;
  document.getElementById('kpiEt0').textContent = `ET₀ FAO-56: ${et0Sum} mm/${isEs ? 'año' : 'yr'}`;
  document.getElementById('kpiAw').textContent = `${s.aw_mm_m.media} mm/m`;
  document.getElementById('kpiAwRange').textContent = `Q0.05–Q0.95: ${s.aw_mm_m.q05}–${s.aw_mm_m.q95} mm/m`;
  document.getElementById('kpiSoc').textContent = `${s.soc_g_kg.media} g/kg`;
  document.getElementById('kpiTexture').textContent = s.textura;
  document.getElementById('kpiPlace').textContent = STATE.env.georef.etiqueta;
  document.getElementById('kpiCoords').textContent = `${STATE.lat.toFixed(4)}°, ${STATE.lon.toFixed(4)}°`;

  drawClimateChart();
  renderJsonPreview();
  runBrowserSimulation();
}

/* ==========================================================================
   IDIOMA Y MODO OSCURO
   ========================================================================== */
function applyTranslations() {
  const dict = I18N[STATE.lang];
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    const key = el.getAttribute('data-i18n');
    if (dict[key]) el.textContent = dict[key];
  });
  const themeLbl = document.querySelector('#themeBtn span');
  if (themeLbl) themeLbl.textContent = STATE.theme === 'dark' ? dict.btn_light : dict.btn_dark;
  renderWorkflowStep();
  renderNdviPreview();
  renderEpistTable();
  renderCriteriaGrid();
  renderAllDataViews();
}

function toggleLang() {
  STATE.lang = STATE.lang === 'es' ? 'en' : 'es';
  applyTranslations();
}

function applyDocsTheme(theme) {
  STATE.theme = theme === 'dark' ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', STATE.theme);
  try { localStorage.setItem('fs_docs_theme', STATE.theme); } catch (_) {}
  const btn = document.getElementById('themeBtn');
  if (btn) {
    btn.innerHTML = STATE.theme === 'dark'
      ? `☀️ <span>${I18N[STATE.lang].btn_light}</span>`
      : `🌙 <span>${I18N[STATE.lang].btn_dark}</span>`;
  }
}

function toggleTheme() {
  applyDocsTheme(STATE.theme === 'light' ? 'dark' : 'light');
  drawClimateChart();
  runBrowserSimulation();
}

window.addEventListener('DOMContentLoaded', () => {
  try {
    const saved = localStorage.getItem('fs_docs_theme');
    if (saved) STATE.theme = saved === 'dark' ? 'dark' : 'light';
  } catch (_) {}
  applyDocsTheme(STATE.theme);
  renderCropTable();
  applyTranslations();
});
