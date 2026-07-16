# AL-Tool v2 — imagem do sidecar (FastAPI + DuckDB) que serve a API E o SPA React.
# Multi-stage: (1) builda o React; (2) instala o backend Python e serve tudo.
# Roda no navegador — sem Electron (o shell desktop é opcional). Nada precisa estar na máquina.

# ---------- stage 1: build do client React ----------
FROM node:20-slim AS client
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/client/package.json apps/client/package.json
COPY apps/desktop/package.json apps/desktop/package.json
RUN npm install --no-audit --no-fund --ignore-scripts
COPY apps/client apps/client
RUN npm run client:build

# ---------- stage 2: sidecar Python ----------
FROM python:3.12-slim AS sidecar
WORKDIR /app

# Backend Python (wheels manylinux de duckdb/polars/pyarrow/calamine — sem toolchain).
COPY backend/pyproject.toml backend/pyproject.toml
COPY backend/src backend/src
RUN pip install --no-cache-dir ./backend

# Pré-baixa a extensão excel do DuckDB para o runtime ser OFFLINE (LOAD do cache local).
RUN python -c "import duckdb; c=duckdb.connect(); c.execute('INSTALL excel'); c.execute('LOAD excel')"

# SPA React buildado no stage 1.
COPY --from=client /app/apps/client/dist ./client-dist

ENV APP_HOST=0.0.0.0 \
    APP_PORT=3000 \
    CLIENT_DIST=/app/client-dist \
    DATA_DIR=/data \
    DB_PATH=/data/altool.duckdb \
    METADATA_DB_PATH=/data/altool.sqlite \
    UPLOAD_DIR=/data/uploads \
    EXPORT_DIR=/data/exports

RUN mkdir -p /data
EXPOSE 3000
CMD ["python", "-m", "altool.main"]
