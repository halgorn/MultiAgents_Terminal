# AI Engineering Runtime — Roadmap

## Estado atual (score: 4.8/10)

| Dimensão | Score | Principal gap |
|---|---|---|
| Architecture | 6/10 | orchestrator.ts god file (619 linhas) |
| Maintainability | 5/10 | 1 test file, silent catch blocks |
| Security | 7/10 | Melhor do grupo |
| Observability | 3/10 | Sem métricas, sem CostTracker |
| Scalability | 4/10 | Rate limit com 2 agentes simultâneos |
| Agent efficiency | 4/10 | Sem prompt caching, sem chunking estrutural |

---

## P0 — Crítico

### P0.1 — SDK Provider (habilita tudo)
**Problema:** CLI subprocess não suporta `cache_control` — system prompts re-enviados inteiros a cada chamada.  
**Impacto:** ~80% redução em tokens de system prompt via prompt caching.  
**Arquivo:** `src/providers/sdk-provider.ts` (novo) + atualizar `cli-provider.ts`  
**Status:** ⬜ pendente

### P0.2 — Tree-sitter chunking
**Problema:** agentes leem arquivos de 200-600 linhas para encontrar uma função de 20 linhas.  
**Impacto:** 70-85% menos tokens por contexto.  
**Arquivo:** `src/infra/chunker.ts` (novo)  
**Status:** ⬜ pendente

### P0.3 — Hybrid Search (BM25 + vetores)
**Problema:** `all-MiniLM` falha em matches de nomes de símbolos exatos.  
**Impacto:** recall 40% → 80%+ em queries de código.  
**Arquivo:** `src/infra/knowledge.ts` + `src/infra/embeddings.ts`  
**Status:** ⬜ pendente

---

## P1 — Importante

### P1.1 — Voyage Code embeddings
Substituir `all-MiniLM-L6-v2` por modelo treinado em código.  
**Status:** ⬜ pendente

### P1.2 — Dependency Graph (ts-morph)
Mapear imports entre módulos automaticamente.  
**Status:** ⬜ pendente

### P1.3 — CostTracker
Telemetria real de tokens e USD por tarefa.  
**Status:** ⬜ pendente

### P1.4 — Quebrar orchestrator.ts
619 linhas, 4 pipelines → separar em `FixPipeline`, `AuditPipeline`, `ReviewPipeline`.  
**Status:** ⬜ pendente

---

## P2 — Otimização

### P2.1 — Re-ranker nos resultados RAG
### P2.2 — Indexar código-fonte no RAG (não só `.ai-memory/`)
### P2.3 — Evidence Agent dedicado
### P2.4 — Call Graph para Developer

---

## Sequência de implementação

```
P0.1 SDK Provider
  → habilita prompt caching
  → habilita streaming nativo
  → elimina rate limit do CLI

P0.2 Tree-sitter chunking
  → depende de: nada
  → habilita: P0.3, P1.2, P2.4

P0.3 Hybrid Search
  → depende de: P0.2 (chunks menores = melhor indexação)

P1.1 Voyage Code
  → depende de: P0.3

P1.2 Dependency Graph
  → depende de: P0.2 (Tree-sitter já instalado)

P1.3 CostTracker
  → depende de: P0.1 (SDK retorna usage real)

P1.4 Refactor orchestrator
  → depende de: nada (pode ser paralelo)
```
