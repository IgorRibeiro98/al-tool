# AL-Tool Frontend

<p align="center">
  <img src="https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=black" alt="React 18"/>
  <img src="https://img.shields.io/badge/Vite-5.x-646CFF?logo=vite&logoColor=white" alt="Vite"/>
  <img src="https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white" alt="TypeScript"/>
  <img src="https://img.shields.io/badge/Tailwind-3.x-06B6D4?logo=tailwindcss&logoColor=white" alt="Tailwind"/>
</p>

Frontend React moderno do AL-Tool, oferecendo uma interface intuitiva para gerenciamento de bases, configuração de conciliações, acompanhamento de jobs em tempo real e exportação de resultados.

---

## 📑 Índice

- [Visão Geral](#-visão-geral)
- [Tecnologias](#-tecnologias)
- [Estrutura de Diretórios](#-estrutura-de-diretórios)
- [Configuração](#-configuração)
- [Desenvolvimento](#-desenvolvimento)
- [Build de Produção](#-build-de-produção)
- [Páginas e Funcionalidades](#-páginas-e-funcionalidades)
- [Componentes Principais](#-componentes-principais)
- [Serviços e API](#-serviços-e-api)
- [Estado e Data Fetching](#-estado-e-data-fetching)
- [Estilização](#-estilização)
- [Integração com Backend](#-integração-com-backend)

---

## 🔎 Visão Geral

O frontend do AL-Tool é uma **Single Page Application (SPA)** que:

- Permite upload e gerenciamento de bases contábeis e fiscais
- Oferece interface para configuração de chaves e regras de conciliação
- Exibe progresso de jobs em tempo real com polling automático
- Visualiza resultados de conciliação em grids de alto volume
- Permite exportação e download de evidências em ZIP

### Características

| Recurso | Descrição |
|---------|-----------|
| 🎨 **UI Moderna** | shadcn-ui + Tailwind CSS |
| 📊 **Alto Volume** | MUI DataGrid para milhares de linhas |
| ⚡ **Tempo Real** | Polling automático de jobs |
| 🔔 **Notificações** | Toast notifications (Sonner) |
| 📱 **Responsivo** | Layout adaptável a diferentes telas |

---

## 🛠️ Tecnologias

### Core

| Tecnologia | Versão | Uso |
|------------|--------|-----|
| React | 18.x | Framework UI |
| Vite | 5.x | Build tool e dev server |
| TypeScript | 5.x | Tipagem estática |
| React Router | 6.x | Navegação SPA |

### UI/UX

| Tecnologia | Uso |
|------------|-----|
| Tailwind CSS | Estilização utility-first |
| shadcn-ui | Componentes Radix + Tailwind |
| MUI DataGrid | Tabelas de alto volume |
| Lucide React | Ícones |
| Sonner | Toast notifications |

### Estado e Data

| Tecnologia | Uso |
|------------|-----|
| React Query (TanStack) | Server state management |
| Axios | Cliente HTTP |
| React Hook Form | Formulários |
| Zod | Validação de schemas |

---

## 📁 Estrutura de Diretórios

\`\`\`
apps/client/
├── public/                     # Assets estáticos
├── src/
│   ├── components/             # Componentes reutilizáveis
│   │   ├── ui/                 # Componentes shadcn-ui
│   │   └── ...                 # Componentes do app
│   ├── hooks/                  # Custom hooks
│   ├── lib/                    # Utilitários e helpers
│   │   ├── utils.ts            # Funções utilitárias
│   │   └── conciliacaoStatus.ts
│   ├── pages/                  # Páginas da aplicação
│   │   ├── Bases.tsx
│   │   ├── BaseDetails.tsx
│   │   ├── Conciliacoes.tsx
│   │   ├── ConciliacaoDetails.tsx
│   │   └── ...
│   ├── services/               # Camada de API
│   │   ├── api.ts              # Cliente Axios configurado
│   │   ├── baseService.ts
│   │   ├── conciliacaoService.ts
│   │   └── ...
│   ├── App.tsx                 # Componente raiz
│   ├── main.tsx                # Entry point
│   └── index.css               # Estilos globais
├── .env.development            # Env de desenvolvimento
├── .env.production             # Env de produção
├── components.json             # Configuração shadcn-ui
├── tailwind.config.ts          # Configuração Tailwind
├── vite.config.ts              # Configuração Vite
├── tsconfig.json               # Configuração TypeScript
└── package.json
\`\`\`

---

## ⚙️ Configuração

### Variáveis de Ambiente

Crie arquivos \`.env\` conforme o ambiente:

#### Desenvolvimento (\`.env.development\`)

\`\`\`bash
# URL base da API (deve apontar para a API local)
VITE_API_BASE_URL=http://localhost:3000/api
\`\`\`

#### Produção (\`.env.production\`)

\`\`\`bash
# Em produção, o frontend é servido pela API
# Use caminho relativo
VITE_API_BASE_URL=/api
\`\`\`

### Variáveis Disponíveis

| Variável | Descrição | Default |
|----------|-----------|---------|
| \`VITE_API_BASE_URL\` | URL base da API REST | \`http://localhost:3000/api\` |

> **Nota:** Variáveis no Vite devem ter prefixo \`VITE_\` para serem expostas ao client.

### Arquivo Local (\`.env.local\`)

Para sobrescrever configurações localmente:

\`\`\`bash
# apps/client/.env.local
VITE_API_BASE_URL=http://localhost:3132/api
\`\`\`

---

## 🚀 Desenvolvimento

### Pré-requisitos

- Node.js 18+
- npm 10+
- API rodando (ver [API README](../api/readme.md))

### Instalação

\`\`\`bash
# Na raiz do monorepo
npm install
\`\`\`

### Scripts Disponíveis

| Script | Comando | Descrição |
|--------|---------|-----------|
| \`dev\` | \`npm run dev\` | Inicia dev server (hot reload) |
| \`build\` | \`npm run build\` | Compila para produção |
| \`build:dev\` | \`npm run build:dev\` | Compila em modo desenvolvimento |
| \`preview\` | \`npm run preview\` | Preview do build de produção |
| \`lint\` | \`npm run lint\` | Executa ESLint |

### Iniciando o Desenvolvimento

\`\`\`bash
# Terminal 1: Iniciar API
npm run api:dev

# Terminal 2: Iniciar Frontend
npm run client:dev

# Ou usando workspace diretamente:
npm --workspace=apps/client run dev
\`\`\`

O dev server estará disponível em **http://localhost:5173** (ou porta alternativa se ocupada).

### Hot Module Replacement (HMR)

O Vite oferece HMR ultrarrápido. Alterações em componentes são refletidas instantaneamente no browser sem perder estado.

---

## 📦 Build de Produção

### Gerando Build

\`\`\`bash
npm run client:build
# ou
npm --workspace=apps/client run build
\`\`\`

O build será gerado em \`apps/client/dist/\`.

### Estrutura do Build

\`\`\`
dist/
├── assets/
│   ├── index-[hash].js
│   ├── index-[hash].css
│   └── ...
├── index.html
└── ...
\`\`\`

### Servindo em Produção

Em produção, a **API serve o frontend**:

1. A API carrega \`apps/client/dist\` como static files
2. Rotas não-API retornam \`index.html\` (SPA fallback)
3. O frontend usa \`/api\` como base URL

---

## 📄 Páginas e Funcionalidades

### Estrutura de Navegação

\`\`\`
/                       # Dashboard (Home)
/bases                  # Lista de bases
/bases/:id              # Detalhes de uma base
/conciliacoes           # Lista de jobs de conciliação
/conciliacoes/:id       # Detalhes e resultados de um job
/configs                # Configurações gerais
/configs/conciliacao    # Configurações de conciliação
/configs/estorno        # Configurações de estorno
/configs/cancelamento   # Configurações de cancelamento
/configs/mapeamento     # Mapeamentos de colunas
/keys                   # Definições de chaves
/license                # Licenciamento
\`\`\`

### Página: Bases

Funcionalidades:
- Listagem paginada de bases
- Filtros por tipo (CONTABIL/FISCAL), período, subtipo
- Upload de novos arquivos
- Status de ingestão em tempo real
- Exclusão de bases

### Página: Detalhes da Base

Funcionalidades:
- Visualização de metadados
- Grid com dados da base (paginação server-side)
- Lista de colunas detectadas
- Status do job de ingestão

### Página: Conciliações

Funcionalidades:
- Listagem paginada de jobs
- Filtros por status (PENDING, RUNNING, DONE, FAILED)
- Criação de novos jobs
- Status e progresso em tempo real
- Ações: ver detalhes, exportar, baixar

### Página: Detalhes da Conciliação

Funcionalidades:
- Informações do job e configurações usadas
- Progresso do pipeline (etapas e %)
- Grid de resultados com filtros
- Métricas agregadas (totais por status)
- Botão de exportação
- Download do ZIP quando pronto

---

## 🧩 Componentes Principais

### Componentes UI (shadcn-ui)

Localizados em \`src/components/ui/\`:

| Componente | Uso |
|------------|-----|
| Button | Botões estilizados |
| Card | Cards e containers |
| Dialog | Modais |
| Input | Campos de entrada |
| Select | Dropdowns |
| Table | Tabelas simples |
| Toast | Notificações |
| Progress | Barras de progresso |
| Skeleton | Loading placeholders |
| Badge | Labels e tags |

### Componentes do App

| Componente | Descrição |
|------------|-----------|
| DataGrid | Wrapper do MUI DataGrid |
| FileUpload | Upload com drag-and-drop |
| StatusBadge | Badges coloridos por status |
| ProgressBar | Barra de progresso estilizada |
| Pagination | Controles de paginação |
| FilterBar | Barra de filtros |

### Exemplo de Uso

\`\`\`tsx
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { StatusBadge } from '@/components/StatusBadge';

function JobCard({ job }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{job.nome}</CardTitle>
      </CardHeader>
      <CardContent>
        <StatusBadge status={job.status} />
        <Button onClick={() => handleExport(job.id)}>
          Exportar
        </Button>
      </CardContent>
    </Card>
  );
}
\`\`\`

---

## 🔌 Serviços e API

### Cliente HTTP

O cliente Axios está configurado em \`src/services/api.ts\`:

\`\`\`typescript
import axios from 'axios';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || '/api',
  timeout: 30000,
});

export default api;
\`\`\`

### Serviços Disponíveis

#### baseService.ts

\`\`\`typescript
// Listar bases
const bases = await baseService.list({ page: 1, pageSize: 20, tipo: 'CONTABIL' });

// Detalhes
const base = await baseService.getById(1);

// Upload
const result = await baseService.upload(file, { tipo: 'FISCAL', nome: 'Base X' });

// Dados
const data = await baseService.getData(1, { page: 1, pageSize: 50 });

// Excluir
await baseService.delete(1);
\`\`\`

#### conciliacaoService.ts

\`\`\`typescript
// Listar jobs
const jobs = await conciliacaoService.list({ page: 1, status: 'DONE' });

// Criar job
const job = await conciliacaoService.create({
  configConciliacaoId: 1,
  nome: 'Conciliação Janeiro'
});

// Detalhes
const job = await conciliacaoService.getById(1);

// Resultados
const results = await conciliacaoService.getResults(1, { page: 1, pageSize: 50 });

// Exportar
await conciliacaoService.export(1);

// Download
const blob = await conciliacaoService.download(1);
\`\`\`

---

## 📊 Estado e Data Fetching

### React Query

O projeto usa **TanStack React Query** para gerenciamento de estado do servidor:

\`\`\`typescript
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

// Buscar dados
const { data, isLoading, error } = useQuery({
  queryKey: ['bases', filters],
  queryFn: () => baseService.list(filters),
});

// Mutação com invalidação
const queryClient = useQueryClient();
const mutation = useMutation({
  mutationFn: baseService.delete,
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: ['bases'] });
  },
});
\`\`\`

### Polling Automático

Para jobs em processamento, o frontend faz polling automático:

\`\`\`typescript
const { data: job } = useQuery({
  queryKey: ['job', jobId],
  queryFn: () => conciliacaoService.getById(jobId),
  refetchInterval: (data) => {
    // Polling enquanto job estiver em execução
    if (data?.status === 'PENDING' || data?.status === 'RUNNING') {
      return 2000; // Poll a cada 2 segundos
    }
    if (data?.export_status === 'IN_PROGRESS') {
      return 3000; // Poll exportação a cada 3 segundos
    }
    return false; // Parar polling
  },
});
\`\`\`

### Helpers de Status

\`\`\`typescript
import { shouldPollJob, isJobExporting, getStatusLabel } from '@/lib/conciliacaoStatus';

// Verificar se deve fazer polling
if (shouldPollJob(job)) {
  // Continuar polling
}

// Verificar se está exportando
if (isJobExporting(job)) {
  // Mostrar progresso de exportação
}

// Obter label amigável
const label = getStatusLabel(job.status); // "Concluído"
\`\`\`

---

## 🎨 Estilização

### Tailwind CSS

O projeto usa **Tailwind CSS** com configuração customizada:

\`\`\`typescript
// tailwind.config.ts
export default {
  darkMode: ['class'],
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        border: 'hsl(var(--border))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: { /* ... */ },
        secondary: { /* ... */ },
        // ...
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
};
\`\`\`

### CSS Variables

Cores são definidas via CSS variables para suportar temas:

\`\`\`css
/* src/index.css */
:root {
  --background: 0 0% 100%;
  --foreground: 222.2 47.4% 11.2%;
  --primary: 222.2 47.4% 11.2%;
  /* ... */
}

.dark {
  --background: 224 71% 4%;
  --foreground: 213 31% 91%;
  /* ... */
}
\`\`\`

### Convenções de Estilização

\`\`\`tsx
// ✅ Usando Tailwind
<div className="flex items-center gap-4 p-4 bg-background rounded-lg border">
  <span className="text-sm text-muted-foreground">Label</span>
  <Badge variant="success">Conciliado</Badge>
</div>

// ✅ Usando cn() para condicionais
import { cn } from '@/lib/utils';

<button
  className={cn(
    'px-4 py-2 rounded-md',
    isActive ? 'bg-primary text-primary-foreground' : 'bg-secondary'
  )}
>
  Click
</button>
\`\`\`

---

## 🔗 Integração com Backend

### Fluxo de Dados

\`\`\`
Frontend (React)
     ↓ HTTP
API (Express)
     ↓ Knex
SQLite
\`\`\`

### Contrato de API

O frontend espera respostas no formato:

\`\`\`typescript
// Listagem paginada
interface PaginatedResponse<T> {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  data: T[];
}

// Erros
interface ErrorResponse {
  error: string;
  details?: string;
}
\`\`\`

### Tratamento de Erros

\`\`\`typescript
import { toast } from 'sonner';

try {
  await conciliacaoService.create(data);
  toast.success('Conciliação criada com sucesso!');
} catch (error) {
  const message = error.response?.data?.error || 'Erro ao criar conciliação';
  toast.error(message);
}
\`\`\`

---

## 📚 Documentação Relacionada

- [README principal](../../README.md) - Visão geral do projeto
- [API README](../api/readme.md) - Documentação da API
- [Desktop README](../desktop/readme.md) - Documentação do Electron

---

<p align="center">
  <sub>AL-Tool Frontend - <a href="https://revaleon.com.br">Revaleon</a></sub>
</p>
