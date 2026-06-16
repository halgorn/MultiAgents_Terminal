# Aion — Roadmap Unificado v0.5.1

> Consolidação completa: estado atual + 25 itens de melhoria + análise de 10 personas + gaps OpenCode → 10 steps de entrega priorizados.

---

## Estado Atual (v0.5.1 — 2026-06-16)

**742 testes passando / 0 falhas.**
**36 comandos CLI publicados em `@aionlabsai/aion`.**

### Infraestrutura Core

| Capability | Status |
|---|---|
| Worktree-isolated agents | ✓ |
| Runtime budgets (low / normal / deep) | ✓ |
| Tree-sitter chunking (TS/TSX + fallback) | ✓ |
| BM25 + hybrid semantic search | ✓ |
| Prompt caching (Anthropic SDK) | ✓ |
| Cost tracker (SDK accurate; CLI: unavailable) | ✓ |
| Evidence gate (findings vs repo-index) | ✓ |
| LangGraph orchestrator wrapper | ✓ |
| KnowledgeStore factory | ✓ |
| FindingAggregator (extraído, testado) | ✓ |
| runWithOrchestrator helper | ✓ |

### Comandos (36 total)

| Grupo | Comandos |
|---|---|
| Setup / Onboarding | `init` `setup` `doctor` `providers` `next` |
| Audit | `audit` `copilot` `release-check` |
| Análise AI | `analyze` `fix` `review` `diff` |
| Scans (zero-token) | `scan` (secrets, env-audit, sbom, api-map, cognitive-load, seo) |
| Memória / RAG | `memory` `index` `search` `eval` `deepeval` |
| Relatórios | `health` `report` `context` `graph` `tree` `churn` `patterns` `trace` |
| Chat / Explain | `chat` `explain` |
| CI / Deploy | `ci` `deploy` `cloud` `watch` `assist` |
| Infra | `mcp` `impact-local` `docs` |

### UX / TUI

| Feature | Status |
|---|---|
| Menu interativo com grupos e atalhos | ✓ |
| Fuzzy filter (digitar ativa filtro em selectOne) | ✓ |
| isSelectable helper (skip separators em selectOne + selectMany) | ✓ |
| Elapsed timers nos agents (`[name] 1.2s …preview`) | ✓ |
| Color-coded confidence (verde ≥80%, amarelo ≥50%, vermelho <50%) | ✓ |
| Terminal-width-aware (termCols, word-wrap, separadores adaptativos) | ✓ |
| Project name no REPL prompt (`ai[nome]> `) | ✓ |
| `/help` meta-command no REPL | ✓ |
| `aion next` state-aware (detecta setup + RAG ausente) | ✓ |
| `aion init` → sugere `aion setup` | ✓ |
| `setup --status` human-readable; `--json` para máquinas | ✓ |
| HTML audit dashboard extraído (`audit-report-html-dashboard.ts`) | ✓ |
| Non-TTY fallback (menu cai para guia textual sem travar) | ✓ |
| Stale index warning no menu | ✓ |
| Prefs de provider/modo persistidas entre sessões | ✓ |

---

## Análise de 10 Personas (resumo executivo)

| # | Persona | Nota atual | Principal blocker |
|---|---|---|---|
| 1 | Novo desenvolvedor | 4.5/10 | Não sabe que precisa rodar `aion setup` antes de metade dos comandos |
| 2 | Engenheiro de segurança | 7.2/10 | `copilot safe` fora do menu; falta delta entre runs |
| 3 | Tech lead senior | 6.4/10 | Sem CLI diff de audit runs; sem timeline de score |
| 4 | DevOps/SRE (CI) | 7.0/10 | Startup lento com tsx; sem exemplo GitHub Actions |
| 5 | Engenheiro AI/ML | 6.5/10 | Chat sem histórico persistente; sem spinner no index build |
| 6 | Product manager | 5.4/10 | `health` mostra score mas não diz "faça X para melhorar" |
| 7 | Dev junior | 5.8/10 | Sem spinner em `explain`; path de aprendizado não guiado |
| 8 | Power user terminal (vim) | 4.5/10 | **j/k ausente**; `/` para filtrar não existe; "Press Enter" bloqueante |
| 9 | Automação/Agente | 6.7/10 | Sem docs de integração; `--json` incompleto em alguns comandos |
| 10 | Contribuidor OSS | 7.4/10 | Strings mistas PT/EN em `classifier.ts`; poucos comentários de decisão |

**Nota média: 6.1/10**

### Gap vs OpenCode (os 4 maiores)

| Gap | Impacto | Complexidade |
|---|---|---|
| `j/k` vim navigation | Alta | Baixa (30 linhas em tui.ts) |
| `/` explícito para filter + fix q/filter conflict | Alta | Baixa |
| Output inline (substituir "Press Enter" + subprocess spawn) | Muito alta | Alta |
| Split layout + streaming (ink-based TUI) | Muito alta | Muito alta |

---

## 10 Steps de Entrega

### Step 1 — Onboarding Inteligente (Personas 1, 6, 7)
**Score atual: 3–4/10 → meta: 7/10**

**O que entregar:**
- Se `!isProjectPrepared(cwd)` ao entrar no menu: exibir banner "First time? Run `aion setup`" antes de mostrar o menu, não apenas no `aion next`
- Adicionar `aion doctor` e `aion providers` como itens visíveis no menu principal (grupo "System")
- `aion memory query` e `aion memory build` com mensagem de erro + fix inline quando índice ausente (item #9)
- `aion health`: após listar top risks, imprimir "→ `aion audit . --domains security,bugs`" como próximo passo (item #7)

**Arquivos:**
- `src/cli/menu.ts` — banner condicional + novos itens de menu
- `src/cli/commands/memory.ts` — on failure: causa + fallback
- `src/cli/commands/health.ts` — suggest action após top risks

**Impacto por persona:** P1 (+3), P6 (+2), P7 (+2)

---

### Step 2 — Vim Navigation + Filter UX (Persona 8, 1, 7)
**Score atual: 0/10 → meta: 8/10**

**O que entregar:**
- `j`/`k` como alias de ↑/↓ em `selectOne` e `selectMany`
- `/` para ativar modo filter (em vez de digitar diretamente)
- Fora do modo filter, `q` sai sem conflito
- Dentro do modo filter, `q` adiciona "q" ao filtro; `Esc` cancela
- Indicador visual: `/ filter mode` vs `↑↓ navigate`

**Arquivos:**
- `src/cli/tui.ts` — keypress handler, estados `navigating` vs `filtering`

**Impacto por persona:** P8 (+5), P1 (+1), P7 (+1)

---

### Step 3 — Spinners + Feedback em Operações Lentas (Personas 5, 7, 1)
**Score atual: 3/10 → meta: 8/10**

**O que entregar:**
- `aion chat`: spinner "Indexing codebase…" durante graph index build (item #10)
- `aion explain`: spinner "Building context for `<file>`…" durante context build (item #16)
- `aion watch`: imprimir qual pattern/diretório está sendo monitorado ao iniciar (item #13)
- `aion health`: imprimir "Report updated → `.ai-runtime/reports/latest/`" ao concluir (item #15)
- `aion search`: score exibido como `87%` com cor (verde/amarelo/vermelho) em vez de `0.87` raw (item #14)

**Arquivos:**
- `src/cli/commands/chat.ts`
- `src/cli/commands/explain.ts`
- `src/cli/commands/watch.ts`
- `src/cli/commands/health.ts`
- `src/cli/commands/search.ts`

**Impacto por persona:** P5 (+2), P7 (+2), P4 (+1)

---

### Step 4 — REPL Persistence + Chat Polish (Personas 5, 7)
**Score atual: 4/10 → meta: 7/10**

**O que entregar:**
- `aion chat`: histórico persistido em `.ai-runtime/chat-history.json` (item #18)
- `aion chat --clear-history`: limpa histórico (item #25)
- `aion report latest`: após mostrar o report, explicar o que é `ai-context.md` e `digest.md` e quando usar cada um (item #8)
- `aion providers`: codex mostra aviso "requires `npm i -g @openai/codex`" como item separado no menu de troca de provider (item #19)

**Arquivos:**
- `src/cli/commands/chat.ts`
- `src/cli/commands/report.ts`
- `src/cli/commands/providers.ts`
- `src/cli/menu.ts` (PROVIDER_ITEMS)

**Impacto por persona:** P5 (+2), P7 (+1), P1 (+1)

---

### Step 5 — Audit UX Polish (Personas 2, 3, 6)
**Score atual: 6/10 → meta: 8/10**

**O que entregar:**
- `aion audit` refusal message exibe o comando correto (`aion audit .` não `ai audit .`) (item #21)
- `aion audit --since <date>` exibir resumo de "apenas N arquivos modificados desde <data>"
- `aion copilot safe` adicionado ao menu principal como opção no grupo Audit
- `aion health`: score comparado com run anterior ("↑3 desde ontem") quando histórico existe

**Arquivos:**
- `src/cli/commands/audit.ts`
- `src/cli/commands/health.ts`
- `src/cli/menu.ts`

**Impacto por persona:** P2 (+1), P3 (+2), P6 (+1)

---

### Step 6 — Dívida Técnica + Internacionalização (Persona 10, 9)
**Score atual: 5/10 → meta: 8/10**

**O que entregar:**
- `src/infra/classifier.ts`: substituir termos PT por EN na documentação interna (item #23)
- `BUDGETS` em `menu.ts`: substituir estimativas hardcoded por ranges derivados de histórico real quando disponível (item #24)
- `aion audit` refusal: mostrar o comando exato com os flags usados, não genérico
- `src/index.ts`: lazy import dos comandos não-críticos para reduzir startup em CI

**Arquivos:**
- `src/infra/classifier.ts`
- `src/cli/menu.ts`
- `src/cli/commands/audit.ts`
- `src/index.ts`

**Impacto por persona:** P10 (+2), P4 (+1), P9 (+1)

---

### Step 7 — CI/Scripting & Automação (Personas 4, 9)
**Score atual: 6.5/10 → meta: 8.5/10**

**O que entregar:**
- `npm run build` compilando para `dist/` + instruções de uso em produção (sem tsx overhead)
- Exemplo de GitHub Actions workflow no README (seção "CI Integration")
- `aion mcp` serve tools via stdio — documentar como integrar em outro agente
- `--json` em `aion watch` (outputa eventos como JSON lines para pipe)
- `aion doctor --json` output estruturado para scripts

**Arquivos:**
- `README.md` — seção CI + MCP integration
- `src/cli/commands/watch.ts`
- `src/cli/commands/doctor.ts`
- `package.json` / `tsconfig.json` — build pipeline

**Impacto por persona:** P4 (+2), P9 (+2)

---

### Step 8 — Inline Output (Eliminar "Press Enter") (Personas 8, 1, 7)
**Score atual: 4/10 → meta: 7/10**

**O que entregar:**
- Substituir o padrão `run() → spawnSync → pressEnter()` por output inline com scroll
- Comandos locais (scan, health, report, search) rodam inline no mesmo processo
- Comandos AI (audit, analyze, fix) mostram streaming output sem deixar o TUI
- "Back to menu" aparece como linha dim após o output, não como prompt bloqueante
- Estado do menu é preservado ao voltar

**Arquivos:**
- `src/cli/menu.ts` — refatorar `run()` e `pressEnter()`
- `src/cli/tui.ts` — suporte a scroll region / inline output

**Impacto por persona:** P8 (+3), P1 (+2), P7 (+1)

---

### Step 9 — Score Timeline + Audit Diff (Personas 3, 2, 6)
**Score atual: 5/10 → meta: 8/10**

**O que entregar:**
- `aion audit diff <run1> <run2>` (ou `aion audit diff --last-2`): imprime findings novos, resolvidos, e score delta
- `aion health` mostra sparkline ASCII de score nas últimas 5 runs (quando histórico existe)
- `aion report` com flag `--compare-last` exibe delta no HTML
- `aion watch` dispara notificação de delta após cada run (stdout + webhook)

**Arquivos:**
- `src/cli/commands/audit.ts` — subcomando `diff`
- `src/cli/commands/health.ts` — sparkline + delta
- `src/infra/audit-report-html.ts` — seção de compare
- `src/cli/commands/watch.ts` — delta notification

**Impacto por persona:** P3 (+3), P2 (+2), P6 (+2)

---

### Step 10 — TUI de Qualidade OpenCode (ink-based) (Todas as personas)
**Score atual: 4.5/10 → meta: 9/10**

**O que entregar:**
- Migrar `tui.ts` para [ink](https://github.com/vadimdemedes/ink) (React para terminal)
- Split layout: lista de comandos (esquerda) + preview/description (direita)
- Streaming output inline — output do agent aparece dentro do TUI sem subprocess
- Persistent header fixo com project name, provider, RAG status, cost acumulado
- Breadcrumb navigation (pilha: Menu → Audit → Mode → Running)
- Vim keybindings nativos (j/k, /, Esc, g/G para top/bottom)
- `Ctrl+C` cancela agent em andamento sem sair do TUI

**Arquivos:**
- `src/cli/tui.ts` → reescrita com ink
- `src/cli/menu.ts` → componentes React/ink
- `src/cli/renderer.ts` → integração com ink stream
- `package.json` → adicionar `ink`, `@inkjs/ui`

**Impacto por persona:** Todas (+2 a +4)
**Nota:** Este step é uma mudança arquitetural. Requer spike técnico para validar compatibilidade com o padrão de spawn de subprocessos atual.

---

## Matriz de Impacto × Complexidade

| Step | Impacto total (personas) | Complexidade | Prioridade |
|---|---|---|---|
| Step 1 — Onboarding inteligente | Alto | Baixa | **P0** |
| Step 2 — Vim navigation + filter UX | Alto | Baixa | **P0** |
| Step 3 — Spinners + feedback | Médio | Baixa | **P1** |
| Step 4 — REPL persistence + chat polish | Médio | Baixa | **P1** |
| Step 5 — Audit UX polish | Médio | Baixa | **P1** |
| Step 6 — Dívida técnica + i18n | Baixo | Baixa | **P2** |
| Step 7 — CI/scripting & automação | Médio | Média | **P2** |
| Step 8 — Inline output (sem Press Enter) | Alto | Média | **P2** |
| Step 9 — Score timeline + audit diff | Alto | Média | **P3** |
| Step 10 — TUI ink-based (OpenCode quality) | Muito alto | Muito alta | **P3** |

---

## Database Intelligence Roadmap

> Análise com 10 personas (Backend Engineer, DBA, DevOps/SRE, Security Engineer, Junior Developer, Tech Lead, Startup CTO, QA Engineer, Full-stack Developer, Compliance/DPO).
>
> O `db-analyzer.ts` cobre análise estática básica (ORM detection, N+1 signals, pool, paginação, migrações como sinais). O que falta está abaixo.

Scores de 0 a 10 por dimensão. Ordenado por prioridade total ponderada.

| # | Feature | Prioridade | Acurácia | Criticidade | Usabilidade | Manutenção | Segurança | Soma |
|---|---------|:-----------:|:--------:|:-----------:|:-----------:|:----------:|:---------:|:----:|
| 1 | Connection Config Auditor (`aion scan db-config`) | 9 | 9 | 9 | 9 | 8 | 10 | **54** |
| 2 | Schema Quality Analyzer (`aion scan db-schema`) | 9 | 8 | 9 | 9 | 8 | 6 | **49** |
| 3 | PII & Data Column Scanner (`aion scan db-pii`) | 8 | 7 | 9 | 8 | 7 | 10 | **49** |
| 4 | Duplicate Query Detector (`aion scan db-duplicates`) | 8 | 7 | 8 | 9 | 8 | 3 | **43** |
| 5 | Migration Health Analyzer (`aion scan db-migrations`) | 7 | 8 | 8 | 8 | 7 | 5 | **43** |
| 6 | Unbounded Query Guard (enhance db-analyzer) | 7 | 8 | 8 | 9 | 8 | 3 | **43** |
| 7 | Transaction Safety Analyzer (enhance db-analyzer) | 7 | 6 | 9 | 7 | 6 | 6 | **41** |
| 8 | N+1 Loop Detector — deep (enhance db-analyzer) | 8 | 6 | 9 | 7 | 6 | 2 | **38** |
| 9 | AI Query Optimizer (`--domains data`) | 6 | 7 | 8 | 8 | 7 | 3 | **39** |
| 10 | Live Schema Introspection (`aion db connect`) | 5 | 10 | 10 | 5 | 4 | 7 | **41** |

### #1 — Connection Config Auditor `aion scan db-config` — Soma 54

Varre `.env`, `docker-compose.yml`, `prisma/schema.prisma`, `knexfile.js`, `typeorm.config.ts`.
Detecta: `sslmode=disable` / `ssl: false`, ausência de `connectionLimit`/`pool_size`, ausência de `connect_timeout`, senha em texto plano na connection string.
Zero token. Análise estática de arquivos de config estruturados — alta acurácia.

### #2 — Schema Quality Analyzer `aion scan db-schema` — Soma 49

Parseia schemas Prisma, entidades TypeORM, modelos Sequelize/Django.
Detecta: FK sem `@@index`, campos nullable sem default, ausência de `@unique` em email/cpf, tabelas sem PK, relações sem `onDelete`.
Zero token. Arquivos estruturados = acurácia alta.

### #3 — PII & Data Column Scanner `aion scan db-pii` — Soma 49

Detecta nomes de coluna sensíveis (`email`, `cpf`, `senha`, `password`, `phone`, `ssn`, `dob`) em schemas ORM e migrations sem sinais de criptografia (`select: false`, `@db.VarChar` com encrypt, audit log).
Relevante para LGPD/GDPR. Zero token.

### #4 — Duplicate Query Detector `aion scan db-duplicates` — Soma 43

Extrai chamadas ORM por arquivo (modelo + operação + campos + filtros) e agrupa por similaridade.
Detecta o mesmo `findMany(User)` reescrito em 3 arquivos diferentes. Output: grupos de duplicatas com localização + sugestão de repositório.

### #5 — Migration Health Analyzer `aion scan db-migrations` — Soma 43

Varre arquivos de migration: FK sem índice correspondente, `DROP COLUMN` sem verificação de dependências, migrations irreversíveis sem `down()`, `ALTER TABLE` em tabelas grandes sem aviso.
Complementa o contador atual de `migrationFiles` com análise de conteúdo.

### #6 — Unbounded Query Guard (enhance) — Soma 43

O `db-analyzer` já conta `unboundedListSignals`. A melhoria: localizar cada ocorrência (arquivo + linha aproximada), sugerir o `take` exato por contexto (API endpoint → 20, admin → 100), diferenciar queries públicas de administrativas.

### #7 — Transaction Safety Analyzer (enhance) — Soma 41

Detecta: múltiplos writes em sequência sem `$transaction()`, `Promise.all` com escritas paralelas (race condition), read-modify-write sem lock. O atual só conta `transactionSignals` sem localizar o problema.

### #8 — N+1 Loop Detector — deep (enhance) — Soma 38

O atual detecta `relationRiskSignals` por contagem. O deep detector busca o padrão concreto: iteração sobre lista + chamada ORM dentro do loop no mesmo arquivo ou caller imediato.

### #9 — AI Query Optimizer `aion audit . --domains data` — Soma 39

Usa AI para sugerir rewrites de queries identificadas pelos scanners locais: uso de índices existentes, substituição de N+1 por `include`/`JOIN`, projeção específica em vez de `SELECT *`. Usa tokens — ativado via `--domains data`.

### #10 — Live Schema Introspection `aion db connect` — Soma 41

Conecta ao banco (Postgres, MySQL, SQLite) e compara: schema ORM vs schema real, índices no código vs índices no banco, tabelas órfãs. Máxima precisão mas exige connection string — UX mais complexa, manutenção de múltiplos drivers.

---

## Critérios de Qualidade (permanentes)

- `npm test` ≥ 742 testes passando
- `release-check` passa (guardrail 500 linhas por arquivo, todos os arquivos chave presentes)
- Nenhuma string em PT em output voltado ao usuário
- Non-TTY: todo comando funciona sem travar
- Providers suportados: claude, openrouter, kimi, minimax, codex
- Score mínimo por commit: +20 pontos no scoring matrix (Architecture + Reliability + Maintainability + Observability + Security)
