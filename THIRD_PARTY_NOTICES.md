# Third-party emulator source

`vendor/serverboy` contains the original Serverboy 0.0.7 emulator source by Daniel Shumway and its GameBoy-Online contributors, licensed under GPL version 2; see the preserved LICENSE and source headers there. The MCP wrapper remains under its existing MIT license.

Source: https://gitlab.com/piglet-plays/serverboy.js
Registry source archive: https://registry.npmjs.org/serverboy/-/serverboy-0.0.7.tgz
Archive SHA-1: 72025d24f369e866a583da882dc733e8ce513d36

Only `src/` and `LICENSE` were copied, unchanged. A CommonJS package boundary was added. The upstream package's ROMs, tests and examples are excluded. No commercial ROM is included in this package or its container image. The test fixture is generated from original source in `scripts/homebrew.mjs`.
