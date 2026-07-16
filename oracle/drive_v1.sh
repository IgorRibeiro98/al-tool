#!/usr/bin/env bash
# Dirige a v1 (porta 3100) para produzir uma conciliação real e salvar {chave: status}.
set -euo pipefail
B=http://127.0.0.1:3100/api
ORA="$(dirname "$0")"
jqpy() { python3 -c "import sys,json; d=json.load(sys.stdin); print($1)"; }

echo "1) subtype"
curl -s -X POST $B/bases/subtypes -H 'Content-Type: application/json' -d '{"name":"oracle"}' >/dev/null || true

echo "2) upload razão (CONTABIL) e livro (FISCAL), header linha 1 col 1"
BC=$(curl -s -X POST $B/bases -F "arquivo=@$ORA/razao_small.xlsx" -F tipo=CONTABIL -F nome=razao -F periodo=t -F subtype=oracle -F header_linha_inicial=1 -F header_coluna_inicial=1 | jqpy "d['data'][0]['id']")
BF=$(curl -s -X POST $B/bases -F "arquivo=@$ORA/livro_small.xlsx" -F tipo=FISCAL -F nome=livro -F periodo=t -F subtype=oracle -F header_linha_inicial=1 -F header_coluna_inicial=1 | jqpy "d['data'][0]['id']")
echo "   base_contabil=$BC base_fiscal=$BF"

echo "3) ingest + poll até rowCount"
for BID in $BC $BF; do
  curl -s -X POST $B/bases/$BID/ingest >/dev/null
done
for BID in $BC $BF; do
  for i in $(seq 1 60); do
    RC=$(curl -s $B/bases/$BID | jqpy "d.get('rowCount')")
    [ "$RC" != "None" ] && { echo "   base $BID rowCount=$RC"; break; }
    sleep 0.5
  done
done

echo "4) colunas (confirmar nomes sanitizados)"
curl -s $B/bases/$BC/columns | jqpy "[c['sqlite_name'] for c in d['data']]"

echo "5) keys + pair"
CK=$(curl -s -X POST $B/keys -H 'Content-Type: application/json' -d '{"nome":"ck","base_tipo":"CONTABIL","base_subtipo":"oracle","columns":["nota"]}' | jqpy "d['id']")
FK=$(curl -s -X POST $B/keys -H 'Content-Type: application/json' -d '{"nome":"fk","base_tipo":"FISCAL","base_subtipo":"oracle","columns":["nota"]}' | jqpy "d['id']")
PAIR=$(curl -s -X POST $B/keys-pairs -H 'Content-Type: application/json' -d "{\"nome\":\"p\",\"contabil_key_id\":$CK,\"fiscal_key_id\":$FK}" | jqpy "d['id']")
echo "   ck=$CK fk=$FK pair=$PAIR"

echo "6) config conciliação (valor x valor, sem inversão, limite 0)"
CFG=$(curl -s -X POST $B/configs/conciliacao -H 'Content-Type: application/json' -d "{\"nome\":\"cfg\",\"base_contabil_id\":$BC,\"base_fiscal_id\":$BF,\"keys\":[{\"key_identifier\":\"CHAVE_1\",\"keys_pair_id\":$PAIR}],\"coluna_conciliacao_contabil\":\"valor\",\"coluna_conciliacao_fiscal\":\"valor\",\"inverter_sinal_fiscal\":false,\"limite_diferenca_imaterial\":0}" | jqpy "d['id']")
echo "   config=$CFG"

echo "7) conciliação + poll"
JOB=$(curl -s -X POST $B/conciliacoes -H 'Content-Type: application/json' -d "{\"configConciliacaoId\":$CFG,\"nome\":\"oracle\"}" | jqpy "d['id']")
echo "   job=$JOB"
for i in $(seq 1 120); do
  ST=$(curl -s $B/conciliacoes/$JOB | jqpy "d['job']['status']")
  echo "   status=$ST"
  [ "$ST" = "DONE" ] && break
  [ "$ST" = "FAILED" ] && { curl -s $B/conciliacoes/$JOB | jqpy "d['job'].get('erro')"; exit 1; }
  sleep 1
done

echo "8) coleta resultado (todas as páginas) → {chave: status}"
python3 - "$JOB" > "$ORA/v1_result.json" <<'PY'
import sys, json, urllib.request
job=sys.argv[1]; B="http://127.0.0.1:3100/api"
out={}; page=1
while True:
    d=json.load(urllib.request.urlopen(f"{B}/conciliacoes/{job}/resultado?page={page}&pageSize=2000"))
    for r in d["data"]:
        k=r.get("CHAVE_1") or r.get("chave")
        out[str(k)]=r["status"]
    if page*d["pageSize"] >= d["total"]: break
    page+=1
json.dump(out, sys.stdout)
PY
echo "   chaves coletadas: $(python3 -c "import json;print(len(json.load(open('$ORA/v1_result.json'))))")"
echo "   distribuição v1:"; python3 -c "import json,collections; print(dict(collections.Counter(json.load(open('$ORA/v1_result.json')).values())))"
