# Roadmap de Evolução — AL-Tool v2

> Melhorias **opt-in** para depois do núcleo (a v2 já roda, com correção comprovada pelo
> oráculo). **Nada aqui é obrigatório** — são evoluções de valor. A única linha vermelha é a
> de sempre: as regras de negócio permanecem idênticas (validadas em [`../oracle/`](../oracle/README.md)).
>
> Para o estado atual da reescrita, ver [remake-v2-python.md](remake-v2-python.md).

---

## Visão geral

| # | Melhoria | Ganho principal | Esforço | Convicção | Depende de |
|---|---|---|---|---|---|
| R1 | **Electron → Tauri** | RAM/disco muito menores (desktops modestos) | Médio | 🟢 Alta | núcleo pronto |
| R2 | **Bases como Parquet** | Simplicidade + portabilidade dos dados | Médio | 🟢 Alta | núcleo pronto |
| R3 | **IA — 2ª passada de matching** | Casa os "Não Encontrado" (qualidade) | Alto | 🟡 Média | gancho R3.0 |
| R4 | **Auto-update** | Distribuir correções sem reinstalar | Baixo | 🟢 Alta | CI de release |
| R5 | **Frontend: estado/UX** | Manutenção do React (telas grandes) | Médio | 🟡 Média | contrato estável |
| R6 | **Observabilidade** | Logs estruturados + painel de diagnóstico | Baixo | 🟢 Alta | — |
| R7 | **Enxugar o bundle** | Instalador ~496MB → bem menor | Baixo | 🟢 Alta | — |

**Ordem sugerida:** R7 → R6 → R4 (ganhos rápidos) → R1 (Tauri) → R2 (Parquet) → R3 (IA) → R5.

---

## R1 — Electron → Tauri

**O quê:** trocar o shell Electron por Tauri (Rust + webview do SO).
**Por quê:** Electron embarca um Chromium inteiro (RAM/disco altos); Tauri usa a webview nativa — binário ~10x menor e consumo de memória bem menor, **direto no gargalo dos desktops modestos**. Tauri tem suporte first-class a sidecar (`externalBin`), então o contrato de spawn do sidecar Python não muda.
**Impacto:** só o shell muda; `main.ts` → `main.rs` (ou config Tauri) fazendo o mesmo `spawn()` + health-probe. React e sidecar Python intactos.
**Cuidado:** revalidar o empacotamento do sidecar como `externalBin`; ajustar o CI.

## R2 — Bases como Parquet

**O quê:** ao ingerir, gravar cada base como arquivo **Parquet** em vez de tabela DuckDB.
**Por quê:** DuckDB consulta Parquet direto (sem `CREATE TABLE`); bases viram **arquivos portáteis/versionáveis**; a ingestão fica mais simples e o storage mais transparente. Reduz o tamanho do `.duckdb` único.
**Impacto:** `engine/ingest.py` grava `base_{id}.parquet`; queries usam `read_parquet(...)`. Metadados (SQLite) guardam o caminho.
**Cuidado:** colunas derivadas/updates in-place ficam menos triviais em Parquet (reescrever o arquivo) — avaliar por caso.

## R3 — IA: 2ª passada de matching

**Gancho (R3.0, barato — fazer cedo):** isolar a conciliação atrás de uma interface `Matcher` com uma implementação hoje (`ExactSqlMatcher`). O status `03_Não Encontrado` já é a fila natural da 2ª passada.
**O quê:** sobre os `03_Não Encontrado`, rodar uma 2ª passada com **embeddings locais** (ex.: MiniLM ~80MB): gera embeddings das chaves não-casadas, busca vizinhos (cosine > 0.85), marca como **"Match sugerido pela IA"** (não como Conciliado) → **usuário valida/rejeita**.
**Por quê:** resolve variações de texto que o match exato perde ("LTDA" vs "LTDA.", "001" vs "1"). Ver [analise-ia-vs-algoritmos-conciliacao-atribuicao.md](analise-ia-vs-algoritmos-conciliacao-atribuicao.md).
**Impacto:** nova `EmbeddingMatcher` plugável; UI de validação; +~80–400MB no bundle (cabe em 8GB).
**Cuidado:** **determinismo do core preservado** — a IA só sugere sobre o que sobrou; nunca reescreve a conciliação auditável. Rodar 2 vezes deve dar a mesma sugestão (fixar seed/thresholds).

## R4 — Auto-update

**O quê:** atualização automática do app (Tauri updater ou electron-updater).
**Por quê:** distribuir correções sem o usuário reinstalar.
**Impacto:** feed de update + assinatura; o CI de release publica os artefatos.
**Cuidado:** exige **certificados de assinatura** (Windows/macOS) — hoje o CI builda sem assinar.

## R5 — Frontend: estado/UX

**O quê:** o React fica (contrato congelado), mas revisar as telas grandes (`BaseDetails` ~745 l, `Bases` ~666 l), consolidar o polling em hooks reutilizáveis, revisar dark-mode.
**Por quê:** manutenibilidade — hoje há telas com muito `useState` e polling manual repetido.
**Cuidado:** só **depois** de o contrato REST estar 100% estável (para não perder o oráculo de contrato).

## R6 — Observabilidade

**O quê:** logging estruturado (JSON) no sidecar + painel de diagnóstico (jobs, memória, DuckDB) — expandindo `/api/debug/*`.
**Por quê:** hoje o diagnóstico é básico; um painel ajuda suporte e depuração em campo.
**Impacto:** middleware de log + endpoints de métricas + uma tela simples.

## R7 — Enxugar o bundle

**O quê:** reduzir o instalador (~496MB).
**Como:**
- **`pyarrow` é o maior peso** e é usado só em `ingest_calamine` (`pa.table`). Trocar por **Polars** nesse caminho permite **remover pyarrow** do runtime → bundle bem menor.
- `--exclude-module` para tkinter/matplotlib/pytest (já parcialmente no spec); avaliar UPX.
- Se R2 (Parquet) entrar, revisar deps de I/O.

---

## Ganchos já preparados

- **IA (R3.0):** o `03_Não Encontrado` do resultado nível-linha é a fila pronta para a 2ª passada.
- **Perfis de hardware:** `engine/db.py` já centraliza `memory_limit`/`threads` do DuckDB (ponto único para afinar por RAM/CPU).
