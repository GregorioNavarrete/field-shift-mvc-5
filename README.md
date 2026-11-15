<div align="center">

# Field Shift v4.0

**Open-Source Agroclimatic Decision-Support Tool for Adaptive Crop Rotations**

[![License](https://img.shields.io/badge/License-Apache_2.0-07503f.svg)](./LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-%E2%89%A518.0-07503f.svg)](https://nodejs.org/)
[![Express](https://img.shields.io/badge/Express-4.19-13795b.svg)](https://expressjs.com/)
[![NASA Space Apps 2026](https://img.shields.io/badge/NASA%20Space%20Apps%202026-Field%20Shift-13795b.svg)](https://www.spaceappschallenge.org/)
[![Contributions Welcome](https://img.shields.io/badge/contributions-welcome-brightgreen.svg)](./CONTRIBUTING.md)

[English](./README.md) · [Español](./README.es.md) · [Live Static Explorer (GitHub Pages)](./docs/index.html)

</div>

---

## Table of Contents

- [About the Project](#about-the-project)
- [Key Features](#key-features)
- [Data Provenance & Epistemological Transparency](#data-provenance--epistemological-transparency)
- [Scientific Pipeline (3 Stages)](#scientific-pipeline-3-stages)
- [Architecture & Repository Layout](#architecture--repository-layout)
- [Getting Started](#getting-started)
  - [Prerequisites](#prerequisites)
  - [Installation](#installation)
  - [Configuration (`.env`)](#configuration-env)
- [Usage & REST API](#usage--rest-api)
- [Verification](#verification)
- [Deployment](#deployment)
- [Known Limitations & Agronomic Disclaimer](#known-limitations--agronomic-disclaimer)
- [Contributing](#contributing)
- [License & AI/SI Disclosure](#license--aisi-disclosure)
- [References](#references)

---

## About the Project

Choosing a multi-year crop rotation involves simultaneous trade-offs across soil moisture, organic carbon, pest and weed disruption, thermal extremes, machinery logistics, and farm liquidity. A crop that builds soil structure in one environment may suffer water deficit or fail over shallow petrocalcic hardpans (*tosca*) in another.

**Field Shift v4.0** is an open-source MVC web application built for the **NASA Space Apps Challenge 2026 ("Field Shift")** by **Project UNSE**. Rather than issuing opaque prescriptions, it acts as a **white-box decision-support system** where students, growers, and agricultural advisors can trace every satellite input, equation, uncertainty bound, and trade-off across **1-to-6-year horizons (12–72 months)**.

---

## Key Features

- **Interactive Plot Definition:** Trace field polygons on satellite tiles (Leaflet + Esri World Imagery) with real-time WGS84 geodesic area ($\text{m}^2$/ha) and centroid calculation via Turf.js.
- **14 Initial Field Conditions:** Anchor Month-0 soil moisture, surface residue cover, mineral N, and an illustrative $7\times 6$ NDVI grid to actual field states (from active summer crops and winter stubble to perennial pastures or bare/degraded fallows).
- **Live Open-API Ingestion with Offline Resilience:** Fetches **NASA POWER** climatology, 20-year daily NASA POWER temperature extremes, **ISRIC SoilGrids v2.0** (`mean`, `Q0.05`, `Q0.95`), and **Georef AR** location metadata in parallel, with TTL caching and automatic fallback to [`data/zona_guamini_10ha.json`](./data/zona_guamini_10ha.json).
- **Custom Strategy Builder:** Modify presets or build custom year-by-year rotations combining **11 winter** and **10 summer** crop/cover options, each with optional per-strategy initial soil/tillage overrides.
- **3-Stage Biophysical & MCDA Engine:** Non-compensatory soil aptitude check → 3-substep monthly FAO-56 soil water balance → FAO-33 ($K_y$) yield response + empirical thermal extremes + **SAW-8**, **SAW-15**, and non-compensatory **TOPSIS-15** ranking with 90% confidence intervals.
- **Stress Testing & White-Box Pedagogy:** Built-in presets (*Normal*, *La Niña Drought `-30% rain / +2°C`*, *El Niño `+30% rain`*, *Economic Shock*), interactive sliders, clickable formula modals for all KPIs, animated per-step pointer tutorials, Dark Mode, and `ES | EN` localization.
- **Serverless Static Explorer (`docs/`):** Standalone HTML/CSS/JS showcase ready for **GitHub Pages** that queries open CORS APIs directly in the browser.

---

## Data Provenance & Epistemological Transparency

Field Shift explicitly separates live external observations from historical benchmarks and parameterized layers:

| Layer / Variable | Source / Endpoint | Data Type in v4.0 | Caching / Fallback |
| :--- | :--- | :--- | :--- |
| **Monthly Climatology** (`T2M`, `T2M_MAX`, `T2M_MIN`, `PRECTOTCORR`, `RH2M`, `WS2M`, `ALLSKY_SFC_SW_DWN`) | `power.larc.nasa.gov/api/temporal/climatology/point?community=AG` | **Live open API** | 1 h in-memory TTL; offline JSON fallback |
| **Daily Thermal Extremes** ($T_{\max}>35\,^\circ\text{C}$, $T_{\min}<0\,^\circ\text{C}$) | `power.larc.nasa.gov/api/temporal/daily/point?community=AG` (20 yr) | **Live open API** → empirical monthly exceedance curves | 7-day cell cache; calibrated Normal fallback |
| **Soil Properties & Uncertainty** (`soc`, `wv0033`, `wv1500`, `sand`, `silt`, `clay`, `0–30 cm`) | `rest.isric.org/soilgrids/v2.0/properties/query` (`mean`, `Q0.05`, `Q0.95`) | **Live open API** (250 m) | 30-day TTL; offline JSON fallback |
| **Administrative Jurisdiction** | `apis.datos.gob.ar/georef/api/ubicacion` | **Live open API** (Argentina) | 24 h TTL; offline fallback |
| **District Yields & Volatility** | `data/zona_guamini_10ha.json` (`estadisticas_magyp`) | **Historical benchmark** (10-yr MAGyP/INDEC Guaminí) | Auto-calibrates $Y_{\text{pot}}$ and $C_{15}$ |
| **Intra-Field NDVI Grid ($7\times 6$) & SMAP Baseline (62%)** | `getInitialFieldStates()` & `computeCellNdvi()` | **Parameterized reference layers** anchored to initial state & Sentinel-2/SMAP ranges | Editable by user in Steps 1 & 2 |
| **Scores, Balances & Rankings** | `yieldModel.js`, `extremesModel.js`, `mcdaModel.js` | **Modeled inferences** | Requires local agronomist validation |

---

## Scientific Pipeline (3 Stages)

1. **Stage 1 — Non-Compensatory Aptitude Filter (`models/yieldModel.js`)**
   Evaluates every crop in a candidate rotation against minimum available water (`minAwReq`) and rootable depth (`minToscaReq`) scaled by hardpan depth (`toscaCm / 100`) across SoilGrids `Q0.05` and `Q0.95` quantiles, assigning `apto` (Suitable), `dudoso` (Uncertain — measure on-farm), or `no_apto` (Unsuitable).

2. **Stage 2 — Monthly FAO-56 Soil Water Balance (`models/yieldModel.js` + `models/mcdaModel.js`)**
   - Computes monthly reference evapotranspiration ($ET_0$) from NASA POWER meteorological variables via full **FAO-56 Penman-Monteith** (`et0PenmanMonteith`).
   - Integrates root-zone moisture across **3 sub-steps per month** over 12–72 months:
     $$S_t = \text{clamp}\big(S_{t-1} + P_{\text{ef}} - ET_a - D,\ 0,\ AW_{\max}\big), \quad ET_a = K_s \cdot ET_c, \quad K_s = \min\!\left(1,\frac{S}{(1-p)\,AW_{\max}}\right)$$
     with $p = 0.50$, tillage modifiers (`siembra_directa`, `labranza_vertical`, `convencional`), deep drainage $D$, carbon accumulation ($\Delta SOC$), nitrate leaching, and cumulative cash flow.

3. **Stage 3 — FAO-33 Yield, Thermal Extremes & MCDA Audit (`models/extremesModel.js`, `yieldModel.js`, `mcdaModel.js`)**
   - Computes water-limited yield via **FAO-33** ($1 - K_y(1 - ET_a/ET_c)$) and deducts heat (>35°C) and frost (<0°C) days during sensitive phenological windows using shifted exceedance curves ($u - \Delta T$).
   - Auto-calibrates $Y_{\text{pot}}$ against 10-year MAGyP district yields.
   - Scores 15 criteria (`C1–C15`), where **`C1`** (Water Balance), **`C7`** (Thermal Resilience), and **`C9`** (Water Use Efficiency) are physically computed (`origin: 'calculado'`, tagged `FAO-33` in the UI), then computes **SAW-8**, **SAW-15**, non-compensatory **TOPSIS-15**, and 90% confidence intervals ($\text{SAW}_{15} \pm 1.645\sigma$).

---

## Architecture & Repository Layout

```text
field-shift-mvc-4/
├── server.js                      # Express server, compression, CORS, EJS setup, error handler
├── package.json                   # Dependencies and npm scripts (Apache-2.0)
├── LICENSE                        # Apache License 2.0
├── README.md                      # Open-source documentation (English)
├── README.es.md                   # Open-source documentation (Spanish)
├── CONTRIBUTING.md                # Contribution guidelines
├── CODE_OF_CONDUCT.md             # Contributor Covenant v2.1
├── .gitignore                     # Excludes node_modules/ and .env
├── routes/
│   └── indexRoutes.js             # GET /, POST /api/analyze, GET /api/equations
├── controllers/
│   └── fieldShiftController.js    # HTTP controller connecting models and EJS view
├── models/
│   ├── agroModel.js               # Parallel API clients (POWER, SoilGrids, Georef), TTL cache, catalogs
│   ├── extremesModel.js           # Empirical monthly thermal exceedance curves
│   ├── yieldModel.js              # Penman-Monteith FAO-56, FAO-33 (Ky), MAGyP calibration, Aptitude Filter
│   └── mcdaModel.js               # 3-substep monthly simulator, SAW-8, SAW-15, TOPSIS-15, 90% CI
├── data/
│   └── zona_guamini_10ha.json     # Offline demo baseline & MAGyP 10-yr yields (Guaminí / INTA Bordenave)
├── views/
│   └── index.ejs                  # 4-step guided UI, strategy builder, equation modals, pointer tutorials
├── public/
│   ├── css/styles.css             # Pastoral Editorial + Dark Mode design system
│   └── js/client.js               # Leaflet map, NDVI grid, Chart.js, tutorials, ES/EN i18n
└── docs/                          # Serverless static single-page explorer for GitHub Pages
    ├── index.html
    ├── styles.css
    └── app.js
```

---

## Getting Started

### Prerequisites

- **Node.js** `>= 18.0` (uses native `fetch` and `AbortSignal.timeout`)
- **npm** `>= 9.0`

### Installation

```bash
git clone https://github.com/GregorioNavarrete/field-shift-mvc-4.git
cd field-shift-mvc-4
npm install
npm start
```

Open `http://localhost:3000` in your browser. For development with auto-reload:

```bash
npm run dev
```

### Configuration (`.env`)

No external API keys are required. You can optionally create a `.env` file (excluded by `.gitignore`) to tune ports, timeouts, and cache TTLs:

| Variable | Default | Description |
| :--- | :--- | :--- |
| `PORT` | `3000` | Express HTTP port |
| `NODE_ENV` | — | Set to `development` to expose stack details in 500 JSON responses |
| `CACHE_TTL_CLIMA_MS` | `3600000` | NASA POWER climatology cache TTL in ms (1 hour) |
| `CACHE_TTL_SUELO_MS` | `2592000000` | ISRIC SoilGrids v2.0 cache TTL in ms (30 days) |
| `CACHE_TTL_EXTREMOS_MS` | `604800000` | Daily temperature extremes cache TTL in ms (7 days) |
| `POWER_EXTREMES_YEARS` | `20` | Number of historical daily years requested from NASA POWER |
| `POWER_DAILY_TIMEOUT_MS` | `4500` | Request timeout in ms for NASA POWER daily time series |

---

## Usage & REST API

| Method & Path | Description |
| :--- | :--- |
| `GET /` | Renders the full 4-step MVC application (`views/index.ejs`) preloaded with Guaminí baseline parameters. |
| `GET /api/equations` | Returns bilingual white-box metadata (16 entries), 14 initial field states, 11 winter + 10 summer crops, and 9 physiological crop cards. |
| `POST /api/analyze` | Re-runs environmental fetching, aptitude filtering, monthly simulation, and MCDA ranking for custom plot/scenario inputs. |

**Example `POST /api/analyze` request:**

```bash
curl -X POST http://localhost:3000/api/analyze \
  -H "Content-Type: application/json" \
  -d '{
    "lat": -36.8055,
    "lon": -62.0265,
    "areaM2": 100000,
    "cycleYears": 3,
    "prevCrop": "soja_1ra",
    "toscaCm": 75,
    "rainDeltaPct": -30,
    "tempDeltaC": 2.0,
    "wWaterPct": 40,
    "wEconPct": 20
  }'
```

---

## Verification

Run syntax checks across all server, model, client, and static explorer modules:

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

Once the server is running (`npm start`), verify live HTTP endpoints:

```bash
curl -s http://localhost:3000/api/equations | head -c 300
```

---

## Deployment

### Option A — GitHub Pages (Static Explorer in `docs/`)

1. Push the repository to GitHub on branch `main`.
2. Go to **Settings → Pages → Build and deployment**.
3. Under **Source**, choose **Deploy from a branch** → branch **`main`** → folder **`/docs`**.
4. Because NASA POWER, ISRIC SoilGrids v2.0, and Georef AR serve `Access-Control-Allow-Origin: *`, the static explorer fetches live data directly from the visitor's browser with automatic offline fallback.

### Option B — Full Node.js MVC App (Render / Railway / Fly.io / VPS)

- **Build command:** `npm install`
- **Start command:** `npm start`
- **Port binding:** automatically reads `process.env.PORT || 3000`

---

## Known Limitations & Agronomic Disclaimer

> [!WARNING]
> **Decision-Support Notice:** Field Shift outputs are modeled inferences designed for comparative scenario exploration—not agronomic prescriptions. Every management decision must be validated on-site by a licensed agronomist familiar with local soils, pests, and markets.

1. **Zonal Resolution:** NASA POWER (~50 km) and SoilGrids (250 m) reflect regional grids; intra-plot variability requires ground sampling and local multispectral imagery.
2. **Monthly Sub-Step Abstraction:** Integrating in 3 sub-steps per month captures seasonal soil water trends but simplifies sub-daily storm runoff compared to daily mechanistic crop models (e.g., APSIM, DSSAT).
3. **Regional Calibration Scope:** Default economic margins (`costHa`, `revHa`) and MAGyP yield benchmarks are calibrated for Guaminí (Sandy Pampas, Argentina) and should be localized before operational deployment in other agroecosystems.

---

## Contributing

Contributions are welcome—especially regional crop parameters, additional MAGyP/USDA district calibrations, SoilGrids/POWER resilience tests, and UI accessibility improvements. Please read [CONTRIBUTING.md](./CONTRIBUTING.md) and adhere to our [Code of Conduct](./CODE_OF_CONDUCT.md).

---

## License & AI/SI Disclosure

- **Open-Source License:** Distributed under the **[Apache License 2.0](./LICENSE)**.
- **Super Intelligence (SI) Disclosure (NASA Space Apps 2026):** Language-model assistance (Super Intelligence) was utilized to accelerate JavaScript/EJS code structuring, mathematical documentation, and bilingual translation under continuous student supervision. Conceptual architecture, dataset selection, agronomic calibration, and verification testing were executed by the **Project UNSE** student team. No NASA logos, flags, or mission identifiers are used or modified.

---

## References

1. Abdalla, M., et al. (2019). A critical review of the impacts of cover crops on nitrogen leaching, net greenhouse gas balance and crop productivity. *Global Change Biology*, 25(8), 2530–2543.
2. Allen, R. G., Pereira, L. S., Raes, D., & Smith, M. (1998). *Crop evapotranspiration: Guidelines for computing crop water requirements*. FAO Irrigation and Drainage Paper No. 56.
3. Álvarez, R., Steinbach, H. S., & De Paepe, J. L. (2017). Cover crop effects on soils and subsequent crops in the pampas: A meta-analysis. *Soil and Tillage Research*, 170, 53–65.
4. Beillouin, D., et al. (2021). Positive but variable effects of crop diversification on biodiversity and ecosystem services. *Global Change Biology*, 27(19), 4697–4710.
5. Bowles, T. M., et al. (2020). Long-term evidence shows that crop-rotation diversification increases agricultural resilience to adverse growing conditions in North America. *One Earth*, 2(3), 284–293.
6. Caviglia, O. P., Sadras, V. O., & Andrade, F. H. (2004). Intensification of agriculture in the south-eastern Pampas. *Field Crops Research*, 87(2–3), 117–129.
7. Doorenbos, J., & Kassam, A. H. (1979). *Yield response to water*. FAO Irrigation and Drainage Paper No. 33.
8. Entekhabi, D., et al. (2010). The Soil Moisture Active Passive (SMAP) Mission. *Proceedings of the IEEE*, 98(5), 704–716.
9. Hwang, C. L., & Yoon, K. (1981). *Multiple Attribute Decision Making: Methods and Applications*. Springer.
10. Pinto, P., Fernández Long, M. E., & Piñeiro, G. (2017). Including cover crops during fallow periods for increasing ecosystem services in Southern South America. *Agriculture, Ecosystems & Environment*, 248, 48–57.
11. Poggio, L., et al. (2021). SoilGrids 2.0: producing soil information for the globe with quantified spatial uncertainty. *SOIL*, 7(1), 217–240.
12. Reichle, R. H., et al. (2019). Version 4 of the SMAP Level-4 Soil Moisture Algorithm and Data Product. *JAMES*, 11(10), 3106–3130.
