# Aion — Roadmap Unificado v0.7

> Consolidação completa: estado atual + 25 itens de melhoria + análise de 10 personas + gaps OpenCode → 10 steps de entrega priorizados.
> **Atualizado 2026-09-20**: Steps 1–9 confirmados como já implementados (ver checklist abaixo); Step 10 (TUI ink-based) segue como único item grande pendente. Nova seção "Roadmap v0.7 — Novas Features" adicionada a partir de gaps encontrados em auditoria de arquitetura (menu de comandos novos não exposto, validação de leitura em stores JSON).

---

## Estado Atual (v0.6.7 — 2026-09-20)

**1043 testes passando / 0 falhas (6 skipped, Windows-only mocks).**
**36+ comandos CLI publicados em `@aionlabsai/aion`, incluindo `workspace` (multi-repo) e `policy` (budget/deny-list) adicionados após o v0.5.1.**

### Desde o v0.5.1

| Capability | Status |
|---|---|
| Windows hardening (CVE-2024-27980: `shell:true` em todos os `spawnSync`/`spawn` de `.cmd`) | ✓ |
| `aion workspace init/list/sync/info` (multi-repo paralelo) | ✓ |
| Busca cross-repo + `WORKSPACE.md` agregado | ✓ |
| `aion policy` — budget caps, deny list, seleção de modelo, tracking de uso | ✓ |
| Validação de leitura (Zod `safeParse`) em `task-repo`/`evidence-repo` — substitui cast não validado | ✓ |

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

| Step | Impacto total (personas) | Complexidade | Status |
|---|---|---|---|
| Step 1 — Onboarding inteligente | Alto | Baixa | ✓ Shipped |
| Step 2 — Vim navigation + filter UX | Alto | Baixa | ✓ Shipped (`j`/`k` em `tui.ts`) |
| Step 3 — Spinners + feedback | Médio | Baixa | ✓ Shipped (`chat.ts`/`explain.ts` usam `ora`) |
| Step 4 — REPL persistence + chat polish | Médio | Baixa | ✓ Shipped (`chat-history.jsonl` + `--clear-history`) |
| Step 5 — Audit UX polish | Médio | Baixa | ✓ Shipped |
| Step 6 — Dívida técnica + i18n | Baixo | Baixa | ✓ Shipped |
| Step 7 — CI/scripting & automação | Médio | Média | ✓ Shipped |
| Step 8 — Inline output (sem Press Enter) | Alto | Média | ✓ Shipped (padrão `pressEnter` removido) |
| Step 9 — Score timeline + audit diff | Alto | Média | ✓ Shipped (`aion audit diff`, sparkline em `health.ts`) |
| Step 10 — TUI ink-based (OpenCode quality) | Muito alto | Muito alta | **Pendente — único item grande em aberto** |

---

## Roadmap v0.7 — Novas Features

> Itens levantados na auditoria de arquitetura de 2026-09-20 (code-graph-mcp + grep estrutural), não em brainstorm — cada um tem uma causa concreta abaixo.

| # | Feature | Prioridade | Complexidade | Evidência |
|---|---------|:---:|:---:|---|
| 1 | Expor `workspace` e `policy` no menu interativo | **P0** | Baixa | `grep -i "policy\|workspace" src/cli/menu.ts` não retorna nada — os dois comandos só existem via CLI direta (`program`), invisíveis para quem usa o menu TUI. Mesmo gap do Step 1 original (persona 1), agora reaberto por features novas. |
| 2 | Endurecer leitura de `policy.ts`/`workspace.ts` com Zod `safeParse` | **P2** | Baixa | `policy.ts:52` e `65` fazem `JSON.parse(...) as Partial<Policy>` sem validação de tipo — mitigado por `mergeWithDefaults`, mas um campo com tipo errado (ex.: `monthlyUsd` como string) passa direto. Mesmo padrão já corrigido em `task-repo.ts`/`evidence-repo.ts` (commit `e7d48c8`); reaproveitar `TaskRecordSchema` como modelo. |
| 3 | `aion workspace audit` — rollup de saúde multi-repo | **P1** | Média | A infra de sync/search cross-repo já existe (`workspace.ts`, `workspace-search.ts`), mas não há comando que agregue score/findings de `aion audit` através dos repos do workspace — hoje é rodar `audit` manualmente em cada um. |
| 4 | Centralizar tokens de cor/output em `renderer.ts` | **P3** | Baixa | `Renderer` mistura `console.log` e `process.stdout.write` entre métodos, e repete lógica de threshold de cor (`conf >= 80 ? green : ...`) inline em ~10 pontos. Sem bug funcional hoje; vale um helper único (`colorForScore()`) antes que a próxima métrica copie o padrão de novo. |

---

## 10 Steps de Entrega — v0.7

> Sequência sugerida: os 4 itens da tabela acima primeiro (baixo risco, diffs pequenos), depois os scanners zero-token de maior soma ponderada do Database/Network Intelligence Roadmap (mesma arquitetura de `analyzeNetwork`/`analyzeDatabase`, só aditivo), e a reescrita ink por último (único item arquitetural, maior risco).

### Step 1 — Expor `workspace`/`policy` no menu interativo
**Prioridade: P0 · Complexidade: Baixa**

- Adicionar grupo "Workspace" e "Policy" em `menu.ts` com os mesmos itens já registrados via Commander em `registerWorkspace`/`registerPolicy`
- Reusar o padrão de `MENU_LINES`/grupos já existente para `Setup`/`Audit`

**Arquivos:** `src/cli/menu.ts`

---

### Step 2 — Validação Zod em `policy.ts`/`workspace.ts`
**Prioridade: P2 · Complexidade: Baixa**

- Criar `PolicySchema` e `WorkspaceConfigSchema` em `src/schemas/` seguindo o modelo de `TaskRecordSchema` (commit `e7d48c8`)
- Trocar os `JSON.parse(...) as ...` em `policy.ts:52,65` e no equivalente em `workspace.ts` por `safeParse`, mantendo o fallback para `DEFAULT_POLICY` já existente em caso de erro

**Arquivos:** `src/schemas/policy.ts` (novo), `src/infra/policy.ts`, `src/infra/workspace.ts`

---

### Step 3 — `aion workspace audit` (rollup multi-repo)
**Prioridade: P1 · Complexidade: Média**

- Novo subcomando que itera `listRepos()` e roda o pipeline de audit local (zero-token) em cada repo, agregando score/findings num único output
- Reusar `collectAuditStats`/`AuditPipeline` já existentes em `src/core/pipelines`

**Arquivos:** `src/cli/commands/workspace.ts`, `src/core/pipelines/audit-pipeline.ts`

---

### Step 4 — Helper de cor/output em `renderer.ts`
**Prioridade: P3 · Complexidade: Baixa**

- Extrair `colorForScore(value, thresholds)` e padronizar em `process.stdout.write` (ou `console.log`, mas um só) nos ~10 pontos de `showResult`

**Arquivos:** `src/cli/ui/renderer.ts`

---

### Step 5 — `aion scan db-config` (Connection Config Auditor)
**Prioridade: Alta · Complexidade: Baixa · Soma 54 (maior do Database Intelligence Roadmap)**

- Novo `src/infra/db-config-analyzer.ts`: varre `.env`, `docker-compose.yml`, `prisma/schema.prisma`, `knexfile.js`, `typeorm.config.ts`
- Detecta `sslmode=disable`/`ssl:false`, ausência de pool/timeout, senha em texto plano na connection string
- Zero-token, mesmo formato de report de `analyzeNetwork`

**Arquivos:** `src/infra/db-config-analyzer.ts` (novo), `src/cli/commands/scan.ts` (novo subcomando `db-config`)

---

### Step 6 — `aion scan db-schema` (Schema Quality Analyzer)
**Prioridade: Alta · Complexidade: Média · Soma 49**

- Parseia schemas Prisma/TypeORM/Sequelize/Django; detecta FK sem índice, nullable sem default, ausência de `@unique` em email/cpf, tabela sem PK

**Arquivos:** `src/infra/db-schema-analyzer.ts` (novo), `src/cli/commands/scan.ts`

---

### Step 7 — `aion scan db-pii` (PII & Data Column Scanner)
**Prioridade: Alta · Complexidade: Baixa · Soma 49 · Relevante para LGPD/GDPR**

- Detecta colunas sensíveis (`email`, `cpf`, `senha`, `phone`, `ssn`) em schemas/migrations sem sinal de criptografia ou `select:false`

**Arquivos:** `src/infra/db-pii-analyzer.ts` (novo), `src/cli/commands/scan.ts`

---

### Step 8 — Request Logging / PII Leak Detector
**Prioridade: Média · Complexidade: Baixa · item #9 pendente do Network Roadmap**

- Estende `analyzeNetwork()` (não um subcomando novo — mesma arquitetura de um `NetworkReport` com mais um tipo de sinal) para detectar `console.log(req.body)` / `logger.info(req)` sem sanitização

**Arquivos:** `src/infra/network-analyzer.ts`

---

### Step 9 — WebSocket Security Checker
**Prioridade: Média · Complexidade: Baixa · item #10 pendente do Network Roadmap**

- Mesmo padrão do Step 8: novo sinal em `analyzeNetwork()` para `ws://` sem TLS, `upgrade` sem auth, broadcast sem filtro de sala

**Arquivos:** `src/infra/network-analyzer.ts`

---

### Step 10 — TUI ink-based (OpenCode quality)
**Prioridade: Muito alta impacto · Complexidade: Muito alta · carregado do roadmap anterior, único item arquitetural em aberto**

- Ver detalhamento completo na seção "Step 10" do roadmap original acima — sem mudanças, continua exigindo spike técnico antes de comprometer os outros 9 steps

**Arquivos:** `src/cli/tui.ts`, `src/cli/menu.ts`, `src/cli/ui/renderer.ts`, `package.json`

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

---

## Network & API Security Roadmap

> Zero-token static analysis of transport security, CORS, ID design, cookies, and API key exposure.
> Command prefix: `aion scan network`

### Priority Table

| # | Feature | Prioridade | Acurácia | Criticidade | Usabilidade | Manutenção | Segurança | Total |
|---|---------|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| 1 | HTTP vs HTTPS Enforcer | 9 | 9 | 10 | 8 | 7 | 10 | **53** |
| 2 | API Key Exposure Scanner | 9 | 8 | 10 | 8 | 6 | 10 | **51** |
| 3 | CORS Auditor | 9 | 8 | 9 | 8 | 7 | 10 | **51** |
| 4 | Sequential ID / IDOR Risk | 9 | 7 | 9 | 8 | 6 | 10 | **49** |
| 5 | Cookie Security Auditor | 8 | 8 | 8 | 8 | 7 | 9 | **48** |
| 6 | Sensitive Data in URLs/GET | 8 | 7 | 9 | 8 | 6 | 9 | **47** |
| 7 | ID Generation Auditor | 8 | 8 | 8 | 7 | 6 | 9 | **46** |
| 8 | Security Headers Checker | 7 | 7 | 7 | 8 | 7 | 8 | **44** |
| 9 | Request Logging / PII Leak | 7 | 6 | 8 | 7 | 6 | 9 | **43** |
| 10 | WebSocket Security | 6 | 7 | 7 | 6 | 6 | 8 | **40** |

### Item Details

**#1 — HTTP vs HTTPS Enforcer** ✅ implemented in `network-analyzer.ts`
Detects `http://` hardcoded in `fetch`, `axios`, `.env`, configs (excludes localhost). Checks for missing HSTS signals in Express/Fastify. Zero-token static analysis.

**#2 — API Key Exposure Scanner** ✅ implemented
Detects `sk-`, `pk_live_`, `AKIA`, `Bearer <token>`, `apiKey: '...'` hardcoded in source files (non-.env). Excludes legitimate `.env` files.

**#3 — CORS Auditor** ✅ implemented
Detects `origin: '*'` wildcard CORS, `Access-Control-Allow-Origin: *` in Express/Fastify/Next.js. Flags any CORS config missing an explicit allowlist.

**#4 — Sequential ID / IDOR Risk** ✅ implemented
Detects routes with `/:id` paired with `parseInt`/`Number()` — signals integer IDs in public routes, creating IDOR (Insecure Direct Object Reference) risk.

**#5 — Cookie Security Auditor** ✅ implemented
Detects `res.cookie()` / `setCookie()` calls without `httpOnly: true`, `secure: true`, or `sameSite` — common session hijacking vector.

**#6 — Sensitive Data in URLs/GET** ✅ implemented
Detects `?token=`, `?password=`, `?key=`, `?secret=`, `?api_key=` patterns in URL strings — leaks credentials to logs, browser history, and Referer headers.

**#7 — ID Generation Auditor** ✅ implemented
Detects `Math.random()` used for ID generation — not cryptographically secure. Recommends `crypto.randomUUID()`, `nanoid`, or `ULID`.

**#8 — Security Headers Checker** ✅ implemented
Detects presence of `helmet()`, `Content-Security-Policy`, `X-Frame-Options`, `X-Content-Type-Options`, `Strict-Transport-Security` in middleware.

**#9 — Request Logging / PII Leak** `aion scan net-log-pii` (future)
Detects `console.log(req.body)`, `logger.info(req)` without sanitization — leaks passwords and tokens to logs.

**#10 — WebSocket Security** `aion scan net-ws` (future)
Detects `ws://` (without TLS), missing auth on `upgrade` event, broadcast without room filter.
