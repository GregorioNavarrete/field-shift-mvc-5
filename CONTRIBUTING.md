# Contributing to Field Shift v4.0

Thank you for your interest in contributing to **Field Shift v4.0**! We welcome pull requests, issue reports, regional agronomic parameterizations, and documentation improvements from developers, agronomists, and students.

## Code of Conduct

Please review and follow our [Code of Conduct](./CODE_OF_CONDUCT.md) in all project interactions.

## How to Contribute

1. **Fork the repository** and create a feature branch from `main`:
   ```bash
   git checkout -b feat/your-feature-name
   ```
2. **Keep changes modular and transparent:**
   - Place external data connectors and catalogs in `models/agroModel.js`.
   - Place biophysical equations and suitability checks in `models/yieldModel.js` or `models/extremesModel.js`.
   - Place multi-criteria scoring and simulation logic in `models/mcdaModel.js`.
   - Keep white-box documentation in `getEquationsMetadata()` synchronized whenever formulas change.
3. **Preserve epistemological honesty:**
   - Clearly distinguish live API measurements from static district benchmarks or parameterized assumptions.
   - Do not fabricate citations or unverified yields; cite peer-reviewed papers or public datasets (NASA, ISRIC, FAO, USDA, INTA, MAGyP).
4. **Verify before opening a Pull Request:**
   - Ensure `node --check` passes on all modified `.js` files.
   - Start the server (`npm start`) and verify `GET /`, `GET /api/equations`, and `POST /api/analyze` return HTTP `200` without console errors.
   - Never commit `.env` files, private API keys, or `node_modules/`.

## Priority Areas for Contribution

- Adding regional crop yield benchmarks outside the Argentine Pampas (e.g., USDA NASS QuickStats or FAO GAEZ adapters).
- Adding unit tests under a dedicated `test/` directory.
- Expanding localized translations (`ES | EN`) and accessibility improvements.

## License

By contributing, you agree that your contributions will be licensed under the **[Apache License 2.0](./LICENSE)**.
