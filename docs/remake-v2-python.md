# Remake AL-Tool v2 — Backend Python + DuckDB

> **Substitui** o backend proposto em [remake-completo.md](remake-completo.md) (que era um refactor Node).
> Domínio, regras de negócio e o plano do client daquele doc continuam válidos.
>
> **Decisões travadas:**
> 1. Backend **Python (FastAPI) + DuckDB + Polars**. Frontend React **congelado** (byte-a-byte) durante o rewrite; melhorias drásticas (incl. Electron→Tauri) no roadmap §11.
> 2. Camada de IA (matching fuzzy / sugestão de chaves): **fundação agora, IA depois**.
> 3. Migração via **backend paralelo + oráculo** (diff byte-a-byte contra o app atual).

> **Status de execução** (atualizado 2026-07-15):
> - **Fase 0** — domain puro portado e testado, fingerprint validado contra golden do Node, sidecar FastAPI no ar, **spike de packaging desmentido no Linux** (sidecar self-contained + `.xlsx` offline + spawn — [`packaging/`](../packaging/README.md)). Pendente: build por-SO (CI), extração do OpenAPI da v1.
> - **Fase 1** — **ingestão validada nos dados reais** (429k linhas / 148MB em ~12s a ~508MB) + **cobertura de formatos** (xlsx/xlsb/csv/txt). Pendente: camada de API/metadados (CRUD, preview) e oráculo.
> - **Fase 2** — **lógica de conciliação central completa**: conciliação A×B, pipeline encadeado (estorno → cancelamento → conciliação), **multi-chave priorizada** e **resultado nível-linha**. 468k linhas em ~6s; classificação SQL == Python em todos os grupos reais (0 divergências); carry-forward e cancelamentos reais comprovados. Pendente: keys/keysPairs + oráculo.
> - **Fase 3** — **atribuição + export XLSX** validados: atribuição (chaves priorizadas, OVERWRITE/ONLY_EMPTY) 42,7k linhas em ~0,1s; export 468k linhas → 15,8 MB em ~15s a ~327MB. Pendente: ZIP Base_A/B/Comparativo, oráculo.
> - **Fase 6 (API)** — FastAPI + storage híbrido (SQLite+DuckDB); **licença**, **bases**, **conciliações**, **atribuições** completas + **CRUD de configs/keys/keys-pairs**, espelhando o contrato v1. Todo o loop (subir → configurar → conciliar/atribuir → resultado → baixar) por HTTP. Pendente: maintenance/debug, subtypes/derived de bases, fidelidade fina de shapes.
> - **Oráculo ✅ VERDE em todos os cenários** — v1 (código real, headless) vs v2: conciliação (4644 chaves, 0 divergências), multi-chave, cancelamento, estorno e atribuição todos **idênticos** ([`oracle/`](../oracle/README.md)). Reescrita comprovadamente fiel.
> - **Integração Electron ✅** — `main.ts` faz `spawn()` do sidecar Python (serve SPA+API); validado com **Electron real (xvfb)**: boot → spawn → `/health` OK.
> - **Cutover ✅** — backend Node (`apps/api`), scripts de conversão e runtime Python antigo **removidos**; root/desktop `package.json` e `electron-builder` migrados para o fluxo v2; desktop compila, backend verde.
> - **CI multi-SO ✅** — workflow ubuntu/windows/macos que builda sidecar (spec cross-platform) + instalador. Pendente: corte real (rodar em paralelo com usuários), certs de assinatura.
> - **Licença removida (v2 sem auth)**, **periféricos portados** (subtypes, colunas derivadas, reuse-monetary, PATCH, maintenance, debug) e **fidelidade de shape** (`CHAVE_n` + `a_values`/`b_values`) concluídos. Roadmap de evolução movido para [roadmap-evolucao.md](roadmap-evolucao.md).
> - **175 testes unitários + 8 de integração** verdes. Detalhe por fase em §9; estado do código em [`backend/README.md`](../backend/README.md).

---

## 1. Tese central

O problema real da v1 **não é a linguagem** — é que ~metade dos 15k linhas do backend é um **motor de dados columnar escrito à mão**: streaming, mmap, buffer pool, worker pool, conversão Arrow, batch dinâmico por RAM. Toda a lógica de conciliação/atribuição/estorno é, no fundo, `JOIN + GROUP BY + SUM + CASE`.

**DuckDB** (OLAP embarcado, 1 binário, offline, determinístico, spill-to-disk automático) executa isso nativamente e apaga essa infraestrutura inteira. **Polars/pyarrow** cuidam da ingestão. **Python** passa a ser o host natural porque o núcleo vira "orquestrar DuckDB + Polars" — e você já depende de Python para o que é difícil (`pyxlsb`).

### O que morre da v1 (aprox.)

| Módulo v1 | Linhas | Substituto v2 |
|---|---:|---|
| `ConciliacaoABStep.ts` | 978 | 1 template SQL DuckDB parametrizado |
| `ConciliacaoExportService.ts` | 879 | DuckDB → Polars → xlsxwriter |
| `StreamingIngestPipeline.ts` | 546 | Polars/pyarrow → `COPY`/`INSERT` DuckDB |
| `atribuicaoRunner.ts` | 558 | DuckDB `UPDATE ... FROM` (COALESCE) |
| `MmapFileReader.ts` | 312 | DuckDB lê o arquivo direto |
| `WorkerPool*` + `pool/*` | ~900 | Paralelismo interno vetorizado do DuckDB |
| `EstornoBaseAStep` / `CancelamentoBaseBStep` / `NullsBase*` | ~1150 | SQL DuckDB (`GROUP BY HAVING`, `UPDATE`) |
| `db/knex.ts` + PRAGMAs por RAM | 190 | DuckDB gerencia memória/spill sozinho |

Estimativa: **~15k linhas TS → ~3–4k linhas Python.**

### O que sobrevive / é preservado à risca

- **Regras de negócio** (`regras-de-negocio.md`) — portadas como funções puras testadas.
- **Contrato REST** — idêntico (mesmas rotas, JSONs, polling). É o critério de aceitação.
- **Fingerprint de licença** — deve gerar o **mesmo sha256** (ativações existentes não podem quebrar). Ver §7.
- **Normalização de precisão Float64** (ex. 80.9399…→80.94) — crítica p/ casar chaves. Ver §7.
- **React client** — não toca em nada além da baseURL (que continua `localhost:3000`).

---

## 2. Arquitetura alvo

```
apps/desktop — Electron (mudança mínima)
  • antes: import() in-process do server.js (Node)
  • depois: spawn() de UM sidecar Python (PyInstaller onefile) em localhost:3000
  • health probe /health, licença gate, kill no before-quit  → inalterados
  • o conversion_worker.py separado DESAPARECE (vira parte do sidecar)
        │ HTTP :3000 (contrato idêntico)
        ▼
backend/ — FastAPI (novo, substitui apps/api)
  routes/     routers espelhando 1:1 o REST atual (Pydantic valida entrada/saída)
  schemas/    modelos Pydantic = o contrato
  services/   orquestração de negócio
  engine/     DuckDB (join/agg/store) + Polars (ingest) + pyarrow (xlsb/xlsx)
  domain/     regras PURAS (classify, compose_key, nulls, estorno, cancel) + testes
  jobs/       worker de background (1 fila, DuckDB paraleliza internamente)
  db/         conexões + migrações
        │
        ▼
apps/client — React  ← CONGELADO
```

### 2.1 Storage: híbrido SQLite + DuckDB

- **SQLite** (transacional, multi-reader) para **metadados/filas/configs**: `jobs_*`, `ingest_jobs`, `atribuicao_runs`, `configs_*`, `keys_*`, `license`. Schema porta ~1:1 das 24 migrations atuais → migração de dados trivial.
- **DuckDB** (colunar, spill-to-disk) para **dados pesados**: tabelas `base_{id}`, `conciliacao_result_{jobId}`, `atribuicao_result_{runId}`, e todo o compute analítico.
- DuckDB pode `ATTACH` o SQLite quando precisar cruzar metadado com dado. Único ponto de atenção: DuckDB é **single-writer** — resolvido rodando jobs por **1 worker sequencial** (que é exatamente o modelo atual de polling).

### 2.2 Modelo de jobs (drástica simplificação)

A v1 tem 3 loops de polling + `fork()` por job + pools de `worker_threads`. Em Python:

- **1 worker de background** (thread ou processo) que faz poll das tabelas `status` (`PENDING→RUNNING→DONE/FAILED`) no SQLite, com claim atômico via `UPDATE` condicional (igual hoje).
- Nada de worker pool manual: **DuckDB e Polars liberam o GIL** e paralelizam internamente (execução vetorizada multi-thread). O worker chama uma query; o DuckDB usa todos os cores.
- Progresso/telemetria: o job escreve `progress`/`status` no SQLite; o React continua fazendo polling como hoje. **Contrato inalterado.**

---

## 3. Mapa de portabilidade (feature → implementação DuckDB/Polars)

| Feature v1 | Implementação v2 |
|---|---|
| **Ingestão** xlsb/xlsx→tabela | Polars/pyarrow lê arquivo (streaming) → normaliza NULL/tipos → `COPY`/`INSERT INTO base_{id}` no DuckDB. DuckDB faz spill se estourar RAM. |
| **Inferência de tipo** (amostra 1000 linhas) | Polars infere; regra de negócio ajusta (monetário, etc). Porta a lógica de `regras-de-negocio.md §1.4–1.5`. |
| **Sanitização de nomes de coluna** | Função pura portada (§1.3) — deve ser **bit-idêntica** senão o oráculo diverge. |
| **Nulls A/B** (`""→"NULL"`, vazio→0) | `UPDATE`/`COALESCE` no DuckDB, ou já na normalização Polars. Função pura testada. |
| **Estorno** (soma≈0 na mesma base) | `SELECT chave FROM base GROUP BY chave HAVING abs(sum(valor)) < :eps` → marca `Conciliado_Estorno`. |
| **Cancelamento** (coluna indicadora) | `UPDATE base_b SET status='04...' WHERE {coluna}={valor_cancelado}`. |
| **Conciliação A×B** | 1 SQL: `FULL/INNER JOIN` por chave composta, `GROUP BY`, `SUM` (com inversão de sinal fiscal), `CASE` classificando contra EPSILON/limite → `conciliacao_result_{jobId}`. |
| **Chaves compostas priorizadas** | Loop por chave (prioridade), cada passada faz o JOIN; `03_Não Encontrado` da chave N vira candidato da chave N+1. |
| **Atribuição** (copiar colunas) | `UPDATE dest SET col = src.col FROM src JOIN por chave` — `OVERWRITE` direto ou `ONLY_EMPTY` via `COALESCE`/`WHERE dest.col é vazio`. |
| **Colunas derivadas** | Expressão SQL calculada → `ALTER TABLE ... ADD COLUMN` + `UPDATE`. |
| **Exportação** XLSX/ZIP | DuckDB → Polars → `xlsxwriter`/`openpyxl` (formatação monetária, cores de header). |
| **Perfis de hardware** (low/std/high) | Só configura `PRAGMA memory_limit` / `threads` do DuckDB por RAM/CPU. Some toda a matemática manual de batch. |

---

## 4. Gancho para IA (fundação agora, implementação depois)

Não implementar IA na v2, mas **deixar o encaixe pronto**:

- O status `03_Não Encontrado` de cada job já é uma **fila natural** para a 2ª passada.
- Isolar a conciliação atrás de uma interface `Matcher` com uma única implementação hoje (`ExactSqlMatcher`). A futura `EmbeddingMatcher` (sentence-transformers, MiniLM ~80MB, cosine>0.85 → "Match sugerido pela IA", usuário valida) pluga sem tocar no core.
- Manter tudo **determinístico** no core auditável; IA só sugere sobre o que sobrou.

Detalhes em [analise-ia-vs-algoritmos-conciliacao-atribuicao.md](analise-ia-vs-algoritmos-conciliacao-atribuicao.md).

---

## 5. Empacotamento

O Electron da v1 roda o backend **in-process** (`import()` do server.js). Isso muda: o backend Python é um **sidecar** que o Electron faz `spawn()`. Também estamos livres para redesenhar o empacotamento por inteiro.

**Recomendação — Python standalone embarcado (sem exigir instalação do usuário):**
- Embarcar um **Python relocável** ([python-build-standalone](https://github.com/astral-sh/python-build-standalone)) com os wheels (DuckDB, Polars, pyarrow, pyxlsb, FastAPI) **pré-instalados no build**. Evolução limpa do `python-runtime/` atual.
- `electron-builder` embarca a pasta como `extraResources` (mesmo lugar de hoje). Electron faz `spawn(python, [main.py])` servindo FastAPI em `:3000`; mata no `before-quit`.
- **Build por SO** (win/linux/mac). Gestão de deps: `uv` (lockfile reprodutível).
- Vantagem sobre PyInstaller: sem falso-positivo de antivírus, sem startup lento de descompactação em temp, sem `--collect-all` para libs nativas.

**Comparativo de opções** (usuário-alvo = equipe de contabilidade, desktops modestos, offline):

| Abordagem | Self-contained | Offline | Fricção p/ usuário | Observação |
|---|:---:|:---:|:---:|---|
| **Python standalone embarcado** ✅ recomendado | Sim | Sim | Zero | Melhor equilíbrio, sem compilação na máquina do usuário |
| PyInstaller onefile | Sim | Sim | Zero | Antivírus + startup mais lento |
| Instalador gerencia Python (silent) | Parcial | Precisa embarcar instalador | Baixa | Fallback se algum wheel não embarcar; drift de versão |
| Usuário instala Python manualmente | Não | Não | **Alta** | Evitar — maior fonte de suporte e "na minha máquina funciona" |

> Como não exigimos instalação manual e o método é o que já usamos (só mais robusto), o packaging deixa de ser risco 🔴 e vira 🟡. **Spike concluído no Linux** (ver §9 Fase 0 e [`packaging/`](../packaging/README.md)): sidecar self-contained + ingestão `.xlsx` offline (extensão `excel` embarcada) + spawn pelo shell, comprovados. Falta só reproduzir o build nos 3 SOs (CI) e enxugar o bundle.

---

## 6. Estratégia de validação (o oráculo)

> **✅ Oráculo executado e VERDE em TODOS os cenários** ([`oracle/`](../oracle/README.md)): rodando o **código real da v1** (build `dist`, headless) contra a v2, saída **idêntica** em: **conciliação A×B** (2×5000 linhas reais, 4644 chaves, 0 divergências), **multi-chave**, **cancelamento**, **estorno** e **atribuição** (datasets sintéticos controlados). Toda a lógica de negócio comprovadamente fiel.

O app atual, **rodando**, é a fonte da verdade. Antes de aposentar o Node:

1. **Golden datasets:** juntar planilhas representativas (pequenas, médias, 100k+, casos-borda: acento, "LTDA." vs "LTDA", estorno, cancelamento, multi-chave).
2. Rodar cada uma no **app atual** e capturar as saídas: tabelas de resultado (`conciliacao_result_*`, `atribuicao_result_*`) + exports XLSX/ZIP.
3. Rodar as mesmas no **backend Python** e **diff byte-a-byte** (linha a linha, célula a célula).
4. **Diff = 0 → correto.** Diferença → bug (quase sempre em nulls/sanitização/precisão).

Isso vira teste de regressão automatizado e é o **gate de cutover**.

---

## 7. Armadilhas que quebram o oráculo (atenção máxima)

1. **Fingerprint de licença.** Hoje: `sha256(hostname|platform|arch|cpuModel)` com valores do Node (`os.platform()`→`"win32"`, `os.arch()`→`"x64"`, `os.cpus()[0].model`). Python (`platform.system()`→`"Windows"`, etc.) gera **strings diferentes** → hash diferente → **máquinas ativadas seriam bloqueadas**. Solução: reproduzir exatamente os valores do Node em Python (mapear `win32/linux/darwin`, `x64`, modelo de CPU idêntico), com teste comparando o hash das duas implementações.
   > **Confirmado empiricamente na Fase 0:** nesta máquina o Node lê `os.cpus()[0].model` = `"12th Gen Intel(R) Core(TM) i5-12450HX"`, mas o `platform.processor()` do Python devolve `"x86_64"`. A função de hash já é 100% compatível (testada contra golden do Node); falta só alimentar os mesmos valores por SO (`/proc/cpuinfo` no Linux, WMI/registry no Windows) — pendência da Fase 4.
2. **Precisão Float64.** `xlsb_to_arrow.py` já normaliza (80.9399…→80.94) porque a chave composta depende disso. A ingestão Polars/DuckDB tem que aplicar a **mesma** normalização, ou chaves deixam de casar.
3. **Sanitização de nomes de coluna** e **normalização NULL/tipo** têm que ser **bit-idênticas** — são funções puras, portar **com testes antes** de qualquer outra coisa.
4. **Ordenação e sinal.** Ordem das linhas no resultado e regra de inversão de sinal fiscal precisam bater exatamente com a v1.
5. **Contrato REST.** Qualquer campo/nome/tipo diferente no JSON quebra o React congelado. Extrair um **OpenAPI da API atual** e validar o novo contra ele.

---

## 8. Estratégia de testes (requisito de primeira classe)

Cobertura de **todos os casos de uso** das regras de negócio é requisito, não opcional. Pirâmide:

### Camada 1 — Unitário das regras puras (`backend/domain`)
Funções puras, sem I/O, rápidas, table-driven (`pytest.mark.parametrize`). Exaustivas **nas bordas**:
- `classify_difference(diff, limite, eps)` → exatamente ε, exatamente o limite, logo acima, negativo, zero → `01/02/03/04`
- `compose_key(row, cols)` → concatenação, valores nulos, prioridade de chave
- `normalize_null(val, tipo)` → `""`→`"NULL"`, numérico vazio→`0`, espaços em branco
- `sanitize_column_name(name)` → todos os casos de §1.3
- `is_estorno_pair(soma, eps)` → soma≈0 nas bordas
- `is_cancelled(row, config)` → coluna indicadora S/N
- `normalize_float64(v)` → 80.9399…→80.94 e casos de arredondamento
- `machine_fingerprint()` → **hash idêntico ao do Node** (golden hash fixo em teste)

### Camada 2 — Integração do engine (DuckDB/Polars)
Cada operação contra fixtures pequenas in-memory:
- Estorno (pares que anulam / não anulam), Cancelamento (indicador S/N)
- Conciliação A×B: os **5 cenários** (Conciliado, Dif. Contábil, Dif. Fiscal, Apenas A, Apenas B) + multi-chave com prioridade + inversão de sinal
- Atribuição: `OVERWRITE` vs `ONLY_EMPTY`, definições de valor-vazio
- Ingestão: xlsb/xlsx → conteúdo de `base_{id}` correto

### Camada 3 — Golden / oráculo (cobertura E2E dos casos de uso)
**É aqui que "todos os casos de uso" vive.** Biblioteca de **datasets nomeados**, um por cenário de negócio, com a saída capturada do app atual (§6). Cada branch do `regras-de-negocio.md` → um dataset. O teste roda o pipeline e exige **diff byte-a-byte zero**. Serve de regressão e de gate de cutover.

### Camada 4 — Contrato da API
Valida respostas do FastAPI contra o **OpenAPI extraído da API Express atual** (garante o React congelado). Ex.: `schemathesis` ou testes de snapshot de response.

### Checklist regra → teste
Manter uma tabela `regras-de-negocio.md §X → test_*` para verificar **mecanicamente** que nenhuma regra ficou sem cobertura. Nenhuma seção de regra pode existir sem teste correspondente.

### CI
`pytest` (+ `ruff`, `mypy`) a cada commit. **O diff do oráculo é o gate de merge de cada fase.** Cobertura mínima definida por camada (domain ~100%).

---

## 9. Fases

> Sempre funcional. Backend novo em paralelo; Node só é aposentado no cutover.
> **Regra transversal:** nenhuma fase fecha sem os testes da sua camada verdes (unit + integração + oráculo da fase).

### Fase 0 — Fundação, contrato, testes e de-risking (o mais importante) — 🟡 parcialmente concluída

**✅ Feito** (código em [`backend/`](../backend/), 73 testes verdes):
- Setup projeto Python (`pyproject`, venv, FastAPI, DuckDB 1.5.4, Polars 1.42.1, pyarrow) + infra `pytest`.
- **Domain puro portado fiel à v1** com testes exaustivos: `matching` (classify_group, normalize_amount toFixed(6), compose_key, sum_column), `nulls` (T52 + parse numérico), `columns` (sanitize, inclusive falsy `!name` do JS), `estorno` (soma_to_key, is_estorno_pair), `fingerprint`.
- `machine_fingerprint` validado **byte-a-byte contra golden gerado pelo Node**.
- FastAPI `/health` sobe como sidecar (prova do processo) + OpenAPI auto-gerado.
- Protótipo DuckDB: conciliação set-based em SQL comprovada (substitui as 978 linhas do `ConciliacaoABStep`).

**⬜ Pendente na Fase 0:**
- ✅ **Spike de packaging (Linux) — risco desmentido.** Sidecar **self-contained** (PyInstaller onedir, sem Python do sistema) sobe em **~0,5s**; **ingestão `.xlsx` funciona offline** com a extensão `excel` do DuckDB **embarcada** (`LOAD` de arquivo local, sem INSTALL/rede); harness Node prova o `spawn()`+probe que o Electron/Tauri fará. Ver [`packaging/README.md`](../packaging/README.md). ⬜ Falta rodar o build nos 3 SOs (PyInstaller não faz cross-compile → CI com runners win/mac/linux) e enxugar o bundle (~496MB; `pyarrow` é o maior peso — R7).
- **Extrair OpenAPI** da API Express atual e usar como contrato de referência.
- **Montar golden datasets** + capturar saídas do app atual (oráculo). Depende de planilhas reais/sintéticas.
- `ruff`/`mypy` no CI + checklist `regra→teste` formalizado.

### Fase 1 — Ingestão — 🟡 fatia central validada

**✅ Feito** (`backend/engine/ingest.py`, `tests/integration/test_ingest_real.py`):
- Ingestão xlsx → DuckDB via `read_xlsx` nativo (all_varchar), dirigida por `IngestSpec(header_row, start_col)` — a "config de header/coluna inicial" da v1. Nomes de coluna sanitizados fiéis à v1; `numeric_sql()` normaliza vírgula→ponto.
- **Substitui** `StreamingIngestPipeline.ts` (546 l) + `conversion_worker.py` + arquivos Arrow por uma chamada nativa com spill-to-disk.
- **Validado nos dados reais** de `storage/ref` (SAP export, dez/2025):

  | Base | Arquivo | Linhas × Cols | Header/Col | Ingestão | Pico RAM (limit 900MB) |
  |---|---|---|---|---|---|
  | A (contábil) | Razão_223 | 38.874 × 34 | linha 6 / col B | ~1s | — |
  | B (fiscal) | Livro_Entradas (148MB) | **429.261 × 73** | linha 5 / col A | **~12s** | **~508MB** |

  Regra de cancelamento confirmada nos dados: 427.459 `N` + 1.802 `S`.

**✅ Cobertura de formatos** (`ingest()` dispatcher, `tests/test_ingest_formats.py`):
- `.xlsx` → `read_xlsx` nativo; **`.xlsb`/`.xls`** → **calamine** (mesmo motivo do `pyxlsb` na v1); `.csv`/`.txt` → `read_csv` nativo. Todos com header/coluna configuráveis e sanitização fiel.

**⬜ Pendente na Fase 1 (camada de API/metadados — fase própria, ou bloqueado no oráculo):**
- Bases CRUD, columns, preview, colunas derivadas, subtipos (endpoints) — **camada de API**.
- Inferência de tipo/monetário por base + persistência de metadados (**SQLite metadados**).
- **Validar** conteúdo de `base_{id}` byte-a-byte contra a v1 — **bloqueado no oráculo**.
- (Fidelidade de formatação de float em células numéricas de `.xlsb` — reconciliar no oráculo.)

> **Dados de referência** (`storage/ref/`): `Razão_223_122025.xlsx` = Base A; `Livro_Entradas_122025.xlsx` = Base B. Estrutura real revelou: header offset por-base, decimal misto (ponto E vírgula na mesma planilha), literais `"NULL"` na origem, e `''`-prefixados (força-texto do Excel). São a semente dos golden datasets (§6).

### Fase 2 — Conciliação — 🟢 lógica central completa (falta keys/keysPairs + oráculo)

**✅ Feito** (`backend/engine/conciliacao.py`, `tests/test_conciliacao.py`, `tests/integration/test_conciliacao_real.py`):
- Conciliação A×B **set-based em SQL** (compose_key → SUM por chave → FULL OUTER JOIN → classificação). **Substitui `ConciliacaoABStep.ts` (978 l)** + worker pool.
- Classificação SQL é **tradução fiel** de `domain.matching.classify_group`, garantida por:
  - **9 cross-checks sintéticos** SQL == Python (bordas de ε, limite, inversão);
  - **fidelidade em escala**: nos **83.344 grupos reais**, status SQL == Python, **0 divergências**.
- **Escala comprovada** nos dados reais (config ilustrativa id_origem):

  | Conciliação A×B (429k × 38k linhas) | |
  |---|---|
  | 83.344 grupos | **~0,1s** |
  | Pico RAM | **~130MB** |

**✅ Pipeline encadeado** (`backend/engine/pipeline.py`, `tests/test_pipeline.py`, `tests/integration/test_pipeline_real.py`):
- Orquestra **Estorno(A) → Cancelamento(B) → Conciliação(A×B)** na ordem da v1, com as exclusões fluindo entre etapas (via VIEWs filtradas — sem cópia de dados).
- **Estorno**: port fiel do pareamento guloso O(n) de `EstornoBaseAStep.ts` (pares → `Conciliado_Estorno`; não-pareados → `Documentos estornados`). **Nulls (T52) aplicados inline** em todo compute (equivalente ao passo materializado da v1 para fins de resultado; materializar só importa p/ export — Fase 3).
- **Cancelamento**: SQL; na Base B real exclui exatamente **1.802 NFs canceladas** (`indicador_de_cancelamento = 'S'`).
- **Escala real**: pipeline completo (estorno + cancelamento + conciliação) em **< 1s** no volume real (429k×38k).

**✅ Multi-chave priorizada + resultado nível-linha** (`conciliar_multichave` / `run_conciliacao`, `tests/test_multichave.py`, `tests/integration/test_multichave_real.py`):
- Chaves em **ordem de prioridade** (INNER JOIN por chave; casadas são puladas nas chaves seguintes; remanescentes → `03_Não Encontrado`) — semântica fiel a `ConciliacaoABStep.ts`.
- Resultado **nível-linha** `conciliacao_result` (uma entrada por linha de A e de B, `value_a/value_b` = somas do grupo, com a chave que resolveu). Marcas de estorno/cancelamento entram como pré-casadas.
- **Escala real** (468k linhas, 2 chaves, marcas): **~6s**. Invariante verificado: total = |A|+|B| = 468.135. Carry-forward comprovado — CHAVE_1 resolveu 80.381 linhas, CHAVE_2 pegou +32 que a CHAVE_1 não casou; 1.802 canceladas via marca.

**⬜ Pendente na Fase 2 (camada de metadados / bloqueado no oráculo):**
- Sistema **keys/keysPairs** — resolver as `KeyDef` a partir da tabela central de vínculos da v1 (**camada de metadados/config**; a lógica de conciliação que as consome já está pronta).
- **Config real do cliente** + **oráculo** para validar os status de negócio byte-a-byte (as configs ilustrativas provam o motor, não a conciliação oficial).

### Fase 3 — Atribuição + Exportação — 🟢 atribuição e export XLSX validados

**✅ Export XLSX** (`backend/engine/export.py`, `tests/test_export.py`, `tests/integration/test_export_real.py`):
- Export do `conciliacao_result` com header estilizado (azul `#3C78D8`, fonte branca bold) e **formatação monetária BR** (`#,##0.00`) — port do essencial de `ConciliacaoExportService.ts`.
- **Streaming** (`xlsxwriter constant_memory`): **468k linhas → 15,8 MB em ~15s, pico ~327MB** de RAM.

**✅ Atribuição** (`backend/engine/atribuicao.py`, `domain/atribuicao.py`, `tests/test_atribuicao.py`, `tests/integration/test_atribuicao_real.py`) — **substitui `atribuicaoRunner.ts` (558 l)**:
- Cópia de colunas origem→destino por **chaves priorizadas** (INNER JOIN exato; cada linha do destino atribuída por no máx. uma chave; `MIN(orig)` vence) + modos **OVERWRITE** / **ONLY_EMPTY**.
- Regras puras portadas fiéis (`is_empty_value` incl. `0`/`0.00`/`null`, `normalize_import_value`, `normalize_key_value`) e traduzidas para SQL.
- **Escala real**: Razão→Livro por nota_fiscal, **42.718 linhas atribuídas em ~0,1s**.

**⬜ Pendente na Fase 3:**
- **ZIP** com `Base_A.xlsx` / `Base_B.xlsx` / `Base_Comparativo.xlsx` reconstruindo a **ordem original das colunas** (depende dos metadados de base — camada de metadados).
- Colunas `CHAVE_n` de exibição no resultado da atribuição.
- **Validar** resultados/arquivos contra a v1 — **oráculo**.

### Fase 4 — Periféricos — 🟢
- ✅ **Maintenance** (`/api/maintenance/cleanup*`) e **Debug** (`/api/debug/*`) portados.
- ✅ **Licença removida na v2** (sem autenticação por enquanto): `/api/license/status` responde `active` por padrão (bypass; `ALTOOL_LICENSE_ENABLED=1` reativa). Fingerprint por-SO fica só se/quando o licenciamento voltar.
- ✅ Perfis de hardware centralizados em `engine/db.py` (memory_limit/threads DuckDB).

### Fase 5 — Integração Electron + Cutover — 🟡 integração pronta

**✅ Integração Electron** (`apps/desktop/src/main.ts` reescrito): o shell agora faz **`spawn()` do sidecar Python** em vez do `import()` in-process do backend Node. O sidecar (FastAPI+DuckDB) serve **SPA React + API** em `localhost:3000`; o `main.ts` faz health-probe e mata no `before-quit`. **Validado com Electron real (headless/xvfb)**: Electron → spawna sidecar → `/health` OK → serve o app. O worker de conversão Python separado **desapareceu** (a ingestão via DuckDB dispensa xlsb→arrow). `electron-builder` agora empacota o **sidecar (PyInstaller) + client/dist**, largando `api/dist`/`python-runtime`/scripts Node.
- **App FastAPI serve o SPA** (`CLIENT_DIST`, fallback SPA como a v1); env: `DB_PATH` (DuckDB), `METADATA_DB_PATH` (SQLite), `UPLOAD_DIR`, `EXPORT_DIR`, `CLIENT_DIST`.

**✅ CI multi-SO** (`.github/workflows/build-desktop.yml`): matriz **ubuntu/windows/macos** — instala backend, roda `pytest`, builda o **sidecar** (`packaging/altool-sidecar.spec`, cross-platform), smoke-testa o `/health`, builda client+desktop, empacota via electron-builder e sobe os instaladores (`.deb`/`.exe`/`.dmg`/`.AppImage`). Validado localmente: YAML, `npm install` (reconcilia lock sem `apps/api`), build do spec e smoke — todos verdes.

### Fase 6 — Camada de API (FastAPI espelhando o contrato REST) — 🟡 fundação + licença

Conecta o engine validado ao frontend congelado. **Regra:** o JSON de cada endpoint precisa
bater exatamente com o que o React consome (é o oráculo de contrato). Storage híbrido:
`MetadataStore` (SQLite, `backend/metadata/store.py`) para metadados; engine DuckDB por fatia.

**✅ Feito** (`backend/api/`, `backend/services/`, `backend/metadata/`, `tests/test_license.py`, `tests/test_bases.py`):
- App FastAPI com routers sob `/api`; `MetadataStore` SQLite (conexão única, bootstrap idempotente); `DuckDBStore` (dados) — storage híbrido montado.
- **Licença** — `GET /api/license/status` (ramos not_activated / expired / blocked_offline com grace 37d / active, fiéis a `licensingService.ts`) e `POST /api/license/activate` (validação externa injetável).
- **Bases + modelo de job assíncrono** — `MetadataStore` com `bases`/`base_columns`/`ingest_jobs`; **`JobWorker` multi-fila** (claim atômico); `GET /api/bases` (paginada, `ingest_in_progress`), upload **multipart** `POST /api/bases` (201), `GET /:id` (rowCount), `/:id/columns`, `/:id/preview`, **`POST /:id/ingest` (202)**, `DELETE /:id`. Ciclo validado por HTTP: upload → 202 → worker → polling `PENDING→READY`.
- **Conciliações (fluxo completo)** — `configs_conciliacao`/`configs_estorno`/`configs_cancelamento` (chaves denormalizadas JSON) + `jobs_conciliacao`/`export_jobs` (filas); **`POST /api/conciliacoes` (201)** cria job → worker roda `run_conciliacao` (Fases 2/3) → `conciliacao_result_{id}`; `GET /:id` (**job + metrics** totalRows/byStatus/byGroup), `GET /:id/resultado` (paginado + `keys` + filtro `status`/`__NULL__`/`search`), `GET` (list), `DELETE /:id`. **Export/download**: `POST /:id/exportar` (**409** se não DONE / **200** se já existe / **202** dispara `export_job`) → worker roda `export_resultado_xlsx` → `GET /:id/export-status` (polling) → `GET /:id/download` (**stream xlsx**). Validado por service, HTTP (download real) e worker de background.
- **Atribuições (fluxo completo)** — `atribuicao_runs`/`atribuicao_run_keys`/`atribuicao_export_jobs` + camada mínima **keys/keysPairs** (`keys_definitions`/`keys_pairs`, colunas por base_tipo/subtipo). Fluxo **dois passos** fiel: **`POST /runs` (201, status CREATED)** valida (origem≠destino, tipos FISCAL↔CONTABIL, keysPairs≥1); **`POST /runs/:id/start`** (→ PENDING, **409** se RUNNING/DONE) → worker roda `atribuir` (Fase 3) → `atribuicao_result_{id}`; `GET /runs/:id` (enriquecido, polling), `/runs/:id/results` (paginado), `GET /runs`; **export/download**: `GET /runs/:id/export` (409/ready/processing) → worker → `GET /runs/:id/download-xlsx` (stream). Validado por service + HTTP (download real).
- **Configs + Keys/KeysPairs (CRUD completo)** — routers `/api/configs/{conciliacao,estorno,cancelamento,mapeamento}` (**array puro**, 201, **204** no delete) e `/api/keys`, `/api/keys-pairs` (envelope **`{data, meta}`**, delete de key **bloqueado** se referenciada). Config de conciliação resolve `keys` (keys_pair_id ou contabil/fiscal_key_id) → colunas denormalizadas (consumidas pelo engine) + response com `keys` expandidas. Fecha o **keys/keysPairs** pendente da Fase 2 e o loop de autoatendimento da UI.
- `GET /health` (shape v1 + info do engine) e `GET /api/diagnostics/env`.

**✅ Periféricos + fidelidade portados** (`tests/test_endpoints_extra.py`, `tests/test_fidelidade_shape.py`):
- **Bases (restante)**: subtypes CRUD, **colunas derivadas** (ABS/INVERTER, sync + job async >10k), `reuse-monetary`, `PATCH` de base e de coluna (`is_monetary`).
- **Fidelidade de shape**: `conciliacao_result` agora com colunas `CHAVE_n` + `a_values`/`b_values` (JSON da linha); atribuição com `CHAVE_n`.
- **Maintenance** e **Debug** routers.

**⬜ Pendente (fino):** validações de contrato de borda (ex.: unicidade de nome de key, compat. de subtipo no par); ZIP `Base_A/B/Comparativo` (dispensado por ora).
- **Atribuições** (`/api/atribuicoes/runs`): `POST` (201), `/:id/start`, `/:id/results`, `/:id/export`, `/:id/download-xlsx` (stream).
- **Configs** cancelamento/estorno/conciliação/mapeamento: **array puro** (sem envelope); create 201, delete **204 vazio**.
- **Keys** e **KeysPairs**: envelope `{data, meta:{total,page,pageSize}}`; delete 204. (Resolve as `KeyDef`/`AtribKey` da Fase 2/3 — fecha o keys/keysPairs.)
- **Maintenance**, **Debug/Diagnostics**.
- **Convenções a preservar**: envelopes de paginação diferem por recurso; status codes (201 create / 202 enqueue / 204 delete de config / 200 `{success:true}` delete de base-job); downloads são streams com `Content-Disposition: attachment`; token `__NULL__`; colunas dinâmicas `CHAVE_\d+`.
- **Workers de job** (fila SQLite `PENDING→RUNNING→DONE`, worker de background) para ingest/conciliação/atribuição/export/derived — hoje o engine roda síncrono; a API precisa do modelo de job assíncrono com polling.

### Fase 5b — Cutover (execução) — 🟢 backend Node aposentado
- **Removidos**: `apps/api` (backend Node/Express), `scripts/` (worker de conversão + xlsb→arrow legados), `apps/desktop/python-runtime` (venv antigo). Root `package.json` e `electron-builder` atualizados para o fluxo v2 (client build → `build-sidecar.sh` → desktop dist). Backend v2 e sidecar seguem verdes pós-remoção. README v1 marcado como referência histórica.
- **Cleanup opcional restante** (não-bloqueante): `apps/desktop/src/main/` (código morto pós-reescrita do `main.ts`), deps Node não usadas do desktop, `docker-compose.yml`/`packages/` vazios.
- **Pendente do corte real**: rodar v1 e v2 em paralelo com usuários antes de deletar de vez (o histórico git preserva a v1).

---

## 10. Reshaping do monorepo

- `packages/domain` e `packages/shared` (hoje **vazios**) eram para o mundo Node — no v2 o domínio vive no `backend/domain` (Python). Podem ser removidos ou repurposed só para tipos do client.
- Estrutura final: `apps/desktop` (Electron TS), `apps/client` (React TS, congelado), `backend/` (Python), `docs/`. Scripts Python avulsos (`scripts/*.py`) são absorvidos pelo `backend/engine`.

---

## 11. Roadmap de melhorias (nada é sagrado, exceto as regras de negócio)

Nada da v1 (front, Electron, API, schema) é intocável. A **única linha vermelha** é: as regras de negócio permanecem idênticas, comprovadas pelo oráculo (§6).

➡️ **O roadmap de evolução detalhado vive em [roadmap-evolucao.md](roadmap-evolucao.md)** (R1 Tauri, R2 Parquet, R3 IA, R4 auto-update, R5 frontend, R6 observabilidade, R7 enxugar bundle) — melhorias opt-in para depois do núcleo.

---

## 12. Riscos & mitigações

| Risco | Severidade | Mitigação |
|---|---|---|
| Packaging Python no Electron falha/incha | 🟢 (Linux) / 🟡 (win/mac) | **Spike Linux OK**: sidecar self-contained + `.xlsx` offline + spawn comprovados ([`packaging/`](../packaging/README.md)). Falta build por-SO (CI) e enxugar bundle (~496MB, R7) |
| Fingerprint quebra ativações | 🔴 | Teste comparando hash Node vs Python p/ mesma máquina |
| Divergência sutil (nulls/precisão/sanitização) | 🟠 | Oráculo + funções puras testadas antes de I/O |
| DuckDB single-writer + jobs concorrentes | 🟡 | 1 worker sequencial (modelo atual); SQLite p/ metadados |
| Reescrita completa = janela de risco | 🟡 | Backend paralelo; Node só sai no cutover validado |
