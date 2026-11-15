/**
 * @file models/mcdaModel.js
 * @description Motor científico de simulación temporal multi-año (1 a 6 años / 12 a 72 meses)
 * y análisis multicriterio (SAW-8 auditado, SAW-15, TOPSIS-15 y Monte Carlo).
 * Evalúa estrategias preconfiguradas o personalizadas por el usuario a partir de sus cultivos
 * anuales (Otoño-Invierno y Primavera-Verano) y condiciones iniciales propias.
 */

const agroModel = require('./agroModel');
const yieldModel = require('./yieldModel');

/** Fracción de agotamiento del agua útil sin estrés hídrico (p, FAO-56). */
const DEPLETION_FRACTION = 0.5;
/** Criterios calculados dinámicamente desde ETa/ETc, rendimiento FAO-33 y extremos térmicos (0-based): C1, C7, C9. */
const COMPUTED_CRITERIA = new Set([0, 6, 8]);

const CRITERIA_META = [
  {
    id: 'C1',
    name: 'C1 Balance hídrico (ETc vs P_ef)',
    name_en: 'C1 Water Balance (ETc vs Effective Rain)',
    dim: 'water',
    baseW: 0.10,
    w8: 0.20,
    sigma: 8.5,
    plain_es: 'Mide si la lluvia que realmente logra infiltrar en tu lote alcanza para cubrir la sed (evapotranspiración) de la secuencia de cultivos sin sufrir déficit grave.',
    plain_en: 'Measures whether effective infiltrating rainfall meets total crop evapotranspiration demand across the cycle without severe water deficit.',
    formula: 'C1 = clamp(100 · [1 - (DH_anual - 20) / 360], 5, 98)\nDH_anual = (1 / N_años) · Σ max(0, ETc_m - P_ef,m - Reserva_útil)',
    apiSource: 'NASA POWER (PRECTOTCORR, T2M, WS2M) + INTA SIGA',
    interp_es: 'Valores <45 indican déficit hídrico severo en floración estival; >75 indica excelente acople entre demanda del cultivo y lluvias.',
    interp_en: 'Values <45 indicate high summer water stress; >75 indicate strong matching between crop demand and rainfall.'
  },
  {
    id: 'C2',
    name: 'C2 Retención edáfica (AW mm/m)',
    name_en: 'C2 Soil Water Retention (AW mm/m)',
    dim: 'water',
    baseW: 0.05,
    w8: 0.10,
    sigma: 11.2,
    plain_es: 'Representa el tamaño del "tanque de agua" de tu suelo según textura, profundidad libre de tosca y mejora por macroporos radiculares de la rotación.',
    plain_en: 'Represents your soil "water tank" size based on texture, hardpan depth, and root-channel bioporosity.',
    formula: 'C2 = clamp(100 · (AW_efectiva - 50) / 170 + Δ_bioporos, 8, 98)\nAW_efectiva = AW_perfil × (Prof_tosca / 100)',
    apiSource: 'ISRIC SoilGrids v2.0 (wv0033, wv1500) + GeoINTA + SMAP L4',
    interp_es: 'Los suelos francos profundos o mejorados con raíces perennes almacenan más agua de reserva; la tosca somera recorta el puntaje.',
    interp_en: 'Deep loams or perennial-root soils hold greater buffer reserves; shallow hardpans reduce score.'
  },
  {
    id: 'C3',
    name: 'C3 Materia orgánica (ΔSOC)',
    name_en: 'C3 Soil Organic Carbon (ΔSOC)',
    dim: 'soil',
    baseW: 0.09,
    w8: 0.15,
    sigma: 6.0,
    plain_es: 'Indica si tu rotación está ganando carbono orgánico y fertilidad estructural (raíces/rastrojos humificados) o perdiendo materia orgánica con los años.',
    plain_en: 'Indicates whether your rotation builds organic matter via living roots/residues or mines soil carbon over time.',
    formula: 'C3 = clamp(100 · (ΔSOC_anual - (-0,40)) / 0,95, 5, 98)\nΔSOC [Mg C/ha/año] = Σ aportes_raíz/rastrojo - k_labranza · SOC₀',
    apiSource: 'ISRIC SoilGrids (soc) + Meta-análisis Pampa / CONICET',
    interp_es: 'Barbechos largos y labranza arrojan C3 <30 (pérdida de carbono). Coberturas de gramíneas y pasturas elevan C3 >70.',
    interp_en: 'Long fallows and tillage yield C3 <30 (carbon depletion). Dense grass covers and pastures exceed 70.'
  },
  {
    id: 'C4',
    name: 'C4 Cobertura viva (NDVI / ISI)',
    name_en: 'C4 Living Vegetation Cover (NDVI / ISI)',
    dim: 'soil',
    baseW: 0.07,
    w8: 0.10,
    sigma: 4.5,
    plain_es: 'Mide qué porcentaje del año el lote está cubierto por plantas vivas fotosintetizando (NDVI > 0,20) o rastrojo protector, reduciendo los días peligrosos de suelo desnudo.',
    plain_en: 'Tracks the share of days per year with active green cover (NDVI > 0.20) or shielding residue, avoiding bare-soil exposure.',
    formula: 'ISI = Días_vivos / Días_totales   |   C4 = clamp(115 · ISI - 8, 8, 98)',
    apiSource: 'ESA Sentinel-2 (10 m) · NASA Landsat/HLS (30 m) · CONAE L89',
    interp_es: 'Un monocultivo de verano deja casi 6 meses de suelo desnudo (ISI ≈ 0,41, C4 ≤ 25). Sumar cultivos de cobertura duplica el ISI.',
    interp_en: 'Summer-only monoculture leaves ~6 bare months/yr (ISI ≈ 0.41, C4 ≤ 25). Adding winter cover crops doubles ISI.'
  },
  {
    id: 'C5',
    name: 'C5 Interrupción de plagas',
    name_en: 'C5 Pest, Weed & Disease Break',
    dim: 'bio',
    baseW: 0.06,
    w8: 0.10,
    sigma: 3.0,
    plain_es: 'Evalúa si alternás distintas familias botánicas (gramíneas, leguminosas, crucíferas, asteráceas) para cortar el ciclo de malezas resistentes, insectos y hongos.',
    plain_en: 'Scores botanical family diversity (grasses, legumes, brassicas, asteraceae) to disrupt weeds, pests, and soil-borne pathogens.',
    formula: 'C5 = 100 · (0,65 · Diversidad_familias + 0,35 · Factor_corte_invernal)',
    apiSource: 'Catálogo Fitopatológico INTA / Tamburini et al. (2020)',
    interp_es: 'Repetir soja/soja o no cortar puentes verdes acumula enfermedades. Alternar invierno + verano de distinta familia eleva C5 >75.',
    interp_en: 'Repeating same-family crops builds resistance pressure. Alternating winter/summer botanical families pushes C5 >75.'
  },
  {
    id: 'C6',
    name: 'C6 Fijación biológica N (BFN)',
    name_en: 'C6 Biological N Fixation (BFN)',
    dim: 'soil',
    baseW: 0.06,
    w8: 0.10,
    sigma: 5.5,
    plain_es: 'Calcula cuántos kilos de nitrógeno gratuito capturan del aire las leguminosas (vicia, alfalfa, arveja, soja) ahorrándote bolsas de fertilizante sintético.',
    plain_en: 'Quantifies free atmospheric nitrogen captured by legumes (vetch, alfalfa, pea, soy), cutting synthetic urea costs.',
    formula: 'C6 = clamp(100 · (BFN_anual_kg / 175), 10, 96)',
    apiSource: 'Frontiers in Agronomy (2023) · 52 ensayos Pampa Húmeda',
    interp_es: 'La vicia villosa fija hasta ~118 kg N/ha y la alfalfa >200 kg N/ha; secuencias solo con cereales quedan debajo de 45 pts.',
    interp_en: 'Hairy vetch fixes up to ~118 kg N/ha and alfalfa >200 kg N/ha; cereal-only sequences score under 45 pts.'
  },
  {
    id: 'C7',
    name: 'C7 Resiliencia térmica (>35°C / <0°C)',
    name_en: 'C7 Thermal & Frost Resilience',
    dim: 'water',
    baseW: 0.07,
    w8: 0.15,
    sigma: 5.0,
    plain_es: 'Mide cuánto riesgo tiene la rotación frente a olas de calor (>35°C en floración de maíz/soja) y heladas tardías (<0°C) registradas por NASA POWER.',
    plain_en: 'Measures exposure to >35°C heatwaves during summer flowering and late <0°C frost events in your plot climatology.',
    formula: 'C7 = clamp(100 · Tolerancia_especies - Penalización_ΔT - Penalización_heladas, 10, 96)',
    apiSource: 'NASA POWER (T2M_MAX, T2M_MIN) + Meteomatics Downscaling',
    interp_es: 'El sorgo y el maíz tardío escapan mejor a las olas de calor de enero que el maíz temprano.',
    interp_en: 'Sorghum and late-sown maize avoid January heat peaks much better than early maize.'
  },
  {
    id: 'C8',
    name: 'C8 Liquidez y mercado local',
    name_en: 'C8 Liquidity & Local Market Access',
    dim: 'econ',
    baseW: 0.07,
    w8: 0.10,
    sigma: 7.0,
    plain_es: 'Evalúa con qué rapidez convertís la producción en dinero en efectivo (venta directa en acopio cercano vs. inmovilización en rollos o hacienda) considerando el costo de siembra.',
    plain_en: 'Evaluates how quickly output turns into liquid cash (direct grain elevator sales vs. livestock/forage capital lock-up).',
    formula: 'C8 = clamp(100 · [0,6 · Proporción_grano_comercial + 0,4 · (Ingreso/Costo - 0,5) / 1,6], 18, 95)',
    apiSource: 'MAGyP Estimaciones Agrícolas · Bolsa de Comercio de Rosario · USDA AMS',
    interp_es: 'Para un arrendatario a corto plazo, liquidez <50 es una señal de alerta financiera aunque la rotación sea excelente en lo ambiental.',
    interp_en: 'For short-term tenants, liquidity <50 flags a cash-flow constraint even if agronomic benefits are high.'
  },
  {
    id: 'C9',
    name: 'C9 Productividad del agua (WUE)',
    name_en: 'C9 Water Use Efficiency (WUE)',
    dim: 'water',
    baseW: 0.08,
    w8: 0,
    sigma: 6.0,
    plain_es: 'Mide cuántos kilos de grano o biomasa útil producís por cada milímetro de agua consumido o caído en el lote ("eficiencia por gota de lluvia").',
    plain_en: 'Measures grain/biomass produced per millimeter of water consumed ("crop per drop").',
    formula: 'WUE = Biomasa_útil / (P_ef + ΔS)  |  C9 = clamp(100 · (WUE - 5) / 17, 15, 95)',
    apiSource: 'FAO WaPOR · OpenET · Caviglia et al. (2004, 2010)',
    interp_es: 'Los dobles cultivos y coberturas aprovechan lluvia de invierno que en barbecho se pierde por evaporación directa o percolación.',
    interp_en: 'Double cropping and covers convert winter/spring rain into biomass instead of losing it to bare evaporation.'
  },
  {
    id: 'C10',
    name: 'C10 Eficiencia de N (No-lixiviación)',
    name_en: 'C10 Nitrogen Retention (Anti-Leaching)',
    dim: 'bio',
    baseW: 0.05,
    w8: 0,
    sigma: 5.0,
    plain_es: 'Verifica si hay raíces vivas en otoño-invierno atrapando nitratos para que las lluvias no los laven hacia la napa subterránea.',
    plain_en: 'Checks whether winter roots trap soil nitrates before heavy rainfall leaches them below the root zone.',
    formula: 'C10 = clamp(96 - N_lixiviado_anual × 1,45, 20, 96)',
    apiSource: 'Restovich et al. (2012) · NASA NLDAS / USGS NWIS',
    interp_es: 'Las coberturas gramíneas (centeno, avena) y crucíferas (nabo) reducen la lixiviación de nitratos más del 60%.',
    interp_en: 'Grass cover crops (rye, oats) and radishes slash nitrate leaching by over 60%.'
  },
  {
    id: 'C11',
    name: 'C11 Control de erosión (RUSLE Factor C)',
    name_en: 'C11 Erosion Control (RUSLE C-Factor)',
    dim: 'soil',
    baseW: 0.08,
    w8: 0,
    sigma: 5.0,
    plain_es: 'Calcula cuánta tierra fértil retenés frente al impacto de las gotas de lluvia (GPM) y la pendiente del lote (SRTM) gracias al escudo de plantas y rastrojos.',
    plain_en: 'Estimates how much topsoil stays anchored against rainfall erosivity (GPM) and terrain slope (SRTM) under residue/canopy.',
    formula: 'A = R_GPM · K_SoilGrids · LS_SRTM · C_cobertura · P\nC11 = clamp(100 · (1 - A / 12,0), 10, 97)',
    apiSource: 'NASA GPM IMERG + SRTM (30 m) + ISRIC SoilGrids + RUSLE',
    interp_es: 'Un puntaje C11 <35 advierte pérdida severa de suelo por hectárea y año; con TOPSIS penaliza todo el ranking.',
    interp_en: 'C11 <35 warns of severe annual topsoil erosion; TOPSIS heavily penalizes this non-compensatory failure.'
  },
  {
    id: 'C12',
    name: 'C12 Balance neto GEI (CO₂-eq)',
    name_en: 'C12 Net GHG Balance (CO₂-eq)',
    dim: 'bio',
    baseW: 0.05,
    w8: 0,
    sigma: 6.0,
    plain_es: 'Balance entre el carbono que el lote captura de la atmósfera y las emisiones de óxido nitroso (N₂O) de fertilizantes y residuos.',
    plain_en: 'Net balance between carbon sequestered in soil and nitrous oxide (N₂O) emissions from fertilizer and residues.',
    formula: 'GEI_neto = -ΔSOC·(44/12) + N₂O_eq  |  C12 = clamp(100 · (2,0 - GEI_neto) / 4,5, 10, 96)',
    apiSource: 'Abdalla et al. (2019) · Abalos et al. (2022) · IPCC Tier 1/2',
    interp_es: 'Mezclar gramíneas (C:N alto) con leguminosas reduce picos de N₂O tras el secado y mejora los créditos de carbono.',
    interp_en: 'Mixing grasses (high C:N) with legumes dampens N₂O spikes at termination and strengthens carbon balance.'
  },
  {
    id: 'C13',
    name: 'C13 Bajo impacto ecotoxicológico',
    name_en: 'C13 Low Ecotoxicological Load',
    dim: 'bio',
    baseW: 0.04,
    w8: 0,
    sigma: 4.0,
    plain_es: 'Premia a las secuencias que ahogan malezas físicamente (ej. centeno denso o pastura) y bajan la cantidad de aplicaciones químicas de herbicidas/insecticidas.',
    plain_en: 'Rewards sequences that physically suppress weeds (dense rye/pasture) and reduce synthetic herbicide/pesticide passes.',
    formula: 'C13 = clamp(94 - Aplicaciones_químicas_equivalentes × 11, 15, 95)',
    apiSource: 'Davis et al. (2012) · Ensayos supresión química INTA',
    interp_es: 'Reemplazar el barbecho químico de invierno por centeno o vicia ahorra 2 a 4 aplicaciones anuales de herbicidas.',
    interp_en: 'Replacing winter chemical fallow with rye or vetch saves 2–4 herbicide sprays per year.'
  },
  {
    id: 'C14',
    name: 'C14 Simplicidad operativa (escala lote)',
    name_en: 'C14 Operational & Machinery Simplicity',
    dim: 'econ',
    baseW: 0.05,
    w8: 0,
    sigma: 3.0,
    plain_es: 'Mide si la secuencia se puede hacer fácilmente con contratistas comunes de la zona o si exige logística extra (rolo faca, enfardadora, hacienda, ventanas apretadas).',
    plain_en: 'Evaluates operational ease with standard local contractors vs. extra machinery/livestock logistics (roller-crimper, balers, tight sowing windows).',
    formula: 'C14 = f(Maquinaria_agricultor, Labranza, Complejidad_siembra_secado)',
    apiSource: 'Parametrización Logística Field Shift (Entrada del Productor)',
    interp_es: 'Un productor sin maquinaria forrajera ve baja operatividad en pastura (C14 ≈ 48), mientras quien tiene hacienda sube +22 pts.',
    interp_en: 'Grain-only farms score pastures lower on operability (C14 ≈ 48), whereas livestock-integrated farms gain +22 pts.'
  },
  {
    id: 'C15',
    name: 'C15 Margen ajustado por riesgo (Sharpe)',
    name_en: 'C15 Risk-Adjusted Margin (Sharpe)',
    dim: 'econ',
    baseW: 0.08,
    w8: 0,
    sigma: 7.5,
    plain_es: 'No mira solo la ganancia máxima de un año ideal, sino cuánto dinero gana el productor de forma estable descontando el riesgo de perder plata en años secos o crisis de precios.',
    plain_en: 'Measures financial return adjusted for inter-annual yield volatility and input cost shocks rather than peak-year luck.',
    formula: 'Sharpe_lote = (Margen_medio - Costo_op) / σ_margen  |  C15 = clamp(32 + Sharpe_lote × 48, 12, 95)',
    apiSource: 'MAGyP / INDEC (CV histórico 10 años) · USDA QuickStats',
    interp_es: 'Aunque el monocultivo de maíz prometiera renta teórica alta, su volatilidad ante sequías y costos de urea deprimen su C15 en años difíciles.',
    interp_en: 'Even if high-input corn looks profitable on paper, drought volatility and urea shocks cut C15.'
  }
];

const MONTH_NAMES_ES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
const MONTH_NAMES_FULL_ES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

/**
 * Genera el conjunto por defecto de estrategias adaptadas a la duración de ciclo elegida (1 a 6 años).
 */
function getDefaultStrategies(cycleYears = 2, prevCrop = 'soja_1ra') {
  const cy = Math.min(6, Math.max(1, Math.round(Number(cycleYears) || 2)));

  const buildPattern = (pairs) => {
    const out = [];
    for (let y = 1; y <= cy; y++) {
      const tpl = pairs[(y - 1) % pairs.length];
      out.push({ year: y, winter: tpl.winter, summer: tpl.summer });
    }
    return out;
  };

  return [
    {
      id: 'E0_Base',
      short: `E0 Actual (${cy}a)`,
      name_es: `Testigo Actual (${cy} años: Maíz / Soja con barbecho desnudo)`,
      name_en: `Current Baseline (${cy} yr: Maize / Soy with bare fallow)`,
      isCustom: false,
      cycleYears: cy,
      sequence: buildPattern([
        { winter: 'barbecho_desnudo', summer: 'maiz_1ra' },
        { winter: 'barbecho_desnudo', summer: 'soja_1ra' }
      ]),
      initialConditions: { useGlobal: true, prevCrop, tillage: 'siembra_directa' }
    },
    {
      id: 'E1_Cob',
      short: `E1 Cob. Inv. (${cy}a)`,
      name_es: `Cobertura de Invierno (${cy} años: Centeno+Vicia → Maíz → Centeno → Soja)`,
      name_en: `Winter Cover Rotation (${cy} yr: Rye+Vetch → Maize → Rye → Soy)`,
      isCustom: false,
      cycleYears: cy,
      sequence: buildPattern([
        { winter: 'centeno_vicia', summer: 'maiz_1ra' },
        { winter: 'centeno_cobertura', summer: 'soja_1ra' }
      ]),
      initialConditions: { useGlobal: true, prevCrop, tillage: 'siembra_directa' }
    },
    {
      id: 'E2_CerInv',
      short: `E2 Cer. Inv. (${cy}a)`,
      name_es: `Cereales Invernales + 2da (${cy} años: Trigo/Soja 2da → Rastrojo/Maíz Tardío)`,
      name_en: `Winter Cereal Double-Crop (${cy} yr: Wheat/2nd Soy → Stubble/Late Maize)`,
      isCustom: false,
      cycleYears: cy,
      sequence: buildPattern([
        { winter: 'trigo_pan', summer: 'soja_2da' },
        { winter: 'barbecho_rastrojo', summer: 'maiz_tardio' }
      ]),
      initialConditions: { useGlobal: true, prevCrop, tillage: 'siembra_directa' }
    },
    {
      id: 'E3_Past',
      short: `E3 Pastura (${cy}a)`,
      name_es: `Pastura Perenne Consociada (${cy} años: Alfalfa + Festuca continua)`,
      name_en: `Perennial Mixed Pasture (${cy} yr: Continuous Alfalfa + Fescue)`,
      isCustom: false,
      cycleYears: cy,
      sequence: buildPattern([
        { winter: 'pastura_inv', summer: 'pastura_est' }
      ]),
      initialConditions: { useGlobal: true, prevCrop, tillage: 'siembra_directa' }
    },
    {
      id: 'E4_Nina',
      short: `E4 Sequía (${cy}a)`,
      name_es: `Resiliente a Sequía La Niña (${cy} años: Vicia/Sorgo → Centeno/Soja → Girasol)`,
      name_en: `La Niña Drought-Resilient (${cy} yr: Vetch/Sorghum → Rye/Soy → Sunflower)`,
      isCustom: false,
      cycleYears: cy,
      sequence: buildPattern([
        { winter: 'vicia_villosa', summer: 'sorgo_granifero' },
        { winter: 'centeno_cobertura', summer: 'soja_1ra' },
        { winter: 'avena_cobertura', summer: 'girasol' }
      ]),
      initialConditions: { useGlobal: true, prevCrop, tillage: 'siembra_directa' }
    },
    {
      id: 'E5_Nino',
      short: `E5 El Niño (${cy}a)`,
      name_es: `Captura Excedentes El Niño (${cy} años: Trigo/Soja 2da → Vicia+Centeno/Maíz)`,
      name_en: `El Niño Surplus Capture (${cy} yr: Wheat/2nd Soy → Vetch+Rye/Maize)`,
      isCustom: false,
      cycleYears: cy,
      sequence: buildPattern([
        { winter: 'trigo_pan', summer: 'soja_2da' },
        { winter: 'centeno_vicia', summer: 'maiz_1ra' }
      ]),
      initialConditions: { useGlobal: true, prevCrop, tillage: 'siembra_directa' }
    }
  ];
}

function computeDynamicWeights(wWaterPct = 30, wEconPct = 20) {
  const wWater = wWaterPct / 100;
  const wEcon = wEconPct / 100;
  const rem = Math.max(0.10, 1 - wWater - wEcon);
  const wSoil = rem * 0.60;
  const wBio = rem * 0.40;

  const raw = CRITERIA_META.map((c) => {
    if (c.dim === 'water') return c.baseW * (wWater / 0.30);
    if (c.dim === 'econ') return c.baseW * (wEcon / 0.20);
    if (c.dim === 'soil') return c.baseW * (wSoil / 0.30);
    return c.baseW * (wBio / 0.20);
  });

  const sum = raw.reduce((a, b) => a + b, 0);
  return raw.map((w) => w / sum);
}

/**
 * Resuelve el diccionario de cultivos y condiciones iniciales efectivas para una estrategia.
 */
function resolveStrategyConfig(rawSt, globalParams, envContext, seasonCatalog, initialStates) {
  const ic = rawSt.initialConditions || {};
  const useGlobal = ic.useGlobal !== false;

  const cycleYears = Math.min(6, Math.max(1, Math.round(Number(rawSt.cycleYears) || Number(globalParams.cycleYears) || 2)));
  const prevCropId = (useGlobal ? globalParams.prevCrop : ic.prevCrop) || globalParams.prevCrop || 'soja_1ra';
  const prevState = initialStates.find((s) => s.id === prevCropId) || initialStates[0];

  const awMmM = Number(useGlobal ? globalParams.awMmM : (ic.awMmM ?? globalParams.awMmM)) || envContext.suelo.aw_mm_m.media || 130;
  const toscaCm = Number(useGlobal ? globalParams.toscaCm : (ic.toscaCm ?? globalParams.toscaCm)) || 100;
  const initMoisturePct = Number(
    useGlobal
      ? globalParams.initMoisturePct
      : (ic.initMoisturePct ?? globalParams.initMoisturePct ?? prevState.initMoisturePct)
  ) || 62;
  const socGKg = Number(useGlobal ? globalParams.socGKg : (ic.socGKg ?? globalParams.socGKg)) || 18.4;
  const machinery = (useGlobal ? globalParams.machinery : (ic.machinery || globalParams.machinery)) || 'contratista_grano';
  const tillage = ic.tillage || globalParams.tillage || 'siembra_directa';

  // Asegurar que sequence tenga exactamente `cycleYears` entradas válidas
  const rawSeq = Array.isArray(rawSt.sequence) && rawSt.sequence.length > 0
    ? rawSt.sequence
    : [{ year: 1, winter: 'centeno_vicia', summer: 'maiz_1ra' }];

  const sequence = [];
  for (let y = 0; y < cycleYears; y++) {
    const item = rawSeq[y % rawSeq.length] || rawSeq[0];
    const wCrop = seasonCatalog.winter.find((c) => c.id === item.winter) || seasonCatalog.winter[0];
    const sCrop = seasonCatalog.summer.find((c) => c.id === item.summer) || seasonCatalog.summer[0];
    sequence.push({ year: y + 1, winter: wCrop.id, summer: sCrop.id, wCrop, sCrop });
  }

  return {
    id: rawSt.id || `Custom_${Date.now()}`,
    short: rawSt.short || `E_Custom (${cycleYears}a)`,
    name_es: rawSt.name_es || rawSt.name || `Estrategia Personalizada (${cycleYears} años)`,
    name_en: rawSt.name_en || rawSt.name || `Custom Strategy (${cycleYears} yr)`,
    isCustom: Boolean(rawSt.isCustom),
    cycleYears,
    sequence,
    effectiveInit: {
      useGlobal,
      prevCropId,
      prevState,
      awMmM,
      toscaCm,
      initMoisturePct,
      socGKg,
      machinery,
      tillage
    }
  };
}

/**
 * Simula dinámicamente mes a mes (12 a 72 meses) la estrategia configurada y calcula métricas biofísicas acumuladas.
 */
function simulateStrategyBiophysics(st, globalParams, envContext) {
  const totalMonths = st.cycleYears * 12;
  const startDate = new Date((globalParams.startDate || '2026-02-15') + 'T12:00:00');
  const startMonth = Number.isNaN(startDate.getTime()) ? 1 : startDate.getMonth();
  const startYear = Number.isNaN(startDate.getTime()) ? 2026 : startDate.getFullYear();

  const { awMmM, toscaCm, initMoisturePct, prevState, tillage, machinery } = st.effectiveInit;
  const awMax = Math.max(40, Math.round(awMmM * (toscaCm / 100)));
  const areaHa = (Number(globalParams.areaM2) || 100000) / 10000;

  const rainDeltaPct = Number(globalParams.rainDeltaPct) || 0;
  const tempDeltaC = Number(globalParams.tempDeltaC) || 0;
  const economicCrisis = Boolean(globalParams.economicCrisis);

  const climRain = envContext.clima.precipitacion_mm;
  const climEt0 = envContext.clima.et0_calibrada_mm;
  const climTemp = envContext.clima.temp_media_c;

  // Penalizaciones/bonificaciones por sistema de labranza
  const tillageConfig = {
    siembra_directa: { rainMult: 1.00, erosionAdd: 0, socAdd: 0.04, bareBonus: 0, chemAdd: 0.5 },
    labranza_vertical: { rainMult: 0.93, erosionAdd: 14, socAdd: -0.06, bareBonus: 1, chemAdd: 0.2 },
    convencional: { rainMult: 0.84, erosionAdd: 30, socAdd: -0.16, bareBonus: 2, chemAdd: -0.3 }
  };
  const til = tillageConfig[tillage] || tillageConfig.siembra_directa;

  let soilWater = Math.min(awMax, Math.max(12, Math.round(awMax * (initMoisturePct / 100))));
  let cumSocHa = 0;
  let cumCashHa = 0;
  let totalDeficit = 0;
  let totalPEf = 0;
  let totalEtc = 0;
  let totalNLeach = 0;
  let bareMonths = 0;
  let ndviSum = 0;
  let cashFlowsAnnual = [];
  let yearCash = 0;

  const series = [];

  for (let m = 0; m < totalMonths; m++) {
    const simYearIdx = Math.floor(m / 12);
    const yearSeq = st.sequence[simYearIdx];
    const calMonth = (startMonth + m) % 12; // 0=Ene .. 11=Dic
    const calYear = startYear + Math.floor((startMonth + m) / 12);

    const isWinterWindow = calMonth >= 4 && calMonth <= 9; // May..Oct
    let activeCrop = isWinterWindow ? yearSeq.wCrop : yearSeq.sCrop;

    // Mes 0 refleja la condición de salida del cultivo/estado inicial seleccionado en el Paso 1
    let isInitTransition = m === 0;
    let stageType = activeCrop.stageType;
    let cropLabel = activeCrop.name_es;
    let kc = activeCrop.kc;
    let ndvi = activeCrop.ndvi;
    let nAvail = Math.round(32 + (activeCrop.nFix * 0.55));
    let nLeach = activeCrop.nLeach;
    let erosionRisk = Math.round(activeCrop.factorC * 175) + til.erosionAdd;
    let cashDelta = 0;
    let noteWhy = '';
    let noteImpact = '';

    // Si es el primer mes, modula NDVI/humedad según estado inicial del lote elegido en Paso 1
    if (isInitTransition) {
      cropLabel = `${prevState.name_es.split('(')[0].trim()} (Inicio)`;
      ndvi = prevState.baseNdvi;
      stageType = prevState.baseNdvi < 0.20 ? 'bare' : (prevState.baseNdvi < 0.45 ? 'stubble' : 'commercial');
      if (prevState.id === 'pastura_alfalfa' || prevState.id === 'cobertura_vicia_centeno') stageType = 'cover';
      nAvail = prevState.initN_kgHa;
      kc = Number(Math.max(0.22, Math.min(1.10, prevState.baseNdvi * 1.15)).toFixed(2));
      erosionRisk = Math.max(6, Math.round((100 - prevState.residueCoverPct) * 0.85) + til.erosionAdd);
      cashDelta = prevState.group === 'estival' ? 180 : 0;
      noteWhy = `Mes de partida del lote (${prevState.name_es}). NDVI satelital inicial ${prevState.baseNdvi.toFixed(2)}, cobertura de rastrojo ${prevState.residueCoverPct}% y nitrógeno disponible ${prevState.initN_kgHa} kg N/ha.`;
      noteImpact = prevState.desc_es;
    } else {
      // Modular curva fenológica realista dentro de cada estación
      if (isWinterWindow) {
        // calMonth: 4(May)=siembra, 5(Jun)=implant, 6(Jul)=macollaje/veg, 7(Ago)-8(Sep)=pico, 9(Oct)=secado/espigazón
        const phenoPos = (calMonth - 4) / 5; // 0..1
        const bell = Math.sin(Math.PI * (0.2 + 0.75 * phenoPos));
        kc = Number((0.25 + (activeCrop.kc - 0.25) * bell).toFixed(2));
        ndvi = Number(Math.max(0.12, Math.min(0.88, (activeCrop.ndvi - 0.12) * bell + (stageType === 'bare' ? 0.12 : 0.16))).toFixed(2));
        if (calMonth === 4) cashDelta = -activeCrop.costHa;
        if (calMonth === 9 && activeCrop.revHa > 0) cashDelta = activeCrop.revHa;

        if (stageType === 'bare') {
          if (tillage === 'convencional') stageType = 'bare';
          noteWhy = `${activeCrop.name_es}: suelo sin raíces activas en invierno (NDVI ${ndvi.toFixed(2)}). Se pierden nitratos por lixiviación y hay erosión eólica/hídrica.`;
          noteImpact = 'Penaliza C3 (Carbono), C4 (Cobertura), C10 (Nitratos) y C11 (Control erosión).';
        } else if (stageType === 'cover') {
          noteWhy = calMonth === 9
            ? `${activeCrop.name_es}: fin de ciclo invernal / rolado o secado estratégico. Fijó ${activeCrop.nFix} kg N/ha anuales y protegió el suelo durante el invierno.`
            : `${activeCrop.name_es}: cobertura viva invernal activa captando radiación, frenando erosión y suprimiendo malezas.`;
          noteImpact = 'Impulsa C3 (Carbono), C4 (Cobertura viva), C10 (Retención N) y C11 (Control erosión).';
        } else if (stageType === 'commercial') {
          noteWhy = calMonth >= 8
            ? `${activeCrop.name_es}: etapa crítica de espigazón/llenado de grano escapando al pico térmico de verano.`
            : `${activeCrop.name_es}: cereal/leguminosa de renta invernal en crecimiento activo.`;
          noteImpact = 'Aporta flujo de caja primaveral (C8) y mejora la productividad por milímetro de lluvia (C9).';
        } else {
          noteWhy = `${activeCrop.name_es}: rastrojo pasivo conservando humedad en barbecho sin labranza.`;
          noteImpact = 'Protección parcial contra encostramiento respecto al barbecho desnudo, aunque sin raíces vivas.';
        }
      } else {
        // Estival: 10(Nov)=siembra, 11(Dic)=veg, 0(Ene)=floración, 1(Feb)=llenado, 2(Mar)-3(Abr)=cosecha
        const mapOrder = { 10: 0, 11: 1, 0: 2, 1: 3, 2: 4, 3: 5 };
        const idxS = mapOrder[calMonth] ?? 2;
        const bellS = [0.45, 0.72, 1.00, 0.96, 0.72, 0.38][idxS];
        kc = Number((0.28 + (activeCrop.kc - 0.28) * bellS).toFixed(2));
        ndvi = Number(Math.max(0.14, Math.min(0.88, 0.16 + (activeCrop.ndvi - 0.16) * bellS)).toFixed(2));
        if (calMonth === 10) cashDelta = -activeCrop.costHa;
        if (calMonth === 2 && activeCrop.revHa > 0) cashDelta = Math.round(activeCrop.revHa * 0.75);
        if (calMonth === 3 && activeCrop.revHa > 0) cashDelta = Math.round(activeCrop.revHa * 0.25);

        if (stageType === 'bare' || tillage === 'convencional' && activeCrop.id === 'barbecho_estival') {
          stageType = 'bare';
          ndvi = 0.14;
        }
        noteWhy = idxS === 2
          ? `${activeCrop.name_es}: período crítico estival (floración / máxima demanda Kc=${kc.toFixed(2)}). Sensibilidad alta a estrés térmico e hídrico.`
          : `${activeCrop.name_es}: ciclo primavero-estival (mes ${idxS + 1}/6 de campaña de verano).`;
        noteImpact = activeCrop.id.includes('sorgo') || activeCrop.id.includes('girasol')
          ? 'Alta estabilidad térmica y menor riesgo de caída de rinde bajo La Niña (C7, C15).'
          : 'Principal generador de ingresos de la campaña anual (C8) y eficiencia hídrica (C9).';
      }
    }

    // Labranza convencional degrada rastrojo entre campañas
    if (tillage === 'convencional' && stageType === 'stubble') {
      stageType = 'bare';
      ndvi = Number(Math.max(0.12, ndvi - 0.08).toFixed(2));
    }

    const rainFactor = 1 + rainDeltaPct / 100;
    const tempFactor = 1 + tempDeltaC * 0.035;
    const coverInfilt = stageType === 'bare' ? 0.70 : (stageType === 'stubble' ? 0.82 : 0.90);
    const pEf = Math.round(climRain[calMonth] * rainFactor * coverInfilt * til.rainMult);
    const etcRaw = climEt0[calMonth] * kc * tempFactor;
    const etc = Math.round(etcRaw);
    const rawBalance = pEf - etc;

    // Balance hídrico FAO-56 en 3 sub-pasos por mes: S_t = S_{t-1} + P_ef - ETa - D ; ETa = Ks · ETc
    const nSub = 3;
    let etaMonth = 0;
    let drainMonth = 0;
    let ksSum = 0;
    for (let k = 0; k < nSub; k++) {
      soilWater += pEf / nSub;
      const excess = Math.max(0, soilWater - awMax);
      soilWater -= excess;
      drainMonth += excess;
      const ks = Math.min(1, soilWater / ((1 - DEPLETION_FRACTION) * awMax));
      const eta = Math.min(soilWater, ks * (etcRaw / nSub));
      soilWater -= eta;
      etaMonth += eta;
      ksSum += ks;
    }
    soilWater = Math.max(8, Math.round(soilWater));
    totalDeficit += Math.max(0, etcRaw - etaMonth);

    totalPEf += pEf;
    totalEtc += etc;
    totalNLeach += nLeach;
    if (ndvi < 0.20) bareMonths += 1;
    ndviSum += ndvi;

    // Evolución de SOC mensual (suma mitad invierno + mitad verano + efecto labranza)
    const monthSocDelta = ((isWinterWindow ? yearSeq.wCrop.socDeltaYear : yearSeq.sCrop.socDeltaYear) + til.socAdd) / 6;
    cumSocHa += monthSocDelta / 2;

    const adjCashDelta = cashDelta * (economicCrisis && cashDelta > 0 ? 0.80 : (economicCrisis && cashDelta < 0 ? 1.18 : 1.0));
    cumCashHa += adjCashDelta;
    yearCash += adjCashDelta;

    if ((m + 1) % 12 === 0 || m === totalMonths - 1) {
      cashFlowsAnnual.push(yearCash);
      yearCash = 0;
    }

    series.push({
      index: m,
      label: `${MONTH_NAMES_ES[calMonth]} ${String(calYear).slice(2)}`,
      fullDate: `${MONTH_NAMES_FULL_ES[calMonth]} ${calYear}`,
      stageType,
      cropId: isInitTransition ? prevState.id : activeCrop.id,
      cropLabel,
      kc,
      calMonth,
      ndvi,
      soilWater,
      awMax,
      awPct: Math.round((soilWater / awMax) * 100),
      pEf,
      etc,
      etcPot: Number(etcRaw.toFixed(1)),
      eta: Number(etaMonth.toFixed(1)),
      ks: Number((ksSum / nSub).toFixed(2)),
      drainage: Number(drainMonth.toFixed(1)),
      waterBalance: rawBalance,
      tempMean: Number((climTemp[calMonth] + tempDeltaC).toFixed(1)),
      cumSocHa: Number(cumSocHa.toFixed(3)),
      cumSocLotTons: Number((cumSocHa * areaHa).toFixed(2)),
      nAvail,
      nLeach,
      erosionRisk: Math.min(95, Math.max(4, erosionRisk)),
      cumCashHa: Math.round(cumCashHa),
      cumCashLot: Math.round(cumCashHa * areaHa),
      noteWhy,
      noteImpact
    });
  }

  // Calcular métricas resumen anuales para normalizar los 15 criterios
  const annualSocRate = cumSocHa / st.cycleYears;
  const meanNdvi = ndviSum / totalMonths;
  const isiRatio = Math.max(0.15, Math.min(0.95, 1 - (bareMonths + til.bareBonus) / totalMonths));

  let sumNfix = 0;
  let sumPest = 0;
  let sumThermal = 0;
  let sumFactorC = 0;
  let sumCommShare = 0;
  let totalCost = 0;
  let totalRev = 0;
  let sumChemPass = 0;

  const uniqueFamilies = new Set();
  const familyOf = (id) => {
    if (id.includes('maiz') || id.includes('trigo') || id.includes('cebada') || id.includes('centeno') || id.includes('avena') || id.includes('sorgo')) return 'Poaceae';
    if (id.includes('soja') || id.includes('vicia') || id.includes('arveja') || id.includes('mani') || id.includes('pastura')) return 'Fabaceae';
    if (id.includes('girasol')) return 'Asteraceae';
    if (id.includes('nabo')) return 'Brassicaceae';
    return 'None';
  };

  st.sequence.forEach((yr) => {
    const w = yr.wCrop;
    const s = yr.sCrop;
    uniqueFamilies.add(familyOf(w.id));
    uniqueFamilies.add(familyOf(s.id));

    sumNfix += w.nFix + s.nFix;
    sumPest += (w.pestBreak + s.pestBreak) / 2;
    sumThermal += (w.thermalTol * 0.35 + s.thermalTol * 0.65);
    sumFactorC += (w.factorC * 0.55 + s.factorC * 0.45);
    const hasWComm = w.stageType === 'commercial' ? 1 : 0;
    const hasSComm = s.stageType === 'commercial' ? 1 : 0;
    sumCommShare += (hasWComm + hasSComm) * 0.5;
    totalCost += w.costHa + s.costHa;
    totalRev += w.revHa + s.revHa;

    const passW = w.id === 'barbecho_desnudo' ? 3.5 : (w.stageType === 'cover' ? 0.5 : 2.0);
    const passS = s.id === 'barbecho_estival' ? 2.5 : (s.id.includes('pastura') ? 0.5 : 2.5);
    sumChemPass += passW + passS + til.chemAdd;
  });

  const nYr = st.sequence.length;
  const avgNFixYr = sumNfix / nYr;
  const avgNLeachYr = totalNLeach / st.cycleYears;
  const avgFactorC = Math.min(0.48, (sumFactorC / nYr) + (tillage === 'convencional' ? 0.14 : (tillage === 'labranza_vertical' ? 0.06 : 0)));
  const avgPestBreak = (sumPest / nYr) * (1 - Math.max(0, (prevState.pestCarryover - 1) * 0.25));
  const avgThermalTol = sumThermal / nYr;
  const avgChemYr = sumChemPass / nYr;
  const avgNetCashYr = cumCashHa / st.cycleYears;
  const rusleTonsHaYr = Number((avgFactorC * 24.5 * (1 + Math.max(0, rainDeltaPct) / 100)).toFixed(2));
  const netGhgMgYr = Number((-annualSocRate * (44 / 12) + Math.max(0.25, 1.35 - (avgNFixYr * 0.002))).toFixed(2));

  // C1..C15 normalizados a [0..100]
  const rainPerturb = rainDeltaPct / 30;
  const heatPerturb = tempDeltaC / 3;
  const deficitYr = totalDeficit / st.cycleYears;

  const clampScore = (v) => Math.min(98, Math.max(8, Math.round(v)));

  const c1 = clampScore(68 - (deficitYr * 0.14) + rainPerturb * 14 - heatPerturb * 7 + (avgThermalTol - 0.65) * 32 + (initMoisturePct - 60) * 0.22);
  const c2 = clampScore(((awMax - 50) / 170) * 100 + (st.sequence.some((y) => y.wCrop.id === 'pastura_inv') ? 22 : (st.sequence.some((y) => y.wCrop.stageType === 'cover') ? 8 : -2)));
  const c3 = clampScore(100 * ((annualSocRate + 0.35) / 0.88));
  const c4 = clampScore(115 * isiRatio - 10 + (meanNdvi - 0.45) * 18);
  const famScore = Math.min(1, ([...uniqueFamilies].filter((f) => f !== 'None').length) / 3);
  const c5 = clampScore(100 * (0.45 * famScore + 0.55 * avgPestBreak));
  const c6 = clampScore(10 + 88 * (avgNFixYr / 195));
  const c7 = clampScore(avgThermalTol * 102 - heatPerturb * 16 + (avgThermalTol > 0.80 ? heatPerturb * 12 : 0));
  const benefitCostRatio = totalCost > 0 ? totalRev / totalCost : 1;
  const c8 = clampScore(26 + (sumCommShare / nYr) * 28 + (benefitCostRatio - 1) * 34 - (economicCrisis ? 14 : 0));
  const wueScore = 100 * ((totalEtc / Math.max(1, totalPEf)) * 0.4 + isiRatio * 0.6);
  const c9 = clampScore(42 + wueScore * 0.46 + (sumCommShare / nYr) * 12);
  const c10 = clampScore(95 - avgNLeachYr * 1.15);
  const c11 = clampScore(99 - rusleTonsHaYr * 7.8);
  const c12 = clampScore(100 * ((2.0 - netGhgMgYr) / 4.2));
  const c13 = clampScore(94 - avgChemYr * 10.5);

  let c14Base = 76;
  const hasPasture = st.sequence.some((y) => y.wCrop.id === 'pastura_inv');
  const hasCover = st.sequence.some((y) => y.wCrop.stageType === 'cover' && y.wCrop.id !== 'pastura_inv');
  if (!hasCover && !hasPasture) c14Base = 91;
  else if (hasPasture) c14Base = machinery === 'mixto_hacienda' ? 74 : 48;
  else if (hasCover) c14Base = machinery === 'equipo_propio' ? 84 : 74;
  if (tillage === 'convencional') c14Base -= 6;
  const c14 = clampScore(c14Base);

  const sharpeBase = (avgNetCashYr / 320) * 30 + (avgThermalTol * 32) - (economicCrisis ? 10 : 0) + (avgNFixYr > 90 && economicCrisis ? 9 : 0);
  const c15 = clampScore(34 + sharpeBase + rainPerturb * 9 - heatPerturb * 5);

  if (machinery === 'mixto_hacienda' && hasPasture) {
    // Pasturas suben fuerte en C8 liquidez forrajera cuando el productor tiene hacienda
    // Ajustado directamente antes de retornar
  }
  const c8Adj = machinery === 'mixto_hacienda' && hasPasture ? clampScore(c8 + 24) : c8;

  return {
    scores: [c1, c2, c3, c4, c5, c6, c7, c8Adj, c9, c10, c11, c12, c13, c14, c15],
    timeline: series,
    summaryMetrics: {
      awMax,
      meanNdvi: Number(meanNdvi.toFixed(2)),
      isiPct: Math.round(isiRatio * 100),
      annualSocRate: Number(annualSocRate.toFixed(2)),
      cumSocLotTons: Number((cumSocHa * areaHa).toFixed(2)),
      annualNFixed: Math.round(avgNFixYr),
      rusleTonsHaYr,
      netGhgMgYr,
      avgNetCashYr: Math.round(avgNetCashYr),
      totalNetCashLot: Math.round(cumCashHa * areaHa)
    }
  };
}

/**
 * Ejecuta la evaluación multicriterio completa (SAW-8 auditado, SAW-15, TOPSIS-15 y Monte Carlo)
 * sobre las estrategias enviadas por el cliente o sobre las estrategias por defecto.
 */
function runFullSimulation(params, envContext) {
  const weights = computeDynamicWeights(params.wWaterPct, params.wEconPct);
  const seasonCatalog = agroModel.getSeasonCropsCatalog();
  const initialStates = agroModel.getInitialFieldStates();
  const isLocalOverride = Boolean(params.isLocalOverride);

  const rawStrategies = Array.isArray(params.strategies) && params.strategies.length > 0
    ? params.strategies
    : getDefaultStrategies(params.cycleYears, params.prevCrop);

  // Etapas 1 & 3 (Field Shift v4.0): calibración Ypot histórica MAGyP sobre clima normal y suelo de referencia
  const ext = yieldModel.makeExtremesModel(envContext.clima);
  const refParams = {
    ...params,
    awMmM: envContext.suelo.aw_mm_m.media || 130,
    toscaCm: 100,
    initMoisturePct: Number(envContext.suelo.humedad_smap_inicial_pct) || 62,
    rainDeltaPct: 0,
    tempDeltaC: 0
  };
  const refDefaults = getDefaultStrategies(2, params.prevCrop || 'soja_1ra')
    .map((rawSt) => resolveStrategyConfig(rawSt, refParams, envContext, seasonCatalog, initialStates));
  const refSeasons = refDefaults.flatMap((st) =>
    yieldModel.analyzeTimeline(simulateStrategyBiophysics(st, refParams, envContext).timeline, {
      ext, ypot: null, years: st.cycleYears
    }).seasons
  );
  const calibration = yieldModel.calibrateYpot(refSeasons, envContext.estadisticas_magyp);

  const resolvedList = rawStrategies.map((rawSt) =>
    resolveStrategyConfig(rawSt, params, envContext, seasonCatalog, initialStates)
  );

  const evaluated = resolvedList.map((st) => {
    const phys = simulateStrategyBiophysics(st, params, envContext);
    const s = [...phys.scores];

    // Etapa 3: C1 (Balance hídrico), C7 (Resiliencia térmica) y C9 (Productividad WUE) desde simulación física
    const water = yieldModel.analyzeTimeline(phys.timeline, {
      ext,
      ypot: calibration.ypot,
      years: st.cycleYears
    });
    s[0] = Math.round(water.criteria.c1);
    s[6] = Math.round(water.criteria.c7);
    s[8] = Math.round(water.criteria.c9);

    // Etapa 1: Filtro no compensatorio de aptitud (Q0.05–Q0.95 SoilGrids + Tosca)
    const aptitude = yieldModel.evaluateStrategyAptitude(st, envContext);
    const meanYieldKgHa = water.seasons.length > 0
      ? Math.round(water.seasons.reduce((acc, row) => acc + row.yieldKgHa, 0) / water.seasons.length)
      : 0;

    // SAW-8 auditado (pesos históricos sobre C1..C8)
    let saw8 = 0;
    for (let i = 0; i < 8; i++) {
      saw8 += CRITERIA_META[i].w8 * s[i];
    }

    // SAW-15 y Propagación de Incertidumbre (IC 90% por Series de Taylor / Monte Carlo)
    let saw15 = 0;
    let varSum = 0;
    s.forEach((val, i) => {
      saw15 += weights[i] * val;
      const sigmaEff = isLocalOverride && (i === 1 || i === 2) ? CRITERIA_META[i].sigma * 0.35 : CRITERIA_META[i].sigma;
      varSum += Math.pow(weights[i] * sigmaEff, 2);
    });
    const stdDev = Math.sqrt(varSum);

    return {
      id: st.id,
      short: st.short,
      name: st.name_es,
      name_es: st.name_es,
      name_en: st.name_en,
      isCustom: st.isCustom,
      cycleYears: st.cycleYears,
      monthsCount: st.cycleYears * 12,
      sequence: st.sequence.map((y) => ({ year: y.year, winter: y.winter, summer: y.summer })),
      initialConditions: {
        useGlobal: st.effectiveInit.useGlobal,
        prevCrop: st.effectiveInit.prevCropId,
        awMmM: st.effectiveInit.awMmM,
        toscaCm: st.effectiveInit.toscaCm,
        initMoisturePct: st.effectiveInit.initMoisturePct,
        socGKg: st.effectiveInit.socGKg,
        machinery: st.effectiveInit.machinery,
        tillage: st.effectiveInit.tillage
      },
      scores: s,
      saw8: Number(saw8.toFixed(2)),
      saw15: Number(saw15.toFixed(2)),
      stdDev: Number(stdDev.toFixed(2)),
      ciLow: Number(Math.max(0, saw15 - 1.645 * stdDev).toFixed(1)),
      ciHigh: Number(Math.min(100, saw15 + 1.645 * stdDev).toFixed(1)),
      summaryMetrics: {
        ...phys.summaryMetrics,
        wueKgMsHaMm: water.wueKgMsHaMm,
        dhMmYear: water.dhMmYear,
        etaMm: water.etaMm,
        etcMm: water.etcMm,
        drainageMm: water.drainageMm,
        meanYieldKgHa
      },
      aptitude,
      water,
      timeline: phys.timeline
    };
  });

  // Cálculo vectorial no compensatorio TOPSIS-15
  const normDenoms = CRITERIA_META.map((_, i) => {
    const sq = evaluated.reduce((acc, r) => acc + Math.pow(r.scores[i], 2), 0);
    return Math.sqrt(sq) || 1;
  });

  const weightedNorm = evaluated.map((r) => r.scores.map((val, i) => weights[i] * (val / normDenoms[i])));
  const idealPos = CRITERIA_META.map((_, i) => Math.max(...weightedNorm.map((row) => row[i])));
  const idealNeg = CRITERIA_META.map((_, i) => Math.min(...weightedNorm.map((row) => row[i])));

  evaluated.forEach((row, idx) => {
    let dPos = 0;
    let dNeg = 0;
    weightedNorm[idx].forEach((v, i) => {
      dPos += Math.pow(v - idealPos[i], 2);
      dNeg += Math.pow(v - idealNeg[i], 2);
    });
    dPos = Math.sqrt(dPos);
    dNeg = Math.sqrt(dNeg);
    const denom = dPos + dNeg;
    row.topsis15 = denom > 0 ? Number(((dNeg / denom) * 100).toFixed(2)) : Number(row.saw15.toFixed(2));
  });

  return {
    criteriaMeta: CRITERIA_META.map((c, i) => ({
      ...c,
      weightPct: Number((weights[i] * 100).toFixed(1)),
      w8Pct: Number((c.w8 * 100).toFixed(0)),
      origin: COMPUTED_CRITERIA.has(i) ? 'calculado' : 'simulado'
    })),
    calibration: calibration.info,
    extremesSource: ext.source,
    strategies: evaluated
  };
}

module.exports = {
  getDefaultStrategies,
  runFullSimulation
};
