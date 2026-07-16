"""Constantes de domínio — espelham 1:1 os valores da v1 (fonte da verdade: código, não README).

Referências v1:
- EPSILON, status e labels: apps/api/src/workers/helpers/conciliacaoHelper.ts
- estorno: apps/api/src/pipeline/core/steps/EstornoBaseAStep.ts
"""

from __future__ import annotations

from typing import Final

# Tolerância para igualdade de valores monetários (conciliacaoHelper.ts:150)
EPSILON: Final[float] = 1e-6

# Casas decimais usadas em normalizeAmount (toFixed(6))
AMOUNT_DECIMALS: Final[int] = 6

# Status de conciliação (conciliacaoHelper.ts:151-153; EstornoBaseAStep.ts:20-22)
STATUS_CONCILIADO: Final[str] = "01_Conciliado"
STATUS_FOUND_DIFF: Final[str] = "02_Encontrado c/Diferença"
STATUS_NOT_FOUND: Final[str] = "03_Não Encontrado"
STATUS_NAO_AVALIADO: Final[str] = "04_Não Avaliado"

# Labels de grupo (conciliacaoHelper.ts:154-156, 222, 225)
LABEL_CONCILIADO: Final[str] = "Conciliado"
LABEL_DIFF_IMATERIAL: Final[str] = "Diferença Imaterial"
LABEL_NOT_FOUND: Final[str] = "Não encontrado"
LABEL_BASE_A_MAIOR: Final[str] = "Encontrado com diferença, BASE A MAIOR"
LABEL_BASE_B_MAIOR: Final[str] = "Encontrado com diferença, BASE B MAIOR"

# Estorno (EstornoBaseAStep.ts:19, 38)
GROUP_ESTORNO: Final[str] = "Conciliado_Estorno"
SOMA_PRECISION: Final[int] = 100  # 2 casas decimais para indexar soma
