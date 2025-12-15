# Lista de arquivos em `apps/client` e propósito

Resumo dos arquivos presentes em `apps/client` (recursivamente) com breve descrição do papel de cada um.

- `apps/client/package.json`: Manifesto do cliente (scripts de build/dev, dependências, etc.).
- `apps/client/vite.config.ts`: Configuração do Vite para build e dev server.
- `apps/client/index.html`: Entrada HTML do SPA.
- `apps/client/tsconfig*.json`: Configurações TypeScript para a aplicação e ambiente Node.
- `apps/client/.env.example` / `.env.development.example` / `.env.development`: Exemplos/override de variáveis de ambiente para o app cliente.
- `apps/client/readme.md`: Notas específicas do app cliente (build, dev e integração com backend).
- `apps/client/tailwind.config.ts` / `postcss.config.js`: Configuração de TailwindCSS e PostCSS.
- `apps/client/components.json`: Lista/manifesto de componentes (ferramentas de build/IDE).

- `apps/client/public/*`: Assets públicos servidos pelo build (favicon, robots, placeholder SVG).

Src (principal):
- `apps/client/src/main.tsx`: Entrada do aplicativo React/TSX — monta a aplicação e provê providers (router, theme, toast).
- `apps/client/src/App.tsx`: Componente raiz que configura rotas e layout principal.
- `apps/client/src/index.css`: Estilos globais e importações de Tailwind/CSS.

Páginas (rotas/views):
- `apps/client/src/pages/Dashboard.tsx`: Painel principal com métricas e visão geral.
- `apps/client/src/pages/Bases.tsx`: Página de listagem e upload/gerenciamento de bases.
- `apps/client/src/pages/BaseDetails.tsx`: Visualização detalhada de uma base (preview, colunas, ingest/ações).
- `apps/client/src/pages/Conciliacoes.tsx`: Lista de jobs de conciliação e status.
- `apps/client/src/pages/ConciliacaoDetails.tsx`: Detalhes de uma conciliação específica, progressos e export.
- `apps/client/src/pages/NewConciliacao.tsx`: Formulário para criar novo job de conciliação.
- `apps/client/src/pages/ConfigConciliacao.tsx`: Listagem / gestão de `configs_conciliacao`.
- `apps/client/src/pages/ConfigEstorno.tsx`, `ConfigCancelamento.tsx`, `ConfigMapeamento.tsx`: Páginas de configuração das regras (estorno, cancelamento, mapeamento).
- `apps/client/src/pages/ConfigKeys.tsx`: Gestão de `keys_definitions`.
- `apps/client/src/pages/KeysPairs.tsx`: Gestão de pares de chaves (`keys_pairs`).
- `apps/client/src/pages/NewBase.tsx`: Tela para upload/registro de nova base e metadados.
- `apps/client/src/pages/NewConfig*` / `EditConfig*`: Formulários para criar/editar configurações.
- `apps/client/src/pages/LicenseActivate.tsx` / `LicenseBlocked.tsx`: Fluxos de ativação/verificação de licença e estado bloqueado.
- `apps/client/src/pages/NotFound.tsx`: Fallback 404 do SPA.

Componentes compartilhados:
- `apps/client/src/components/AppHeader.tsx` / `AppSidebar.tsx`: Cabeçalho e barra lateral da UI.
- `apps/client/src/components/Layout.tsx`: Layout geral com header/sidebar/content.
- `apps/client/src/components/MetricCard.tsx`, `StatusChip.tsx`, `NavLink.tsx`, `PageSkeletonWrapper.tsx`, `ThemeToggle.tsx`: componentes de UI reutilizáveis.
- `apps/client/src/components/Automcomplete.tsx`: Autocomplete para selects/inputs.

UI primitives / design system (subpasta `components/ui`):
- Vários componentes genéricos adaptados do design system: `button`, `input`, `select`, `dialog`, `dropdown-menu`, `toast`, `table`, `pagination`, `calendar`, `chart`, `tabs`, `badge`, `card`, `skeleton`, `drawer`, `sheet`, `popover`, `tooltip`, `context-menu`, `radio-group`, `checkbox`, `label`, `accordion`, `hover-card`, `carousel`, `resizable`, `sidebar` e outros.
- `apps/client/src/components/ui/use-toast.ts` e `apps/client/src/hooks/use-toast.ts`: helpers para toasts (notificações).

Serviços (API clients):
- `apps/client/src/services/api.ts`: Cliente HTTP genérico (configuração base URL, wrappers fetch/axios-like).
- `apps/client/src/services/baseService.ts`: Chamadas relacionadas a `bases` (upload, ingest, preview, derived columns).
- `apps/client/src/services/keysService.ts`: CRUD para `keys_definitions`.
- `apps/client/src/services/keysPairsService.ts`: CRUD para `keys_pairs`.
- `apps/client/src/services/configsService.ts`: Gerencia chamadas para `configs_conciliacao`, `configs_estorno`, `configs_cancelamento`, `configs_mapeamento`.
- `apps/client/src/services/conciliacaoService.ts`: Endpoints e helpers para criar/listar jobs de conciliação, consultar status e exportar resultados.
- `apps/client/src/services/licenseService.ts`: Integração para ativação/verificação de licença.
- `apps/client/src/services/maintenanceService.ts`: Endpoints de manutenção/health usados pela UI.

Hooks e utilitários:
- `apps/client/src/hooks/use-mobile.tsx`: Hook para detectar/tunar comportamento mobile/responsivo.
- `apps/client/src/hooks/use-toast.ts`: Hook local para toasts (ligado ao design system).
- `apps/client/src/lib/utils.ts`: Utilitários genéricos (formatos, parsing, helpers pequenos).
- `apps/client/src/lib/download.ts`: Helpers para download de blobs/arquivos gerados pelo backend.
- `apps/client/src/lib/mappingUtils.ts`: Funções utilitárias para trabalhar com mappings entre bases/colunas.
- `apps/client/src/lib/zod-ptbr.ts`: Schemas/validações Zod com mensagens em português.
- `apps/client/src/lib/conciliacaoStatus.ts` e `baseStatus.ts`: Enums/mapeamentos de status usados pela UI.

Types / definições:
- `apps/client/src/types/*`: Tipos TypeScript compartilhados entre componentes e serviços (keys, configs, tipos globais).

Outros arquivos de projeto:
- `apps/client/.gitignore`, `eslint.config.js`: Ignorar arquivos e configuração ESLint.

Observações finais:
- As páginas e serviços refletem diretamente as rotas e entidades do backend (`/api/*`) — portanto os nomes são autoexplicativos (bases, configs, conciliações, keys).
- Se quiser, posso:
  - gerar `apps/client/FILES_SUMMARY.json` estruturado;
  - extrair as rotas React Router usadas em `App.tsx` e criar um resumo navegável das páginas;
  - ou gerar documentação Swagger-like dos endpoints consumidos (enumerando chamadas em `services/*`).

Fim.
