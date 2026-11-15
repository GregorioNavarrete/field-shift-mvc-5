/**
 * @file public/js/client.js
 * @description Controlador cliente de Field Shift v3.0:
 *  - 14 estados iniciales de lote vinculados al mapa NDVI y simulación
 *  - Grilla interna NDVI Sentinel-2 con color científico, etiqueta numérica y diagnóstico por celda
 *  - Ciclos flexibles de 1 a 6 años (12 a 72 meses)
 *  - Constructor e interfaz completa de estrategias en el Paso 2 con condiciones iniciales propias
 *  - Modo Oscuro persistente (incluyendo ejes y grillas Chart.js)
 *  - Sistema integral de Popups explicativos + ecuaciones matematicas utilizadas
 */

const APP_DATA = window.__INITIAL_DATA__;
let BASELINE_STRATEGIES = JSON.parse(JSON.stringify(APP_DATA.simulation.strategies));

const CLIENT_STATE = {
  lang: 'es',
  theme: 'light',
  currentStep: 0,
  lat: APP_DATA.params.lat,
  lon: APP_DATA.params.lon,
  areaM2: APP_DATA.params.areaM2,
  areaHa: APP_DATA.params.areaM2 / 10000,
  meanNdvi: APP_DATA.envContext?.satellite?.meanNdvi ?? 0.33,
  showNdviOverlay: true,
  showNdviNumbers: true,
  satelliteData: APP_DATA.envContext?.satellite || null,
  satFetching: false,
  satLastBboxKey: '',
  satDebounceTimer: null,
  selectedStrategyId: APP_DATA.simulation.strategies[1]?.id || APP_DATA.simulation.strategies[0].id,
  selectedMonthIndex: 7,
  isLocalOverride: false,
  economicCrisis: false,
  scenarioMode: 'normal',
  simulation: APP_DATA.simulation,
  envContext: APP_DATA.envContext,
  configuredStrategies: JSON.parse(JSON.stringify(APP_DATA.simulation.strategies)),
  editingStrategyId: null,
  playbackTimer: null,
  seenTutorials: {},
  chartGuideExpanded: true,
  tutorialState: { active: false, paused: false, step: 0, idx: 0, timer: null }
};

let map, polygonLayer, ndviLayerGroup, ndviLabelsGroup, vertexMarkers = [];
let currentLatLngs = [];
let timelineChartInstance = null;
let rankingChartInstance = null;

function formatCoords(lat, lon, isEs = CLIENT_STATE.lang === 'es') {
  const latH = lat >= 0 ? 'N' : 'S';
  const lonH = lon >= 0 ? 'E' : (isEs ? 'O' : 'W');
  return `${Math.abs(lat).toFixed(6)}° ${latH}, ${Math.abs(lon).toFixed(6)}° ${lonH}`;
}

/* ==========================================================================
   1. DICCIONARIO BILINGÜE COMPLETO (ESPAÑOL / INGLÉS)
   ========================================================================== */
const I18N = {
  es: {
    mq_1: '✓ NASA Space Apps 2026 — Field Shift v5.0 (FAO-56 · FAO-33 · MCDA)',
    mq_2: '✓ Planetary Computer Sentinel-2 L2A + NASA POWER + SoilGrids 5 Profundidades',
    mq_3: '✓ Filtro Aptitud · Auditoría SAW-15 · TOPSIS-15 · Monte Carlo (N=10.000)',
    mq_4: '✓ Licencia Abierta Apache 2.0 — Ciclos 1 a 6 Años & Mini-Tutorial Interactivo',
    hdr_ready: 'Version 5.0 · 2026',
    hdr_step_prefix: 'Paso',
    hdr_of: 'de 4',
    btn_tour_hdr: 'Tutorial',
    btn_mini_tut: 'Mini-tutorial paso',
    pt_skip: 'Saltar tutorial ✕',
    pt_pause: 'Pausar',
    pt_resume: 'Reanudar',
    pt_paused_badge: '⏸ Pausado',
    pt_next: 'Siguiente ▶',
    pt_finish: 'Listo ✓',
    btn_sat_detect: 'Detectar satélite en lote',
    btn_guide_hdr: '📘 Guía',
    btn_theme_dark: 'Oscuro',
    btn_theme_light: 'Claro',
    hero_eyebrow: 'Decisión Agronómica Guiada. Basado en datos NASA',
    hero_title: 'Elige la mejor rotación viendo exactamente qué cambia en tu suelo',
    hero_sub: 'Un recorrido guiado en 4 pasos: delimitá tu lote con grilla NDVI real, elegí estado inicial y duración (1 a 6 años), diseñá tus estrategias con sus propias condiciones y obtené resultados explicados en cada dato.',
    hero_start_btn: 'Hacer un cálculo →',
    st_1: 'Lote y Mapa NDVI',
    st_2: 'Suelo y Estrategias',
    st_3: 'Línea de Tiempo',
    st_4: 'Resultados y Criterios',
    s1_kicker: 'Paso 1 de 4 · Delimitación Espacial, NDVI Interno y Estado de Partida',
    s1_title: 'Marca los puntos de tu lote para inspeccionar el NDVI por cuadro e iniciar el ciclo',
    s1_intro: 'Haz clic sobre la imagen satelital para marcar tu parcela (mínimo 3 puntos). Cada cuadro interno muestra su color y valor exacto de NDVI Sentinel-2 acorde al estado inicial del campo. Hacé clic en cualquier cuadro del mapa para ver su diagnóstico.',
    s1_map_hint: 'Haz clic en las esquinas del lote o tocá un cuadro interno de color para leer su NDVI exacto.',
    btn_undo: '↩ Quitar último punto',
    btn_clear: 'Limpiar mapa',
    btn_preset: 'Cargar Guaminí (100.000 m²)',
    ndvi_title: 'Grilla NDVI Realista por Cuadro (Sentinel-2 — 10 m)',
    btn_ndvi_nums_hide: '🔢 Ocultar números',
    btn_ndvi_nums_show: '🔢 Ver números NDVI',
    btn_ndvi_hide: '👁️ Ocultar capa NDVI',
    btn_ndvi_show: '👁️ Mostrar capa NDVI',
    btn_explain: '¿Qué significa?',
    ndvi_t0: '0,00–0,19 Suelo desnudo (Terracota)',
    ndvi_t1: '0,20–0,44 Rastrojo/Baja (Ocre)',
    ndvi_t2: '0,45–0,69 Cultivo activo (Salvia)',
    ndvi_t3: '0,70+ Vigor pleno (Verde)',
    poly_ready: 'Polígono Validado',
    lbl_area: 'Superficie Calculada del Lote',
    lbl_loc: 'Centroide y Jurisdicción (API Georef)',
    lbl_start_date: 'Inicio del ciclo',
    lbl_duration: 'Duración del ciclo',
    opt_1y: '1 año (12 meses · Campaña)',
    opt_2y: '2 años (24 meses)',
    opt_3y: '3 años (36 meses · Trienal)',
    opt_4y: '4 años (48 meses)',
    opt_5y: '5 años (60 meses)',
    opt_6y: '6 años (72 meses · Ciclo INTA)',
    lbl_prev_crop: 'Cultivo inicial o estado actual del campo',
    btn_back_home: '← Volver al inicio',
    btn_to_s2: 'Completar Paso 1 y seguir al Paso 2 →',
    s2_kicker: 'Paso 2 de 4 · Datos Satelitales y Diseño de Estrategias',
    s2_title: 'Revisá los datos NASA/INTA, ajustá tu lote y diseñá las estrategias a comparar',
    s2_intro: 'Consultamos las APIs abiertas para tu coordenada. Podés ajustar los datos base del lote y luego crear o editar cada estrategia candidata con su secuencia año por año y sus condiciones iniciales antes de enviar todo al motor matemático.',
    card_rain_lbl: 'Lluvia y Demanda Calibrada',
    card_smap_lbl: 'Humedad Radicular Inicial',
    card_smap_sub: 'Carga hídrica inicial del perfil en 0–100 cm.',
    card_magyp_lbl: 'Estabilidad Rindes 10 años',
    card_magyp_sub: 'Sorgo: 5.400 kg/ha. Maíz: 6.900 kg/ha.',
    s2_form_title: 'Parámetros Base del Lote y Manejo del Agricultor',
    s2_form_sub: 'Determinados en vivo por satélite según el polígono del Paso 1. Si contás con análisis INTA, laboratorio o medición propia, podés editarlos abajo.',
    badge_sat_mode: 'Modo Satélite (IC 90%)',
    badge_field_mode: 'Calibrado con Dato INTA / Propio ✓',
    btn_edit_inta: 'Modificar con datos INTA / propios',
    btn_edit_inta_active: 'Editando valores INTA / propios',
    btn_reset_sat: 'Usar datos satelitales del Paso 1',
    inp_aw: 'Agua Disponible Perfil (mm/m)',
    hint_aw: 'Modifica: Capacidad del tanque hídrico y C2.',
    inp_moist: 'Humedad Inicial del Suelo (%)',
    hint_moist: 'Modifica: Reserva de agua en el Mes 1.',
    inp_soc: 'Carbono Orgánico Lab (g/kg)',
    hint_soc: 'Modifica: Línea base SOC y reduce error en C3.',
    inp_tosca: 'Profundidad útil / Tosca (cm)',
    opt_tosca_100: 'Sin limitante (> 100 cm perfil útil)',
    opt_tosca_75: 'Tosca moderada a 75 cm (-25% agua útil)',
    opt_tosca_50: 'Tosca somera a 50 cm (-50% agua útil)',
    hint_tosca: 'Modifica: Lámina máxima almacenada.',
    inp_tenure: 'Tenencia de la tierra',
    opt_owner: 'Propietario (equilibrio suelo + rinde)',
    opt_tenant: 'Arrendatario 1–2 años (prioriza caja rápida)',
    hint_tenure: 'Modifica: Peso de liquidez (C8 y C15).',
    inp_mach: 'Maquinaria y Destino Forrajero',
    opt_mach_grain: 'Contratista agrícola (solo cosecha grano)',
    opt_mach_livestock: 'Con ganadería / rollos propios',
    opt_mach_own: 'Equipo propio con rolo faca',
    hint_mach: 'Modifica: Viabilidad de pastura y sorgo (C8/C14).',
    sb_kicker: 'Constructor de Estrategias a Evaluar',
    sb_title: 'Crea o edita cada estrategia con su secuencia y situación inicial antes de analizar',
    sb_sub: 'Cada tarjeta representa una estrategia que se enviará al motor SAW-15 / TOPSIS-15. Puede modificar sus cultivos año a año (Invierno/Verano), cambiar su duración o darle condiciones iniciales propias (humedad, labranza, tosca, SOC).',
    sb_btn_restore: '↺ Restaurar Base',
    sb_btn_add: '+ Crear Nueva Estrategia',
    sb_tpl_lbl: 'Agregar plantilla rápida:',
    sb_tpl_1: '+ Regenerativa 6 Años (Mixta)',
    sb_tpl_2: '+ Trigo / Girasol / Nabo (3 Años)',
    sb_tpl_3: '+ Maní + Centeno Protector (2 Años)',
    sb_tpl_4: '+ Contraste Labranza Convencional',
    btn_back_s1: '← Volver al Paso 1 (Editar lote)',
    btn_to_s3: 'Mandar todo a analizar y ver Simulación (Paso 3) →',
    s3_kicker: 'Paso 3 de 4 · Simulación Temporal Mes a Mes',
    s3_title: 'Línea de tiempo interactiva con estados intermedios y explicación al pie',
    s3_intro: 'Inspecciona cada estrategia analizada mes a mes. Haz clic en cualquier mes o en el botón (?) de cualquier indicador para entender exactamente qué mide y cómo se calcula.',
    s3_chart_guide_title: '📊 Cómo leer este gráfico y qué significan sus tendencias',
    s3_btn_chart_tour: 'Mini-tutorial de los gráficos',
    s3_btn_toggle_guide: 'Ocultar guía',
    s3_btn_show_guide: 'Mostrar guía de gráficos',
    s3_chart_axes_hint: 'El Eje Izquierdo mide Agua Útil (mm), Vigor NDVI (×100) y Nitrógeno (kg/ha). El Eje Derecho mide el Carbono Acumulado en tu lote (t C). Hacé clic en cualquier punto de las curvas para inspeccionar ese mes.',
    chk_compare_e0: 'Comparar agua útil vs. Testigo Base',
    btn_prev_m: '◀ Mes anterior',
    btn_play_m: '▶ Recorrer ciclo automáticamente',
    btn_pause_m: '⏸ Pausar recorrido',
    btn_next_m: 'Mes siguiente ▶',
    leg_comm: 'Cultivo comercial',
    leg_cov: 'Cobertura viva',
    leg_stub: 'Rastrojo',
    leg_bare: 'Suelo desnudo',
    fn_kicker: 'Detalle del Mes Seleccionado',
    btn_fn_eq: '? · ƒx Fórmulas del mes',
    btn_back_s2: '← Volver al Paso 2 (Editar Estrategias)',
    btn_to_s4: 'Seguir a Gráficos y Conclusiones (Paso 4) →',
    s4_kicker: 'Paso 4 de 4 · Resultados Auditados, Escenarios y Popups Explicativos',
    s4_title: 'Gráficos comparativos, prueba de estrés climático y explicación de cada resultado',
    s4_intro: 'Evaluá el ranking final SAW-15, SAW-8 y TOPSIS-15. Haz clic en cualquier criterio o puntaje de la tabla para abrir un popup con detalles tecnicos del indicador, su ecuación exacta y cómo mejorar ese puntaje.',
    scen_prompt: 'Probar escenario climático o económico particular:',
    sc_normal: 'Clima Normal (Base)',
    sc_nina: 'Sequía La Niña (-30% lluvia · +2°C)',
    sc_nino: 'Evento El Niño (+30% lluvia)',
    sc_crisis: 'Crisis Económica (-20% grano · +40% urea)',
    sl_rain: 'Perturbación Lluvia',
    sl_rain_h: 'Modifica: C1 (Agua) y C15 (Riesgo).',
    sl_temp: 'Anomalía Térmica',
    sl_temp_h: 'Modifica: C7 (Calor) y C1 (ETc).',
    sl_wwater: 'Prioridad Agua',
    sl_wwater_h: 'Modifica pesos: C1, C2, C7, C9.',
    sl_wecon: 'Prioridad Caja',
    sl_wecon_h: 'Modifica pesos: C8, C14, C15.',
    conc_kicker: 'Síntesis Agronómica Auditada',
    btn_explain_res: 'Criterios de lectura del diagnóstico',
    conc_title: 'Conclusiones y recomendación para tu parcela',
    chart_rank_title: 'Gráfico Comparativo: Puntaje Ponderado (SAW-15) vs. No Compensatorio (TOPSIS-15)',
    btn_audit_mcda: '? · ƒx Auditar fórmulas SAW, TOPSIS y Monte Carlo',
    tbl_click_hint: 'Tip interactivo: Haz clic en cualquier criterio (C1–C15), puntaje de la tabla o fila final (SAW-8 / SAW-15 / TOPSIS) para abrir su explicación detallada.',
    btn_all_crit: '📘 Ver los 15 criterios juntos',
    cat_title: 'Parámetros Fisiológicos de las Especies Evaluadas',
    btn_back_s3: '← Volver al Paso 3 (Línea de Tiempo)',
    btn_restart: '↻ Iniciar nuevo cálculo',
    ft_desc: 'Herramienta abierta de apoyo a la decisión agronómica bajo cambio climático (Apache 2.0). Desafío NASA Space Apps 2026. Toda decisión de manejo debe validarse con un ingeniero agrónomo matriculado.',
    ft_apis: 'APIs Integradas',
    ft_api_1: 'NASA POWER API (Clima + GWETROOT)',
    ft_api_2: 'ISRIC SoilGrids v2.0 (5 Profundidades · IC 90%)',
    ft_api_3: 'Planetary Computer Sentinel-2 L2A (10 m) & Open-Meteo',
    ft_api_4: 'Georef AR + OSM Nominatim · INTA · MAGyP',
    ft_arch: 'Arquitectura MVC v5.0',
    ft_arch_1: 'Backend: Node.js + Express + EJS',
    ft_arch_2: 'Física: Penman-Monteith FAO-56 + FAO-33',
    ft_arch_3: 'Geodesia: Leaflet.js + Turf.js + Chart.js',
    ft_arch_4: 'Motor: SAW-15 · TOPSIS-15 · Extremos POWER',
    mod_badge: 'Fundamento Técnico y Fórmulas',
    btn_close: 'Cerrar ✕',
    btn_cancel: 'Cancelar',
    se_badge: 'Configurador de Estrategia Agronómica',
    se_title_new: 'Crear Nueva Estrategia de Rotación',
    se_title_edit: 'Editar Estrategia y Condiciones Iniciales',
    se_lbl_short: 'Código corto',
    se_lbl_name: 'Nombre descriptivo',
    se_lbl_years: 'Duración de esta estrategia',
    se_seq_title: '1. Secuencia de Cultivos Año por Año (Otoño-Invierno y Primavera-Verano)',
    se_seq_sub: 'Elige qué cubre el lote en invierno y qué cultivo comercial sembrarías en verano.',
    se_init_title: '2. Datos y Situación Inicial Propia de esta Estrategia',
    se_chk_global: 'Heredar parámetros base del lote (Paso 1 y 2)',
    se_inp_prev: 'Estado / Cultivo Inicial',
    se_inp_til: 'Sistema de Labranza',
    opt_til_sd: 'Siembra Directa continua',
    opt_til_vert: 'Labranza vertical / cincel ocasional',
    opt_til_conv: 'Labranza convencional (reja/rastra)',
    se_inp_moist: 'Humedad Inicial (%)',
    se_inp_aw: 'Agua Disponible AW (mm/m)',
    se_inp_soc: 'SOC Inicial (g/kg)',
    se_inp_tosca: 'Profundidad útil / Tosca (cm)',
    se_btn_save: 'Guardar Estrategia en Comparativa ✓',
    dir_badge: 'Glosario Científico-Agronómico Completo',
    dir_title: '¿Qué significa cada dato, criterio (C1–C15) y método matemático?',
    dir_sub: 'Explora cada criterio y conceptos con su ecuación exacta y fuente oficial NASA/INTA.'
  },
  en: {
    mq_1: '✓ NASA Space Apps 2026 — Field Shift v5.0 (FAO-56 · FAO-33 · MCDA)',
    mq_2: '✓ Planetary Computer Sentinel-2 L2A + NASA POWER + 5-Depth SoilGrids',
    mq_3: '✓ Aptitude Filter · Audited SAW-15 · TOPSIS-15 · Monte Carlo (N=10,000)',
    mq_4: '✓ Open Source Apache 2.0 — 1–6 Yr Cycles & Interactive Pointer Tour',
    hdr_ready: 'Version 5.0 · 2026',
    hdr_step_prefix: 'Step',
    hdr_of: 'of 4',
    btn_tour_hdr: 'Tour',
    btn_mini_tut: 'mini-tutorial',
    pt_skip: 'Skip tutorial ✕',
    pt_pause: 'Pause',
    pt_resume: 'Resume',
    pt_paused_badge: '⏸ Paused',
    pt_next: 'Next ▶',
    pt_finish: 'Got it ✓',
    btn_sat_detect: 'Detect satellite on plot',
    btn_guide_hdr: '📘 Guide',
    btn_theme_dark: 'Dark',
    btn_theme_light: 'Light',
    hero_eyebrow: 'NASA Earth Observation · Guided Agronomic Decision Support',
    hero_title: 'Choose the best crop rotation by seeing exactly what changes in your soil',
    hero_sub: 'A 4-step workflow: delineate your plot with real cell-level NDVI colors, choose initial field state & duration (1–6 years), build candidate strategies with custom initial conditions, and inspect formula explanations on every metric.',
    hero_start_btn: 'Make a calculation →',
    st_1: 'Plot & NDVI Map',
    st_2: 'Soil & Strategies',
    st_3: 'Timeline',
    st_4: 'Results & Criteria',
    s1_kicker: 'Step 1 of 4 · Spatial Plot, Cell-Level NDVI & Starting State',
    s1_title: 'Mark plot corners to inspect per-cell NDVI vigor and start the cycle',
    s1_intro: 'Click on the satellite map to mark your plot (minimum 3 points). Each internal square shows its real Sentinel-2 NDVI color and numeric value matching your initial field state. Click any internal square for cell diagnostics.',
    s1_map_hint: 'Click corners on map or click any colored internal square to inspect its exact NDVI.',
    btn_undo: '↩ Undo last point',
    btn_clear: 'Clear map',
    btn_preset: 'Load Guaminí (100,000 m²)',
    ndvi_title: 'Cell-Level Satellite NDVI Grid (Sentinel-2 — 10 m)',
    btn_ndvi_nums_hide: '🔢 Hide numbers',
    btn_ndvi_nums_show: '🔢 Show NDVI numbers',
    btn_ndvi_hide: '👁️ Hide NDVI layer',
    btn_ndvi_show: '👁️ Show NDVI layer',
    btn_explain: 'What does this mean?',
    ndvi_t0: '0.00–0.19 Bare soil (Terracotta)',
    ndvi_t1: '0.20–0.44 Stubble/Low (Ochre)',
    ndvi_t2: '0.45–0.69 Active crop (Sage)',
    ndvi_t3: '0.70+ Peak vigor (Forest green)',
    poly_ready: 'Validated Polygon',
    lbl_area: 'Calculated Plot Surface Area',
    lbl_loc: 'Centroid & Jurisdiction (Georef API)',
    lbl_start_date: 'Cycle start date',
    lbl_duration: 'Cycle duration',
    opt_1y: '1 year (12 months · Single season)',
    opt_2y: '2 years (24 months)',
    opt_3y: '3 years (36 months · Triennial)',
    opt_4y: '4 years (48 months)',
    opt_5y: '5 years (60 months)',
    opt_6y: '6 years (72 months · Full INTA cycle)',
    lbl_prev_crop: 'Initial crop or current field state',
    btn_back_home: '← Back to home',
    btn_to_s2: 'Complete Step 1 and go to Step 2 →',
    s2_kicker: 'Step 2 of 4 · Satellite Data & Candidate Strategy Designer',
    s2_title: 'Review NASA/INTA data, adjust base plot, and build candidate strategies',
    s2_intro: 'We queried open APIs for your coordinates. Adjust global plot parameters, then create or edit each strategy (crop sequence year by year and strategy-specific initial soil/tillage conditions) before sending everything to the engine.',
    card_rain_lbl: 'Rainfall & Calibrated ET₀',
    card_smap_lbl: 'Initial Root-Zone Moisture',
    card_smap_sub: 'Initial water fill in 0–100 cm profile.',
    card_magyp_lbl: '10-Year Yield Stability',
    card_magyp_sub: 'Sorghum: 5,400 kg/ha (CV 17%). Maize: 6,900 kg/ha.',
    s2_form_title: 'Base Plot Parameters & Farmer Management',
    s2_form_sub: 'Determined live by satellite for your Step 1 plot. If you have INTA, lab, or farm-level measurements, you can edit them below.',
    badge_sat_mode: 'Satellite Mode (90% CI)',
    badge_field_mode: 'Calibrated with INTA / Farm Data ✓',
    btn_edit_inta: 'Modify with INTA / farm data',
    btn_edit_inta_active: 'Editing INTA / farm data',
    btn_reset_sat: 'Use Step 1 satellite data',
    inp_aw: 'Profile Available Water (mm/m)',
    hint_aw: 'Modifies: Water tank capacity and C2.',
    inp_moist: 'Initial Soil Moisture (%)',
    hint_moist: 'Modifies: Starting water reserve in Month 1.',
    inp_soc: 'Lab Soil Organic Carbon (g/kg)',
    hint_soc: 'Modifies: SOC baseline and cuts C3 uncertainty.',
    inp_tosca: 'Effective Soil Depth / Hardpan (cm)',
    opt_tosca_100: 'No restriction (> 100 cm effective profile)',
    opt_tosca_75: 'Moderate hardpan at 75 cm (-25% available water)',
    opt_tosca_50: 'Shallow hardpan at 50 cm (-50% available water)',
    hint_tosca: 'Modifies: Maximum water storage capacity.',
    inp_tenure: 'Land Tenure',
    opt_owner: 'Owner (balances soil health + yield)',
    opt_tenant: '1–2 yr Tenant (prioritizes short-term cash)',
    hint_tenure: 'Modifies: Liquidity weights (C8 and C15).',
    inp_mach: 'Machinery & Livestock Integration',
    opt_mach_grain: 'Grain contractor (harvests grain only)',
    opt_mach_livestock: 'Integrated livestock / own hay baling',
    opt_mach_own: 'Own machinery with roller-crimper',
    hint_mach: 'Modifies: Pasture & sorghum feasibility (C8/C14).',
    sb_kicker: 'Candidate Strategy Builder',
    sb_title: 'Create or edit each strategy with its sequence & initial conditions before analysis',
    sb_sub: 'Every card here is sent to the SAW-15 / TOPSIS-15 engine. Customize Winter/Summer crops year by year, change duration (1–6 years), or assign strategy-specific initial soil & tillage conditions.',
    sb_btn_restore: '↺ Restore Defaults',
    sb_btn_add: '+ Create New Strategy',
    sb_tpl_lbl: 'Add quick template:',
    sb_tpl_1: '+ Regenerative 6-Yr (Mixed)',
    sb_tpl_2: '+ Wheat / Sunflower / Radish (3-Yr)',
    sb_tpl_3: '+ Peanut + Protective Rye (2-Yr)',
    sb_tpl_4: '+ Conventional Tillage Contrast',
    btn_back_s1: '← Back to Step 1 (Edit plot)',
    btn_to_s3: 'Send All Strategies to Analyze & Simulate (Step 3) →',
    s3_kicker: 'Step 3 of 4 · Month-by-Month Temporal Simulation',
    s3_title: 'Interactive timeline with intermediate states & explanatory footnote',
    s3_intro: 'Inspect each analyzed strategy month by month. Click any month tile or the (?) button on any metric to read what it means and how it is calculated.',
    s3_chart_guide_title: '📊 How to read this chart & what the trends mean',
    s3_btn_chart_tour: 'Charts mini-tutorial',
    s3_btn_toggle_guide: 'Hide guide',
    s3_btn_show_guide: 'Show charts guide',
    s3_chart_axes_hint: 'Left Axis shows Available Water (mm), Cover NDVI (×100), and Nitrogen (kg/ha). Right Axis shows Accumulated Plot Carbon (t C). Click any point on the curves to inspect that month.',
    chk_compare_e0: 'Compare available water vs. Baseline Strategy',
    btn_prev_m: '◀ Previous month',
    btn_play_m: '▶ Auto-play cycle',
    btn_pause_m: '⏸ Pause playback',
    btn_next_m: 'Next month ▶',
    leg_comm: 'Cash crop',
    leg_cov: 'Living cover crop',
    leg_stub: 'Stubble fallow',
    leg_bare: 'Bare soil',
    fn_kicker: 'Selected Month Detail · Footnote Explanation',
    btn_fn_eq: '? · ƒx Month formulas',
    btn_back_s2: '← Back to Step 2 (Edit Strategies)',
    btn_to_s4: 'Continue to Charts & Conclusions (Step 4) →',
    s4_kicker: 'Step 4 of 4 · Audited Results, Stress Scenarios & Interactive Popups',
    s4_title: 'Comparative charts, climate stress tests & criterion-level explanations',
    s4_intro: 'Evaluate SAW-15, SAW-8, and TOPSIS-15 rankings. Click any criterion (C1–C15), score chip, or summary row in the table to open a clear popup explaining what it means, its exact formula, and how to improve it.',
    scen_prompt: 'Test a climate or economic shock scenario:',
    sc_normal: 'Normal Climate (Base)',
    sc_nina: 'La Niña Drought (-30% rain · +2°C)',
    sc_nino: 'El Niño Event (+30% rain)',
    sc_crisis: 'Economic Crisis (-20% grain · +40% urea)',
    sl_rain: 'Rainfall Perturbation',
    sl_rain_h: 'Modifies: C1 (Water) and C15 (Risk).',
    sl_temp: 'Thermal Anomaly',
    sl_temp_h: 'Modifies: C7 (Heat) and C1 (ETc).',
    sl_wwater: 'Water Priority',
    sl_wwater_h: 'Modifies weights: C1, C2, C7, C9.',
    sl_wecon: 'Cash Flow Priority',
    sl_wecon_h: 'Modifies weights: C8, C14, C15.',
    conc_kicker: 'Audited Agronomic Synthesis',
    btn_explain_res: 'How to read these results?',
    conc_title: 'Conclusions and recommendation for your plot',
    chart_rank_title: 'Comparative Chart: Weighted Score (SAW-15) vs. Non-Compensatory (TOPSIS-15)',
    btn_audit_mcda: '? · ƒx Audit SAW, TOPSIS & Monte Carlo formulas',
    tbl_click_hint: 'Interactive tip: Click any criterion (C1–C15), score chip, or summary row (SAW-8 / SAW-15 / TOPSIS) to open a detailed explanation popup.',
    btn_all_crit: '📘 Browse all 15 criteria',
    cat_title: 'Physiological Parameters of Evaluated Species',
    btn_back_s3: '← Back to Step 3 (Timeline)',
    btn_restart: '↻ Start new calculation',
    ft_desc: 'Open-source agronomic decision support tool under climate change (Apache 2.0). NASA Space Apps 2026 Challenge. Validate all field decisions with a licensed agronomist.',
    ft_apis: 'Integrated APIs',
    ft_api_1: 'NASA POWER API (Climatology + GWETROOT)',
    ft_api_2: 'ISRIC SoilGrids v2.0 (5 Depths · 90% CI)',
    ft_api_3: 'Planetary Computer Sentinel-2 L2A (10 m) & Open-Meteo',
    ft_api_4: 'Georef AR + OSM Nominatim · INTA · MAGyP',
    ft_arch: 'MVC Architecture v5.0',
    ft_arch_1: 'Backend: Node.js + Express + EJS',
    ft_arch_2: 'Physics: Penman-Monteith FAO-56 + FAO-33',
    ft_arch_3: 'Geodesy: Leaflet.js + Turf.js + Chart.js',
    ft_arch_4: 'Engine: SAW-15 · TOPSIS-15 · POWER Extremes',
    mod_badge: 'Technical Basis & Evaluation Formulas',
    btn_close: 'Close ✕',
    btn_cancel: 'Cancel',
    se_badge: 'Agronomic Strategy Configurator',
    se_title_new: 'Create New Rotation Strategy',
    se_title_edit: 'Edit Strategy Sequence & Initial Conditions',
    se_lbl_short: 'Short code',
    se_lbl_name: 'Descriptive name',
    se_lbl_years: 'Strategy cycle duration',
    se_seq_title: '1. Year-by-Year Crop Sequence (Fall-Winter & Spring-Summer)',
    se_seq_sub: 'Choose winter soil cover and summer cash crop for each year.',
    se_init_title: '2. Strategy-Specific Initial Soil & Management Conditions',
    se_chk_global: 'Inherit global plot parameters (Steps 1 & 2)',
    se_inp_prev: 'Initial Field State / Crop',
    se_inp_til: 'Tillage System',
    opt_til_sd: 'Continuous No-Till',
    opt_til_vert: 'Occasional vertical / chisel tillage',
    opt_til_conv: 'Conventional plow/disk tillage',
    se_inp_moist: 'Initial Soil Moisture (%)',
    se_inp_aw: 'Available Water AW (mm/m)',
    se_inp_soc: 'Initial SOC (g/kg)',
    se_inp_tosca: 'Effective Depth / Hardpan (cm)',
    se_btn_save: 'Save Strategy to Comparison ✓',
    dir_badge: 'Full Scientific-Agronomic Glossary',
    dir_title: 'What does every metric, criterion (C1–C15) and formula mean?',
    dir_sub: 'Explore every indicator and agronomic method alongside its exact equation and NASA/INTA source.'
  }
};

function t(key) {
  return (I18N[CLIENT_STATE.lang] && I18N[CLIENT_STATE.lang][key]) || I18N.es[key] || key;
}

/* ==========================================================================
   2. MODO OSCURO Y TRADUCCIONES
   ========================================================================== */
function initTheme() {
  const saved = localStorage.getItem('fs_theme') || 'light';
  applyTheme(saved);
}

function applyTheme(theme) {
  CLIENT_STATE.theme = theme === 'dark' ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', CLIENT_STATE.theme);
  localStorage.setItem('fs_theme', CLIENT_STATE.theme);

  const btn = document.getElementById('themeToggleBtn');
  if (btn) {
    btn.innerHTML = CLIENT_STATE.theme === 'dark'
      ? `☀️ <span>${t('btn_theme_light')}</span>`
      : `🌙 <span>${t('btn_theme_dark')}</span>`;
  }
}

function toggleDarkMode() {
  applyTheme(CLIENT_STATE.theme === 'dark' ? 'light' : 'dark');
  if (CLIENT_STATE.currentStep === 3) renderTimelineSection();
  if (CLIENT_STATE.currentStep === 4) renderRankingSection();
}

function getChartThemeColors() {
  const dark = CLIENT_STATE.theme === 'dark';
  return {
    tick: dark ? '#cad9d3' : '#353535',
    grid: dark ? 'rgba(130, 230, 168, 0.14)' : 'rgba(195, 205, 167, 0.45)',
    legend: dark ? '#edf5f1' : '#212529',
    primaryLine: dark ? '#82e6a8' : '#07503f',
    primaryFill: dark ? 'rgba(130, 230, 168, 0.16)' : 'rgba(7, 80, 63, 0.12)',
    barSaw: dark ? '#13795b' : '#07503f',
    barTopsis: dark ? '#6fb3e0' : '#b2cee7',
    barTopsisBorder: dark ? '#82e6a8' : '#07503f'
  };
}

function applyStaticTranslations() {
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    const key = el.getAttribute('data-i18n');
    if (I18N[CLIENT_STATE.lang][key]) {
      el.textContent = I18N[CLIENT_STATE.lang][key];
    }
  });
  applyTheme(CLIENT_STATE.theme);
  populateInitialStatesSelect('prevCropInput');
  populateInitialStatesSelect('sePrevCropInput');
  renderInitialStateSummaryCard();
  updateHeaderBadge();
}

function toggleLanguage() {
  CLIENT_STATE.lang = CLIENT_STATE.lang === 'es' ? 'en' : 'es';
  const prevVal = document.getElementById('prevCropInput').value;
  applyStaticTranslations();
  document.getElementById('prevCropInput').value = prevVal;
  renderSatObservationBanner();
  renderInitialStateSummaryCard();

  const scenEl = document.getElementById('scenarioActiveLabel');
  if (scenEl) scenEl.textContent = t(`sc_${CLIENT_STATE.scenarioMode || 'normal'}`);

  if (currentLatLngs.length >= 3) {
    renderPolygonOnMap(true);
  }
  applyZoneSatelliteParamsToInputs(CLIENT_STATE.envContext);
  updateEnvCards(CLIENT_STATE.envContext);
  renderStep2Strategies();
  updateChartGuideToggleButton();
  if (CLIENT_STATE.currentStep === 3) renderTimelineSection();
  if (CLIENT_STATE.currentStep === 4) {
    renderRankingSection();
    renderCropCatalog();
  }
  if (CLIENT_STATE.tutorialState.active) {
    updatePointerTutorialPauseUi();
    renderPointerTutorialSlide(false);
  }
}

/* ==========================================================================
   3. PROTECCIÓN DE RUEDA EN CONTROLES NUMÉRICOS / SLIDERS
   ========================================================================== */
function setupWheelProtection() {
  document.addEventListener('wheel', (e) => {
    const target = e.target;
    if (target && (target.classList.contains('no-wheel') || target.type === 'number' || target.type === 'range')) {
      e.preventDefault();
      target.blur();
    }
  }, { passive: false });
}

/* ==========================================================================
   4. ESTADOS INICIALES DEL CAMPO (14 OPCIONES) Y CICLOS (1 A 6 AÑOS)
   ========================================================================== */
function getSelectedInitialFieldState(stateId) {
  const id = stateId || document.getElementById('prevCropInput')?.value || 'soja_1ra';
  return APP_DATA.initialFieldStates.find((s) => s.id === id) || APP_DATA.initialFieldStates[0];
}

function populateInitialStatesSelect(selectId) {
  const sel = document.getElementById(selectId);
  if (!sel) return;
  const currentVal = sel.value || APP_DATA.params?.prevCrop || 'satelite_actual';
  const isEs = CLIENT_STATE.lang === 'es';

  const groups = {
    satelite: { label: isEs ? '🛰️ Observación Satelital Real (Sin cultivo predefinido)' : '🛰️ Live Satellite Field Observation (Auto-detected)', items: [] },
    estival: { label: isEs ? '🌾 Cultivos Estivales en Curso / Rastrojos de Cosecha' : '🌾 Standing Summer Crops & Harvest Residues', items: [] },
    invernal_perenne: { label: isEs ? '🌱 Coberturas, Pasturas y Rastrojos Invernales' : '🌱 Winter Stubble, Cover Crops & Pastures', items: [] },
    barbecho_critico: { label: isEs ? '⚠️ Barbechos y Estados Críticos de Suelo' : '⚠️ Fallows & Critical Soil Conditions', items: [] }
  };

  APP_DATA.initialFieldStates.forEach((st) => {
    const g = groups[st.group] || groups.estival;
    g.items.push(st);
  });

  sel.innerHTML = Object.values(groups)
    .filter((g) => g.items.length > 0)
    .map((g) => `
      <optgroup label="${g.label}">
        ${g.items.map((st) => `<option value="${st.id}">${isEs ? st.name_es : st.name_en}</option>`).join('')}
      </optgroup>
    `).join('');

  if ([...sel.options].some((o) => o.value === currentVal)) {
    sel.value = currentVal;
  } else {
    sel.value = 'satelite_actual';
  }
}

function getEffectiveSatelliteSummary() {
  const sat = CLIENT_STATE.satelliteData;
  const ctxSoil = CLIENT_STATE.envContext?.suelo || {};
  const liveMoist = Number.isFinite(Number(ctxSoil.humedad_smap_inicial_pct))
    ? Number(ctxSoil.humedad_smap_inicial_pct)
    : 62;
  if (sat && sat.modo === 'live_sentinel2' && sat.summary) {
    return {
      isLive: true,
      ndvi: Number(sat.meanNdvi),
      ndmi: Number(sat.meanNdmi),
      date: sat.date,
      cloudPct: sat.cloudPct,
      vegSharePct: sat.vegSharePct,
      bareSharePct: sat.bareSharePct,
      moisturePct: liveMoist,
      residueCoverPct: sat.summary.residueCoverPct,
      initN_kgHa: sat.summary.initN_kgHa,
      title_es: sat.summary.title_es,
      title_en: sat.summary.title_en,
      desc_es: sat.summary.desc_es,
      desc_en: sat.summary.desc_en
    };
  }
  return {
    isLive: false,
    ndvi: 0.25,
    ndmi: null,
    date: null,
    cloudPct: null,
    moisturePct: liveMoist,
    residueCoverPct: 50,
    initN_kgHa: 36
  };
}

function renderSatObservationBanner() {
  const box = document.getElementById('satObservationBanner');
  if (!box) return;
  const isEs = CLIENT_STATE.lang === 'es';
  const sat = CLIENT_STATE.satelliteData;
  const soil = CLIENT_STATE.envContext?.suelo || {};
  const selectedId = document.getElementById('prevCropInput')?.value || 'satelite_actual';
  const isSatMode = selectedId === 'satelite_actual';

  if (CLIENT_STATE.satFetching) {
    box.innerHTML = `
      <div class="sat-obs-head">
        <span class="trust-badge trust-yellow"><span class="trust-dot"></span> ${isEs ? 'Consultando Sentinel-2 L2A + NASA humedad para tu polígono...' : 'Querying Sentinel-2 L2A + NASA moisture for your plot...'}</span>
      </div>
    `;
    return;
  }

  if (sat && sat.modo === 'live_sentinel2') {
    const sSum = sat.summary || {};
    const title = isEs ? (sSum.title_es || 'Observación Sentinel-2 L2A') : (sSum.title_en || 'Sentinel-2 L2A Observation');
    const histHtml = Array.isArray(sat.history) && sat.history.length > 0
      ? `<div class="sat-history-strip">
           <span>${isEs ? 'Últimas pasadas sin nubes (centroide):' : 'Recent cloud-free passes (centroid):'}</span>
           ${sat.history.map((h) => `<span class="sat-history-chip">${h.date}: NDVI ${isEs ? Number(h.ndvi).toFixed(2).replace('.', ',') : Number(h.ndvi).toFixed(2)}</span>`).join('')}
         </div>`
      : '';

    const manualNote = !isSatMode
      ? `<div style="margin-top:6px; font-size:11.5px; color:var(--alert-terracotta); font-weight:600;">
           ${isEs ? 'Nota: Elegiste un estado manual; el mapa muestra tu patrón paramétrico en vez de los píxeles Sentinel-2 reales.' : 'Note: Manual state selected; map displays your chosen parametric pattern instead of raw Sentinel-2 pixels.'}
         </div>`
      : '';

    box.innerHTML = `
      <div class="sat-obs-head">
        <span class="trust-badge ${isSatMode ? 'trust-green' : 'trust-yellow'}">
          <span class="trust-dot"></span>
          ${isEs ? `🛰️ Sentinel-2 L2A en vivo · Escena ${sat.date}` : `🛰️ Live Sentinel-2 L2A · Scene ${sat.date}`}
        </span>
        <span style="font-size:11.5px; color:var(--graphite);">${title}</span>
      </div>
      <div class="sat-obs-metrics">
        <span class="sat-metric-chip">NDVI: <strong>${isEs ? Number(sat.meanNdvi).toFixed(2).replace('.', ',') : Number(sat.meanNdvi).toFixed(2)}</strong></span>
        <span class="sat-metric-chip">NDMI (${isEs ? 'agua foliar' : 'moisture'}): <strong>${sat.meanNdmi !== null && sat.meanNdmi !== undefined ? (isEs ? Number(sat.meanNdmi).toFixed(2).replace('.', ',') : Number(sat.meanNdmi).toFixed(2)) : '—'}</strong></span>
        <span class="sat-metric-chip">${isEs ? 'Nubes escena' : 'Scene cloud'}: <strong>${sat.cloudPct ?? '—'}%</strong></span>
        <span class="sat-metric-chip">${isEs ? 'Humedad perfil' : 'Root moisture'}: <strong>${soil.humedad_smap_inicial_pct ?? 62}%</strong></span>
      </div>
      ${histHtml}
      ${manualNote}
    `;
  } else {
    box.innerHTML = `
      <div class="sat-obs-head">
        <span class="trust-badge trust-yellow">
          <span class="trust-dot"></span>
          ${isEs ? '📐 Estimación paramétrica (sin escena Sentinel-2 en vivo)' : '📐 Parametric estimation (no live Sentinel-2 scene)'}
        </span>
        <span style="font-size:11.5px; color:var(--graphite);">${sat?.error ? (isEs ? 'Escena reciente cubierta o timeout' : 'Recent imagery cloudy or timed out') : ''}</span>
      </div>
      <div class="sat-obs-metrics">
        <span class="sat-metric-chip">${isEs ? 'Humedad perfil' : 'Root moisture'}: <strong>${soil.humedad_smap_inicial_pct ?? 62}%</strong> (${soil.humedad_fuente || 'NASA/Open-Meteo'})</span>
      </div>
    `;
  }
}

function getBboxArrayFromLatLngs(latLngs) {
  if (!Array.isArray(latLngs) || latLngs.length < 3) return null;
  const lats = latLngs.map((p) => p[0]);
  const lons = latLngs.map((p) => p[1]);
  return [
    Number(Math.min(...lons).toFixed(6)),
    Number(Math.min(...lats).toFixed(6)),
    Number(Math.max(...lons).toFixed(6)),
    Number(Math.max(...lats).toFixed(6))
  ];
}

async function fetchStep1SatelliteData(force = false) {
  if (currentLatLngs.length < 3) return;
  const bbox = getBboxArrayFromLatLngs(currentLatLngs);
  if (!bbox) return;
  const bboxKey = bbox.join(',');
  if (!force && bboxKey === CLIENT_STATE.satLastBboxKey && CLIENT_STATE.satelliteData?.modo === 'live_sentinel2') {
    return;
  }

  CLIENT_STATE.satFetching = true;
  renderSatObservationBanner();

  try {
    const res = await fetch('/api/satellite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        lat: CLIENT_STATE.lat,
        lon: CLIENT_STATE.lon,
        bbox,
        polygon: currentLatLngs,
        rows: 6,
        cols: 7,
        force
      })
    });
    const data = await res.json();
    if (data && data.ok) {
      CLIENT_STATE.satLastBboxKey = bboxKey;
      CLIENT_STATE.satelliteData = data.satellite || null;
      if (!CLIENT_STATE.envContext) CLIENT_STATE.envContext = {};
      if (data.georef) CLIENT_STATE.envContext.georef = data.georef;
      if (data.suelo) CLIENT_STATE.envContext.suelo = data.suelo;
      if (data.clima) CLIENT_STATE.envContext.clima = data.clima;
      if (data.estadisticas_magyp) CLIENT_STATE.envContext.estadisticas_magyp = data.estadisticas_magyp;

      if (data.georef?.etiqueta) {
        const jd = document.getElementById('jurisdictionDisplay');
        if (jd) jd.textContent = data.georef.etiqueta;
      }

      applyZoneSatelliteParamsToInputs(CLIENT_STATE.envContext);
      updateEnvCards(CLIENT_STATE.envContext);
      if (CLIENT_STATE.currentStep === 2) {
        renderStep2Strategies();
      }
    }
  } catch (err) {
    console.warn('Error consultando /api/satellite:', err);
  } finally {
    CLIENT_STATE.satFetching = false;
    renderSatObservationBanner();
    renderInitialStateSummaryCard();
    if (currentLatLngs.length >= 3) {
      renderPolygonOnMap(true);
    }
  }
}

function refreshStep1Satellite(force = true) {
  fetchStep1SatelliteData(force);
}

function renderInitialStateSummaryCard() {
  const st = getSelectedInitialFieldState();
  const isEs = CLIENT_STATE.lang === 'es';
  const box = document.getElementById('initialStateSummaryCard');
  if (!box || !st) return;

  if (st.id === 'satelite_actual') {
    const live = getEffectiveSatelliteSummary();
    const desc = live.isLive
      ? (isEs ? live.desc_es : live.desc_en)
      : (isEs ? st.desc_es : st.desc_en);
    const ndviTxt = live.ndvi.toFixed(2);
    const ndmiBadge = live.ndmi !== null && live.ndmi !== undefined
      ? `<div class="init-mini-badge"><span>NDMI</span><strong>${live.ndmi.toFixed(2)}</strong></div>`
      : '';
    box.innerHTML = `
      <div style="font-size:12px; line-height:1.45;">
        <strong>${live.isLive
          ? (isEs ? `Observación real Sentinel-2 (${live.date}):` : `Live Sentinel-2 observation (${live.date}):`)
          : (isEs ? 'Diagnóstico inicial del lote:' : 'Initial field impact:')}</strong>
        ${desc}
      </div>
      <div class="init-state-metrics-row">
        <div class="init-mini-badge"><span>${live.isLive ? 'NDVI Real' : 'NDVI Ini'}</span><strong>${ndviTxt}</strong></div>
        ${ndmiBadge}
        <div class="init-mini-badge"><span>${isEs ? 'Humedad' : 'Moisture'}</span><strong>${live.moisturePct}%</strong></div>
        <div class="init-mini-badge"><span>${isEs ? 'Cobertura est.' : 'Est. Cover'}</span><strong>${live.residueCoverPct}%</strong></div>
        <div class="init-mini-badge"><span>${isEs ? 'N disp.' : 'Avail. N'}</span><strong>${live.initN_kgHa} kg</strong></div>
      </div>
    `;
    return;
  }

  box.innerHTML = `
    <div style="font-size:12px; line-height:1.45;">
      <strong>${isEs ? 'Diagnóstico inicial del lote:' : 'Initial field impact:'}</strong>
      ${isEs ? st.desc_es : st.desc_en}
    </div>
    <div class="init-state-metrics-row">
      <div class="init-mini-badge"><span>NDVI Ini</span><strong>${st.baseNdvi.toFixed(2)}</strong></div>
      <div class="init-mini-badge"><span>${isEs ? 'Humedad' : 'Moisture'}</span><strong>${st.initMoisturePct}%</strong></div>
      <div class="init-mini-badge"><span>${isEs ? 'Rastrojo' : 'Residue'}</span><strong>${st.residueCoverPct}%</strong></div>
      <div class="init-mini-badge"><span>${isEs ? 'N disp.' : 'Avail. N'}</span><strong>${st.initN_kgHa} kg</strong></div>
    </div>
  `;
}

function onPrevCropChange() {
  const st = getSelectedInitialFieldState();
  renderSatObservationBanner();
  renderInitialStateSummaryCard();

  if (!CLIENT_STATE.isLocalOverride) {
    applyZoneSatelliteParamsToInputs(CLIENT_STATE.envContext);
  }

  // Sincronizar las estrategias base que heredan parámetros globales
  CLIENT_STATE.configuredStrategies.forEach((s) => {
    if (!s.initialConditions || s.initialConditions.useGlobal !== false) {
      s.initialConditions = { ...(s.initialConditions || {}), useGlobal: true, prevCrop: st.id };
    }
  });

  if (currentLatLngs.length >= 3) {
    renderPolygonOnMap(true);
  }
}

function onGlobalCycleYearsChange() {
  const cy = Math.min(6, Math.max(1, Number(document.getElementById('cycleYearsInput').value) || 2));

  CLIENT_STATE.configuredStrategies.forEach((st) => {
    if (!st.isCustom) {
      st.cycleYears = cy;
      if (st.short) {
        st.short = st.short.replace(/\(\d+a\)/, `(${cy}a)`);
      }
      const seq = st.sequence && st.sequence.length > 0 ? st.sequence : [{ year: 1, winter: 'centeno_vicia', summer: 'maiz_1ra' }];
      const newSeq = [];
      for (let y = 1; y <= cy; y++) {
        const ref = seq[(y - 1) % seq.length];
        newSeq.push({ year: y, winter: ref.winter, summer: ref.summer });
      }
      st.sequence = newSeq;
    }
  });
}

/* ==========================================================================
   5. NAVEGACIÓN POR PASOS (0 -> 1 -> 2 -> 3 -> 4)
   ========================================================================== */
function startGuidedCalculation() {
  document.getElementById('heroLanding').style.display = 'none';
  document.getElementById('wizardWorkspace').style.display = 'block';
  goToStep(1);
}

function resetWizardToHome(e) {
  if (e) e.preventDefault();
  stopStepPointerTutorial(false);
  if (CLIENT_STATE.playbackTimer) {
    clearInterval(CLIENT_STATE.playbackTimer);
    CLIENT_STATE.playbackTimer = null;
  }
  CLIENT_STATE.currentStep = 0;
  document.getElementById('wizardWorkspace').style.display = 'none';
  document.getElementById('heroLanding').style.display = 'flex';
  const tourBtn = document.getElementById('btnReplayTutorial');
  if (tourBtn) tourBtn.style.display = 'none';
  updateHeaderBadge();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function updateHeaderBadge() {
  const badge = document.getElementById('headerStepBadge');
  if (CLIENT_STATE.currentStep === 0) {
    badge.textContent = t('hdr_ready');
  } else {
    badge.textContent = `${t('hdr_step_prefix')} ${CLIENT_STATE.currentStep} ${t('hdr_of')}`;
  }
}

async function goToStep(stepNum) {
  if (stepNum >= 2 && currentLatLngs.length < 3) {
    alert(CLIENT_STATE.lang === 'es'
      ? 'Marcá al menos 3 puntos en el mapa para delimitar tu lote antes de continuar.'
      : 'Mark at least 3 corners on the map to define your plot before continuing.');
    return;
  }

  stopStepPointerTutorial(false);

  if (stepNum !== 3 && CLIENT_STATE.playbackTimer) {
    clearInterval(CLIENT_STATE.playbackTimer);
    CLIENT_STATE.playbackTimer = null;
  }

  [1, 2, 3, 4].forEach((n) => {
    const panel = document.getElementById(`wizardStep${n}`);
    const node = document.getElementById(`stepNode${n}`);
    panel.style.display = n === stepNum ? 'block' : 'none';

    node.classList.remove('active', 'completed', 'locked');
    node.onclick = null;
    if (n === stepNum) {
      node.classList.add('active');
    } else if (n < stepNum) {
      node.classList.add('completed');
      node.onclick = () => goToStep(n);
    } else {
      node.classList.add('locked');
    }
  });

  CLIENT_STATE.currentStep = stepNum;
  const tourBtn = document.getElementById('btnReplayTutorial');
  if (tourBtn) tourBtn.style.display = stepNum >= 1 ? 'inline-flex' : 'none';
  updateHeaderBadge();
  window.scrollTo({ top: 0, behavior: 'smooth' });

  if (stepNum === 1) {
    setTimeout(() => {
      if (map) {
        map.invalidateSize();
        if (polygonLayer) map.fitBounds(polygonLayer.getBounds(), { padding: [40, 40] });
      }
      maybeAutoStartStepTutorial(1);
    }, 180);
  } else if (stepNum === 2) {
    if (currentLatLngs.length >= 3) {
      clearTimeout(CLIENT_STATE.satDebounceTimer);
      await fetchStep1SatelliteData(false);
    }
    applyZoneSatelliteParamsToInputs(CLIENT_STATE.envContext);
    renderStep2Strategies();
    await syncWithBackend();
    applyZoneSatelliteParamsToInputs(CLIENT_STATE.envContext);
    renderStep2Strategies();
    maybeAutoStartStepTutorial(2);
  } else if (stepNum === 3) {
    await syncWithBackend();
    renderTimelineSection();
    maybeAutoStartStepTutorial(3);
  } else if (stepNum === 4) {
    await syncWithBackend();
    renderRankingSection();
    renderCropCatalog();
    maybeAutoStartStepTutorial(4);
  }
}

/* ==========================================================================
   6. MAPA LEAFLET + GRILLA NDVI REALISTA CON COLOR Y NÚMERO EN CADA CUADRO
   ========================================================================== */
function initMap() {
  map = L.map('map', { scrollWheelZoom: false }).setView([CLIENT_STATE.lat, CLIENT_STATE.lon], 15);

  const esriLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    attribution: 'Tiles &copy; Esri &mdash; Sentinel-2 / NASA Earthdata',
    updateWhenIdle: true,
    keepBuffer: 2
  }).addTo(map);

  let tileErrors = 0;
  let osmAdded = false;
  esriLayer.on('tileerror', () => {
    tileErrors += 1;
    if (tileErrors >= 3 && !osmAdded) {
      osmAdded = true;
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors',
        updateWhenIdle: true
      }).addTo(map);
    }
  });

  ndviLayerGroup = L.layerGroup().addTo(map);
  ndviLabelsGroup = L.layerGroup().addTo(map);

  map.on('click', (e) => {
    currentLatLngs.push([e.latlng.lat, e.latlng.lng]);
    CLIENT_STATE.isLocalOverride = false;
    renderPolygonOnMap();
  });

  // Marcar bbox inicial de SSR para evitar doble consulta al arrancar cuando ya llegó Sentinel-2 en vivo
  const initBbox = getBboxArrayFromLatLngs(APP_DATA.meta.poligono_default);
  if (initBbox && CLIENT_STATE.satelliteData?.modo === 'live_sentinel2') {
    CLIENT_STATE.satLastBboxKey = initBbox.join(',');
  }

  loadGuaminiPreset(false);
}

function loadGuaminiPreset(recenter = true) {
  currentLatLngs = APP_DATA.meta.poligono_default.map((pt) => [...pt]);
  if (recenter) CLIENT_STATE.isLocalOverride = false;
  renderPolygonOnMap();
  if (recenter && polygonLayer) {
    map.fitBounds(polygonLayer.getBounds(), { padding: [40, 40] });
  }
}

function undoLastPoint() {
  if (currentLatLngs.length > 0) {
    currentLatLngs.pop();
    CLIENT_STATE.isLocalOverride = false;
    renderPolygonOnMap();
  }
}

function clearPolygon() {
  currentLatLngs = [];
  CLIENT_STATE.isLocalOverride = false;
  renderPolygonOnMap();
}

function toggleNdviOverlay() {
  CLIENT_STATE.showNdviOverlay = !CLIENT_STATE.showNdviOverlay;
  const btn = document.getElementById('toggleNdviLayerBtn');
  btn.textContent = CLIENT_STATE.showNdviOverlay ? t('btn_ndvi_hide') : t('btn_ndvi_show');
  renderPolygonOnMap();
}

function toggleNdviNumbers() {
  CLIENT_STATE.showNdviNumbers = !CLIENT_STATE.showNdviNumbers;
  const btn = document.getElementById('toggleNdviNumbersBtn');
  btn.textContent = CLIENT_STATE.showNdviNumbers ? t('btn_ndvi_nums_hide') : t('btn_ndvi_nums_show');
  renderPolygonOnMap();
}

/**
 * Paleta científica de 8 niveles según el NDVI real del cuadro interno.
 */
function getNdviColor(val) {
  if (val < 0.16) return '#9e2a2b'; // Suelo desnudo severo
  if (val < 0.24) return '#c85a17'; // Muy baja cobertura / transición
  if (val < 0.34) return '#e08e45'; // Rastrojo abierto / ralo
  if (val < 0.46) return '#e9c46a'; // Cobertura moderada / emergencia
  if (val < 0.58) return '#a3b18a'; // Cultivo en crecimiento
  if (val < 0.70) return '#588157'; // Cultivo activo denso
  if (val < 0.79) return '#2d6a4f'; // Vigor alto
  return '#07503f';                 // Vigor máximo fotosintético
}

function computeCellNdvi(r, c, rows, cols, initState) {
  const base = initState.baseNdvi;
  const pat = initState.ndviSpatialPattern || 'headland_stress';
  const edgeDist = Math.min(r, rows - 1 - r, c, cols - 1 - c); // 0 en bordes, 1..3 adentro
  const wave = Math.sin(r * 1.45 + c * 1.15) * 0.065 + Math.cos(r * 0.7 - c * 1.6) * 0.035;

  let offset = wave;
  if (pat === 'headland_stress') {
    // Cabeceras compactadas/bordes con menor vigor y centro más vigoroso
    offset += (edgeDist === 0 ? -0.18 : (edgeDist === 1 ? -0.04 : 0.11));
  } else if (pat === 'low_bare') {
    offset += (edgeDist === 0 ? -0.04 : 0.03) + wave * 0.4;
  } else if (pat === 'patchy') {
    offset += Math.sin(r * 2.1) * Math.cos(c * 1.8) * 0.14;
  } else if (pat === 'wet_lowland') {
    // Gradiente topográfico de loma a bajo húmedo
    const diag = ((r / (rows - 1)) + (c / (cols - 1))) / 2; // 0..1
    offset += (diag - 0.5) * 0.26;
  } else {
    // Uniforme
    offset += (edgeDist === 0 ? -0.05 : 0.03);
  }

  return Number(Math.min(0.89, Math.max(0.10, base + offset)).toFixed(2));
}

function updateAreaDisplay(bandCounts = { bare: 0, low: 0, mod: 0, high: 0, total: 0 }) {
  const isEs = CLIENT_STATE.lang === 'es';
  document.getElementById('areaM2Display').textContent = `${CLIENT_STATE.areaM2.toLocaleString(isEs ? 'es-AR' : 'en-US')} m²`;
  document.getElementById('areaHaDisplay').textContent = isEs
    ? `${CLIENT_STATE.areaHa.toFixed(2).replace('.', ',')} hectáreas · ${currentLatLngs.length} vértices`
    : `${CLIENT_STATE.areaHa.toFixed(2)} hectares · ${currentLatLngs.length} vertices`;
  document.getElementById('centroidDisplay').textContent = formatCoords(CLIENT_STATE.lat, CLIENT_STATE.lon, isEs);
  document.getElementById('meanNdviBadge').textContent = isEs
    ? `NDVI medio lote: ${CLIENT_STATE.meanNdvi.toFixed(2).replace('.', ',')}`
    : `Plot mean NDVI: ${CLIENT_STATE.meanNdvi.toFixed(2)}`;

  const sumBox = document.getElementById('ndviSpatialSummary');
  if (sumBox && bandCounts.total > 0) {
    const pct = (n) => Math.round((n / bandCounts.total) * 100);
    sumBox.innerHTML = `
      <div class="ndvi-band-stat"><span class="ndvi-band-dot" style="background:#9e2a2b;"></span><strong>${bandCounts.bare} (${pct(bandCounts.bare)}%)</strong><br>${isEs ? 'Suelo desnudo <0,20' : 'Bare <0.20'}</div>
      <div class="ndvi-band-stat"><span class="ndvi-band-dot" style="background:#e9c46a;"></span><strong>${bandCounts.low} (${pct(bandCounts.low)}%)</strong><br>${isEs ? 'Rastrojo/Baja 0,20–0,44' : 'Low 0.20–0.44'}</div>
      <div class="ndvi-band-stat"><span class="ndvi-band-dot" style="background:#588157;"></span><strong>${bandCounts.mod} (${pct(bandCounts.mod)}%)</strong><br>${isEs ? 'Activo 0,45–0,69' : 'Active 0.45–0.69'}</div>
      <div class="ndvi-band-stat"><span class="ndvi-band-dot" style="background:#07503f;"></span><strong>${bandCounts.high} (${pct(bandCounts.high)}%)</strong><br>${isEs ? 'Pleno ≥0,70' : 'Peak ≥0.70'}</div>
    `;
  } else if (sumBox) {
    sumBox.innerHTML = '';
  }
}

function renderPolygonOnMap(skipAutoFetch = false) {
  if (polygonLayer) map.removeLayer(polygonLayer);
  if (ndviLayerGroup) ndviLayerGroup.clearLayers();
  if (ndviLabelsGroup) ndviLabelsGroup.clearLayers();
  vertexMarkers.forEach((m) => map.removeLayer(m));
  vertexMarkers = [];

  const isEs = CLIENT_STATE.lang === 'es';
  document.getElementById('vertexCountBadge').innerHTML = `<span class="trust-dot"></span> ${currentLatLngs.length} ${isEs ? 'vértices' : 'vertices'}`;

  currentLatLngs.forEach((pt, idx) => {
    const marker = L.circleMarker(pt, {
      radius: 7,
      color: '#07503f',
      weight: 2,
      fillColor: '#e8fe85',
      fillOpacity: 1
    }).addTo(map);
    marker.bindTooltip(`${isEs ? 'Vértice' : 'Vertex'} ${idx + 1}`, { direction: 'top' });
    vertexMarkers.push(marker);
  });

  const btnNext = document.getElementById('btnNextStep1');

  if (currentLatLngs.length >= 3) {
    btnNext.disabled = false;

    const ring = currentLatLngs.map((p) => [p[1], p[0]]);
    ring.push(ring[0]);
    const polyGeoJson = turf.polygon([ring]);
    const rawM2 = turf.area(polyGeoJson);
    const centroid = turf.centroid(polyGeoJson).geometry.coordinates;

    const areaM2 = Math.abs(rawM2 - 100000) < 400 ? 100000 : Math.round(rawM2);
    CLIENT_STATE.areaM2 = areaM2;
    CLIENT_STATE.areaHa = areaM2 / 10000;
    CLIENT_STATE.lon = centroid[0];
    CLIENT_STATE.lat = centroid[1];

    polygonLayer = L.polygon(currentLatLngs, {
      color: '#e8fe85',
      weight: 2.8,
      fillColor: '#07503f',
      fillOpacity: CLIENT_STATE.showNdviOverlay ? 0.04 : 0.25
    }).addTo(map);

    const initState = getSelectedInitialFieldState();
    const bbox = turf.bbox(polyGeoJson);
    const cols = 7, rows = 6;
    const dx = (bbox[2] - bbox[0]) / cols;
    const dy = (bbox[3] - bbox[1]) / rows;

    const sat = CLIENT_STATE.satelliteData;
    const useLiveSat = initState.id === 'satelite_actual' && sat && sat.modo === 'live_sentinel2' && Array.isArray(sat.cells);

    const gridTitleEl = document.getElementById('ndviGridTitle');
    if (gridTitleEl) {
      gridTitleEl.textContent = useLiveSat
        ? (isEs ? `Grilla NDVI Real Sentinel-2 L2A (${sat.date})` : `Live Sentinel-2 L2A NDVI Grid (${sat.date})`)
        : (isEs ? `Grilla Paramétrica (${initState.name_es.split('(')[0].trim()})` : `Parametric Pattern (${initState.name_en.split('(')[0].trim()})`);
    }

    let ndviSum = 0;
    const bandCounts = { bare: 0, low: 0, mod: 0, high: 0, total: 0 };

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const minX = bbox[0] + c * dx;
        const minY = bbox[1] + r * dy;
        const maxX = minX + dx;
        const maxY = minY + dy;
        const cellPoly = turf.bboxPolygon([minX, minY, maxX, maxY]);
        const clipped = turf.intersect(cellPoly, polyGeoJson);

        if (clipped) {
          const satCell = useLiveSat ? (sat.cells[r]?.[c] || null) : null;
          const ndviVal = satCell ? Number(satCell.ndvi) : computeCellNdvi(r, c, rows, cols, initState);
          const cellColor = getNdviColor(ndviVal);
          const cellM2 = Math.round(turf.area(clipped));
          const cellCenter = turf.centroid(clipped).geometry.coordinates;

          ndviSum += ndviVal;
          bandCounts.total++;
          if (ndviVal < 0.20) bandCounts.bare++;
          else if (ndviVal < 0.45) bandCounts.low++;
          else if (ndviVal < 0.70) bandCounts.mod++;
          else bandCounts.high++;

          if (CLIENT_STATE.showNdviOverlay) {
            const subLayer = L.geoJSON(clipped, {
              style: {
                color: '#ffffff',
                weight: 1.1,
                fillColor: cellColor,
                fillOpacity: 0.76
              }
            }).addTo(ndviLayerGroup);

            const statusTxt = satCell
              ? `${isEs ? satCell.sclLabel_es : satCell.sclLabel_en} · ${ndviVal < 0.20 ? (isEs ? 'sin cobertura verde' : 'bare / stubble') : (ndviVal < 0.45 ? (isEs ? 'vigor bajo / rastrojo mixto' : 'low greenness / mixed stubble') : (isEs ? 'vegetación verde activa' : 'active green canopy'))}`
              : (ndviVal < 0.20
                ? (isEs ? 'Suelo desnudo / riesgo crítico' : 'Bare soil / critical exposure')
                : (ndviVal < 0.45 ? (isEs ? 'Rastrojo o cobertura baja' : 'Stubble / low cover')
                  : (ndviVal < 0.70 ? (isEs ? 'Cultivo o cobertura activa' : 'Active growing canopy') : (isEs ? 'Vigor fotosintético pleno' : 'Peak canopy vigor'))));

            const redRefl = satCell ? satCell.red : Number((0.18 - ndviVal * 0.12).toFixed(3));
            const nirRefl = satCell ? satCell.nir : Number((redRefl * (1 + ndviVal) / (1 - ndviVal)).toFixed(3));
            const swirInfo = satCell ? ` · SWIR1=${satCell.swir1} · NDMI=${satCell.ndmi}` : '';
            const sourceHeader = satCell
              ? `Sentinel-2 L2A (${sat.date}) · ${isEs ? 'Cuadro' : 'Cell'} [${r + 1},${c + 1}]`
              : `${isEs ? 'Patrón Paramétrico' : 'Parametric Pattern'} · ${isEs ? 'Cuadro' : 'Cell'} [${r + 1},${c + 1}]`;

            subLayer.bindTooltip(
              `<strong>${satCell ? 'Sentinel-2' : (isEs ? 'Simulado' : 'Modeled')} [${r + 1},${c + 1}] · NDVI: ${ndviVal.toFixed(2)}</strong><br>${statusTxt}<br><em>${isEs ? 'Clic para explicar este cuadro' : 'Click for cell details'}</em>`,
              { sticky: true }
            );

            subLayer.bindPopup(`
              <div style="font-family:Inter,sans-serif; font-size:12.5px; min-width:215px;">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px; gap:6px;">
                  <strong>${sourceHeader}</strong>
                  <span style="display:inline-block; padding:2px 8px; border-radius:100px; background:${cellColor}; color:#fff; font-weight:700;">NDVI ${ndviVal.toFixed(2)}</span>
                </div>
                <p style="margin-bottom:5px;"><strong>${isEs ? 'Clasificación:' : 'Class:'}</strong> ${statusTxt}</p>
                <p style="margin-bottom:5px;"><strong>${isEs ? 'Superficie:' : 'Area:'}</strong> ${cellM2.toLocaleString(isEs ? 'es-AR' : 'en-US')} m²</p>
                <p style="margin-bottom:5px;"><strong>${satCell ? (isEs ? 'Bandas L2A:' : 'L2A Bands:') : (isEs ? 'Espectro est.:' : 'Est. Bands:')}</strong> NIR=${nirRefl} · Red=${redRefl}${swirInfo}<br><code>(NIR-Red)/(NIR+Red) = ${ndviVal.toFixed(2)}</code></p>
                <p style="margin-bottom:0; opacity:0.85;">${ndviVal < 0.20
                  ? (isEs ? 'Sector expuesto a erosión eólica/hídrica y evaporación directa.' : 'Exposed to wind/water erosion and direct evaporation.')
                  : (isEs ? 'Sector con protección superficial y captación de radiación.' : 'Sector with surface protection and light interception.')}</p>
              </div>
            `);

            // Etiqueta numérica visible justo dentro de cada cuadro
            if (CLIENT_STATE.showNdviNumbers && cellM2 > 220) {
              const ndviLabelText = isEs ? ndviVal.toFixed(2).replace('.', ',') : ndviVal.toFixed(2);
              const labelMarker = L.marker([cellCenter[1], cellCenter[0]], {
                interactive: false,
                icon: L.divIcon({
                  className: 'ndvi-cell-label',
                  html: `<span class="ndvi-cell-chip" style="border-color:${cellColor};">${ndviLabelText}</span>`,
                  iconSize: [36, 16],
                  iconAnchor: [18, 8]
                })
              }).addTo(ndviLabelsGroup);
            }
          }
        }
      }
    }

    CLIENT_STATE.meanNdvi = bandCounts.total > 0 ? ndviSum / bandCounts.total : initState.baseNdvi;
    updateAreaDisplay(bandCounts);

    // Disparar autodetección satelital debounced si el polígono cambió respecto al último bbox consultado
    if (!skipAutoFetch) {
      const nextKey = [
        Number(bbox[0].toFixed(6)),
        Number(bbox[1].toFixed(6)),
        Number(bbox[2].toFixed(6)),
        Number(bbox[3].toFixed(6))
      ].join(',');
      if (nextKey !== CLIENT_STATE.satLastBboxKey) {
        clearTimeout(CLIENT_STATE.satDebounceTimer);
        CLIENT_STATE.satDebounceTimer = setTimeout(() => {
          fetchStep1SatelliteData(false);
        }, 550);
      }
    }
  } else {
    btnNext.disabled = true;
    document.getElementById('areaM2Display').textContent = '0 m²';
    document.getElementById('areaHaDisplay').textContent = isEs
      ? `Marcá ${3 - currentLatLngs.length} punto(s) más en el mapa`
      : `Mark ${3 - currentLatLngs.length} more point(s) on the map`;
    updateAreaDisplay();
  }
}

/* ==========================================================================
   7. PASO 2: CONSTRUCTOR E INTERFAZ DE ESTRATEGIAS + SYNC EXPRESS
   ========================================================================== */
function getCropLabelById(season, cropId) {
  const list = APP_DATA.seasonCrops[season] || [];
  const c = list.find((item) => item.id === cropId);
  if (!c) return cropId;
  return CLIENT_STATE.lang === 'es' ? c.name_es.split('(')[0].trim() : c.name_en.split('(')[0].trim();
}

function getStrategyDisplayName(st) {
  return CLIENT_STATE.lang === 'es' ? (st.name_es || st.name) : (st.name_en || st.name_es || st.name);
}

function getStrategyLabel(st) {
  const isEs = CLIENT_STATE.lang === 'es';
  const raw = st.short || st.id;
  if (isEs) return raw;
  const mapEn = {
    E0_Base: `E0 Base (${st.cycleYears}yr)`,
    E1_Cob: `E1 Cover (${st.cycleYears}yr)`,
    E2_CerInv: `E2 W. Cereal (${st.cycleYears}yr)`,
    E3_Past: `E3 Pasture (${st.cycleYears}yr)`,
    E4_Nina: `E4 Drought (${st.cycleYears}yr)`,
    E5_Nino: `E5 El Niño (${st.cycleYears}yr)`
  };
  if (mapEn[st.id]) return mapEn[st.id];
  return raw.replace(/\((\d+)a\)/, '($1yr)');
}

function renderStep2Strategies() {
  const container = document.getElementById('step2StrategiesList');
  if (!container) return;
  const isEs = CLIENT_STATE.lang === 'es';
  const list = CLIENT_STATE.configuredStrategies;

  const countBadge = document.getElementById('strategyCountBadge');
  if (countBadge) {
    countBadge.innerHTML = `<span class="trust-dot"></span> ${list.length} ${isEs ? 'estrategias configuradas' : 'strategies ready'}`;
  }

  container.innerHTML = list.map((st) => {
    const ic = st.initialConditions || { useGlobal: true };
    const usesGlobal = ic.useGlobal !== false;
    const seqHtml = (st.sequence || []).map((yr) => `
      <div class="sb-year-chip-row">
        <strong>${isEs ? 'Año' : 'Yr'} ${yr.year}:</strong>
        <span class="season-badge-w">❄️ ${getCropLabelById('winter', yr.winter)}</span>
        <span>→</span>
        <span class="season-badge-s">☀️ ${getCropLabelById('summer', yr.summer)}</span>
      </div>
    `).join('');

    const initName = isEs
      ? getSelectedInitialFieldState(ic.prevCrop).name_es.split('(')[0].trim()
      : getSelectedInitialFieldState(ic.prevCrop).name_en.split('(')[0].trim();
    const tilNames = isEs
      ? { siembra_directa: 'Siembra Directa', labranza_vertical: 'Labranza Vertical', convencional: 'Labranza Convencional' }
      : { siembra_directa: 'No-Till', labranza_vertical: 'Vertical Tillage', convencional: 'Conventional Tillage' };
    const tilTxt = tilNames[ic.tillage || 'siembra_directa'] || (ic.tillage || 'No-Till');
    const globalAw = document.getElementById('inputAW')?.value || CLIENT_STATE.envContext?.suelo?.aw_mm_m?.media || '—';
    const globalMoist = document.getElementById('inputInitMoisture')?.value || CLIENT_STATE.envContext?.suelo?.humedad_smap_inicial_pct || '—';
    const globalSoc = document.getElementById('inputSOC')?.value || CLIENT_STATE.envContext?.suelo?.soc_g_kg?.media || '—';
    const zoneLabel = CLIENT_STATE.envContext?.georef?.etiqueta || 'Paso 1';
    const sourceTag = CLIENT_STATE.isLocalOverride
      ? (isEs ? 'Calibración INTA/Propia' : 'INTA/Farm override')
      : (isEs ? `Satélite ${zoneLabel}` : `Satellite ${zoneLabel}`);
    const initSummary = usesGlobal
      ? `${sourceTag} · ${initName} · AW ${globalAw} mm/m · ${isEs ? 'Hum' : 'Moist'} ${globalMoist}% · SOC ${globalSoc} g/kg`
      : `${initName} · ${tilTxt} · AW ${ic.awMmM ?? globalAw} mm/m · ${isEs ? 'Hum' : 'Moist'} ${ic.initMoisturePct ?? globalMoist}% · SOC ${ic.socGKg ?? globalSoc} g/kg`;

    return `
      <div class="strategy-builder-card ${st.isCustom ? 'is-custom' : ''}">
        <div>
          <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:8px; margin-bottom:8px;">
            <div>
              <span class="trust-badge ${st.isCustom ? 'trust-green' : 'trust-yellow'}" style="margin-bottom:5px;">
                <span class="trust-dot"></span>
                ${st.isCustom ? (isEs ? 'Personalizada' : 'Custom') : (isEs ? 'Estrategia Base' : 'Preset')} · ${st.cycleYears} ${isEs ? (st.cycleYears === 1 ? 'año' : 'años') : 'yr'}
              </span>
              <h4 style="font-family:var(--font-serif); font-size:22px; color:var(--charcoal); line-height:1.15;">${getStrategyLabel(st)}</h4>
              <p class="muted-sub" style="font-size:12px;">${getStrategyDisplayName(st)}</p>
            </div>
          </div>
          <div class="sb-seq-pills">${seqHtml}</div>
          <div style="margin-top:10px; font-size:11.5px; color:var(--graphite); padding:7px 10px; border-radius:10px; background:var(--bone); border:1px solid var(--moss);">
            <strong>${isEs ? 'Condiciones iniciales:' : 'Initial conditions:'}</strong> ${initSummary}
          </div>
        </div>

        <div style="display:flex; flex-wrap:wrap; gap:6px; padding-top:8px; border-top:1px solid var(--moss);">
          <button class="btn-eq" onclick="openStrategyEditor('${st.id}')">✏️ ${isEs ? 'Configurar' : 'Configure'}</button>
          <button class="btn-eq" onclick="duplicateStrategy('${st.id}')">📋 ${isEs ? 'Duplicar' : 'Duplicate'}</button>
          ${list.length > 2 ? `<button class="btn-eq" style="color:var(--alert-terracotta);" onclick="removeStrategy('${st.id}')">🗑️ ${isEs ? 'Quitar' : 'Remove'}</button>` : ''}
        </div>
      </div>
    `;
  }).join('');
}

function openStrategyEditor(strategyId) {
  CLIENT_STATE.editingStrategyId = strategyId;
  const isEs = CLIENT_STATE.lang === 'es';
  populateInitialStatesSelect('sePrevCropInput');

  const globalCy = Number(document.getElementById('cycleYearsInput').value) || 2;
  const globalPrev = document.getElementById('prevCropInput').value || 'soja_1ra';

  let st = strategyId ? CLIENT_STATE.configuredStrategies.find((s) => s.id === strategyId) : null;

  if (!st) {
    document.getElementById('seModalTitle').textContent = t('se_title_new');
    const nextNum = CLIENT_STATE.configuredStrategies.length + 1;
    document.getElementById('seShortInput').value = `E${nextNum} Custom (${globalCy}a)`;
    document.getElementById('seNameInput').value = isEs ? 'Estrategia Personalizada de Rotación' : 'Custom Rotation Strategy';
    document.getElementById('seYearsInput').value = String(globalCy);

    const defSeq = [];
    for (let y = 1; y <= globalCy; y++) {
      defSeq.push({ year: y, winter: y % 2 === 1 ? 'centeno_vicia' : 'trigo_pan', summer: y % 2 === 1 ? 'maiz_1ra' : 'soja_2da' });
    }
    renderStrategyEditorSequenceRows(defSeq);

    document.getElementById('seUseGlobalInitCheck').checked = false;
    document.getElementById('sePrevCropInput').value = globalPrev;
    document.getElementById('seTillageInput').value = 'siembra_directa';
    document.getElementById('seMoistureInput').value = document.getElementById('inputInitMoisture').value || 62;
    document.getElementById('seAwInput').value = document.getElementById('inputAW').value || 130;
    document.getElementById('seSocInput').value = document.getElementById('inputSOC').value || 18.4;
    document.getElementById('seToscaInput').value = document.getElementById('inputTosca').value || '100';
  } else {
    document.getElementById('seModalTitle').textContent = t('se_title_edit');
    document.getElementById('seShortInput').value = st.short;
    document.getElementById('seNameInput').value = getStrategyDisplayName(st);
    document.getElementById('seYearsInput').value = String(st.cycleYears || globalCy);
    renderStrategyEditorSequenceRows(st.sequence);

    const ic = st.initialConditions || { useGlobal: true };
    document.getElementById('seUseGlobalInitCheck').checked = ic.useGlobal !== false;
    document.getElementById('sePrevCropInput').value = ic.prevCrop || globalPrev;
    document.getElementById('seTillageInput').value = ic.tillage || 'siembra_directa';
    document.getElementById('seMoistureInput').value = ic.initMoisturePct ?? (document.getElementById('inputInitMoisture').value || 62);
    document.getElementById('seAwInput').value = ic.awMmM ?? (document.getElementById('inputAW').value || 130);
    document.getElementById('seSocInput').value = ic.socGKg ?? (document.getElementById('inputSOC').value || 18.4);
    document.getElementById('seToscaInput').value = String(ic.toscaCm ?? (document.getElementById('inputTosca').value || '100'));
  }

  toggleStrategyInitFields();
  document.getElementById('strategyEditorModal').classList.add('open');
}

function closeStrategyEditor() {
  document.getElementById('strategyEditorModal').classList.remove('open');
}

function toggleStrategyInitFields() {
  const checked = document.getElementById('seUseGlobalInitCheck').checked;
  const box = document.getElementById('seCustomInitFieldsGrid');
  if (checked) {
    box.classList.add('disabled-block');
  } else {
    box.classList.remove('disabled-block');
  }
}

function renderStrategyEditorSequenceRows(existingSequence) {
  const years = Number(document.getElementById('seYearsInput').value) || 2;
  const container = document.getElementById('seSequenceRowsContainer');
  const isEs = CLIENT_STATE.lang === 'es';

  // Leer valores actuales si ya hay filas renderizadas y no se pasó existingSequence
  let currentRows = existingSequence;
  if (!currentRows) {
    currentRows = [];
    const existingW = container.querySelectorAll('.se-w-sel');
    const existingS = container.querySelectorAll('.se-s-sel');
    for (let i = 0; i < existingW.length; i++) {
      currentRows.push({ winter: existingW[i].value, summer: existingS[i].value });
    }
    if (currentRows.length === 0) {
      currentRows = [{ winter: 'centeno_vicia', summer: 'maiz_1ra' }];
    }
  }

  const wOpts = APP_DATA.seasonCrops.winter;
  const sOpts = APP_DATA.seasonCrops.summer;

  let html = '';
  for (let y = 1; y <= years; y++) {
    const prev = currentRows[(y - 1) % currentRows.length] || currentRows[0];
    html += `
      <div class="se-year-editor-row">
        <strong style="font-size:13px; color:var(--forest-ink);">${isEs ? 'Año' : 'Year'} ${y}</strong>
        <div>
          <label style="display:block; font-size:11px; color:var(--pewter); margin-bottom:3px;">❄️ ${isEs ? 'Otoño–Invierno' : 'Fall–Winter'}</label>
          <select class="form-control se-w-sel" style="padding:7px 12px; font-size:12.5px;">
            ${wOpts.map((c) => `<option value="${c.id}" ${c.id === prev.winter ? 'selected' : ''}>${isEs ? c.name_es : c.name_en}</option>`).join('')}
          </select>
        </div>
        <div>
          <label style="display:block; font-size:11px; color:var(--pewter); margin-bottom:3px;">☀️ ${isEs ? 'Primavera–Verano' : 'Spring–Summer'}</label>
          <select class="form-control se-s-sel" style="padding:7px 12px; font-size:12.5px;">
            ${sOpts.map((c) => `<option value="${c.id}" ${c.id === prev.summer ? 'selected' : ''}>${isEs ? c.name_es : c.name_en}</option>`).join('')}
          </select>
        </div>
      </div>
    `;
  }
  container.innerHTML = html;
}

function saveStrategyFromEditor() {
  const shortVal = document.getElementById('seShortInput').value.trim() || 'E_Custom';
  const nameVal = document.getElementById('seNameInput').value.trim() || shortVal;
  const cycleYears = Number(document.getElementById('seYearsInput').value) || 2;

  const wSels = [...document.querySelectorAll('.se-w-sel')];
  const sSels = [...document.querySelectorAll('.se-s-sel')];
  const sequence = wSels.map((wEl, idx) => ({
    year: idx + 1,
    winter: wEl.value,
    summer: sSels[idx].value
  }));

  const useGlobal = document.getElementById('seUseGlobalInitCheck').checked;
  const initialConditions = useGlobal
    ? { useGlobal: true, prevCrop: document.getElementById('prevCropInput').value, tillage: 'siembra_directa' }
    : {
        useGlobal: false,
        prevCrop: document.getElementById('sePrevCropInput').value,
        tillage: document.getElementById('seTillageInput').value,
        initMoisturePct: Number(document.getElementById('seMoistureInput').value) || 62,
        awMmM: Number(document.getElementById('seAwInput').value) || 130,
        socGKg: Number(document.getElementById('seSocInput').value) || 18.4,
        toscaCm: Number(document.getElementById('seToscaInput').value) || 100
      };

  if (CLIENT_STATE.editingStrategyId) {
    const idx = CLIENT_STATE.configuredStrategies.findIndex((s) => s.id === CLIENT_STATE.editingStrategyId);
    if (idx >= 0) {
      CLIENT_STATE.configuredStrategies[idx] = {
        ...CLIENT_STATE.configuredStrategies[idx],
        short: shortVal,
        name: nameVal,
        name_es: nameVal,
        name_en: nameVal,
        isCustom: true,
        cycleYears,
        sequence,
        initialConditions
      };
    }
  } else {
    const newId = `Custom_${Date.now()}`;
    CLIENT_STATE.configuredStrategies.push({
      id: newId,
      short: shortVal,
      name: nameVal,
      name_es: nameVal,
      name_en: nameVal,
      isCustom: true,
      cycleYears,
      sequence,
      initialConditions
    });
    CLIENT_STATE.selectedStrategyId = newId;
  }

  closeStrategyEditor();
  renderStep2Strategies();
}

function duplicateStrategy(strategyId) {
  const orig = CLIENT_STATE.configuredStrategies.find((s) => s.id === strategyId);
  if (!orig) return;
  const copy = JSON.parse(JSON.stringify(orig));
  copy.id = `Custom_${Date.now()}`;
  copy.short = `${orig.short} (Copia)`.slice(0, 22);
  copy.isCustom = true;
  CLIENT_STATE.configuredStrategies.push(copy);
  renderStep2Strategies();
}

function removeStrategy(strategyId) {
  if (CLIENT_STATE.configuredStrategies.length <= 2) return;
  CLIENT_STATE.configuredStrategies = CLIENT_STATE.configuredStrategies.filter((s) => s.id !== strategyId);
  if (CLIENT_STATE.selectedStrategyId === strategyId) {
    CLIENT_STATE.selectedStrategyId = CLIENT_STATE.configuredStrategies[0].id;
  }
  renderStep2Strategies();
}

function addQuickStrategyTemplate(tplKey) {
  const isEs = CLIENT_STATE.lang === 'es';
  const id = `Tpl_${tplKey}_${Date.now().toString().slice(-4)}`;
  const templates = {
    regenerative_6y: {
      short: 'E_Regen (6a)',
      name_es: 'Rotación Regenerativa Completa 6 Años (Coberturas + Pastura corta + Granos)',
      name_en: 'Full 6-Yr Regenerative Sequence (Covers + Short Pasture + Cash Grains)',
      cycleYears: 6,
      sequence: [
        { year: 1, winter: 'centeno_vicia', summer: 'maiz_1ra' },
        { year: 2, winter: 'nabo_forrajero', summer: 'soja_1ra' },
        { year: 3, winter: 'trigo_pan', summer: 'soja_2da' },
        { year: 4, winter: 'vicia_villosa', summer: 'sorgo_granifero' },
        { year: 5, winter: 'pastura_inv', summer: 'pastura_est' },
        { year: 6, winter: 'pastura_inv', summer: 'pastura_est' }
      ],
      initialConditions: { useGlobal: false, prevCrop: 'lote_degradado', tillage: 'siembra_directa', initMoisturePct: 54, awMmM: Number(document.getElementById('inputAW').value) || 130, socGKg: 15.0, toscaCm: 100 }
    },
    girasol_trigo_3y: {
      short: 'E_Girasol (3a)',
      name_es: 'Trigo/Soja 2da → Nabo/Girasol → Centeno+Vicia/Maíz Tardío (3 Años)',
      name_en: 'Wheat/2nd Soy → Radish/Sunflower → Rye+Vetch/Late Maize (3 Yr)',
      cycleYears: 3,
      sequence: [
        { year: 1, winter: 'trigo_pan', summer: 'soja_2da' },
        { year: '2', winter: 'nabo_forrajero', summer: 'girasol' },
        { year: 3, winter: 'centeno_vicia', summer: 'maiz_tardio' }
      ],
      initialConditions: { useGlobal: true, prevCrop: document.getElementById('prevCropInput').value, tillage: 'siembra_directa' }
    },
    mani_centeno_2y: {
      short: 'E_Maní+Cent (2a)',
      name_es: 'Centeno Protector → Maní → Centeno+Vicia → Maíz (Control erosivo post-arrancado)',
      name_en: 'Protective Rye → Peanut → Rye+Vetch → Maize (Post-digging erosion shield)',
      cycleYears: 2,
      sequence: [
        { year: 1, winter: 'centeno_cobertura', summer: 'mani' },
        { year: 2, winter: 'centeno_vicia', summer: 'maiz_1ra' }
      ],
      initialConditions: { useGlobal: false, prevCrop: 'mani', tillage: 'siembra_directa', initMoisturePct: 58, awMmM: 125, socGKg: 17.0, toscaCm: 100 }
    },
    convencional_testigo: {
      short: 'E_Convencional',
      name_es: 'Contraste con Labranza Convencional + Barbecho Desnudo (Riesgo degradación)',
      name_en: 'Conventional Tillage + Bare Fallow Contrast (Degradation benchmark)',
      cycleYears: Number(document.getElementById('cycleYearsInput').value) || 2,
      sequence: [
        { year: 1, winter: 'barbecho_desnudo', summer: 'soja_1ra' },
        { year: 2, winter: 'barbecho_desnudo', summer: 'maiz_1ra' }
      ],
      initialConditions: { useGlobal: false, prevCrop: 'barbecho_desnudo', tillage: 'convencional', initMoisturePct: 50, awMmM: Number(document.getElementById('inputAW').value) || 130, socGKg: 16.5, toscaCm: 100 }
    }
  };

  const tpl = templates[tplKey];
  if (!tpl) return;
  const seqFixed = [];
  for (let y = 1; y <= tpl.cycleYears; y++) {
    const s = tpl.sequence[(y - 1) % tpl.sequence.length];
    seqFixed.push({ year: y, winter: s.winter, summer: s.summer });
  }
  CLIENT_STATE.configuredStrategies.push({
    id,
    short: tpl.short,
    name: isEs ? tpl.name_es : tpl.name_en,
    name_es: tpl.name_es,
    name_en: tpl.name_en,
    isCustom: true,
    cycleYears: tpl.cycleYears,
    sequence: seqFixed,
    initialConditions: tpl.initialConditions
  });
  renderStep2Strategies();
}

async function restoreDefaultStrategies() {
  CLIENT_STATE.configuredStrategies = JSON.parse(JSON.stringify(BASELINE_STRATEGIES));
  onGlobalCycleYearsChange();
  await syncWithBackend();
  renderStep2Strategies();
}

async function submitStrategiesAndAnalyze() {
  await goToStep(3);
}

async function syncWithBackend() {
  const tenure = document.getElementById('inputTenure').value;
  if (tenure === 'arrendatario' && Number(document.getElementById('sliderWEcon').value) === 20) {
    document.getElementById('sliderWEcon').value = 35;
    document.getElementById('wEconLabel').textContent = '35%';
  }

  const prevCrop = document.getElementById('prevCropInput').value;
  const sat = CLIENT_STATE.satelliteData;
  const satelliteInit = (prevCrop === 'satelite_actual' && sat && sat.modo === 'live_sentinel2' && sat.summary)
    ? {
        ndvi: sat.meanNdvi,
        ndmi: sat.meanNdmi,
        date: sat.date,
        title_es: sat.summary.title_es,
        title_en: sat.summary.title_en,
        desc_es: sat.summary.desc_es,
        desc_en: sat.summary.desc_en,
        residueCoverPct: sat.summary.residueCoverPct,
        initN_kgHa: sat.summary.initN_kgHa,
        cnRatio: sat.summary.cnRatio,
        pestCarryover: sat.summary.pestCarryover
      }
    : null;

  const payload = {
    lat: CLIENT_STATE.lat,
    lon: CLIENT_STATE.lon,
    areaM2: CLIENT_STATE.areaM2,
    polygon: currentLatLngs,
    bbox: getBboxArrayFromLatLngs(currentLatLngs),
    startDate: document.getElementById('startDateInput').value,
    cycleYears: Number(document.getElementById('cycleYearsInput').value),
    prevCrop,
    satelliteInit,
    awMmM: Number(document.getElementById('inputAW').value),
    toscaCm: Number(document.getElementById('inputTosca').value),
    initMoisturePct: Number(document.getElementById('inputInitMoisture').value),
    socGKg: Number(document.getElementById('inputSOC').value),
    isLocalOverride: CLIENT_STATE.isLocalOverride,
    rainDeltaPct: Number(document.getElementById('sliderRain').value),
    tempDeltaC: Number(document.getElementById('sliderTemp').value),
    economicCrisis: CLIENT_STATE.economicCrisis,
    wWaterPct: Number(document.getElementById('sliderWWater').value),
    wEconPct: Number(document.getElementById('sliderWEcon').value),
    machinery: document.getElementById('inputMachinery').value,
    strategies: CLIENT_STATE.configuredStrategies
  };

  try {
    const res = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (data.ok) {
      CLIENT_STATE.simulation = data.simulation;
      CLIENT_STATE.envContext = data.envContext;
      if (data.envContext?.satellite) {
        CLIENT_STATE.satelliteData = data.envContext.satellite;
        renderSatObservationBanner();
        renderInitialStateSummaryCard();
      }
      applyZoneSatelliteParamsToInputs(data.envContext);
      updateEnvCards(data.envContext);
    }
  } catch (err) {
    console.error('Error sincronizando con Express:', err);
  }
}

function updateEnvCards(ctx) {
  if (!ctx) return;
  const isEs = CLIENT_STATE.lang === 'es';
  document.getElementById('jurisdictionDisplay').textContent = ctx.georef.etiqueta;
  document.getElementById('rainCardVal').textContent = `${ctx.clima.lluvia_anual_mm} ${isEs ? 'mm/año' : 'mm/yr'}`;
  document.getElementById('et0CardSub').innerHTML = isEs
    ? `ET₀ calibrada: <strong>${ctx.clima.et0_anual_mm} mm/año</strong>.`
    : `Calibrated ET₀: <strong>${ctx.clima.et0_anual_mm} mm/yr</strong>.`;
  document.getElementById('soilTaxSub').textContent = ctx.suelo.taxonomia;
  document.getElementById('awCardVal').textContent = `${ctx.suelo.aw_mm_m.media} mm/m`;
  document.getElementById('awCardSub').innerHTML = isEs
    ? `IC 90%: <strong>${ctx.suelo.aw_mm_m.q05}–${ctx.suelo.aw_mm_m.q95} mm/m</strong>.`
    : `90% CI: <strong>${ctx.suelo.aw_mm_m.q05}–${ctx.suelo.aw_mm_m.q95} mm/m</strong>.`;

  const climaBadge = document.getElementById('climaSourceBadge');
  if (climaBadge) {
    const isLiveC = ctx.clima?.modo === 'live_api';
    climaBadge.className = `trust-badge ${isLiveC ? 'trust-green' : 'trust-yellow'}`;
    climaBadge.innerHTML = `<span class="trust-dot"></span> ${isLiveC ? 'NASA POWER (En vivo)' : 'NASA POWER (Respaldo)'}`;
  }
  const soilBadge = document.getElementById('soilSourceBadge');
  if (soilBadge) {
    const isLiveS = ctx.suelo?.modo === 'live_api';
    soilBadge.className = `trust-badge ${isLiveS ? 'trust-green' : 'trust-yellow'}`;
    soilBadge.innerHTML = `<span class="trust-dot"></span> ${isLiveS ? 'SoilGrids v2.0 (En vivo)' : 'SoilGrids + GeoINTA (Respaldo)'}`;
  }

  const smapBadge = document.getElementById('smapSourceBadge');
  const smapValEl = document.getElementById('smapCardVal');
  const smapSub = document.getElementById('smapCardSub');
  const isLiveM = ctx.suelo?.humedad_modo === 'live_api';
  if (smapBadge) {
    smapBadge.className = `trust-badge ${isLiveM ? 'trust-green' : 'trust-yellow'}`;
    smapBadge.innerHTML = `<span class="trust-dot"></span> ${isLiveM ? 'NASA GWETROOT + Open-Meteo' : 'Humedad Respaldo'}`;
  }
  const volM3 = Number.isFinite(Number(ctx.suelo?.humedad_volumetrica_m3)) ? Number(ctx.suelo.humedad_volumetrica_m3) : 0.21;
  if (smapValEl) {
    smapValEl.textContent = `${isEs ? volM3.toFixed(2).replace('.', ',') : volM3.toFixed(2)} m³/m³`;
  }
  const initSt = getSelectedInitialFieldState();
  const inputMoistRaw = document.getElementById('inputInitMoisture')?.value;
  const moistVal = inputMoistRaw !== '' && Number.isFinite(Number(inputMoistRaw))
    ? Number(inputMoistRaw)
    : (Number.isFinite(Number(ctx.suelo?.humedad_smap_inicial_pct)) ? Number(ctx.suelo.humedad_smap_inicial_pct) : (initSt?.initMoisturePct ?? 62));
  if (smapSub && initSt) {
    const stName = isEs ? initSt.name_es.split('(')[0].replace(/^📡\s*/, '').trim() : initSt.name_en.split('(')[0].replace(/^📡\s*/, '').trim();
    const dtTxt = ctx.suelo?.humedad_fecha ? ` · ${ctx.suelo.humedad_fecha}` : '';
    smapSub.textContent = isEs
      ? `Carga inicial del ${moistVal}% en 0–100 cm (${stName}${dtTxt}).`
      : `${moistVal}% initial profile fill in 0–100 cm (${stName}${dtTxt}).`;
  }

  const magyp = ctx.estadisticas_magyp || {};
  const magypBadge = document.getElementById('magypSourceBadge');
  const magypVal = document.getElementById('magypCardVal');
  const magypSub = document.getElementById('magypCardSub');
  const isLocalM = magyp.es_local !== false;
  if (magypBadge) {
    magypBadge.className = `trust-badge ${isLocalM ? 'trust-green' : 'trust-yellow'}`;
    magypBadge.innerHTML = `<span class="trust-dot"></span> ${isLocalM ? 'MAGyP / INDEC (AR)' : (isEs ? 'Referencia FAO-33' : 'FAO-33 Reference')}`;
  }
  if (magypVal) {
    magypVal.textContent = isLocalM ? 'CV 17%–34%' : 'FAO-33 Ypot';
  }
  if (magypSub) {
    magypSub.textContent = isLocalM
      ? (isEs ? 'Sorgo: 5.400 kg/ha (CV 17%). Maíz: 6.900 kg/ha.' : 'Sorghum: 5,400 kg/ha (CV 17%). Maize: 6,900 kg/ha.')
      : (isEs ? (magyp.ambito_es || 'Fuera de región MAGyP AR — rinde potencial FAO-33 ajustado por NASA POWER.') : (magyp.ambito_en || 'Outside MAGyP AR — FAO-33 yields driven by local NASA POWER climate.'));
  }
}

function updateCalibrationModeUi() {
  const isOverride = Boolean(CLIENT_STATE.isLocalOverride);
  ['inputAW', 'inputInitMoisture', 'inputSOC', 'inputTosca'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.classList.toggle('is-overridden', isOverride);
  });

  const badge = document.getElementById('calibrationStatusBadge');
  if (badge) {
    badge.className = `trust-badge ${isOverride ? 'trust-green' : 'trust-yellow'}`;
    badge.innerHTML = `<span class="trust-dot"></span> <span>${t(isOverride ? 'badge_field_mode' : 'badge_sat_mode')}</span>`;
  }

  const editBtn = document.getElementById('btnToggleManualOverride');
  if (editBtn) {
    editBtn.classList.toggle('btn-forest', isOverride);
    editBtn.classList.toggle('btn-outline', !isOverride);
    editBtn.innerHTML = `✏️ <span>${t(isOverride ? 'btn_edit_inta_active' : 'btn_edit_inta')}</span>`;
  }
}

function applyZoneSatelliteParamsToInputs(ctx) {
  const isEs = CLIENT_STATE.lang === 'es';
  const suelo = ctx?.suelo || {};
  const georef = ctx?.georef || {};
  const sat = CLIENT_STATE.satelliteData || ctx?.satellite;
  const st = getSelectedInitialFieldState();

  const satAw = Number.isFinite(Number(suelo.aw_mm_m?.media)) ? Number(suelo.aw_mm_m.media) : null;
  const rawSoc = suelo.soc_g_kg;
  const satSoc = typeof rawSoc === 'number'
    ? (Number.isFinite(rawSoc) ? rawSoc : null)
    : (Number.isFinite(Number(rawSoc?.media)) ? Number(rawSoc.media) : null);
  const satMoist = Number.isFinite(Number(suelo.humedad_smap_inicial_pct)) ? Number(suelo.humedad_smap_inicial_pct) : null;
  const satTosca = Number.isFinite(Number(suelo.profundidad_util_cm)) ? Number(suelo.profundidad_util_cm) : 100;

  if (!CLIENT_STATE.isLocalOverride) {
    if (satAw !== null) document.getElementById('inputAW').value = satAw;
    if (satSoc !== null) document.getElementById('inputSOC').value = satSoc;
    const toscaEl = document.getElementById('inputTosca');
    if (toscaEl && [50, 75, 100].includes(satTosca)) {
      toscaEl.value = String(satTosca);
    }
    const prevId = document.getElementById('prevCropInput')?.value || 'satelite_actual';
    if (prevId === 'satelite_actual') {
      if (satMoist !== null) document.getElementById('inputInitMoisture').value = satMoist;
    } else if (st) {
      document.getElementById('inputInitMoisture').value = st.initMoisturePct;
    }
  }

  const refPrefix = isEs ? '🛰️ Satélite Paso 1:' : '🛰️ Step 1 Satellite:';
  const setRef = (id, htmlVal) => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = `${refPrefix} <strong>${htmlVal}</strong>`;
  };
  setRef('satRefAW', satAw !== null ? `${satAw} mm/m` : '—');
  setRef('satRefMoist', satMoist !== null ? `${satMoist}%` : '—');
  setRef('satRefSOC', satSoc !== null ? `${satSoc} g/kg` : '—');
  setRef('satRefTosca', `${satTosca} cm`);

  const banner = document.getElementById('step2ZoneOriginBanner');
  if (banner) {
    const locName = georef.etiqueta || formatCoords(CLIENT_STATE.lat, CLIENT_STATE.lon, isEs);
    const areaTxt = isEs
      ? `${CLIENT_STATE.areaHa.toFixed(2).replace('.', ',')} ha`
      : `${CLIENT_STATE.areaHa.toFixed(2)} ha`;
    const soilSrc = suelo.modo === 'live_api'
      ? (isEs ? 'SoilGrids 250 m (En vivo)' : 'SoilGrids 250 m (Live)')
      : (isEs ? 'SoilGrids (Estimación zonal)' : 'SoilGrids (Zonal est.)');
    const s2Txt = (sat && sat.modo === 'live_sentinel2')
      ? `Sentinel-2 (${sat.date}, NDVI ${Number(sat.meanNdvi).toFixed(2)})`
      : (isEs ? 'Sentinel-2 sin escena reciente' : 'Sentinel-2 no recent pass');

    banner.innerHTML = isEs
      ? `<span>🛰️ <strong>Parámetros cargados desde la zona del Paso 1:</strong> ${locName} (${formatCoords(CLIENT_STATE.lat, CLIENT_STATE.lon, true)} · ${areaTxt})</span>
         <span>• <strong>Suelo:</strong> ${soilSrc}${suelo.textura ? ` · ${suelo.textura}` : ''}</span>
         <span>• <strong>Sensores:</strong> ${s2Txt} · ${suelo.humedad_fuente || 'NASA GWETROOT + Open-Meteo'}</span>`
      : `<span>🛰️ <strong>Loaded from Step 1 polygon:</strong> ${locName} (${formatCoords(CLIENT_STATE.lat, CLIENT_STATE.lon, false)} · ${areaTxt})</span>
         <span>• <strong>Soil:</strong> ${soilSrc}${suelo.textura ? ` · ${suelo.textura}` : ''}</span>
         <span>• <strong>Sensors:</strong> ${s2Txt} · ${suelo.humedad_fuente || 'NASA GWETROOT + Open-Meteo'}</span>`;
  }

  updateCalibrationModeUi();
}

function toggleManualOverrideMode() {
  if (CLIENT_STATE.isLocalOverride) {
    resetLocalOverrides();
  } else {
    markLocalOverride();
    const awEl = document.getElementById('inputAW');
    if (awEl) awEl.focus();
  }
}

function markLocalOverride() {
  CLIENT_STATE.isLocalOverride = true;
  updateCalibrationModeUi();
  renderStep2Strategies();
}

async function resetLocalOverrides() {
  CLIENT_STATE.isLocalOverride = false;
  applyZoneSatelliteParamsToInputs(CLIENT_STATE.envContext);
  updateEnvCards(CLIENT_STATE.envContext);
  renderStep2Strategies();
  if (CLIENT_STATE.currentStep === 2) {
    await syncWithBackend();
    applyZoneSatelliteParamsToInputs(CLIENT_STATE.envContext);
    renderStep2Strategies();
  }
}

/* ==========================================================================
   8. PASO 3: LÍNEA DE TIEMPO INTERACTIVA Y KPIs CON POPUP EXPLICATIVO
   ========================================================================== */
function localizeMonthShort(label, isEs = CLIENT_STATE.lang === 'es') {
  if (isEs || !label) return label;
  return String(label)
    .replace(/^Ene\b/, 'Jan')
    .replace(/^Abr\b/, 'Apr')
    .replace(/^Ago\b/, 'Aug')
    .replace(/^Dic\b/, 'Dec');
}

function localizeFullDate(fullDate, isEs = CLIENT_STATE.lang === 'es') {
  if (isEs || !fullDate) return fullDate;
  const map = {
    Enero: 'January', Febrero: 'February', Marzo: 'March', Abril: 'April',
    Mayo: 'May', Junio: 'June', Julio: 'July', Agosto: 'August',
    Septiembre: 'September', Octubre: 'October', Noviembre: 'November', Diciembre: 'December'
  };
  return String(fullDate).replace(/^[A-Za-zÁÉÍÓÚáéíóú]+/, (m) => map[m] || m);
}

function getTimelineCropLabel(item, isEs = CLIENT_STATE.lang === 'es') {
  if (isEs) return item.cropLabel;
  if (item.cropLabel_en) return item.cropLabel_en;
  const base = getCropLabelById('winter', item.cropId) !== item.cropId
    ? getCropLabelById('winter', item.cropId)
    : getCropLabelById('summer', item.cropId);
  return base !== item.cropId ? base : item.cropLabel;
}

function renderTimelineSection() {
  const strategies = CLIENT_STATE.simulation.strategies;
  const pillsContainer = document.getElementById('timelineStrategyPills');
  const isEs = CLIENT_STATE.lang === 'es';

  pillsContainer.innerHTML = strategies.map((st) => `
    <button class="strategy-pill ${st.id === CLIENT_STATE.selectedStrategyId ? 'active' : ''}"
            onclick="selectTimelineStrategy('${st.id}')">
      ${getStrategyLabel(st)}
    </button>
  `).join('');

  const activeStrategy = strategies.find((s) => s.id === CLIENT_STATE.selectedStrategyId) || strategies[0];
  CLIENT_STATE.selectedStrategyId = activeStrategy.id;
  const baselineStrategy = strategies.find((s) => s.id.startsWith('E0')) || strategies[0];
  const series = activeStrategy.timeline;

  if (CLIENT_STATE.selectedMonthIndex >= series.length) {
    CLIENT_STATE.selectedMonthIndex = 0;
  }

  renderTimelineChartJs(series, baselineStrategy.timeline, activeStrategy);
  renderTimelineChartGuide(series, baselineStrategy.timeline, activeStrategy);

  const grid = document.getElementById('monthTrackGrid');
  grid.innerHTML = series.map((item) => {
    const locDate = localizeMonthShort(item.label, isEs);
    const locCrop = getTimelineCropLabel(item, isEs);
    return `
      <div class="month-cell state-${item.stageType} ${item.index === CLIENT_STATE.selectedMonthIndex ? 'selected' : ''}"
           onclick="selectTimelineMonth(${item.index})">
        <div class="month-cell-date">${locDate}</div>
        <div class="month-cell-crop" title="${locCrop}">${locCrop}</div>
        <div class="month-cell-mini">AW ${item.soilWater}mm · NDVI ${item.ndvi.toFixed(2)}</div>
      </div>
    `;
  }).join('');

  renderFootnoteInspector(series[CLIENT_STATE.selectedMonthIndex], activeStrategy, baselineStrategy.timeline[CLIENT_STATE.selectedMonthIndex]);
}

function renderTimelineChartJs(series, baselineSeries, activeStrategy) {
  const ctx = document.getElementById('timelineChartCanvas').getContext('2d');
  const isEs = CLIENT_STATE.lang === 'es';
  const labels = series.map((d) => localizeMonthShort(d.label, isEs));
  const showCompare = document.getElementById('compareBaselineCheck').checked && activeStrategy.id !== 'E0_Base';
  const tc = getChartThemeColors();

  if (timelineChartInstance) timelineChartInstance.destroy();

  const datasets = [
    {
      label: isEs ? `Agua Útil ${getStrategyLabel(activeStrategy)} (mm)` : `Available Water ${getStrategyLabel(activeStrategy)} (mm)`,
      data: series.map((d) => d.soilWater),
      borderColor: tc.primaryLine,
      backgroundColor: tc.primaryFill,
      fill: true,
      borderWidth: 2.6,
      tension: 0.3,
      pointRadius: series.map((_, i) => (i === CLIENT_STATE.selectedMonthIndex ? 7 : 2.5)),
      pointBackgroundColor: series.map((_, i) => (i === CLIENT_STATE.selectedMonthIndex ? '#e8fe85' : tc.primaryLine)),
      yAxisID: 'y'
    },
    {
      label: isEs ? 'NDVI Cobertura (×100)' : 'Cover NDVI (×100)',
      data: series.map((d) => Math.round(d.ndvi * 100)),
      borderColor: '#2a9d8f',
      borderWidth: 2,
      tension: 0.25,
      yAxisID: 'y'
    },
    {
      label: isEs ? 'N Disponible / Fijado (kg/ha)' : 'Available / Fixed N (kg/ha)',
      data: series.map((d) => d.nAvail),
      borderColor: '#4ea8de',
      borderWidth: 2,
      tension: 0.25,
      yAxisID: 'y'
    },
    {
      label: isEs ? 'Carbono Acumulado Lote (t C)' : 'Plot Accumulated Carbon (t C)',
      data: series.map((d) => d.cumSocLotTons),
      borderColor: '#e08e45',
      borderWidth: 2.3,
      tension: 0.2,
      yAxisID: 'y1'
    }
  ];

  if (showCompare && baselineSeries) {
    datasets.splice(1, 0, {
      label: isEs ? 'Agua Útil Testigo Base (mm)' : 'Baseline Water (mm)',
      data: baselineSeries.slice(0, series.length).map((d) => d.soilWater),
      borderColor: '#e63946',
      borderDash: [6, 4],
      borderWidth: 1.8,
      tension: 0.3,
      pointRadius: 0,
      yAxisID: 'y'
    });
  }

  timelineChartInstance = new Chart(ctx, {
    type: 'line',
    data: { labels, datasets },
    options: {
      responsive: true,
      animation: { duration: 220 },
      interaction: { mode: 'index', intersect: false },
      onClick: (event, elements) => {
        if (elements && elements.length > 0) selectTimelineMonth(elements[0].index);
      },
      plugins: { legend: { position: 'top', labels: { usePointStyle: true, color: tc.legend, font: { family: 'Inter', size: 12 } } } },
      scales: {
        x: { ticks: { color: tc.tick }, grid: { color: tc.grid } },
        y: {
          type: 'linear',
          position: 'left',
          ticks: { color: tc.tick },
          title: { display: true, color: tc.tick, text: isEs ? 'Agua (mm) / NDVI×100 / N (kg/ha)' : 'Water (mm) / NDVI×100 / N (kg/ha)' },
          grid: { color: tc.grid }
        },
        y1: {
          type: 'linear',
          position: 'right',
          ticks: { color: tc.tick },
          title: { display: true, color: tc.tick, text: isEs ? 'Carbono Lote (t C)' : 'Plot Carbon (t C)' },
          grid: { drawOnChartArea: false }
        }
      }
    }
  });
}

function updateChartGuideToggleButton() {
  const btn = document.getElementById('btnToggleChartGuide');
  const body = document.getElementById('step3ChartGuideBody');
  const expanded = CLIENT_STATE.chartGuideExpanded !== false;
  if (body) body.style.display = expanded ? 'block' : 'none';
  if (btn) {
    btn.innerHTML = `📖 <span>${t(expanded ? 's3_btn_toggle_guide' : 's3_btn_show_guide')}</span>`;
  }
}

function toggleChartGuideDetails() {
  CLIENT_STATE.chartGuideExpanded = !CLIENT_STATE.chartGuideExpanded;
  updateChartGuideToggleButton();
}

function startChartMiniTutorial() {
  CLIENT_STATE.chartGuideExpanded = true;
  updateChartGuideToggleButton();
  startStepPointerTutorial(3, true);
  jumpToPointerTutorialSlide(1);
}

function renderTimelineChartGuide(series, baselineSeries, activeStrategy) {
  const grid = document.getElementById('timelineTrendsGrid');
  if (!grid || !Array.isArray(series) || series.length === 0) return;

  const isEs = CLIENT_STATE.lang === 'es';
  const tc = getChartThemeColors();
  const n = series.length;

  const avgWater = Math.round(series.reduce((acc, d) => acc + Number(d.soilWater || 0), 0) / n);
  let maxW = series[0];
  let minW = series[0];
  let stressMonths = 0;
  series.forEach((d) => {
    if (d.soilWater > maxW.soilWater) maxW = d;
    if (d.soilWater < minW.soilWater) minW = d;
    if (Number.isFinite(d.ks) && d.ks < 0.75) stressMonths += 1;
  });

  const hasBaseComp = Array.isArray(baselineSeries) && baselineSeries.length >= n && activeStrategy.id !== 'E0_Base';
  const baseAvgWater = hasBaseComp
    ? Math.round(baselineSeries.slice(0, n).reduce((acc, d) => acc + Number(d.soilWater || 0), 0) / n)
    : avgWater;
  const waterDelta = avgWater - baseAvgWater;
  const waterClass = stressMonths > Math.ceil(n * 0.28) ? 'is-neg' : (waterDelta >= 4 || stressMonths <= 1 ? 'is-pos' : 'is-flat');

  const avgNdvi = series.reduce((acc, d) => acc + Number(d.ndvi || 0), 0) / n;
  const covMonths = series.filter((d) => Number(d.ndvi) >= 0.30).length;
  const bareMonths = series.filter((d) => Number(d.ndvi) < 0.20).length;
  const covPct = Math.round((covMonths / n) * 100);
  const ndviClass = bareMonths === 0 && covPct >= 65 ? 'is-pos' : (bareMonths >= 4 || covPct < 45 ? 'is-neg' : 'is-flat');

  const startN = Math.round(series[0].nAvail || 0);
  const endN = Math.round(series[n - 1].nAvail || 0);
  const maxN = series.reduce((best, d) => (d.nAvail > best.nAvail ? d : best), series[0]);
  const totalLeach = Math.round(series.reduce((acc, d) => acc + Number(d.nLeach || 0), 0));
  const nDiff = endN - startN;
  const nClass = nDiff >= 5 || totalLeach <= 15 ? (nDiff >= -5 ? 'is-pos' : 'is-flat') : (totalLeach > 35 ? 'is-neg' : 'is-flat');

  const endSocLot = Number(series[n - 1].cumSocLotTons || 0);
  const socRateHa = Number(activeStrategy.summaryMetrics?.annualSocRate ?? 0);
  const socClass = endSocLot >= 0.15 ? 'is-pos' : (endSocLot <= -0.15 ? 'is-neg' : 'is-flat');

  const cards = [
    {
      swatch: tc.primaryLine,
      name: isEs ? 'Agua Útil del Perfil (mm)' : 'Profile Available Water (mm)',
      axis: isEs ? 'Eje Izquierdo' : 'Left Axis',
      meaning: isEs
        ? 'Mide el tanque de agua disponible en raíces (0–100 cm). Cuando la curva sube hay recarga por lluvia o ahorro en barbecho; cuando cae abruptamente hay alto consumo de cultivo o sequía. La línea roja punteada es el Testigo Base.'
        : 'Tracks plant-available soil water (0–100 cm). Rising slopes indicate rainfall recharge or fallow storage; steep drops show high crop demand or drought. The dashed red line shows the Baseline Strategy.',
      slopeClass: waterClass,
      trend: isEs
        ? `${hasBaseComp ? `<strong>${waterDelta >= 0 ? '+' : ''}${waterDelta} mm</strong> vs. Testigo E0 en promedio · ` : ''}Promedio ${avgWater} mm (pico ${maxW.soilWater} mm en ${localizeMonthShort(maxW.label, true)}, piso ${minW.soilWater} mm en ${localizeMonthShort(minW.label, true)})${stressMonths > 0 ? ` · ${stressMonths} mes(es) con estrés Ks < 0,75` : ' · Sin estrés severo'}.`
        : `${hasBaseComp ? `<strong>${waterDelta >= 0 ? '+' : ''}${waterDelta} mm</strong> vs. E0 Baseline avg · ` : ''}Mean ${avgWater} mm (peak ${maxW.soilWater} mm in ${localizeMonthShort(maxW.label, false)}, low ${minW.soilWater} mm in ${localizeMonthShort(minW.label, false)})${stressMonths > 0 ? ` · ${stressMonths} month(s) with Ks < 0.75 stress` : ' · No severe stress'}.`
    },
    {
      swatch: '#2a9d8f',
      name: isEs ? 'Cobertura Vegetal NDVI (×100)' : 'Vegetation Cover NDVI (×100)',
      axis: isEs ? 'Eje Izquierdo' : 'Left Axis',
      meaning: isEs
        ? 'Refleja cuánto vigor verde protege el suelo (0 a 90 pts = NDVI 0,00 a 0,90). Picos altos marcan cultivos activos; valles por debajo de 20 indican suelo desnudo vulnerable a erosión y malezas.'
        : 'Shows green canopy shield (0–90 scale = NDVI 0.00–0.90). Peaks indicate vigorous crops; valleys below 20 mark bare soil exposed to erosion and runoff.',
      slopeClass: ndviClass,
      trend: isEs
        ? `NDVI medio <strong>${avgNdvi.toFixed(2).replace('.', ',')}</strong> · <strong>${covPct}%</strong> del ciclo con cobertura viva (${covMonths}/${n} meses) y <strong>${bareMonths}</strong> mes(es) en suelo desnudo.`
        : `Mean NDVI <strong>${avgNdvi.toFixed(2)}</strong> · <strong>${covPct}%</strong> of cycle with living cover (${covMonths}/${n} months) and <strong>${bareMonths}</strong> bare-soil month(s).`
    },
    {
      swatch: '#4ea8de',
      name: isEs ? 'Nitrógeno Disponible (kg N/ha)' : 'Available Nitrogen (kg N/ha)',
      axis: isEs ? 'Eje Izquierdo' : 'Left Axis',
      meaning: isEs
        ? 'Muestra el balance mineral del suelo: sube con leguminosas fijadoras (soja, vicia, alfalfa) y mineralización; baja por absorción de gramíneas (maíz, trigo) o lavado en profundidad.'
        : 'Tracks mineral soil N: increases after legume biological fixation (soy, vetch, alfalfa) and mineralization; drops during high cereal uptake (maize, wheat) or leaching.',
      slopeClass: nClass,
      trend: isEs
        ? `Parte en ${startN} kg/ha y cierra en <strong>${endN} kg/ha</strong> (${nDiff >= 0 ? '+' : ''}${nDiff} kg/ha) · Pico de ${Math.round(maxN.nAvail)} kg/ha en ${localizeMonthShort(maxN.label, true)} · Lixiviación acumulada: ${totalLeach} kg N/ha.`
        : `Starts at ${startN} kg/ha and ends at <strong>${endN} kg/ha</strong> (${nDiff >= 0 ? '+' : ''}${nDiff} kg/ha) · Peak ${Math.round(maxN.nAvail)} kg/ha in ${localizeMonthShort(maxN.label, false)} · Cumulative leaching: ${totalLeach} kg N/ha.`
    },
    {
      swatch: '#e08e45',
      name: isEs ? 'Carbono Orgánico Acumulado (t C)' : 'Plot Accumulated Carbon (t C)',
      axis: isEs ? 'Eje Derecho' : 'Right Axis',
      meaning: isEs
        ? 'Es la tendencia estructural de salud edáfica del lote completo (ΔSOC según modelo AMG). Si la pendiente asciende, el sistema secuestra carbono; si desciende, degrada materia orgánica.'
        : 'Structural soil-health trend across your whole parcel (AMG ΔSOC model). Upward slope = carbon sequestration; downward slope = organic matter depletion.',
      slopeClass: socClass,
      trend: isEs
        ? `${endSocLot >= 0.15 ? '📈 Tendencia regenerativa' : (endSocLot <= -0.15 ? '📉 Tendencia extractiva' : '➖ Equilibrio de carbono')}: <strong>${endSocLot >= 0 ? '+' : ''}${endSocLot.toFixed(2).replace('.', ',')} t C</strong> en el lote (${socRateHa >= 0 ? '+' : ''}${socRateHa.toFixed(2).replace('.', ',')} Mg C/ha/año).`
        : `${endSocLot >= 0.15 ? '📈 Regenerative trend' : (endSocLot <= -0.15 ? '📉 Depleting trend' : '➖ Carbon equilibrium')}: <strong>${endSocLot >= 0 ? '+' : ''}${endSocLot.toFixed(2)} t C</strong> across plot (${socRateHa >= 0 ? '+' : ''}${socRateHa.toFixed(2)} Mg C/ha/yr).`
    }
  ];

  grid.innerHTML = cards.map((c) => `
    <div class="trend-explain-card">
      <div class="trend-explain-head">
        <span class="trend-explain-name"><span class="trend-swatch" style="background:${c.swatch};"></span> ${c.name}</span>
        <span class="trend-axis-tag">${c.axis}</span>
      </div>
      <p class="trend-meaning-txt">${c.meaning}</p>
      <div class="trend-slope-pill ${c.slopeClass}">
        <strong>${isEs ? 'Tendencia actual:' : 'Current trend:'}</strong> ${c.trend}
      </div>
    </div>
  `).join('');

  updateChartGuideToggleButton();
}

function renderFootnoteInspector(item, strategy, baseItem) {
  const isEs = CLIENT_STATE.lang === 'es';
  const locFullDate = localizeFullDate(item.fullDate, isEs);
  const locCrop = getTimelineCropLabel(item, isEs);
  document.getElementById('fnTitle').textContent = isEs
    ? `Mes ${item.index + 1} de ${strategy.monthsCount} (${strategy.cycleYears}a) — ${locFullDate} · ${locCrop}`
    : `Month ${item.index + 1} of ${strategy.monthsCount} (${strategy.cycleYears}y) — ${locFullDate} · ${locCrop}`;

  const badge = document.getElementById('fnStateBadge');
  if (item.stageType === 'bare') {
    badge.className = 'trust-badge trust-red';
    badge.innerHTML = `<span class="trust-dot"></span> ${isEs ? 'Suelo Desnudo (NDVI < 0,20)' : 'Bare Soil (NDVI < 0.20)'}`;
  } else if (item.stageType === 'stubble') {
    badge.className = 'trust-badge trust-yellow';
    badge.innerHTML = `<span class="trust-dot"></span> ${isEs ? 'Barbecho con Rastrojo' : 'Stubble Fallow'}`;
  } else {
    badge.className = 'trust-badge trust-green';
    badge.innerHTML = `<span class="trust-dot"></span> ${
      item.stageType === 'cover'
        ? (isEs ? 'Cobertura Viva Activa' : 'Active Living Cover')
        : (isEs ? 'Cultivo Comercial Activo' : 'Active Cash Crop')
    }`;
  }

  const diffWaterVsE0 = baseItem ? item.soilWater - baseItem.soilWater : 0;
  const diffSign = diffWaterVsE0 > 0 ? '+' : '';
  const faoInfo = Number.isFinite(item.eta)
    ? `<div style="font-size:11.5px; color:var(--graphite); margin-top:6px;">
         ${isEs ? 'Balance FAO-56 (3 sub-pasos):' : 'FAO-56 Water Stress Balance:'}
         ETa = <strong>${item.eta} mm</strong> / ETc = <strong>${item.etcPot ?? item.etc} mm</strong> ·
         Ks = <strong>${item.ks ?? 1}</strong> ·
         ${isEs ? 'Drenaje' : 'Drainage'}: <strong>${item.drainage ?? 0} mm</strong>
       </div>`
    : '';
  document.getElementById('waterTankBanner').innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px; font-size:13px;">
      <span><strong>${isEs ? 'Reserva de Agua Útil en Perfil (0–100 cm):' : 'Profile Available Water Reserve:'}</strong> ${item.soilWater} mm / ${item.awMax} mm (${item.awPct}%)</span>
      <span class="delta-pill ${diffWaterVsE0 >= 0 ? 'delta-up' : 'delta-down'}">
        ${strategy.id === 'E0_Base'
          ? (isEs ? 'Estrategia testigo' : 'Baseline strategy')
          : `${diffSign}${diffWaterVsE0} mm ${isEs ? 'vs. Testigo E0' : 'vs. Baseline E0'}`}
      </span>
    </div>
    <div class="tank-bar-bg"><div class="tank-bar-fill" style="width:${item.awPct}%;"></div></div>
    ${faoInfo}
  `;

  const kpis = isEs ? [
    { key: 'ndvi', label: '1. Vigor Vegetal (NDVI)', val: `${item.ndvi.toFixed(2)}`, sub: item.ndvi < 0.20 ? 'Sin cobertura viva (erosión)' : 'Suelo protegido por canopeo' },
    { key: 'et0', label: '2. Balance Hídrico Mes', val: `${item.waterBalance >= 0 ? '+' : ''}${item.waterBalance} mm`, sub: `Lluvia útil ${item.pEf} mm − Consumo ${item.etc} mm` },
    { key: 'et0', label: '3. Temperatura Media', val: `${item.tempMean} °C`, sub: 'Serie calibrada INTA SIGA' },
    { key: 'soc_gei', label: '4. Carbono Acumulado Lote', val: `${item.cumSocLotTons >= 0 ? '+' : ''}${item.cumSocLotTons} t C`, sub: `${item.cumSocHa >= 0 ? '+' : ''}${item.cumSocHa} Mg C/ha en ${CLIENT_STATE.areaHa.toFixed(1)} ha` },
    { key: 'C6', label: '5. Nitrógeno Disponible', val: `${item.nAvail} kg N/ha`, sub: `Lixiviación mes: ${item.nLeach} kg N/ha` },
    { key: 'rusle', label: '6. Riesgo Erosión', val: `${item.erosionRisk}%`, sub: item.erosionRisk > 50 ? 'Crítico: voladura / escorrentía' : 'Bajo riesgo superficial' },
    { key: 'C8', label: '7. Flujo Caja Acumulado', val: `${item.cumCashLot >= 0 ? '+' : ''}${item.cumCashLot.toLocaleString('es-AR')} USD`, sub: `${item.cumCashHa} USD/ha acumulados` },
    { key: 'mcda', label: '8. Puntaje Global Hoy', val: `${strategy.saw15.toFixed(1)} pts`, sub: `TOPSIS: ${strategy.topsis15.toFixed(1)} | SAW-8: ${strategy.saw8.toFixed(1)}` }
  ] : [
    { key: 'ndvi', label: '1. Vegetation Vigor (NDVI)', val: `${item.ndvi.toFixed(2)}`, sub: item.ndvi < 0.20 ? 'No living cover (erosion risk)' : 'Protected by canopy' },
    { key: 'et0', label: '2. Monthly Water Balance', val: `${item.waterBalance >= 0 ? '+' : ''}${item.waterBalance} mm`, sub: `Effective rain ${item.pEf} mm − ETc ${item.etc} mm` },
    { key: 'et0', label: '3. Mean Temperature', val: `${item.tempMean} °C`, sub: 'Calibrated INTA SIGA series' },
    { key: 'soc_gei', label: '4. Plot Carbon (ΔSOC)', val: `${item.cumSocLotTons >= 0 ? '+' : ''}${item.cumSocLotTons} t C`, sub: `${item.cumSocHa >= 0 ? '+' : ''}${item.cumSocHa} Mg C/ha across ${CLIENT_STATE.areaHa.toFixed(1)} ha` },
    { key: 'C6', label: '5. Available Nitrogen', val: `${item.nAvail} kg N/ha`, sub: `Monthly leaching: ${item.nLeach} kg N/ha` },
    { key: 'rusle', label: '6. Erosion Risk', val: `${item.erosionRisk}%`, sub: item.erosionRisk > 50 ? 'Critical topsoil loss risk' : 'Low surface risk' },
    { key: 'C8', label: '7. Cumulative Cash Flow', val: `${item.cumCashLot >= 0 ? '+' : ''}${item.cumCashLot.toLocaleString('en-US')} USD`, sub: `${item.cumCashHa} USD/ha cumulative` },
    { key: 'mcda', label: '8. Overall Score Today', val: `${strategy.saw15.toFixed(1)} pts`, sub: `TOPSIS: ${strategy.topsis15.toFixed(1)} | SAW-8: ${strategy.saw8.toFixed(1)}` }
  ];

  document.getElementById('fnKpiGrid').innerHTML = kpis.map((k) => {
    const clickFn = k.key.startsWith('C') ? `openCriterionPopup('${k.key}', '${strategy.id}', null)` : `openInfoPopup('${k.key}')`;
    return `
      <div class="kpi-tile" onclick="${clickFn}" title="${isEs ? 'Clic para explicar este dato' : 'Click to explain this metric'}">
        <div class="kpi-tile-label"><span>${k.label}</span> <span class="btn-help-inline" style="width:16px;height:16px;font-size:10px;">?</span></div>
        <div class="kpi-tile-val">${k.val}</div>
        <div class="kpi-tile-sub">${k.sub}</div>
      </div>
    `;
  }).join('');

  document.getElementById('fnProse').innerHTML = isEs ? `
    <p style="font-size:14px; color:var(--charcoal); margin-bottom:10px;">
      <strong style="color:var(--forest-ink);">¿Qué está pasando en el lote este mes?</strong> ${item.noteWhy}
    </p>
    <p style="font-size:13px; color:var(--graphite);">
      <strong style="color:var(--forest-ink);">¿Cómo impacta en tu resultado final?</strong> ${item.noteImpact}
    </p>
  ` : `
    <p style="font-size:14px; color:var(--charcoal); margin-bottom:10px;">
      <strong style="color:var(--forest-ink);">What is happening in the field this month?</strong> Stage: ${item.cropLabel} (NDVI ${item.ndvi.toFixed(2)}, monthly water balance ${item.waterBalance >= 0 ? '+' : ''}${item.waterBalance} mm, available mineral N ${item.nAvail} kg/ha).
    </p>
    <p style="font-size:13px; color:var(--graphite);">
      <strong style="color:var(--forest-ink);">Impact on 15-Criteria Matrix (${getStrategyLabel(strategy)}):</strong> ${item.stageType === 'bare' ? 'Increases bare soil days (C4) and erosion risk (C11).' : 'Strengthens soil cover (C4), organic carbon retention (C3), and water use efficiency (C9).'}
    </p>
  `;
}

function selectTimelineStrategy(id) {
  CLIENT_STATE.selectedStrategyId = id;
  renderTimelineSection();
}

function selectTimelineMonth(idx) {
  CLIENT_STATE.selectedMonthIndex = idx;
  renderTimelineSection();
}

function stepTimelineMonth(delta) {
  const activeStrategy = CLIENT_STATE.simulation.strategies.find((s) => s.id === CLIENT_STATE.selectedStrategyId);
  const len = activeStrategy ? activeStrategy.timeline.length : 24;
  CLIENT_STATE.selectedMonthIndex = (CLIENT_STATE.selectedMonthIndex + delta + len) % len;
  renderTimelineSection();
}

function toggleTimelinePlayback() {
  const btn = document.getElementById('playTimelineBtn');
  if (CLIENT_STATE.playbackTimer) {
    clearInterval(CLIENT_STATE.playbackTimer);
    CLIENT_STATE.playbackTimer = null;
    btn.textContent = t('btn_play_m');
  } else {
    btn.textContent = t('btn_pause_m');
    CLIENT_STATE.playbackTimer = setInterval(() => stepTimelineMonth(1), 1000);
  }
}

/* ==========================================================================
   9. PASO 4: CONCLUSIONES, PODIO, GRÁFICO Y MATRIZ CLICKABLE CON POPUPS
   ========================================================================== */
function renderDynamicConclusions() {
  const sorted = [...CLIENT_STATE.simulation.strategies].sort((a, b) => b.saw15 - a.saw15);
  const winner = sorted[0];
  const baseline = CLIENT_STATE.simulation.strategies.find((s) => s.id.startsWith('E0')) || sorted[sorted.length - 1];
  const lastMonthWin = winner.timeline[winner.timeline.length - 1];
  const lastMonthBase = baseline.timeline[baseline.timeline.length - 1];
  const isEs = CLIENT_STATE.lang === 'es';

  const cards = isEs ? [
    {
      bg: 'card-sage',
      kicker: '1. Estrategia Recomendada',
      title: `${getStrategyLabel(winner)} (${winner.saw15.toFixed(1)} pts)`,
      body: `Supera en +${(winner.saw15 - baseline.saw15).toFixed(1)} puntos SAW-15 al testigo (${getStrategyLabel(baseline)}). En tu parcela de ${CLIENT_STATE.areaHa.toFixed(2)} ha logra ${lastMonthWin.cumSocLotTons >= 0 ? '+' : ''}${lastMonthWin.cumSocLotTons} toneladas de carbono (C) frente a ${lastMonthBase.cumSocLotTons} t C del testigo, con erosión de ${winner.summaryMetrics.rusleTonsHaYr} t/ha/año.`
    },
    {
      bg: 'card-sky',
      kicker: '2. Seguridad Hídrica e Incertidumbre',
      title: `Reserva final: ${lastMonthWin.soilWater} mm (${lastMonthWin.awPct}%)`,
      body: `Cierra su ciclo de ${winner.cycleYears} año(s) con TOPSIS-15 de ${winner.topsis15.toFixed(1)} pts e intervalo Monte Carlo 90% de [${winner.ciLow}–${winner.ciHigh}] pts (σ = ±${winner.stdDev}).`
    },
    {
      bg: 'card-peach',
      kicker: '3. Evidencia vs. Inferencia y Validación',
      title: CLIENT_STATE.isLocalOverride ? 'Calibrado con datos de campo' : 'Requiere muestreo local',
      body: CLIENT_STATE.isLocalOverride
        ? 'Incorporaste mediciones propias del lote (reduciendo un 65% el margen de error edáfico). Validá fecha de secado y densidad de siembra con tu ingeniero agrónomo.'
        : 'Los parámetros provienen de satélites NASA/ISRIC (250 m–9 km). Confirmá profundidad real de tosca y análisis de nitratos/fósforo antes de sembrar.'
    }
  ] : [
    {
      bg: 'card-sage',
      kicker: '1. Recommended Strategy',
      title: `${getStrategyLabel(winner)} (${winner.saw15.toFixed(1)} pts)`,
      body: `Outperforms baseline (${getStrategyLabel(baseline)}) by +${(winner.saw15 - baseline.saw15).toFixed(1)} SAW-15 points. Across ${CLIENT_STATE.areaHa.toFixed(2)} ha it achieves ${lastMonthWin.cumSocLotTons >= 0 ? '+' : ''}${lastMonthWin.cumSocLotTons} t soil carbon vs. ${lastMonthBase.cumSocLotTons} t C in baseline, with ${winner.summaryMetrics.rusleTonsHaYr} t/ha/yr RUSLE erosion.`
    },
    {
      bg: 'card-sky',
      kicker: '2. Water Security & Uncertainty',
      title: `Final reserve: ${lastMonthWin.soilWater} mm (${lastMonthWin.awPct}%)`,
      body: `Finishes its ${winner.cycleYears}-yr cycle with ${winner.topsis15.toFixed(1)} TOPSIS-15 points and a 90% Monte Carlo confidence band of [${winner.ciLow}–${winner.ciHigh}] pts (σ = ±${winner.stdDev}).`
    },
    {
      bg: 'card-peach',
      kicker: '3. Evidence vs. Model & Validation',
      title: CLIENT_STATE.isLocalOverride ? 'Calibrated with field data' : 'Field sampling required',
      body: CLIENT_STATE.isLocalOverride
        ? 'Your field measurements cut soil uncertainty by 65%. Validate termination timing and seeding rate with your local agronomist.'
        : 'Soil/climate derive from NASA/ISRIC (250 m–9 km). Confirm actual hardpan depth and lab P/NO₃⁻ levels before planting.'
    }
  ];

  document.getElementById('dynamicConclusionsGrid').innerHTML = cards.map((c) => `
    <div class="card ${c.bg}">
      <span style="font-size:11px; font-weight:600; text-transform:uppercase; color:var(--forest-ink);">${c.kicker}</span>
      <h4 style="font-family:var(--font-serif); font-size:24px; margin:6px 0 8px;">${c.title}</h4>
      <p style="font-size:13px; color:var(--charcoal); line-height:1.55;">${c.body}</p>
    </div>
  `).join('');
}

function renderLivePodium() {
  const sorted = [...CLIENT_STATE.simulation.strategies].sort((a, b) => b.saw15 - a.saw15);
  const top3 = sorted.slice(0, 3);
  const cardStyles = ['card-sage', 'card-sky', 'card-peach'];
  const isEs = CLIENT_STATE.lang === 'es';
  const medals = isEs ? ['1° Mejor Opción', '2° Alternativa', '3° Alternativa'] : ['1st Best Option', '2nd Alternative', '3rd Alternative'];

  document.getElementById('livePodiumGrid').innerHTML = top3.map((st, idx) => {
    const baseSt = BASELINE_STRATEGIES.find((b) => b.id === st.id);
    const delta = baseSt ? Number((st.saw15 - baseSt.saw15).toFixed(2)) : 0;
    const deltaHtml = !baseSt
      ? `<span class="delta-pill delta-up">${isEs ? 'Personalizada' : 'Custom'}</span>`
      : (Math.abs(delta) < 0.05
        ? `<span class="delta-pill delta-neutral">${isEs ? 'Base' : 'Base'}</span>`
        : `<span class="delta-pill ${delta > 0 ? 'delta-up' : 'delta-down'}">${delta > 0 ? `+${delta} ▲` : `${delta} ▼`}</span>`);

    const apt = st.aptitude;
    const aptHtml = apt
      ? `<span class="apt-badge apt-badge-${apt.status}" title="${isEs ? apt.reason_es : apt.reason_en}">${isEs ? apt.label_es : apt.label_en}</span>`
      : '';
    const wueTxt = st.summaryMetrics?.wueKgMsHaMm
      ? `<div style="font-size:11.5px; color:var(--graphite); margin-top:6px;">WUE: <strong>${st.summaryMetrics.wueKgMsHaMm} kg MS/ha/mm</strong>${st.summaryMetrics.meanYieldKgHa ? ` · FAO-33: <strong>${st.summaryMetrics.meanYieldKgHa.toLocaleString(isEs ? 'es-AR' : 'en-US')} kg/ha</strong>` : ''}</div>`
      : '';

    return `
      <div class="card ${cardStyles[idx]}" style="cursor:pointer;" onclick="openStrategyResultPopup('${st.id}')">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
          <span style="font-size:11px; font-weight:600; text-transform:uppercase; color:var(--forest-ink);">${medals[idx]}</span>
          ${deltaHtml}
        </div>
        <h3 style="font-family:var(--font-serif); font-size:25px; margin-bottom:6px;">${getStrategyLabel(st)}</h3>
        <div style="margin-bottom:6px;">${aptHtml}</div>
        <div style="font-size:28px; font-weight:600; color:var(--forest-ink); margin-bottom:6px;">
          ${st.saw15.toFixed(2)} <span style="font-size:13px; font-weight:400; color:var(--graphite);">pts SAW-15 · TOPSIS ${st.topsis15.toFixed(1)}</span>
        </div>
        <p style="font-size:12px; color:var(--graphite);">${getStrategyDisplayName(st)}</p>
        ${wueTxt}
      </div>
    `;
  }).join('');
}

function renderRankingSection() {
  renderDynamicConclusions();
  renderLivePodium();

  const { criteriaMeta, strategies } = CLIENT_STATE.simulation;
  const isEs = CLIENT_STATE.lang === 'es';
  const tc = getChartThemeColors();

  const ctx = document.getElementById('rankingChartCanvas').getContext('2d');
  if (rankingChartInstance) rankingChartInstance.destroy();

  rankingChartInstance = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: strategies.map((s) => getStrategyLabel(s)),
      datasets: [
        {
          label: isEs ? 'Puntaje Ponderado SAW-15' : 'Weighted Score SAW-15',
          data: strategies.map((s) => s.saw15),
          backgroundColor: tc.barSaw,
          borderRadius: 10
        },
        {
          label: isEs ? 'Índice No Compensatorio TOPSIS-15' : 'Non-Compensatory TOPSIS-15',
          data: strategies.map((s) => s.topsis15),
          backgroundColor: tc.barTopsis,
          borderColor: tc.barTopsisBorder,
          borderWidth: 1,
          borderRadius: 10
        }
      ]
    },
    options: {
      responsive: true,
      plugins: { legend: { labels: { color: tc.legend } } },
      scales: {
        y: { beginAtZero: true, max: 100, ticks: { color: tc.tick }, grid: { color: tc.grid } },
        x: { ticks: { color: tc.tick }, grid: { display: false } }
      }
    }
  });

  document.getElementById('mcdaTableHead').innerHTML = `
    <tr>
      <th>${isEs ? 'Criterio Auditado (0–100) · Clic para explicar' : 'Audited Criterion (0–100) · Click to explain'}</th>
      <th>${isEs ? 'Peso' : 'Weight'}</th>
      ${strategies.map((s) => `<th>${getStrategyLabel(s)}</th>`).join('')}
    </tr>
  `;

  const tbody = document.getElementById('mcdaTableBody');
  let html = '';

  criteriaMeta.forEach((crit, i) => {
    const critTitle = isEs ? crit.name : crit.name_en;
    const originTag = crit.origin === 'calculado'
      ? `<span class="crit-origin-pill" title="${isEs ? 'Calculado físicamente vía FAO-56 / FAO-33' : 'Physically computed via FAO-56 / FAO-33'}">FAO-33</span>`
      : '';
    html += `<tr>
      <td>
        <button class="crit-btn-link" onclick="openCriterionPopup('${crit.id}', null, null)">
          <span class="btn-help-inline" style="width:18px;height:18px;font-size:10px;">?</span>
          <span>${critTitle}</span>
          ${originTag}
        </button>
      </td>
      <td>${crit.weightPct}%</td>
      ${strategies.map((r) => {
        const v = r.scores[i];
        const cls = v >= 70 ? 'sc-high' : (v >= 50 ? 'sc-mid' : 'sc-low');
        return `<td><button class="score-chip ${cls}" onclick="openCriterionPopup('${crit.id}', '${r.id}', ${v})" title="${isEs ? 'Clic para explicar este puntaje' : 'Click to explain this score'}">${v}</button></td>`;
      }).join('')}
    </tr>`;
  });

  html += `<tr class="row-saw">
    <td><button class="crit-btn-link" onclick="openInfoPopup('mcda')"><span class="btn-help-inline">?</span> ${isEs ? 'PUNTAJE TOTAL SAW-15 (15 Criterios AHP)' : 'TOTAL SCORE SAW-15 (15 AHP Criteria)'}</button></td>
    <td>100%</td>
    ${strategies.map((r) => `<td style="font-size:15px; color:var(--forest-ink); cursor:pointer;" onclick="openStrategyResultPopup('${r.id}')">${r.saw15.toFixed(2)}</td>`).join('')}
  </tr>`;

  html += `<tr class="row-topsis">
    <td><button class="crit-btn-link" onclick="openInfoPopup('mcda')"><span class="btn-help-inline">?</span> ${isEs ? 'ÍNDICE NO COMPENSATORIO TOPSIS-15' : 'NON-COMPENSATORY TOPSIS-15'}</button></td>
    <td>—</td>
    ${strategies.map((r) => `<td style="cursor:pointer;" onclick="openStrategyResultPopup('${r.id}')">${r.topsis15.toFixed(2)}</td>`).join('')}
  </tr>`;

  html += `<tr>
    <td><button class="crit-btn-link" onclick="openInfoPopup('mcda')"><span class="btn-help-inline">?</span> ${isEs ? 'Auditoría Histórica SAW-8 (C1–C8)' : 'Audited Historical SAW-8 (C1–C8)'}</button></td>
    <td>100%</td>
    ${strategies.map((r) => `<td style="cursor:pointer;" onclick="openStrategyResultPopup('${r.id}')">${r.saw8.toFixed(2)}</td>`).join('')}
  </tr>`;

  html += `<tr class="row-ci">
    <td><button class="crit-btn-link" onclick="openInfoPopup('mcda')"><span class="btn-help-inline">?</span> ${isEs ? 'Intervalo Confianza 90% (Taylor / Monte Carlo)' : '90% Confidence Interval (Taylor / Monte Carlo)'}</button></td>
    <td>±1,65σ</td>
    ${strategies.map((r) => `<td style="cursor:pointer;" onclick="openStrategyResultPopup('${r.id}')">${r.ciLow.toFixed(1)} – ${r.ciHigh.toFixed(1)}</td>`).join('')}
  </tr>`;

  tbody.innerHTML = html;
}

function renderCropCatalog() {
  const isEs = CLIENT_STATE.lang === 'es';
  document.getElementById('cropCatalogGrid').innerHTML = APP_DATA.cropCatalog.map((c) => `
    <div class="card ${c.card}" style="color:var(--charcoal);">
      <span style="font-size:11px; font-weight:600; text-transform:uppercase; color:var(--forest-ink);">${c.family}</span>
      <h4 style="font-family:var(--font-serif); font-size:23px; margin:6px 0 10px;">${c.name}</h4>
      <div style="font-size:13px; line-height:1.7;">
        <div><strong>Kc (FAO-56):</strong> ${c.kc}</div>
        <div><strong>${isEs ? 'Relación C:N:' : 'C:N Ratio:'}</strong> ${c.cn}</div>
        <div><strong>${isEs ? 'Fijación N:' : 'N Fixation:'}</strong> ${c.bfn}</div>
        <div><strong>${isEs ? 'Manejo:' : 'Management:'}</strong> ${c.stress}</div>
      </div>
    </div>
  `).join('');
}

/* ==========================================================================
   10. SISTEMA COMPLETO DE POPUPS EXPLICATIVOS (DATOS, CRITERIOS Y RESULTADOS)
   ========================================================================== */
function openInfoPopup(key) {
  const isEs = CLIENT_STATE.lang === 'es';
  const eq = APP_DATA.equations[key] || APP_DATA.equations.general;

  document.getElementById('modalBadgeText').textContent = t('mod_badge');
  document.getElementById('modalEqTitle').textContent = isEs ? (eq.title_es || eq.title) : (eq.title_en || eq.title_es);
  document.getElementById('modalPlainBox').innerHTML = `<strong>💡 ${isEs ? 'Resumen de la información:' : 'Information summary:'}</strong> ${isEs ? eq.plain_es : eq.plain_en}`;
  document.getElementById('modalContextScoreBox').style.display = 'none';
  document.getElementById('modalEqFormula').textContent = eq.formula;
  document.getElementById('modalInterpBox').innerHTML = `<strong>📊 ${isEs ? 'Interpretación práctica:' : 'Practical interpretation:'}</strong> ${isEs ? eq.interp_es : eq.interp_en}`;
  document.getElementById('modalEqSource').textContent = `${isEs ? 'Fuentes:' : 'Sources:'} ${eq.source}`;

  document.getElementById('equationModal').classList.add('open');
}

function openCriterionPopup(critId, strategyId, scoreVal) {
  const isEs = CLIENT_STATE.lang === 'es';
  const crit = CLIENT_STATE.simulation.criteriaMeta.find((c) => c.id === critId);
  if (!crit) return openInfoPopup('general');

  document.getElementById('modalBadgeText').textContent = isEs
    ? `Explicación de Criterio ${crit.id} (Peso AHP: ${crit.weightPct}%)`
    : `Criterion ${crit.id} Explanation (AHP Weight: ${crit.weightPct}%)`;
  document.getElementById('modalEqTitle').textContent = isEs ? crit.name : crit.name_en;
  document.getElementById('modalPlainBox').innerHTML = `<strong>💡 ${isEs ? '¿Qué mide este criterio?' : 'What does this criterion measure?'}</strong> ${isEs ? crit.plain_es : crit.plain_en}`;

  const ctxBox = document.getElementById('modalContextScoreBox');
  if (strategyId && scoreVal !== null && scoreVal !== undefined) {
    const st = CLIENT_STATE.simulation.strategies.find((s) => s.id === strategyId);
    const tierTxt = scoreVal >= 70
      ? (isEs ? 'Desempeño Sobresaliente (Verde ≥70)' : 'Strong Performance (Green ≥70)')
      : (scoreVal >= 50 ? (isEs ? 'Desempeño Intermedio (Amarillo 50–69)' : 'Moderate Performance (Yellow 50–69)')
        : (isEs ? 'Alerta Agronómica / Cuello de Botella (<50)' : 'Agronomic Bottleneck Alert (<50)'));
    const sm = st ? st.summaryMetrics : null;

    ctxBox.style.display = 'block';
    ctxBox.innerHTML = `
      <strong>🎯 ${isEs ? 'Diagnóstico puntual en' : 'Specific result in'} ${st ? getStrategyLabel(st) : strategyId}: ${scoreVal} / 100 pts</strong><br>
      <span>${tierTxt}.</span>
      ${sm ? `<br><span style="font-size:12px;">${isEs ? 'Métricas reales del ciclo:' : 'Simulated cycle metrics:'} ISI cobertura = <strong>${sm.isiPct}%</strong> · ΔSOC = <strong>${sm.annualSocRate} Mg C/ha/año</strong> · BFN = <strong>${sm.annualNFixed} kg N/ha</strong> · Erosión RUSLE = <strong>${sm.rusleTonsHaYr} t/ha/año</strong> · Margen = <strong>${sm.avgNetCashYr} USD/ha/año</strong>.</span>` : ''}
    `;
  } else {
    ctxBox.style.display = 'none';
  }

  document.getElementById('modalEqFormula').textContent = crit.formula;
  document.getElementById('modalInterpBox').innerHTML = `<strong>📊 ${isEs ? 'Cómo interpretar los puntos (0–100):' : 'How to read scores (0–100):'}</strong> ${isEs ? crit.interp_es : crit.interp_en}`;
  document.getElementById('modalEqSource').textContent = `${isEs ? 'Datos de origen:' : 'Source data:'} ${crit.apiSource} · σ instrumental = ±${crit.sigma} pts`;

  document.getElementById('equationModal').classList.add('open');
}

function openStrategyResultPopup(strategyId) {
  const isEs = CLIENT_STATE.lang === 'es';
  const st = CLIENT_STATE.simulation.strategies.find((s) => s.id === strategyId);
  if (!st) return;
  const sm = st.summaryMetrics;
  const gap = Number((st.saw15 - st.topsis15).toFixed(1));

  document.getElementById('modalBadgeText').textContent = isEs ? `Radiografía Completa de Resultados · ${st.short}` : `Full Result Breakdown · ${st.short}`;
  document.getElementById('modalEqTitle').textContent = getStrategyDisplayName(st);
  document.getElementById('modalPlainBox').innerHTML = isEs
    ? `<strong>💡 Diagnóstico general:</strong> Esta rotación obtuvo <strong>${st.saw15.toFixed(2)} pts</strong> en promedio ponderado (SAW-15) y <strong>${st.topsis15.toFixed(2)} pts</strong> en el filtro exigente TOPSIS-15. ${gap > 12 ? '⚠️ Atención: TOPSIS cae mucho respecto a SAW porque algún criterio crítico (suelo desnudo o erosión) está muy bajo.' : '✅ Excelente equilibrio entre productividad económica y cuidado del suelo.'}`
    : `<strong>💡 Overall assessment:</strong> This strategy scored <strong>${st.saw15.toFixed(2)} pts</strong> in weighted SAW-15 and <strong>${st.topsis15.toFixed(2)} pts</strong> in non-compensatory TOPSIS-15. ${gap > 12 ? '⚠️ Notice TOPSIS drops well below SAW because one or more critical soil/erosion indicators are severely degraded.' : '✅ Well balanced between cash returns and soil resilience.'}`;

  const aptInfo = st.aptitude
    ? `<br>• ${isEs ? 'Filtro Aptitud Q0.05–Q0.95:' : 'Aptitude Filter (Q0.05–Q0.95):'} <strong>${isEs ? st.aptitude.label_es : st.aptitude.label_en}</strong> — ${isEs ? st.aptitude.reason_es : st.aptitude.reason_en}`
    : '';
  const waterInfo = sm.wueKgMsHaMm
    ? `<br>• ${isEs ? 'Eficiencia Agua FAO-56/33:' : 'FAO-56/33 Water Metrics:'} ETa = <strong>${sm.etaMm} mm</strong> / ETc = <strong>${sm.etcMm} mm</strong> · WUE = <strong>${sm.wueKgMsHaMm} kg MS/ha/mm</strong>${sm.meanYieldKgHa ? ` · Rinde medio = <strong>${sm.meanYieldKgHa} kg/ha</strong>` : ''}`
    : '';

  const ctxBox = document.getElementById('modalContextScoreBox');
  ctxBox.style.display = 'block';
  ctxBox.innerHTML = isEs
    ? `<strong>Indicadores Físicos Simulados (${st.cycleYears} años / ${st.monthsCount} meses):</strong><br>
       • Cobertura viva (ISI): <strong>${sm.isiPct}%</strong> del ciclo (NDVI medio: ${sm.meanNdvi})<br>
       • Balance de Carbono: <strong>${sm.annualSocRate >= 0 ? '+' : ''}${sm.annualSocRate} Mg C/ha/año</strong> (${sm.cumSocLotTons >= 0 ? '+' : ''}${sm.cumSocLotTons} t C totales en tu lote)<br>
       • Erosión RUSLE estimada: <strong>${sm.rusleTonsHaYr} t suelo/ha/año</strong> · Fijación N: <strong>${sm.annualNFixed} kg/ha/año</strong><br>
       • Margen Neto promedio: <strong>${sm.avgNetCashYr} USD/ha/año</strong> · Total lote: <strong>${sm.totalNetCashLot.toLocaleString('es-AR')} USD</strong>
       ${waterInfo}${aptInfo}`
    : `<strong>Simulated Physical Metrics (${st.cycleYears} yr / ${st.monthsCount} months):</strong><br>
       • Living cover (ISI): <strong>${sm.isiPct}%</strong> of cycle (Mean NDVI: ${sm.meanNdvi})<br>
       • Soil Carbon Balance: <strong>${sm.annualSocRate >= 0 ? '+' : ''}${sm.annualSocRate} Mg C/ha/yr</strong> (${sm.cumSocLotTons >= 0 ? '+' : ''}${sm.cumSocLotTons} t C across plot)<br>
       • RUSLE Erosion: <strong>${sm.rusleTonsHaYr} t soil/ha/yr</strong> · N Fixation: <strong>${sm.annualNFixed} kg/ha/yr</strong><br>
       • Avg Net Margin: <strong>${sm.avgNetCashYr} USD/ha/yr</strong> · Plot total: <strong>${sm.totalNetCashLot.toLocaleString('en-US')} USD</strong>
       ${waterInfo}${aptInfo}`;

  document.getElementById('modalEqFormula').textContent =
    `SAW-15 = ${st.saw15.toFixed(2)} pts   |   SAW-8 (Auditado) = ${st.saw8.toFixed(2)} pts\n` +
    `TOPSIS-15 = ${st.topsis15.toFixed(2)} pts   |   IC 90% Monte Carlo = [${st.ciLow} , ${st.ciHigh}] (σ = ±${st.stdDev})`;
  document.getElementById('modalInterpBox').innerHTML = isEs
    ? `<strong>Condiciones iniciales aplicadas:</strong> ${st.initialConditions.useGlobal ? 'Parámetros globales del lote' : `Personalizadas (Labranza: ${st.initialConditions.tillage}, AW: ${st.initialConditions.awMmM}mm, Humedad: ${st.initialConditions.initMoisturePct}%)`}`
    : `<strong>Initial conditions used:</strong> ${st.initialConditions.useGlobal ? 'Inherited global plot settings' : `Custom (${st.initialConditions.tillage}, AW ${st.initialConditions.awMmM}mm, Moist ${st.initialConditions.initMoisturePct}%)`}`;
  document.getElementById('modalEqSource').textContent = `Field Shift v5.0 · ${isEs ? 'Extremos térmicos:' : 'Thermal extremes:'} ${CLIENT_STATE.simulation.extremesSource || (isEs ? 'serie calibrada' : 'calibrated series')}.`;

  document.getElementById('equationModal').classList.add('open');
}

function openConceptDirectoryModal() {
  const isEs = CLIENT_STATE.lang === 'es';
  const body = document.getElementById('conceptDirectoryBody');

  const modelKeys = ['general', 'ndvi', 'et0', 'fao33_yield', 'aptitude', 'aw', 'smap', 'rusle', 'soc_gei', 'mcda'];
  const modelCards = modelKeys.map((k) => {
    const eq = APP_DATA.equations[k];
    return `
      <div class="dir-item-card" onclick="closeConceptDirectoryModal(); openInfoPopup('${k}');">
        <strong style="color:var(--forest-ink); font-size:13.5px;">📘 ${isEs ? eq.title_es : eq.title_en}</strong>
        <p class="muted-sub" style="margin-top:5px;">${isEs ? eq.plain_es : eq.plain_en}</p>
      </div>
    `;
  }).join('');

  const critCards = CLIENT_STATE.simulation.criteriaMeta.map((c) => `
    <div class="dir-item-card" onclick="closeConceptDirectoryModal(); openCriterionPopup('${c.id}', null, null);">
      <strong style="color:var(--forest-ink); font-size:13.5px;">🎯 ${isEs ? c.name : c.name_en} (${c.weightPct}%)</strong>
      <p class="muted-sub" style="margin-top:5px;">${isEs ? c.plain_es : c.plain_en}</p>
    </div>
  `).join('');

  body.innerHTML = modelCards + critCards;
  document.getElementById('conceptDirectoryModal').classList.add('open');
}

function closeConceptDirectoryModal() {
  document.getElementById('conceptDirectoryModal').classList.remove('open');
}

function openEquationModal(key) {
  openInfoPopup(key);
}

function closeEquationModal() {
  document.getElementById('equationModal').classList.remove('open');
}

/* ==========================================================================
   11. ESCENARIOS ESPECIALES Y SLIDERS PASO 4
   ========================================================================== */
async function applyPresetScenario(mode) {
  CLIENT_STATE.scenarioMode = mode;
  CLIENT_STATE.economicCrisis = false;

  document.querySelectorAll('.preset-btn').forEach((b) => {
    b.classList.remove('btn-forest');
    b.classList.add('btn-outline');
  });

  const sRain = document.getElementById('sliderRain');
  const sTemp = document.getElementById('sliderTemp');
  const label = document.getElementById('scenarioActiveLabel');

  if (mode === 'normal') {
    document.getElementById('btnPresetNormal').classList.replace('btn-outline', 'btn-forest');
    sRain.value = 0; sTemp.value = 0;
    label.textContent = t('sc_normal');
  } else if (mode === 'nina') {
    document.getElementById('btnPresetNina').classList.replace('btn-outline', 'btn-forest');
    sRain.value = -30; sTemp.value = 2.0;
    const e4 = CLIENT_STATE.configuredStrategies.find((s) => s.id.includes('Nina'));
    if (e4) CLIENT_STATE.selectedStrategyId = e4.id;
    label.textContent = t('sc_nina');
  } else if (mode === 'nino') {
    document.getElementById('btnPresetNino').classList.replace('btn-outline', 'btn-forest');
    sRain.value = 30; sTemp.value = 0;
    const e5 = CLIENT_STATE.configuredStrategies.find((s) => s.id.includes('Nino'));
    if (e5) CLIENT_STATE.selectedStrategyId = e5.id;
    label.textContent = t('sc_nino');
  } else if (mode === 'crisis') {
    document.getElementById('btnPresetCrisis').classList.replace('btn-outline', 'btn-forest');
    sRain.value = -10; sTemp.value = 1.0;
    CLIENT_STATE.economicCrisis = true;
    document.getElementById('sliderWEcon').value = 35;
    label.textContent = t('sc_crisis');
  }

  await onSliderChange();
}

async function onSliderChange() {
  const r = Number(document.getElementById('sliderRain').value);
  const tVal = Number(document.getElementById('sliderTemp').value);
  const ww = Number(document.getElementById('sliderWWater').value);
  const we = Number(document.getElementById('sliderWEcon').value);

  document.getElementById('rainValLabel').textContent = `${r > 0 ? '+' : ''}${r}%`;
  document.getElementById('tempValLabel').textContent = `+${tVal.toFixed(1)} °C`;
  document.getElementById('wWaterLabel').textContent = `${ww}%`;
  document.getElementById('wEconLabel').textContent = `${we}%`;

  await syncWithBackend();
  renderRankingSection();
}

/* ==========================================================================
   12. MINI-TUTORIAL ANIMADO CON PUNTERO GUIADO (PASOS 1, 2, 3 Y 4)
   ========================================================================== */
const STEP_TUTORIALS = {
  1: [
    {
      selector: '#prevCropInput',
      title_es: '1° Elegí qué tiene el lote hoy',
      title_en: '1st Choose initial crop / field state',
      desc_es: 'Empezá modificando esto: define el NDVI de partida, la humedad residual, rastrojo y nitrógeno del suelo.',
      desc_en: 'Start here: sets Day-0 Sentinel-2 NDVI, residual moisture, surface stubble cover, and starting N.'
    },
    {
      selector: '#cycleYearsInput',
      title_es: '2° Definí cuántos años analizar (1–6)',
      title_en: '2nd Select horizon length (1–6 years)',
      desc_es: 'Podés simular desde 1 campaña (12 meses) hasta un ciclo largo INTA de 6 años (72 meses).',
      desc_en: 'Simulate from a 1-year season (12 months) up to a full 6-year long-term cycle (72 months).'
    },
    {
      selector: '#map',
      title_es: '3° Delimitá tu lote y tocá los cuadros NDVI',
      title_en: '3rd Mark plot corners & inspect NDVI squares',
      desc_es: 'Haz clic en el mapa para dibujar tu lote o tocá cualquier cuadro de color para ver su valor NDVI exacto.',
      desc_en: 'Click map corners to adjust your parcel or tap any colored grid square to inspect exact NDVI.'
    },
    {
      selector: '#btnNextStep1',
      title_es: '4° Pasá al diseño de estrategias',
      title_en: '4th Advance to strategy design',
      desc_es: 'Cuando el polígono y el estado inicial estén listos, presioná aquí para pasar al Paso 2.',
      desc_en: 'Once your plot and starting state look right, click here to continue to Step 2.'
    }
  ],
  2: [
    {
      selector: '#inputAW',
      title_es: '1° Ajustá suelo si tenés datos locales',
      title_en: '1st Fine-tune soil data if measured',
      desc_es: 'Primero revisá agua útil, humedad inicial, carbono de laboratorio y tosca (opcional: si no tenés análisis, dejá los datos NASA/SoilGrids).',
      desc_en: 'Review available water, starting moisture, SOC, and hardpan depth—or keep live NASA/SoilGrids defaults.'
    },
    {
      selector: '#strategyBuilderSection',
      title_es: '2° Personalizá o creá tus estrategias',
      title_en: '2nd Customize or build strategies',
      desc_es: 'Creá una estrategia nueva (+ Crear Nueva) o editá cualquiera para elegir cultivos de Invierno/Verano año por año y sus condiciones iniciales.',
      desc_en: 'Create a custom strategy (+ Create New) or edit any card to set Winter/Summer crops year by year and initial conditions.'
    },
    {
      selector: '.sb-templates-bar',
      title_es: '3° Sumá plantillas con 1 clic',
      title_en: '3rd Add 1-click rotation templates',
      desc_es: 'Podés agregar secuencias regenerativas de 6 años, mixtas o contraste en labranza convencional al instante.',
      desc_en: 'Drop in 6-year regenerative, 3-year diversified, or conventional-tillage contrast strategies with one click.'
    },
    {
      selector: '#btnSubmitStrategiesAnalyze',
      title_es: '4° Mandá todo al motor de análisis',
      title_en: '4th Send all strategies to analyze',
      desc_es: 'Haz clic aquí para correr el balance FAO-56, rendimientos FAO-33, aptitud Q0.05–Q0.95 y ranking multicriterio.',
      desc_en: 'Click here to run the FAO-56 balance, FAO-33 yields, Q0.05–Q0.95 aptitude check, and MCDA ranking.'
    }
  ],
  3: [
    {
      selector: '#timelineStrategyPills',
      title_es: '1° Elige qué estrategia recorrer',
      title_en: '1st Pick a strategy to inspect',
      desc_es: 'Empieza cambiando entre estrategias para comparar su evolución hídrica y de carbono mes a mes.',
      desc_en: 'Switch between evaluated strategies here to compare monthly soil water and carbon paths.'
    },
    {
      selector: '#timelineChartCanvas',
      title_es: '2° Lee las 4 curvas y ambos ejes del gráfico',
      title_en: '2nd Read the 4 chart curves & dual axes',
      desc_es: 'Eje izquierdo: Agua Útil (mm), NDVI (×100) y Nitrógeno; línea roja punteada = Testigo Base. Eje derecho: Carbono Acumulado (t C). Tocá cualquier mes del gráfico para seleccionarlo.',
      desc_en: 'Left axis: Available Water (mm), NDVI (×100) & N; dashed red line = Baseline. Right axis: Plot Carbon (t C). Click any point to inspect that month.'
    },
    {
      selector: '#step3ChartGuideBox',
      title_es: '3° Revisa el significado y tendencia automática',
      title_en: '3rd Review curve meanings & automatic trends',
      desc_es: 'Estas 4 tarjetas traducen la pendiente del gráfico para la estrategia activa (recarga vs. estrés hídrico, cobertura protectora y secuestro o pérdida de carbono).',
      desc_en: 'These 4 cards translate chart slopes for the active strategy (recharge vs. water stress, soil shield, and carbon gain or loss).'
    },
    {
      selector: '#playTimelineBtn',
      title_es: '4° Configura un ciclo o elige un mes',
      title_en: '4th Auto-play cycle or click a month',
      desc_es: 'Utiliza "Recorrer ciclo" o haz clic sobre cualquier mes de la grilla (rojo = suelo desnudo, verde = cobertura viva).',
      desc_en: 'Click "Auto-play cycle" or pick any month tile below (red = bare soil, green = active cover).'
    },
    {
      selector: '#waterTankBanner',
      title_es: '5° Inspecciona agua útil, ETa y estrés Ks',
      title_en: '5th Check water reserve, ETa & Ks stress',
      desc_es: 'Muestra la reserva frente al testigo y el balance FAO-56 en 3 sub-pasos (ETa real vs ETc y drenaje).',
      desc_en: 'Displays tank reserve vs baseline plus 3-substep FAO-56 water balance (actual ETa vs ETc & drainage).'
    },
    {
      selector: '#fnKpiGrid',
      title_es: '6° Elige cualquier KPI para abrir su popup',
      title_en: '6th Click any KPI to explain the math',
      desc_es: 'Cada tarjeta tiene botón (?) con explicaciones y la ecuación utilizada. Luego prosigue al Paso 4.',
      desc_en: 'Every metric card opens an explanation + formula popup. Then proceed to Step 4.'
    }
  ],
  4: [
    {
      selector: '#btnPresetNina',
      title_es: '1° Prueba estrés climático o prioridades',
      title_en: '1st Test climate shock or priorities',
      desc_es: 'Seleccioná un escenario (La Niña, El Niño o Crisis) o ajustá los controles de lluvia, temperatura y prioridades para evaluar cómo responde cada rotación.',
      desc_en: 'Select a scenario (La Niña, El Niño, or Economic crisis) or adjust the rainfall, temperature, and priority controls to evaluate how each rotation responds.'
    },
    {
      selector: '#livePodiumGrid',
      title_es: '2° Revisá el Podio, Aptitud y Rinde FAO-33',
      title_en: '2nd Inspect Podium, Aptitude & FAO-33 Yield',
      desc_es: 'Cada tarjeta muestra si la estrategia es Apta/Dudosa/No Apta, su WUE y su rinde medio. Tocá una para abrir su radiografía.',
      desc_en: 'Each podium card displays Suitability filter badge, WUE, and FAO-33 mean yield. Click one for full breakdown.'
    },
    {
      selector: '#mcdaTable',
      title_es: '3° Auditá cualquier criterio (C1–C15) o nota',
      title_en: '3rd Audit any criterion (C1–C15) or score',
      desc_es: 'Haz clic en C1, C7, C9 (marcados FAO-33) o en cualquier chip numérico para entender la fórmula y cómo mejorarlo.',
      desc_en: 'Click C1, C7, C9 (tagged FAO-33) or any score chip to inspect its equation and improvement tips.'
    },
    {
      selector: '#cropCatalogGrid',
      title_es: '4° Consultá las fichas fisiológicas',
      title_en: '4th Review crop physiological profiles',
      desc_es: 'Verificá Kc, relación C:N y tolerancia térmica de las especies antes de validar con tu ingeniero agrónomo.',
      desc_en: 'Review Kc, C:N ratio, and heat/frost sensitivity before local agronomist sign-off.'
    }
  ]
};

function maybeAutoStartStepTutorial(stepNum) {
  if (!STEP_TUTORIALS[stepNum]) return;
  if (CLIENT_STATE.seenTutorials[stepNum]) return;
  setTimeout(() => {
    if (CLIENT_STATE.currentStep === stepNum && !CLIENT_STATE.seenTutorials[stepNum]) {
      startStepPointerTutorial(stepNum, false);
    }
  }, 420);
}

function startStepPointerTutorial(stepNum, force = true) {
  const targetStep = stepNum || CLIENT_STATE.currentStep || 1;
  if (!STEP_TUTORIALS[targetStep]) return;

  if (!force && CLIENT_STATE.seenTutorials[targetStep]) return;
  stopStepPointerTutorial(false);

  CLIENT_STATE.tutorialState = {
    active: true,
    paused: false,
    step: targetStep,
    idx: 0,
    timer: null
  };

  const overlay = document.getElementById('pointerTutorialOverlay');
  if (overlay) {
    overlay.style.display = 'block';
    overlay.classList.remove('is-paused');
  }

  updatePointerTutorialPauseUi();
  renderPointerTutorialSlide(true);
  schedulePointerTutorialNext();
}

function updatePointerTutorialPauseUi() {
  const ts = CLIENT_STATE.tutorialState;
  const overlay = document.getElementById('pointerTutorialOverlay');
  const pauseBtn = document.getElementById('ptPauseBtn');
  if (overlay) overlay.classList.toggle('is-paused', Boolean(ts.paused));
  if (pauseBtn) {
    pauseBtn.classList.toggle('is-paused', Boolean(ts.paused));
    pauseBtn.setAttribute('aria-pressed', ts.paused ? 'true' : 'false');
    pauseBtn.innerHTML = ts.paused
      ? `▶ <span>${t('pt_resume')}</span>`
      : `⏸ <span>${t('pt_pause')}</span>`;
  }
  const badge = document.getElementById('ptStepBadge');
  const slides = STEP_TUTORIALS[ts.step] || [];
  if (badge && ts.active && slides.length > 0) {
    const isEs = CLIENT_STATE.lang === 'es';
    const pausedTxt = ts.paused ? ` · ${t('pt_paused_badge')}` : '';
    badge.innerHTML = `<span class="trust-dot"></span> ${isEs ? 'Paso' : 'Step'} ${ts.step} · ${ts.idx + 1}/${slides.length}${pausedTxt}`;
  }
}

function togglePauseStepPointerTutorial() {
  const ts = CLIENT_STATE.tutorialState;
  if (!ts.active) return;
  ts.paused = !ts.paused;
  if (ts.paused) {
    if (ts.timer) {
      clearTimeout(ts.timer);
      ts.timer = null;
    }
  } else {
    schedulePointerTutorialNext();
  }
  updatePointerTutorialPauseUi();
}

function schedulePointerTutorialNext() {
  if (CLIENT_STATE.tutorialState.timer) {
    clearTimeout(CLIENT_STATE.tutorialState.timer);
    CLIENT_STATE.tutorialState.timer = null;
  }
  const ts = CLIENT_STATE.tutorialState;
  const slides = STEP_TUTORIALS[ts.step] || [];
  if (!ts.active || ts.paused || ts.idx >= slides.length - 1) return;

  ts.timer = setTimeout(() => {
    if (!CLIENT_STATE.tutorialState.active || CLIENT_STATE.tutorialState.paused) return;
    nextStepPointerTutorial();
  }, 4200);
}

function renderPointerTutorialSlide(allowScroll = true) {
  const ts = CLIENT_STATE.tutorialState;
  const slides = STEP_TUTORIALS[ts.step];
  if (!ts.active || !slides || !slides.length) return;

  const slide = slides[ts.idx];
  const isEs = CLIENT_STATE.lang === 'es';

  updatePointerTutorialPauseUi();
  document.getElementById('ptTitle').textContent = isEs ? slide.title_es : slide.title_en;
  document.getElementById('ptDesc').textContent = isEs ? slide.desc_es : slide.desc_en;

  const prevBtn = document.getElementById('ptPrevBtn');
  const nextBtn = document.getElementById('ptNextBtn');
  if (prevBtn) prevBtn.disabled = ts.idx === 0;
  if (nextBtn) {
    nextBtn.textContent = ts.idx === slides.length - 1 ? t('pt_finish') : t('pt_next');
  }

  document.getElementById('ptDots').innerHTML = slides.map((_, i) =>
    `<button type="button" class="pt-dot ${i === ts.idx ? 'active' : ''}" onclick="jumpToPointerTutorialSlide(${i})" aria-label="Slide ${i + 1}"></button>`
  ).join('');

  const targetEl = document.querySelector(slide.selector);
  if (targetEl && allowScroll) {
    const r = targetEl.getBoundingClientRect();
    if (r.top < 80 || r.bottom > window.innerHeight - 60) {
      targetEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      [120, 320, 580].forEach((ms) => {
        setTimeout(() => positionPointerTutorial(), ms);
      });
    }
  }
  positionPointerTutorial();
}

function positionPointerTutorial() {
  const ts = CLIENT_STATE.tutorialState;
  if (!ts.active) return;
  const slides = STEP_TUTORIALS[ts.step];
  const slide = slides && slides[ts.idx];
  if (!slide) return;

  const el = document.querySelector(slide.selector);
  const ring = document.getElementById('pointerTargetRing');
  const cursor = document.getElementById('pointerVirtualCursor');
  const card = document.getElementById('pointerTutorialCard');
  if (!el || !ring || !cursor || !card) return;

  const rect = el.getBoundingClientRect();
  const pad = 6;
  const top = Math.max(8, rect.top - pad);
  const left = Math.max(8, rect.left - pad);
  const width = Math.min(window.innerWidth - 16, rect.width + pad * 2);
  const height = Math.max(32, Math.min(window.innerHeight - 16, rect.height + pad * 2));

  ring.style.top = `${top}px`;
  ring.style.left = `${left}px`;
  ring.style.width = `${width}px`;
  ring.style.height = `${height}px`;

  // Posicionar puntero cerca del centro/borde derecho del elemento apuntado
  const cursorX = Math.max(16, Math.min(window.innerWidth - 46, rect.left + Math.min(rect.width * 0.72, 220)));
  const cursorY = Math.max(66, Math.min(window.innerHeight - 46, rect.top + Math.min(rect.height * 0.55, 110)));
  cursor.style.transform = `translate(${cursorX}px, ${cursorY}px)`;

  // Ubicar la tarjeta flotante evitando tapar el objetivo
  const cw = Math.min(340, window.innerWidth - 24);
  const ch = card.offsetHeight || 190;
  let cardLeft = rect.right + 18;
  let cardTop = Math.max(76, rect.top);

  if (cardLeft + cw > window.innerWidth - 12) {
    cardLeft = rect.left - cw - 18;
  }
  if (cardLeft < 12) {
    cardLeft = Math.max(12, Math.min(window.innerWidth - cw - 12, rect.left));
    cardTop = rect.bottom + 14;
    if (cardTop + ch > window.innerHeight - 12) {
      cardTop = Math.max(74, rect.top - ch - 14);
    }
  }
  cardTop = Math.max(72, Math.min(window.innerHeight - ch - 12, cardTop));

  card.style.left = `${cardLeft}px`;
  card.style.top = `${cardTop}px`;
}

function nextStepPointerTutorial() {
  const ts = CLIENT_STATE.tutorialState;
  const slides = STEP_TUTORIALS[ts.step] || [];
  if (ts.idx < slides.length - 1) {
    ts.idx += 1;
    renderPointerTutorialSlide(true);
    schedulePointerTutorialNext();
  } else {
    skipStepPointerTutorial();
  }
}

function prevStepPointerTutorial() {
  const ts = CLIENT_STATE.tutorialState;
  if (ts.idx > 0) {
    ts.idx -= 1;
    renderPointerTutorialSlide(true);
    schedulePointerTutorialNext();
  }
}

function jumpToPointerTutorialSlide(index) {
  const ts = CLIENT_STATE.tutorialState;
  const slides = STEP_TUTORIALS[ts.step] || [];
  if (index >= 0 && index < slides.length) {
    ts.idx = index;
    renderPointerTutorialSlide(true);
    schedulePointerTutorialNext();
  }
}

function skipStepPointerTutorial() {
  stopStepPointerTutorial(true);
}

function stopStepPointerTutorial(markSeen = true) {
  const ts = CLIENT_STATE.tutorialState;
  if (ts.timer) {
    clearTimeout(ts.timer);
    ts.timer = null;
  }
  if (markSeen && ts.step) {
    CLIENT_STATE.seenTutorials[ts.step] = true;
  }
  ts.active = false;
  ts.paused = false;
  const overlay = document.getElementById('pointerTutorialOverlay');
  if (overlay) {
    overlay.classList.remove('is-paused');
    overlay.style.display = 'none';
  }
}

window.addEventListener('resize', () => {
  if (CLIENT_STATE.tutorialState.active) positionPointerTutorial();
});
window.addEventListener('scroll', () => {
  if (CLIENT_STATE.tutorialState.active) positionPointerTutorial();
}, { passive: true });
window.addEventListener('keydown', (e) => {
  if (!CLIENT_STATE.tutorialState.active) return;
  if (e.key === 'Escape') {
    skipStepPointerTutorial();
  } else if (e.code === 'Space') {
    const tag = (e.target && e.target.tagName) || '';
    if (!['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON'].includes(tag)) {
      e.preventDefault();
      togglePauseStepPointerTutorial();
    }
  }
});

window.addEventListener('DOMContentLoaded', () => {
  initTheme();
  setupWheelProtection();
  populateInitialStatesSelect('prevCropInput');
  populateInitialStatesSelect('sePrevCropInput');
  initMap();
  applyStaticTranslations();
  renderSatObservationBanner();
  renderInitialStateSummaryCard();
  applyZoneSatelliteParamsToInputs(CLIENT_STATE.envContext);
  updateEnvCards(CLIENT_STATE.envContext);
  updateChartGuideToggleButton();
});
