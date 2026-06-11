#!/usr/bin/env bash
# Test all AI-powered functions using MiniMax provider
set -e

AION="node dist/index.js"
PROVIDER="--provider minimax"
BUDGET="--budget low"
TARGET_FILE="src/providers/minimax-provider.ts"
export OPENAI_API_KEY=

echo ""
echo "══════════════════════════════════════════════"
echo "  AION — Full AI Function Test (MiniMax)"
echo "══════════════════════════════════════════════"
echo ""

run() {
  echo "▶ $1"
  echo "  cmd: $2"
  echo ""
  eval "$2" 2>&1 | tail -20
  echo ""
  echo "──────────────────────────────────────────────"
  echo ""
}

run "1. ANALYZE — bug investigation" \
  "$AION analyze 'custo de tokens não aparece no output quando provider é minimax' $PROVIDER $BUDGET"

run "2. REVIEW — code review de arquivo" \
  "$AION review $TARGET_FILE $PROVIDER $BUDGET"

run "3. EXPLAIN — explicar arquivo" \
  "$AION explain $TARGET_FILE $PROVIDER"

run "4. IMPACT — análise de impacto" \
  "$AION impact $TARGET_FILE $PROVIDER"

run "5. AUDIT — auditoria local (zero token)" \
  "$AION audit . --local-only --domains bugs"

run "6. CONTEXT — gerar contexto compacto" \
  "$AION context providers"

run "7. HEALTH — health score (zero token)" \
  "$AION health"

run "8. SCAN — scan de secrets (zero token)" \
  "$AION scan secrets"

echo "✅ Todos os testes concluídos."
