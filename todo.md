# TODO - melhorias AL-Tool

## Prioridades (ordem de ataque)
1) Performance e dados: pipeline SQL set-based (ConciliacaoAB/Estorno/Cancelamento/Nulls), índices/TTL, ingest otimizada, locks/concorrência dos workers, export streaming.
2) Confiabilidade/licenciamento: migrações consolidadas (sem colunas criadas em runtime), módulo único de fingerprint/licença com timeout/retry/backoff/circuit-breaker, CORS allowlist, validação Zod e limites de payload/checksum.
3) Observabilidade/operacão: logs estruturados com request-id/jobId, métricas por etapa, painel de integridade (disco/fila/versão), health/diagnostics enriquecido e tracing simples; Electron health/backoff/lock de migrations.
4) UX front/Electron: listas com paginação/filtros, valores formatados/difference, reprocessar ingest, preview paginado, títulos dinâmicos, erros com tooltip/log; cliente HTTP com timeout/retry/trace; Sidebar/Header com branding/versão/licença/ambiente; StatusChip robusto.
5) Código compartilhado/cleanup: utilitários de chaves/mapeamentos/fingerprint em `packages/shared/domain`, erros estruturados, contratos OpenAPI/ts, deps removidas.
6) Testes/CI: suites sintéticas de steps/ingest/export, E2E completo, licenciamento/offline/revoke, worker conversão/xlsx_to_jsonl, UI (Conciliacoes/ConciliacaoDetails/BaseDetails), hooks/StatusChip/Sidebar, CI `pnpm -r lint test` + smokes shadcn.

## Plano de execução em etapas
- **Sprint 1 (núcleo de performance)**: Reescrever ConciliacaoAB set-based com índices; refatorar Estorno/Cancelamento/Nulls em lote; otimizar ingest (transação única, PRAGMAs por job, índices + ANALYZE); TTL/cleanup de result/export; locks/concorrência em workers; export streaming com métricas.
- **Sprint 2 (confiabilidade/licenciamento)**: Consolidar migracoes (jobs/export/pipeline/licença); unificar fingerprint/licensing (API/Electron) com timeout/retry/backoff/circuit-breaker e CA opcional; CORS allowlist; validação Zod + limites de payload/checksum em uploads.
- **Sprint 3 (observabilidade/operacão)**: Logs estruturados + request-id/jobId; métricas por etapa; painel de integridade (disco/fila/versão/commit); health/diagnostics enriquecido; tracing simples; Electron health-check com backoff e lock de migrations.
- **Sprint 4 (UX front/Electron)**: Paginação/filtros/busca em listas (jobs/bases/resultados); valores formatados/difference + CSV da página; reprocessar ingest e preview paginado; títulos dinâmicos e mensagens de erro com tooltip/log; cliente HTTP com timeout/retry/trace; Header/Sidebar com branding/versão/licença/ambiente; StatusChip resiliente.
- **Sprint 5 (shared/cleanup)**: Extrair utilitários para `packages/shared/domain`; erros estruturados (message/details/remediation); contratos OpenAPI/ts; remover dependências não usadas.
- **Sprint 6 (testes/CI)**: Tests sintéticos (steps/ingest/export), E2E completo (upload→ingest→conciliar→export→download), licenciamento online/offline/revoke, worker conversão/xlsx_to_jsonl, UI (Conciliacoes/ConciliacaoDetails/BaseDetails), hooks/StatusChip/Sidebar, smokes shadcn; CI `pnpm -r lint test`.

## Performance e escala do pipeline
- [ ] Reescrever `ConciliacaoABStep` para operar majoritariamente em SQL (CTEs com `GROUP BY` por chave, somas e classificacao no banco) e inserir via `INSERT ... SELECT`, eliminando o `getARow/getBRow` N+1.
- [ ] Adicionar indices dedicados em `conciliacao_result_{jobId}` (`job_id`, `chave`, `status`, `grupo`, `a_row_id`, `b_row_id`) e nas colunas dinamicas de chave para acelerar export e consultas.
- [ ] Refatorar `EstornoBaseAStep` para usar consultas agrupadas e joins (sem carregar toda a base em memoria nem loops `listA x listB`), com insercao em lote na `conciliacao_marks`.
- [ ] Ajustar `CancelamentoBaseBStep` e normalizacao de nulos (`NullsBaseA/B`) para usar updates e inserts em lote/CTE, evitando uma transacao por coluna ou por linha.
- [ ] Tornar ingestao mais rapida: envolver criacao de tabela + inserts em transacao unica, suportar `PRAGMA` otimizados por job, e evitar dupla leitura completa do JSONL quando possivel.
- [ ] Garantir criacao proativa de indices antes da conciliacao (base e chaves) e rodar `ANALYZE` apos ingest para planos de execucao melhores em bases grandes.
- [ ] Simplificar leitura de tabelas nao conciliadas (A-only/B-only) para usar `INSERT ... SELECT` com filtros `NOT IN`/`LEFT JOIN` em vez de iterar linha a linha.
- [ ] Adicionar TTL/cleanup para tabelas `conciliacao_result_*` e arquivos de export, liberando disco apos expirar o job.
- [ ] Habilitar pragma `foreign_keys=ON` e revisar PRAGMAs padrao (busy_timeout, cache_size) por ambiente; expor ajustes via env.
- [ ] Implementar paginacao/limite em consultas grandes nas rotas de listagem de jobs/bases para evitar retornos massivos.
- [ ] Cache leve de metadata de bases/configs no processo do worker para reduzir consultas repetitivas durante a pipeline.
- [ ] Considerar shards ou bancos separados por cliente/tenant para isolar I/O em cenarios com alto volume.
- [ ] Alinhar o worker de conversao (`scripts/conversion_worker.py`) com os paths da API/Electron: usar DB_PATH/DATA_DIR do runtime, busy_timeout e WAL, alem de backoff/telemetria e encerramento gracioso.
- [ ] Melhorar conversor `xlsx_to_jsonl.js`: validar sheet index, limitar linhas, medir tamanho/tempo, emitir cabecalho/meta e permitir filtro de colunas para reduzir I/O.

## Confiabilidade e consistencia
- [ ] Adicionar constraint/indice unico em `conciliacao_marks` (`base_id`, `row_id`, `grupo`) para evitar duplicidades e reduzir consultas `exists` por linha.
- [ ] Introduzir locks por base/config no worker para impedir que dois jobs conciliem a mesma base simultaneamente.
- [ ] Rodar pipeline dentro de transacoes por etapa ou checkpoints com retry/backoff, registrando falhas com contexto (config/base/chave).
- [ ] Validar configs (chaves, colunas de valor, limites) com Zod antes de iniciar a pipeline e bloquear execucao em configuracoes inconsistentes.
- [ ] Ajustar `env.ts` e resolucao de paths para nao depender de `process.cwd()` (padronizar DATA_DIR/DB_PATH/UPLOAD_DIR/EXPORT_DIR) e remover logs ruidosos em prod.
- [ ] Garantir timeout e retry exponencial nos calls de licenciamento (API cloud), incluindo suporte a proxy/offline detection e circuit-breaker para evitar travas no Electron.
- [ ] Adicionar migracao formal para colunas usadas pela licenca (id fixo=1, indices) e validar schema no boot, falhando rapido com mensagem clara.
- [ ] Fechar brechas de CORS: configurar allowlist em vez de `origin: true` por padrao.
- [ ] Adicionar limites de concorrencia no worker (tick) para nao empilhar forks quando execucoes forem lentas; incluir fila/lease com heartbeat e cancelamento.
- [ ] Criar watchdog/timeout para o worker de conversao Python e reinicio automatico se morrer.
- [ ] Validar entrada das rotas (zod) incluindo tipos de parametros e tamanhos maximos para evitar ataques de payload grande.
- [ ] Adicionar assinatura/verificacao opcional para uploads (checksum) para garantir integridade dos arquivos.
- [ ] Revisar migracoes iniciais: adicionar FKs/indices para bases/configs/jobs, campos `created_at/updated_at` consistentes, e tipos temporais adequados; remover dependencias de inserts que criam colunas em runtime.
- [ ] Consolidar migracao da tabela `license` com indices e defaults coerentes (status, datas) e validacao de schema no boot.
- [ ] Garantir que o worker de conversao use o mesmo mecanismo de lock/estado da ingestao (ingest_jobs) para evitar escrita concorrente em `bases`.

## Observabilidade e operacao
- [ ] Emitir metricas por etapa (duracao, linhas lidas, linhas marcadas, grupos gerados) e registrar tamanhos de arquivos/linhas na ingestao.
- [ ] Centralizar logs estruturados (JSON) para API, workers e Electron, com correlacao por `jobId` e rotacao em `<DATA_DIR>/logs`.
- [ ] Expor endpoint de diagnostico de filas (pendentes, em execucao, ultima execucao) e incluir versao/commit em `/health` para suporte.
- [ ] Incluir logs/telemetria especifica de licenciamento (ativacao, validacao, expiracao, ultimo erro) e refletir no front.
- [ ] Registrar PRAGMAs efetivos e tempo de execucao de `runMigrations` no boot para suporte.
- [ ] Adicionar tracing simples (request-id) passando pela API, workers e export para correlacionar logs.
- [ ] Criar painel de integridade mostrando espaco em disco, versao do app, e fila pendente.
- [ ] Incluir logs estruturados no worker de conversao (claim, caminho resolvido, duracao, bytes) e enviar estatisticas para dashboard.

## Arquitetura e codigo
- [ ] Extrair funcoes utilitarias de parsing de chaves/mapeamentos para um modulo compartilhado (`packages/shared`) para evitar duplicacao em steps/export.
- [ ] Introduzir tipos compartilhados de dominio (configs, base metadata, status) entre API, pipeline e front (usar `packages/domain`).
- [ ] Eliminar branches mortos e redundantes em `ExcelIngestService` e normalizar nomes/tipos de colunas em um unico fluxo de ingestao (Excel/JSONL).
- [ ] Adicionar migrations para todas as colunas adicionadas dinamicamente em runtime (export_progress, pipeline_stage, overrides) evitando `try/catch` ad-hoc no repositorio.
- [ ] Criar camada de servicos para `conciliacao_result` e `conciliacao_marks` encapsulando acesso ao SQLite e facilitando testes/mocks.
- [ ] Unificar licenciamento: mover logica duplicada (API vs Electron) para pacote compartilhado, adicionando cache de status e funcoes puras para grace/offline.
- [ ] Adicionar timeouts e validacoes de input nas rotas `/api/license` e nas chamadas HTTP internas (evitar travamento por rede lenta / DNS).
- [ ] Normalizar uso de `https` com agente reutilizavel e opcao de CA custom para ambientes inspecionados; evitar queda silenciosa.
- [ ] Revisar `runMigrations` no Electron: garantir que so rode uma vez por boot, com lock de arquivo para evitar corrida com API iniciada em paralelo.
- [ ] Revisar dependencias e remover pacotes nao utilizados nos workspaces para reduzir attack surface e tempo de build.
- [ ] Padronizar tratamento de erro com objeto estruturado (message, details, remediation) em todas as rotas.
- [ ] Documentar contratos de dados (API e eventos) em um unico lugar e gerar tipos automaticamente (OpenAPI/ts). 
- [ ] Ajustar cliente HTTP (`apps/client/src/services/api.ts`) para incluir timeout, retry/backoff e headers de trace; evitar dependencia de slash final na base URL.

## Frontend e Electron
- [ ] Tratar estados de licenca no front com skeleton/toast dedicados e mensagens offline (usar cache curto no `LicenseGate`).
- [ ] No Electron, mover validacao/licensing para thread separada ou promessa com timeout e mostrar feedback quando backend levar mais tempo para subir.
- [ ] Adicionar tela de diagnostico (env efetivo, paths, versao) servida pela API e acessivel pelo front para suporte em campo.
- [ ] Blindar front em caso de erro na `LicenseGate` (hoje `isError` deixa prosseguir): exibir rota de bloqueio ou retry com backoff.
- [ ] Exibir expiracao e ultimo erro de licenca no UI, permitindo reativacao manual e logs baixaveis.
- [ ] No Electron, adicionar timeout/health-check com backoff para API e worker de conversao, e matar child process na troca de perfil/dado.
- [ ] Melhorar UX de listas grandes (jobs, bases) com paginacao e filtros server-side; DataGrid com colunas dinamicas deve suportar lazy-load.
- [ ] Adicionar estado de carregamento/export em cards e botao de download com retry e contagem regressiva.
- [ ] Exibir alerta quando espaco em disco estiver baixo (dados de diagnostico) antes de iniciar ingestao/conciliação.
- [ ] Em `Conciliacoes`, exibir nome da config real (nao o mesmo `job.nome`), mostrar pipeline stage detalhado e oferecer filtro/busca; paginar para muitos jobs.
- [ ] Adicionar confirmacao de exclusao com resumo de impacto (linhas, espaco) e opcao de cancelar jobs em execucao.
- [ ] Em `ConciliacaoDetails`, exibir nome correto da configuração (hoje texto fixo "Conciliação Janeiro 2024"), incluir filtros adicionais (grupo/chave), coluna de valores formatados e download direto quando export_status DONE.
- [ ] Em `BaseDetails`, mostrar progresso e status do ingest job, botao de reprocessar/reenfileirar ingest, e avisar quando preview for grande; paginar preview.
- [ ] Padronizar truncamento/tooltip de erros longos em cards (base/conversao/ingestao) e links para logs.
- [ ] Validar `mappingUtils` (auto-map) quando colunas são duplicadas ou faltantes; oferecer UI para limpar/resetar mapeamentos.
- [ ] Em UI de resultados da conciliação, formatar valores monetários e mostrar `difference`; permitir copiar/exportar página atual em CSV.
- [ ] Corrigir fingerprints duplicados: mover geração para função pura compartilhada e validar no Electron e API para consistência.
- [ ] Tornar `StatusChip` tolerante a valores desconhecidos com legenda legível e tooltip do status original; mapear cores por categoria (pipeline/export/licença).
- [ ] Deixar `AppHeader`/branding dinâmico via config (nome da empresa/instância) e incluir status de licença/ambiente (dev/prod) visível.
- [ ] `AppSidebar`: destacar rota ativa, expandir grupos em mobile, e esconder itens não permitidos conforme licença/role futura.
- [ ] `useIsMobile`: usar ResizeObserver ou throttle para evitar leaks e considerar SSR-safe guard.
- [ ] Ajustar `Sidebar` (componentes ui/sidebar): expor prop de persistência opcional (evitar cookie em ambientes sensíveis), melhorar acessibilidade (ARIA) e reduzir listeners globais; permitir largura custom.
- [ ] Botões/Inputs (ui/button, input, etc.): adicionar `data-testid` e estados de loading desabilitado para operações longas.
- [ ] Mostrar versão/licença no Header/Sidebar e incluir indicador de ambiente (dev/prod) com cores.

## Testes e qualidade
- [ ] Criar suites de teste para cada step da pipeline com bases sinteticas (estorno, cancelamento, chaves multiplas, limites imateriais) e verificacao de status/grupo.
- [ ] Adicionar testes de ingestao (Excel/JSONL) cobrindo inferencia de tipos, mapeamento de colunas, cleanup e indices criados.
- [ ] Incluir smoke/E2E: criacao de configs -> ingestao -> conciliacao -> export -> download no cliente React e start do Electron.
- [ ] Automatizar benchmarks com bases grandes (100k+ linhas) para medir tempo de ingestao/concilicao/export e guiar otimizacoes futuras.
- [ ] Escrever testes de licenca (ativacao, validacao, grace offline) simulando API de licenciamento fake e verificando estados finais.
- [ ] Cobrir `runMigrations`/boot do Electron com teste de integracao que verifica criacao de pastas e logs em `userData`.
- [ ] Adicionar testes de rotas `/api/license` offline/erro de rede, assegurando mensagens claras para o front.
- [ ] Linter/formatter compartilhado (ESLint/Prettier) aplicado a todos os pacotes e CI com `pnpm -r lint test`.
- [ ] Criar testes do worker de conversao (paths resolvidos, arquivo inexistente, erro do conversor) e do util `xlsx_to_jsonl.js` (sheet index, dados numericos, linhas vazias).
- [ ] Adicionar testes de UI para `Conciliacoes`/`ConciliacaoDetails`/`BaseDetails` (paginacao, filtros, export, delete) usando mocks da API.
- [ ] Testar `mappingUtils` (auto-map, serialize) cobrindo colunas duplicadas, vazias e reset de mapeamentos.
- [ ] Testar `machineFingerprint` e licenciamento no Electron com envs simulados (sem LICENSE_API_BASE_URL, token ausente, expirado, revoke) e retries com timeout.
- [ ] Testar hooks utilitários (`useIsMobile`) e componentes básicos (StatusChip, Sidebar, Header) com variações de estado/tema.
- [ ] Adicionar smoke de componentes shadcn (button/input/select/sidebar) para garantir renderização e variantes.
