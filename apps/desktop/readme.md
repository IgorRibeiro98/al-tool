# AL-Tool Desktop

<p align="center">
  <img src="https://img.shields.io/badge/Electron-39-47848F?logo=electron&logoColor=white" alt="Electron 39"/>
  <img src="https://img.shields.io/badge/Node.js-18+-339933?logo=node.js&logoColor=white" alt="Node.js"/>
  <img src="https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white" alt="TypeScript"/>
  <img src="https://img.shields.io/badge/Python-3.11+-3776AB?logo=python&logoColor=white" alt="Python"/>
</p>

Aplicação desktop do AL-Tool construída com **Electron**, que encapsula a API backend, o frontend React e o Python Worker em um executável distribuível para Windows, macOS e Linux.

---

## 📑 Índice

- [Visão Geral](#-visão-geral)
- [Arquitetura](#-arquitetura)
- [Estrutura de Diretórios](#-estrutura-de-diretórios)
- [Configuração](#-configuração)
- [Desenvolvimento](#-desenvolvimento)
- [Build de Produção](#-build-de-produção)
- [Python Worker](#-python-worker)
- [Licenciamento](#-licenciamento)
- [Diretórios de Dados](#-diretórios-de-dados)
- [Troubleshooting](#-troubleshooting)

---

## 🔎 Visão Geral

O desktop wrapper do AL-Tool oferece:

| Recurso | Descrição |
|---------|-----------|
| 📦 **Distribuível** | Executável único para cada plataforma |
| 🔌 **API Embarcada** | API Express roda dentro do Electron |
| 🎨 **Frontend Integrado** | React carregado como static files |
| 🐍 **Python Bundled** | Worker Python embutido (Windows/Linux) |
| 🔐 **Licenciamento** | Integração com serviço de licenças Revaleon |
| 💾 **Auto-contido** | Todos os dados em diretório local do usuário |

### Diferenças entre Modos

| Aspecto | Desenvolvimento | Produção |
|---------|-----------------|----------|
| Frontend | Vite dev server (:5173) | Static files bundled |
| API | Hot reload | Bundled em main.js |
| Python | Sistema (conda/venv) | Bundled runtime |
| Dados | `storage/` do projeto | `userData/` do sistema |
| Debug | DevTools aberto | DevTools fechado |

---

## 🏗️ Arquitetura

### Fluxo de Inicialização

```
┌────────────────────────────────────────────────────────────┐
│                    Electron Main Process                    │
│                                                              │
│  1. Startup                                                  │
│     ├── Verifica/cria diretórios (DATA_DIR)                 │
│     ├── Inicializa Python Worker (spawn)                    │
│     └── Inicia API Express (spawn ou inline)                │
│                                                              │
│  2. API Ready                                                │
│     ├── Roda migrations (Knex)                              │
│     ├── Serve static files (React build)                    │
│     └── Escuta em APP_PORT                                  │
│                                                              │
│  3. Window                                                   │
│     └── BrowserWindow carrega http://localhost:APP_PORT     │
└────────────────────────────────────────────────────────────┘
```

### Comunicação entre Processos

```
┌─────────────┐     IPC      ┌─────────────┐
│   Main      │◄────────────►│  Renderer   │
│  Process    │              │  (React)    │
└──────┬──────┘              └─────────────┘
       │
       ├──────► API (Express via spawn/inline)
       │        └── SQLite (better-sqlite3)
       │
       └──────► Python Worker (spawn)
                └── Converte XLSB/PDF/TXT → JSONL
```

---

## �� Estrutura de Diretórios

```
apps/desktop/
├── src/
│   ├── main.ts                 # Entry point Electron
│   ├── preload.ts              # Preload script (IPC)
│   ├── paths.ts                # Resolução de caminhos
│   ├── pythonWorker.ts         # Gerenciamento do worker
│   └── license.ts              # Integração licenciamento
├── python-runtime/             # Runtime Python bundled
│   ├── python/                 # Binários Python
│   ├── Lib/                    # Site-packages
│   └── Scripts/                # Executáveis pip, etc.
├── storage/                    # Dados em desenvolvimento
│   ├── db/                     # SQLite database
│   ├── uploads/                # Arquivos enviados
│   ├── ingests/                # JSONL processados
│   └── exports/                # ZIPs exportados
├── package.json
└── tsconfig.json
```

### Estrutura do Build

```
dist/
├── main.js                     # Main process bundled
├── preload.js                  # Preload bundled
├── renderer/                   # React build
│   ├── index.html
│   └── assets/
├── python-runtime/             # Python bundled (se aplicável)
└── package.json
```

---

## ⚙️ Configuração

### Variáveis de Ambiente

Em desenvolvimento, crie um arquivo `.env` na raiz do desktop:

```bash
# apps/desktop/.env

# Porta da API embarcada
APP_PORT=3132

# Diretório raiz de dados (desenvolvimento)
DATA_DIR=./storage

# URL do serviço de licenças
LICENSE_API_BASE_URL=https://licenses.revaleon.com.br

# Modo de execução
NODE_ENV=development
```

### Variáveis Disponíveis

| Variável | Descrição | Default (Dev) | Default (Prod) |
|----------|-----------|---------------|----------------|
| `APP_PORT` | Porta da API | `3132` | `3132` |
| `DATA_DIR` | Diretório raiz de dados | `./storage` | `app.getPath('userData')` |
| `LICENSE_API_BASE_URL` | URL do serviço de licenças | `http://localhost:3100` | `https://licenses.revaleon.com.br` |
| `NODE_ENV` | Ambiente de execução | `development` | `production` |

### Caminhos em Produção

Em produção, os dados são armazenados no diretório do usuário:

| Plataforma | Caminho |
|------------|---------|
| Windows | `%APPDATA%/al-tool/` |
| macOS | `~/Library/Application Support/al-tool/` |
| Linux | `~/.config/al-tool/` |

---

## 🚀 Desenvolvimento

### Pré-requisitos

- Node.js 18+
- npm 10+
- Python 3.11+ (com pip)
- Conda recomendado (para ambiente isolado)

### Instalação

```bash
# Na raiz do monorepo
npm install

# Configurar Python Worker
npm run python:setup
```

### Scripts Disponíveis

| Script | Comando | Descrição |
|--------|---------|-----------|
| `dev` | `npm run dev` | Inicia Electron em modo dev |
| `build` | `npm run build` | Compila TypeScript |
| `python:setup` | `npm run python:setup` | Configura ambiente Python |

### Iniciando Desenvolvimento

#### Opção 1: Desenvolvimento Completo

```bash
# Terminal 1: API em modo watch
npm run api:dev

# Terminal 2: Frontend em modo watch
npm run client:dev

# Terminal 3: Electron
npm run desktop:dev
```

#### Opção 2: Desktop Standalone

```bash
# Compila frontend para produção
npm run client:build

# Inicia desktop com API embarcada
npm run desktop:dev
```

### DevTools

Em desenvolvimento, o DevTools abre automaticamente. Para debug:

```typescript
// No main.ts
mainWindow.webContents.openDevTools();
```

---

## 📦 Build de Produção

### Preparação

1. **Build do Frontend:**
   ```bash
   npm run client:build
   ```

2. **Setup Python Runtime:**
   ```bash
   npm run python:setup
   ```

3. **Compile TypeScript:**
   ```bash
   npm run desktop:build
   ```

### Build Electron

```bash
# Windows
npm run desktop:build:win

# macOS
npm run desktop:build:mac

# Linux
npm run desktop:build:linux
```

### Configuração electron-builder

```json
// package.json do desktop
{
  "build": {
    "appId": "com.revaleon.al-tool",
    "productName": "AL-Tool",
    "directories": {
      "output": "release"
    },
    "files": [
      "dist/**/*",
      "python-runtime/**/*"
    ],
    "extraResources": [
      {
        "from": "../client/dist",
        "to": "renderer"
      },
      {
        "from": "python-runtime",
        "to": "python-runtime"
      }
    ],
    "win": {
      "target": ["nsis"],
      "icon": "icons/icon.ico"
    },
    "mac": {
      "target": ["dmg"],
      "icon": "icons/icon.icns"
    },
    "linux": {
      "target": ["AppImage", "deb"],
      "icon": "icons/icon.png"
    }
  }
}
```

### Artefatos Gerados

| Plataforma | Artefato | Localização |
|------------|----------|-------------|
| Windows | `AL-Tool Setup.exe` | `release/` |
| macOS | `AL-Tool.dmg` | `release/` |
| Linux | `AL-Tool.AppImage` | `release/` |

---

## 🐍 Python Worker

O Python Worker é responsável por converter arquivos para JSONL:

| Formato | Suporte |
|---------|---------|
| XLSB | ✅ Planilhas binárias Excel |
| XLSX | ✅ Planilhas Excel |
| PDF | ✅ PDFs com tabelas |
| TXT | ✅ Arquivos texto delimitados |

### Setup do Worker

#### Desenvolvimento (Conda)

```bash
# Criar ambiente
conda create -n al-tool-python python=3.11 -y
conda activate al-tool-python

# Instalar dependências
pip install -r scripts/requirements.txt
```

#### Desenvolvimento (venv)

```bash
# Na raiz do projeto
python -m venv .venv
source .venv/bin/activate  # Linux/macOS
# ou
.venv\Scripts\activate     # Windows

pip install -r scripts/requirements.txt
```

#### Produção (Runtime Bundled)

O script `python:setup` prepara o runtime:

```bash
# Windows
node scripts/windows/prepare_python_runtime_win.py

# Linux
node scripts/unix/bootstrap_conversion_runtime.py
```

Isso cria `apps/desktop/python-runtime/` com:
- Binários Python embeddable
- Dependências instaladas
- Scripts de conversão

### Comunicação com Worker

```typescript
// pythonWorker.ts
import { spawn } from 'child_process';

function runConversion(inputPath: string, outputPath: string) {
  const pythonPath = getPythonPath(); // Resolve caminho do Python
  const scriptPath = getScriptPath('conversion_worker.py');
  
  const proc = spawn(pythonPath, [scriptPath, inputPath, outputPath]);
  
  proc.stdout.on('data', (data) => {
    // Progresso reportado via stdout
  });
  
  proc.on('close', (code) => {
    // Conversão finalizada
  });
}
```

### Troubleshooting Python

```bash
# Verificar instalação
python --version
pip list | grep -E "openpyxl|pandas|camelot"

# Testar conversão manual
python scripts/conversion_worker.py input.xlsb output.jsonl
```

---

## 🔐 Licenciamento

O AL-Tool usa o serviço de licenças Revaleon:

### Fluxo de Licenciamento

```
┌─────────────────────────────────────────────────────────────┐
│  1. Startup                                                  │
│     └── Verifica licença local (db/license.json)            │
│                                                              │
│  2. Se não existe ou expirada                               │
│     └── Abre modal de ativação no frontend                  │
│                                                              │
│  3. Usuário insere chave                                    │
│     └── Frontend envia para API → Serviço Revaleon          │
│                                                              │
│  4. Validação OK                                            │
│     └── Salva licença localmente                            │
│     └── Libera funcionalidades                              │
└─────────────────────────────────────────────────────────────┘
```

### Verificação de Licença

```typescript
// license.ts
interface License {
  key: string;
  expiresAt: Date;
  features: string[];
  machineId: string;
}

async function checkLicense(): Promise<boolean> {
  const license = loadLocalLicense();
  
  if (!license) return false;
  if (isExpired(license)) return false;
  if (!matchesMachine(license)) return false;
  
  // Validação online periódica
  return await validateOnline(license);
}
```

### Configuração

```bash
# URL do serviço (produção)
LICENSE_API_BASE_URL=https://licenses.revaleon.com.br

# URL do serviço (desenvolvimento/staging)
LICENSE_API_BASE_URL=http://localhost:3100
```

---

## 💾 Diretórios de Dados

### Estrutura de Dados

```
DATA_DIR/
├── db/
│   └── al-tool.sqlite3         # Banco de dados
├── uploads/
│   └── <uuid>/                 # Arquivos originais por upload
│       └── arquivo.xlsb
├── ingests/
│   └── <base_id>/              # JSONL convertidos
│       └── data.jsonl
└── exports/
    └── <job_id>/               # Exportações por job
        └── evidencias.zip
```

### Limpeza de Dados

```bash
# Remover uploads antigos (> 30 dias)
find $DATA_DIR/uploads -type f -mtime +30 -delete

# Remover exports processados
find $DATA_DIR/exports -type f -mtime +7 -delete
```

### Backup

```bash
# Backup completo
tar -czf backup-$(date +%Y%m%d).tar.gz $DATA_DIR

# Backup apenas banco
cp $DATA_DIR/db/al-tool.sqlite3 backup-db.sqlite3
```

---

## �� Troubleshooting

### Problemas Comuns

#### API não inicia

```bash
# Verificar porta ocupada
lsof -i :3132          # Linux/macOS
netstat -ano | findstr :3132  # Windows

# Verificar logs
cat ~/.config/al-tool/logs/api.log
```

#### Python Worker não funciona

```bash
# Verificar Python
which python
python --version

# Testar manualmente
python scripts/conversion_worker.py --help

# Verificar dependências
pip show openpyxl pandas
```

#### Erro de permissão (Windows)

```
Executar como Administrador (primeira vez para instalar)
```

#### Banco corrompido

```bash
# Backup do banco atual
mv $DATA_DIR/db/al-tool.sqlite3 al-tool.sqlite3.bak

# O app recriará o banco na próxima execução
# Depois, importe dados se necessário
```

#### Tela branca no Electron

```bash
# Verificar se o frontend foi compilado
ls apps/client/dist/

# Recompilar se necessário
npm run client:build
```

### Logs

| Log | Localização |
|-----|-------------|
| Electron | Console do DevTools |
| API | `DATA_DIR/logs/api.log` |
| Python | `DATA_DIR/logs/python-worker.log` |

### Debug Mode

Para debug avançado:

```bash
# Iniciar com debug
DEBUG=* npm run desktop:dev

# Electron verbose
ELECTRON_ENABLE_LOGGING=1 npm run desktop:dev
```

---

## 📚 Documentação Relacionada

- [README principal](../../README.md) - Visão geral do projeto
- [API README](../api/readme.md) - Documentação da API
- [Client README](../client/readme.md) - Documentação do Frontend

---

## 🔗 Links Úteis

- [Electron Documentation](https://www.electronjs.org/docs)
- [electron-builder](https://www.electron.build/)
- [Revaleon Licensing](https://revaleon.com.br)

---

<p align="center">
  <sub>AL-Tool Desktop - <a href="https://revaleon.com.br">Revaleon</a></sub>
</p>
