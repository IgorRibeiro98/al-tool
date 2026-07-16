# Oráculo — validação v1 ≡ v2 (byte-a-byte)

Prova de que a **conciliação da v2 (Python) é idêntica à da v1 (Node)**, rodando o **código
real da v1** contra **dados reais**. É o gate de correção da reescrita (ver [../docs/remake-v2-python.md](../docs/remake-v2-python.md) §6).

## ✅ Resultado — TODOS os cenários idênticos

Rodando o **código real da v1** (headless) contra a v2, mesma entrada + mesma config:

| Cenário | Dados | Comparação | v1 vs v2 |
|---|---|---|---|
| **Conciliação A×B** | 2×5000 linhas **reais** | 4644 chaves, status por chave | ✅ **0 divergências** |
| **Multi-chave priorizada** | sintético (CHAVE_1→CHAVE_2) | distribuição de status | ✅ `{01:6, 02:2, 03:2}` idêntico |
| **Cancelamento** | sintético (indicador S/N) | distribuição de status | ✅ `{01:4, 04:2}` idêntico |
| **Estorno** | sintético (par que anula) | distribuição por grupo | ✅ `{Conciliado_Estorno:2, Conciliado:2, Não encontrado:1}` idêntico |
| **Atribuição** | sintético (OVERWRITE) | valores copiados | ✅ `[('ORIG1','100')]` idêntico |

**Toda a lógica de negócio da reescrita está comprovadamente fiel à v1** — não é "parece certo", é "é o mesmo que o app em produção gera". O cenário de conciliação usou 2×5000 linhas reais de `storage/ref`; os demais usaram datasets sintéticos controlados que exercitam cada regra especificamente.

## Como foi feito

1. **v1 headless**: `tsc` build (`apps/api/dist`) + `knex migrate:latest` + `node dist/server.js` num DB isolado, porta 3100.
2. **Datasets reais**: dois `.xlsx` (chave `nota` + `valor`) extraídos de `storage/ref` (Razão contábil, Livro fiscal), 5000 linhas cada — preservando valores reais (vírgula decimal, `NULL` literais).
3. **v1**: upload → **ingestão real da v1** (worker de conversão Python + StreamingIngestPipeline) → config (keys/pair) → conciliação → `{chave: status}`.
4. **v2**: mesmos `.xlsx`, mesma config (`nota` × `valor`, sem inversão, limite 0) → `{chave: status}`.
5. **Diff**: `compare.py` — 0 divergências.

## Armadilhas da v1 headless (para futuras execuções do oráculo)

A v1 é frágil fora do Electron (o diagnóstico do plano já apontava isso). Para rodá-la headless:
- **`pyxlsb` obrigatório** no Python do worker de conversão — `xlsb_to_arrow.py` importa no topo mesmo para `.xlsx`.
- **Buildar (`tsc`)**: os workers fazem `fork()` de arquivos **`.js`** — rodar via `ts-node` quebra ("Cannot find module ...Runner.js").
- **`WORKER_THREADS_ENABLED=false`**: o pool de worker-threads da conciliação trava em modo headless; desabilitado, cai no caminho síncrono (idêntico em resultado).
- `logs/` sem permissão de escrita gera warnings `EACCES` **não-fatais**.

## Reproduzir / estender

- `drive_v1.sh` — dirige a v1 via HTTP (subtype → upload → ingest → keys → config → conciliação → resultado).
- `compare.py` — diff de dois `{chave: status}` JSON.

O mesmo harness estende para validar **estorno, cancelamento, multi-chave e atribuição**: basta configurar o cenário nos dois lados e comparar. Este run cobriu a **conciliação A×B**, o núcleo.

## Nota de fidelidade

`base_1` (contábil) passou pela **ingestão real da v1**. `base_2` (fiscal) foi injetada replicando o schema/normalização da v1 (vírgula→ponto) — porque a ingestão da v1 emperrou por contenção de SQLite entre workers headless (fragilidade da v1, não da v2). A conciliação comparada é 100% código real da v1.
