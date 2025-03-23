## Server

Build
```bash
docker build --progress=plain -f docker/server/Dockerfile -t server .
```

Run
```bash
docker run --env-file docker/server/.env.example -p 8101:8101 -p 8102:8102 -t server
```

## Emulator

Build & run
```bash
docker-compose -f docker/emulator/docker.compose.yaml up --build
```
