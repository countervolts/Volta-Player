# Self-hosting Volta Player

Build and start the production player from the `player` directory:

```bash
docker compose -f docker/compose.yaml up -d --build
```

Open <http://localhost:8080>. To use another host port:

```bash
VOLTA_PORT=3000 docker compose -f docker/compose.yaml up -d --build
```

Volta is a static client. The browser connects directly to the Navidrome
server entered on the sign-in screen, so the Navidrome server must allow the
origin where Volta is served. For an HTTPS deployment, serve this container
behind your reverse proxy and allow that HTTPS origin in Navidrome CORS
settings. An HTTPS Volta page cannot connect directly to an HTTP Navidrome
server because browsers block mixed content.

The nginx configuration includes SPA fallback support, so private routes such
as `/123456/album/...` work after a refresh, and exposes `/healthz` for
container health checks.

Stop the container with:

```bash
docker compose -f docker/compose.yaml down
```

For a production update, rebuild only `volta-player` and wait for its health
check; do not bring down the whole Compose project:

```bash
docker compose -f docker/compose.yaml up -d --build --no-deps --wait volta-player
```

The player is a static shell and streams audio directly from Navidrome, so an
existing tab keeps its current release while the new container comes up. The
service worker also waits to activate a new shell until the current tab is
closed, preventing an update from replacing an active session mid-listen.
