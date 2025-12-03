# AL-Tool API — Configuração de .env

A API carrega automaticamente o arquivo `.env` localizado em `apps/api/.env` em tempo de execução, antes de avaliar qualquer módulo que leia variáveis de ambiente.

## Como funciona

- Bootstrap em `src/env.ts` executa `dotenv.config({ path: path.resolve(__dirname, '../.env') })`.
- `src/server.ts` importa `./env` como primeira instrução, garantindo que as variáveis estejam disponíveis para `paths.ts` e demais módulos.

## Variáveis suportadas

- `APP_PORT`: porta do servidor HTTP. Padrão: `3000` (ou valor enviado pelo Electron)
- `DATA_DIR`: diretório raiz de dados (db/uploads/exports)
- `DB_PATH`: caminho completo do arquivo SQLite. Padrão: `<DATA_DIR>/db/dev.sqlite3`
- `UPLOAD_DIR`: `<DATA_DIR>/uploads` (padrão)
- `EXPORT_DIR`: `<DATA_DIR>/exports` (padrão)
- `CORS_ORIGIN`: origens permitidas (ex.: `*` ou `https://exemplo.com`)

## Precedência em tempo de execução

1. Variáveis definidas no processo (ex.: export no shell, env do Electron)
2. Valores do arquivo `apps/api/.env`
3. Defaults internos do `paths.ts`

Observação: Se o Electron definir `DATA_DIR`/`APP_PORT` via env, esses valores têm precedência sobre o `.env`.

## Dicas de desenvolvimento

- Verifique o `DATA_DIR` efetivo via:

```bash
curl http://localhost:3000/health
```

- Aplique migrations para o `DATA_DIR` em uso (exemplo com o `DATA_DIR` do Electron):

```bash
DATA_DIR=/home/igor/.config/Electron/data \
npm --workspace=apps/api run migrate
```

- Para forçar um `DB_PATH` específico:

```bash
DATA_DIR=/caminho/data DB_PATH=/caminho/data/db/app.sqlite3 \
npm --workspace=apps/api run migrate
```

## Cliente integrado

- A API agora serve o build de `apps/client/dist` na raiz (`/`). Basta gerar o build e abrir `http://localhost:<APP_PORT>/` para receber o `index.html` e os assets.
- O backend continua respondendo as rotas sob `/api/...`, portanto requisições de dados não precisam de proxy adicional.
- Antes de subir a API (ou o Electron), gere os assets com `npm run build --workspace=apps/client` ou `npm run client:build` na raiz.

## Erros comuns

- "no such table": rode migrations apontando para o mesmo `DATA_DIR` que a API está usando.
- Módulo nativo SQLite (better-sqlite3): em produção, o instalador inclui rebuild; em dev, o Electron spawna a API com `node` para evitar mismatch de ABI.
