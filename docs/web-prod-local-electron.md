# Guia "Web Prod Local"

> Objetivo: reproduzir em uma máquina local a mesma experiência servida em produção (API + frontend buildado), consumindo tudo via navegador ou via shell Electron.

## Checklist rápido

- `npm run prod:web-local` → executa todo o fluxo automaticamente (build completo, backend produção e abertura do Electron ou navegador).

> Dicas: use `USE_ELECTRON=1 npm run prod:web-local` para abrir via Electron, `SKIP_BUILD=1` se já rodou `build:prod` e `NO_UI=1` para apenas subir o backend sem abrir interface automaticamente.

Para entender o que o script faz (ou executar manualmente cada etapa), siga as seções abaixo.

## 1. Preparar o ambiente

```bash
cd /var/www/html/al-tool/al-tool
npm install
```

- Node.js 18 ou superior é obrigatório.
- O comando instala dependências para API, frontend, pacote de pipeline e Electron. Rode novamente sempre que houver alterações no `package-lock.json`.

## 2. Gerar artefatos de produção

```bash
npm run build:prod
```

Esse script encadeia:
- `build:pipeline`: compila `packages/pipeline/src` para `packages/pipeline/dist` (steps TypeScript usados pela conciliação na API).
- `build:front`: gera `apps/client/dist` com o bundle React (Vite).
- `build:api`: compila `apps/api/src` para `apps/api/dist`.

Ao final existem três diretórios prontos para servir: `packages/pipeline/dist`, `apps/client/dist` e `apps/api/dist`.

## 3. Iniciar o backend unificado

```bash
NODE_ENV=production APP_PORT=3131 npm --workspace=apps/api start
```

O que acontece:
- `dist/main.js` habilita CORS, monta a API em `/api` e publica o React buildado na raiz (`/`).
- SQLite, uploads e exports usam `storage/` (configurável via `.env` raiz ou `apps/api/.env`).
- Workers de ingest e conciliação sobem automaticamente e seguem usando a mesma base.

Verificações úteis:

```bash
curl http://localhost:3131/health
curl -I http://localhost:3131        # deve retornar 200 com o index.html
tail -f apps/api/logs/*.log          # monitora ingest e conciliação
```

Para encerrar o backend pressione `Ctrl+C`. Os dados permanecem em `storage/` até que você os remova manualmente.

## 4. Consumir a UI

### Navegador
Com o backend rodando, abra `http://localhost:3131` em qualquer navegador. A aplicação React é entregue diretamente pelo Express, sem servidor adicional de frontend.

### Shell Electron (opcional)

```bash
USE_ELECTRON=1 npm run app:desktop
```

O launcher (`scripts/launcher.ts`):
- Checa `http://localhost:3131/health`. Se não responder, inicia `npm run app:local` (modo dev) e aguarda ficar pronto.
- Quando o backend responde com 200, abre o Electron apontando para `http://localhost:3131`.
- Ao fechar a janela Electron, o backend continua rodando (encerre-o manualmente quando desejar).

## 5. Fluxo recomendado

1. `npm run build:prod` sempre que houver alterações na API, pipeline ou frontend.
2. Terminal A: `NODE_ENV=production APP_PORT=3131 npm --workspace=apps/api start`.
3. Terminal B: `USE_ELECTRON=1 npm run app:desktop` **ou** apenas abra o navegador em `http://localhost:3131`.
4. Trabalhe normalmente; quando terminar, feche a janela Electron (se estiver aberta) e finalize o backend com `Ctrl+C`.

## 6. Dicas e troubleshooting

- **Diretório de dados limpo:** pare o backend e remova `storage/` para começar do zero (migrations serão reaplicadas quando a API subir novamente).
- **Porta ocupada:** ajuste `APP_PORT` no comando de start ou no `.env` raiz e repita o processo completo.
- **Build desatualizado:** se o Electron abrir e mostrar assets antigos, rode `npm run build:prod` novamente antes de iniciar o backend.
- **Logs:** arquivos em `apps/api/logs/` ajudam a debugar ingest, conciliação e exportação.
- **Variáveis extras:** defina `CORS_ORIGIN`, `APP_DATA_DIR` e demais ajustes em `.env` conforme necessário; o backend de produção local respeita as mesmas regras do ambiente real.

Seguindo este roteiro você reproduz a experiência "web prod" inteiramente na máquina local, com o frontend servido pela própria API e a opção de encapsular tudo em uma janela Electron.