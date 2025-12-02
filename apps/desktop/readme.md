# AL-Tool Desktop (Electron)

Este app Electron encapsula a UI e a API local, iniciando o backend como processo filho e abrindo a interface somente após o health-check responder.

## Requisitos

- Node.js 18+
- Dependências instaladas no monorepo (`npm install` na raiz)

## Desenvolvimento (dev)

1) Compile a API para gerar `apps/api/dist/server.js`:

```bash
npm run api:build
```

2) Rode o Electron em modo dev:

```bash
npm run desktop:dev
```

Fluxo em dev:
- O Electron calcula `DATA_DIR` usando `app.getPath('userData')`.
- Spawna `apps/api/dist/server.js` com envs:
  - `APP_PORT` (default `3000`)
  - `DATA_DIR` (pasta de dados do usuário)
- Aguarda `http://localhost:APP_PORT/health` ficar ativo.
- Abre a janela carregando `http://localhost:APP_PORT`.
- Em caso de falha no health-check (timeout), mostra uma página de erro amigável.

Verificações úteis:

```bash
curl http://localhost:3000/health
# Abra http://localhost:3000 no navegador
```

Logs:
- O stdout/stderr do backend é encaminhado para o console do Electron com prefixo `[api]`.
- O app encerra o backend (SIGINT) ao fechar a janela.
- Em dev a janela do Electron abre diretamente o `apps/client` dev server (`http://localhost:8080`). Não é necessário que o Electron suba a API nem use os builds.

Fluxo dev completo:

- `npm --workspace=apps/api run dev` (API em http://localhost:3000)
- `npm --workspace=apps/client run dev` (UI em http://localhost:8080)
- `npm --workspace=apps/desktop run dev` (Electron carrega o dev server do client)

Variáveis de ambiente (opcionais):
- `APP_PORT` — porta da API (padrão: `3000`).
- `DATA_DIR` — pode ser definido manualmente; quando ausente, o Electron usa `userData/data`.
- A API também aceita `DB_PATH`, `UPLOAD_DIR`, `EXPORT_DIR` (por padrão derivadas de `DATA_DIR`).

## Build de produção (installer)

Gerar instalador com Electron Builder (inclui backend compilado):

```bash
npm run app:dist
```

Este comando:
- `npm run api:build` — compila a API para `apps/api/dist`.
- `npm run client:build` — gera `apps/client/dist` que será servido pela API.
- `npm --workspace=apps/desktop run build` — compila o main do Electron para `apps/desktop/dist`.
- `npm --workspace=apps/desktop run dist` — empacota com `electron-builder`, copiando `apps/api/dist` para `resources/api/dist`.

- Execução empacotada:
- O Electron usa `process.resourcesPath/api/server.js` para iniciar o backend.
- Paths de dados são resolvidos via `app.getPath('userData')` (`DATA_DIR = <userData>/data`).
- O app aguarda o `/health` antes de abrir a UI.

Nota sobre .env da API:
- A API agora carrega automaticamente `apps/api/.env` na inicialização (via `src/env.ts`).
- Valores passados pelo Electron (ex.: `DATA_DIR`, `APP_PORT`) têm precedência sobre o `.env`.

## Troubleshooting

- Health-check não responde:
  - Aguarde até ~20s. Se falhar, verifique os logs `[api]` no console do app.
  - Cheque se `apps/api/dist/server.js` existe (rode `npm run api:build`).
- Porta ocupada:
  - Defina `APP_PORT` antes de rodar (`APP_PORT=3132 npm run desktop:dev`).
- Dados corrompidos/migrations:
  - Remova o conteúdo do `DATA_DIR` (pasta `userData/data`) e reinicie. A API recria a base.

## DATA_DIR no Electron

- Padrão em runtime: o Electron define `DATA_DIR = path.join(app.getPath('userData'), 'data')`.
  - Em Linux geralmente: `/home/<usuario>/.config/Electron/data`
  - Isso garante permissões de escrita, isolamento por usuário e compatibilidade com o instalador.

- Como descobrir o `DATA_DIR` efetivo:
```bash
curl http://localhost:3000/health
# Resposta inclui { dataDir: "..." }
```

- Rodar migrations para o mesmo `DATA_DIR` usado pelo Electron:
```bash
DATA_DIR=/home/<usuario>/.config/Electron/data \
npm --workspace=apps/api run migrate
```

- Opcional (copiar DB do repo para o DATA_DIR):
```bash
mkdir -p /home/<usuario>/.config/Electron/data/db
cp apps/api/db/dev.sqlite3 /home/<usuario>/.config/Electron/data/db/dev.sqlite3
```

- Observações importantes:
  - A API carrega `apps/api/.env`, mas valores enviados pelo Electron têm precedência.
  - Por padrão, o Electron sempre injeta `DATA_DIR` do `userData` em dev e produção.
  - Se precisar forçar outro caminho em desenvolvimento, altere `apps/desktop/src/main.ts` para respeitar `process.env.DATA_DIR` quando definido (ex.: `DATA_DIR: process.env.DATA_DIR || dataDir`).

### Módulo nativo `better-sqlite3` (erro NODE_MODULE_VERSION)

Em produção o backend é iniciado pelo executável do Electron, que embute uma versão de Node diferente da versão usada no seu terminal. Módulos nativos precisam ser recompilados para o ABI do Electron.

Sintoma: `ERR_DLOPEN_FAILED` / `Module did not self-register` / versão esperada de `NODE_MODULE_VERSION` diferente.

Dev (solução rápida): usamos o Node do sistema para spawn do backend — isso evita rebuild.

Produção / Rebuild necessário:
```bash
npm install --save-dev electron-rebuild
npx electron-rebuild -w better-sqlite3
```

Script opcional pós-install no `package.json` raiz:
```json
"scripts": { "postinstall": "electron-rebuild -w better-sqlite3 || true" }
```

Se persistir:
```bash
rm -rf node_modules
npm install
npx electron-rebuild -w better-sqlite3 -f
```

Verifique ABI:
```bash
node -p "process.versions.modules"
electron -p "process.versions.modules"
```

## Estrutura relevante

- `apps/desktop/src/main.ts` — main process do Electron (spawn do backend, health-check, janela).
- `apps/desktop/package.json` — scripts `dev`, `build`, `dist` e config do `electron-builder`.
- `apps/api/src/server.ts` — entrypoint único da API (serve `/api` e UI buildada em produção).
- `apps/api/src/config/paths.ts` — centraliza `DATA_DIR`, `DB_PATH`, `UPLOAD_DIR`, `EXPORT_DIR`.

## Próximos passos

- Adicionar ícones em `apps/desktop/build/` e configurar no `electron-builder`.
- (Opcional) Persistir logs do backend em arquivo dentro de `<userData>/logs`.