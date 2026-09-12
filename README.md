# Volta Player

A self-hosted web player for Navidrome.

For listener setup, browser support, privacy controls, and audio-quality
behavior, see [the user guide](docs/USER_GUIDE.md). Operators preparing a
public launch should also use the [release checklist](docs/RELEASE_CHECKLIST.md).

## Development

```bash
npm install
npm run dev
```

Open the Vite URL and enter your Navidrome server address.

Run the Chromium and Firefox regression suite with `npm test -- --reporter=list`.
The WebKit audio test is also available in a Playwright-supported Ubuntu CI
runner or container with `PLAYWRIGHT_INCLUDE_WEBKIT=1`.

## Docker

From this directory:

```bash
docker compose -f docker/compose.yaml up -d --build
```

Open <http://localhost:8080>.

Stop it with:

```bash
docker compose -f docker/compose.yaml down
```

Volta runs in the browser and connects directly to Navidrome. Configure
Navidrome CORS for the URL where Volta is hosted. If Volta uses HTTPS,
Navidrome must also be available over HTTPS.

## Production build

```bash
npm run build
```

The output is written to `dist/`.
