# GameBoy MCP server

Control a GameBoy emulator with MCP tools or an authenticated browser interface. The server supports Node.js 22.19+ and 24 on Linux, Windows and macOS. Rendering uses pure JavaScript; native Canvas and an installed browser are not needed to run the server.

## Start with stdio

Install from npm, or build this repository:

```sh
npm ci
npm run build
node dist/index.js --stdio
```

An MCP client configuration for the published package:

```json
{
  "mcpServers": {
    "gameboy": {
      "command": "npx",
      "args": ["-y", "mcp-gameboy"],
      "env": { "ROM_DIR": "/absolute/path/to/your/roms" }
    }
  }
}
```

Use an absolute Windows path such as `C:\\Games\\GameBoy` on Windows. Stdio is the default transport. It starts without a cartridge and does not open a browser or HTTP port. Set `ROM_PATH` to load a cartridge at startup. Relative `ROM_PATH` values resolve from the process working directory. The exact configured startup file may be outside `ROM_DIR`; this does not authorize other files alongside it.

The stdio server is a local capability available to the process that starts it. HTTP authentication is not required unless HTTP is enabled.

## HTTP and browser interface

Generate a random operator key:

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
```

Set `MCP_OPERATOR_TOKEN` to that value in your environment or private `.env`, then run:

```sh
node dist/index.js --http
```

Open `http://127.0.0.1:3001` and enter the operator key. The page keeps it in memory, clears the input, and uses an Authorization header. Refreshing or disconnecting forgets the key. Never place it in a URL. Every ROM, upload, screen, control and MCP endpoint requires authentication; the static sign-in page and generic health response are public.

HTTP clients use `Authorization: Bearer <operator-key>`. This deployment has one operator and one emulator: all authorized MCP clients and browser controls intentionally share the cartridge and button state. Run separate server processes with separate keys and ROM directories for independent users.

Settings:

| Variable | Default | Purpose |
| --- | --- | --- |
| `ROM_DIR` | `./roms` | Authoritative cartridge directory, created if needed |
| `ROM_PATH` | unset | Optional exact startup cartridge |
| `SERVER_HOST` | `127.0.0.1` | HTTP bind address |
| `SERVER_PORT` | `3001` | HTTP port; `PORT` is an alias |
| `MCP_OPERATOR_TOKEN` | unset | Required for all HTTP modes; 32–256 random URL-safe characters |
| `MCP_PUBLIC_URL` | local bind origin | Exact public origin; HTTPS required outside loopback |
| `MCP_ALLOWED_ORIGINS` | unset | Additional exact browser origins, comma separated |

For a remote deployment, use a TLS reverse proxy, an explicit HTTPS `MCP_PUBLIC_URL`, and `SERVER_HOST=0.0.0.0` as needed. The proxy must preserve the configured public Host header. Host ports and browser Origins are checked exactly; wildcards, reflected origins and the sandbox `null` origin are rejected. A valid bearer does not override those checks.

`--ui` adds the authenticated HTTP interface alongside stdio. `--sse` remains an alias for HTTP mode. Automatic browser launching has been removed.

## MCP compatibility

The server uses TypeScript SDK 2 with the actual 2026-07-28 serving entry points:

- Modern stdio starts with `server/discover`; legacy stdio `initialize` remains supported.
- `POST /mcp` provides modern Streamable HTTP and explicit legacy stateless compatibility.
- `GET /sse` plus `POST /messages?sessionId=...` preserves the older SSE transport. `GET /mcp` without a protocol header is its compatibility alias. Each SSE connection owns its own MCP server; at most 32 sessions can remain open, with a 10-minute idle timeout.
- Modern HTTP clients must send the protocol's `Mcp-Protocol-Version`, `Mcp-Method` and applicable `Mcp-Name` headers, plus per-request client metadata. Prefer the current MCP client SDK.

The frozen SDK legacy SSE package is present only for migration compatibility. New clients should use Streamable HTTP. No client-roots, sampling, logging, task or resource capability is falsely advertised.

Tools:

| Tool | Behavior |
| --- | --- |
| `press_up/down/left/right/a/b/start/select` | Hold a button for `duration_frames` (default 25), then one release frame |
| `wait_frames` | Advance `duration_frames` without input (default 100) |
| `get_screen` | Advance one frame and return a 160×144 PNG |
| `load_rom` | Load `romPath`, replacing the cartridge, and render five startup frames |
| `is_rom_loaded` | Read availability, cartridge path, frame count and queue size |
| `list_roms` | List regular .gb/.gbc files directly inside ROM_DIR |

Filesystem and emulator failures return MCP `isError` results. Frame values must be integers from 1 to 600. Read-only annotations match actual behavior; `get_screen` advances state.

## Cartridge and execution boundaries

Use cartridges you are entitled to use. No game ROM is included in the npm package or container. ROMs must be regular .gb/.gbc files from 32 KiB to 8 MiB whose length matches the cartridge size header. Canonical paths prevent sibling-prefix, traversal and external-symlink escapes. Uploads accept one bounded file with a plain portable filename, use an exclusive create, and never overwrite an existing file. Directory listings stop at 1000 entries.

The original Serverboy emulator runs in a worker, with a 128 MiB old-generation heap limit. The main process allows four concurrent ROM reads/uploads and 16 queued emulator operations. Load operations have a five-second deadline; frame operations have a two-second deadline. Timeout or active cancellation terminates the worker, rejects queued work and clears the cartridge state. Reload the cartridge to recover; mutations are never replayed automatically. These bounds protect server responsiveness; they do not make the older emulator a complete hardware-compatibility implementation.

The browser's `GET /screen` only reads the cached PNG. Advancing a frame, loading a cartridge and uploads require authenticated POST requests. Old state-changing GET links return 405.

## Docker

```sh
docker build -t mcp-gameboy .
docker run --rm -i --mount type=bind,source=/absolute/roms,target=/data/roms,readonly mcp-gameboy
```

The image runs as UID 1000, includes no ROMs or credentials, and needs no native Canvas libraries. Mount a writable cartridge directory owned by UID 1000 if uploads are required.

For local HTTP, use a private env file containing the operator key and publish only loopback:

```sh
docker run --rm -p 127.0.0.1:3001:3001 --env-file .env \
  -e SERVER_HOST=0.0.0.0 -e MCP_PUBLIC_URL=http://127.0.0.1:3001 \
  mcp-gameboy --http
```

A generic `GET /health` response is available in HTTP mode. Stdio containers do not open an HTTP health port.

## Validation and maintenance

```sh
npm test
npm run test:wire
npm run test:package
npm audit --omit=dev
npm run test:docker
```

Set `RUN_BROWSER_TESTS=true` for the actual Chromium interface test. `PUPPETEER_EXECUTABLE_PATH` can select an installed browser; Puppeteer is a development-only dependency. Linux CI explicitly disables Chromium's sandbox for the test harness where the hosted runner blocks its user namespaces. Production server behavior is unaffected.

The release workflow exercises Linux/Windows Node 22/24 and macOS Node 24, the generated original homebrew cartridge, actual pixels and button effects, ROM/auth boundaries, cancellation/timeout recovery, simultaneous SSE connections, both protocol eras and an independently installed production-only tarball. Its Linux Docker job builds and runs the actual container. Development was performed in a Linux VM without a Docker socket; container acceptance is established by CI, not claimed from local mocks.

The vendored emulator remains Serverboy 0.0.7, an older upstream implementation. The release tests establish the exercised homebrew behavior, not compatibility with every commercial game, cartridge mapper, save file or audio feature. Recheck Node support, SDK protocol revisions and dependency advisories before a late-2026 release; no implementation can certify future external changes.

## Licensing

The existing MCP wrapper is MIT licensed. The vendored emulator source is GPL version 2; its source and license are included. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for exact provenance. The upstream npm archive contains a commercial ROM, so this project includes only its emulator source and license rather than installing that archive as a runtime dependency.
