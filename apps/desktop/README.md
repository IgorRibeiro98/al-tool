AL Tool Desktop (Electron)
==========================

Módulo desktop em Electron que embute:

- Frontend React/MUI (Vite) – `apps/client`
- API/pipeline Node/Express + SQLite – `apps/api`
- Scripts de conversão – `scripts/`

O objetivo é rodar todo o fluxo de conciliação **100% offline**, em um único app instalável (Windows/Linux/macOS).

## 1. Requisitos

- Node.js LTS (>= 18)
- npm (monorepo com workspaces)

Do repositório raiz (`al-tool`):

```bash
npm install
```

Isso instala dependências de todos os workspaces, incluindo `apps/desktop`, `apps/api` e `apps/client`.

## 2. Modo desenvolvimento

### 2.1. Frontend (Vite)

No diretório `apps/client`:

```bash
cd apps/client
npm run dev -- --port 8081
```

O frontend ficará acessível em `http://localhost:8081`.

### 2.2. Electron (desktop)

No diretório `apps/desktop`:

```bash
cd apps/desktop
npm run dev
```

O script `dev` faz:

- `tsc -w` no desktop (`src/main.ts`, `src/preload.ts` → `dist/`)
- Aguarda o dev server do Vite (`http://localhost:8081`) com `wait-on`
- Sobe o Electron apontando para a URL do frontend

Variáveis importantes:

- `ELECTRON_DEV_URL` (opcional): URL do frontend em dev.
	- Default: `http://localhost:8081`
- `ELECTRON_API_PORT` (opcional): porta da API local embutida em dev.
	- Default: `3000`

## 3. Modo produção (sem empacotamento)

### 3.1. Build da pipeline

Antes de compilar a API e o Electron, é necessário gerar o build do pacote de pipeline (steps de conciliação), pois a API o consome em produção:

```bash
cd packages/pipeline
npm run build
```

### 3.2. Build do frontend

```bash
cd apps/client
npm run build
```

Gera `apps/client/dist` com os arquivos estáticos do React/MUI.

### 3.3. Build da API

```bash
cd apps/api
npm run build
```

Gera `apps/api/dist`, incluindo `dist/server.js` e código da pipeline.

### 3.4. Build do Electron

```bash
cd apps/desktop
npm run build:electron
```

Esse script executa, em ordem:

- `npm run build` (desktop) → compila `src/main.ts`/`src/preload.ts` para `dist/`
- `npm run build:frontend` → roda `npm run build` em `apps/client`
- `npm run build:api` → roda `npm run build` em `apps/api`

### 3.5. Rodar o Electron em produção (dev local)

```bash
cd apps/desktop
npm run start:electron:prod
```

O `main.ts` vai:

- Inicializar a API/pipeline embutida
- Carregar o build estático do frontend de `../client/dist/index.html`

## 4. Estrutura de diretórios de dados (SQLite, uploads, exports, logs)

Ao iniciar o app Electron, os diretórios de dados são criados automaticamente dentro de `app.getPath('userData')`:

- `data/db` → arquivo SQLite principal (`data.sqlite3`)
- `data/uploads` → arquivos de ingestão (JSONL/Excel) temporários
- `data/exports` → ZIPs e planilhas exportadas
- `data/logs` → logs de ingestão e de execução da pipeline

Esses diretórios são injetados no backend via variáveis de ambiente quando o Electron sobe a API local:

- `DB_PATH` → caminho absoluto para o arquivo SQLite
- `UPLOAD_DIR` → diretório base para uploads/ingests
- `EXPORT_DIR` → diretório base para exports
- `LOGS_DIR` → diretório base para logs

No backend (`apps/api`), esses envs são usados em:

- `db/knex.ts` → usa `DB_PATH` se definido; fallback para `apps/api/db/dev.sqlite3` em modo servidor
- `services/ExcelIngestService.ts` → usa `LOGS_DIR` e `UPLOAD_DIR` quando presentes
- `services/ConciliacaoExportService.ts` → usa `EXPORT_DIR` para gerar ZIPs

## 5. Bridge entre Electron e frontend (preload)

O preload (`src/preload.ts`) expõe um bridge seguro para o frontend via `contextBridge`:

- Objeto global: `window.appBridge`

APIs principais:

- `appBridge.getApiBaseUrl(): string`
	- Ex.: `http://localhost:3000`
	- Calculado a partir da porta da API embutida (`ELECTRON_API_PORT` ou default 3000)

O bridge mantém:

- `nodeIntegration: false`
- `contextIsolation: true`

## 6. Integração no frontend React/MUI

No frontend (`apps/client`), a camada HTTP deve resolver dinamicamente a base da API, por exemplo:

```ts
// src/lib/api.ts (exemplo)
import axios from 'axios'

declare global {
	interface Window {
		appBridge?: {
			getApiBaseUrl?: () => string
		}
	}
}

function resolveApiBaseUrl() {
	const bridgeBase = window.appBridge?.getApiBaseUrl?.()
	if (bridgeBase) return bridgeBase

	const envBase = import.meta.env.VITE_API_BASE_URL
	if (envBase) return envBase

	return 'http://localhost:3000'
}

export const api = axios.create({
	baseURL: resolveApiBaseUrl()
})
```

Assim, o frontend funciona tanto:

- **No browser** (usando `.env`/`VITE_API_BASE_URL` ou fallback local)
- **No Electron** (usando `window.appBridge.getApiBaseUrl()`)

## 7. Empacotamento com electron-builder

O empacotamento é configurado via `apps/desktop/package.json` usando `electron-builder`.

### 7.1. Scripts principais

No diretório `apps/desktop`:

```bash
# build completo (desktop + frontend + api)
npm run build:electron

# gerar instaladores para a plataforma atual
npm run dist:electron
```

O script `dist:electron` executa:

- `npm run build:electron`
- `electron-builder`

Os artefatos finais são gerados em `apps/desktop/dist-build/`:

- Windows: instalador NSIS (`.exe`)
- Linux: AppImage (`.AppImage`)
- macOS: DMG (`.dmg`)

### 7.2. Arquivos incluídos no pacote

A configuração `build` em `package.json` inclui:

- `dist/**/*` → código compilado do Electron
- `../client/dist/**/*` → build estático do React/MUI
- `../api/dist/**/*` → build da API/pipeline
- `../scripts/**/*` (via `extraResources`) → scripts auxiliares de conversão

Isso garante que o instalador gerado tem tudo necessário para rodar a conciliação offline.

## 8. Fluxo E2E offline (resumo)

1. Gerar instalador:
	 ```bash
	 cd apps/desktop
	 npm run dist:electron
	 ```
2. Instalar em uma máquina/VM limpa (sem Node, sem repo).
3. Abrir o app (sem internet) e seguir o fluxo:
	 - Upload de Base A/B
	 - Criação de configuração de conciliação
	 - Execução do job
	 - Exportação do ZIP (Base_A.xlsx + Base_B.xlsx)
4. Confirmar que todos os dados/logs/exports estão em `userData/data/...`.
