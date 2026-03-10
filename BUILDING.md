# Building Hermes IDE

Instructions for building Hermes IDE from source.

## Prerequisites

| Tool | Version | Install |
|------|---------|---------|
| [Node.js](https://nodejs.org) | 20+ | [nodejs.org](https://nodejs.org) |
| [Rust](https://rustup.rs) | stable | `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \| sh` |

### Platform-Specific Dependencies

**macOS:**

```bash
xcode-select --install
```

**Linux (Debian/Ubuntu):**

```bash
sudo apt-get install libwebkit2gtk-4.1-dev libgtk-3-dev libsoup-3.0-dev libjavascriptcoregtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf
```

**Windows:**

Install [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) with the "Desktop development with C++" workload. Windows 10 users may also need to install the [WebView2 Runtime](https://developer.microsoft.com/en-us/microsoft-edge/webview2/).

## Clone and Setup

```bash
git clone https://github.com/hermes-hq/hermes-ide.git
cd hermes-ide
npm ci
```

## Development

```bash
npm run dev          # Vite dev server only (frontend)
npm run tauri dev    # Full Tauri app with hot-reload
```

## Production Build

```bash
npm run tauri build
```

Build artifacts are output to `src-tauri/target/release/bundle/`.

## Tests

```bash
npm run test                    # Frontend tests
cd src-tauri && cargo test      # Rust tests
npx tsc --noEmit                # TypeScript type check
```

## License

Hermes IDE is source-available under the [Business Source License 1.1](LICENSE). Contributions require signing the [CLA](CLA.md). See [CONTRIBUTING.md](CONTRIBUTING.md) for details.
