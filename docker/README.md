# Self-hosting Volta Player

Build and start the production player from the `player` directory:

```bash
docker compose -f docker/compose.yaml up -d --build
```

Open <http://localhost:8080>. To use another host port:

```bash
VOLTA_PORT=<PORT> docker compose -f docker/compose.yaml up -d --build
```

Stop the container with:

```bash
docker compose -f docker/compose.yaml down
```