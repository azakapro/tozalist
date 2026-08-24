# engine

Internal validation engine (Go).

**Trust boundary:** internal-only. It has no published host port in
`docker-compose.yml` and must never be exposed publicly. Only the API and the
worker, from inside the private network, may call it.

Scope at step 0.1: a placeholder process that logs `engine placeholder` and
stays alive until terminated, so Docker Compose can manage it. No HTTP server
and no validation logic yet.

```bash
docker compose up -d engine
docker compose logs engine
```
