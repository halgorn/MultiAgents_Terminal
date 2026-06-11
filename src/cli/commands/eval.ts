import type { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { embedTextRemote, embedText } from '../../infra/embeddings.js';
import { createVectorStore } from '../../infra/vector-store.js';
import { rerankWithLLM, rerankLocal } from '../../infra/reranker.js';
import { BM25Index, rrfScore } from '../../infra/bm25.js';
import { AI_RUNTIME_DIR } from '../../infra/paths.js';

// ── Golden Set Schema ─────────────────────────────────────────────────────────
// .ai-memory/eval/retrieval.json:
// { "queries": [{ "query": "...", "expected": ["file.ts", ...] }] }

interface GoldenQuery {
  query: string;
  expected: string[];
  note?: string;
}

interface GoldenSet {
  queries: GoldenQuery[];
}

interface EvalResult {
  query: string;
  expected: string[];
  retrieved: string[];
  hitAt3: boolean;
  hitAt5: boolean;
  rr: number; // reciprocal rank
}

interface EvalReport {
  provider: string;
  backend: string;
  rerankMode: string;
  queries: number;
  recall3: number;
  recall5: number;
  mrr: number;
  results: EvalResult[];
  ranAt: string;
}

function loadGoldenSet(path: string): GoldenSet | null {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as GoldenSet;
  } catch {
    return null;
  }
}

function scaffoldGoldenSet(path: string): void {
  mkdirSync(join(path, '..'), { recursive: true });
  const example: GoldenSet = {
    queries: [
      { query: 'embedding vector similarity', expected: ['src/infra/embeddings.ts'], note: 'example — edit expected files' },
      { query: 'BM25 ranking score', expected: ['src/infra/bm25.ts'] },
      { query: 'audit pipeline scanner agents', expected: ['src/core/pipelines/audit-pipeline.ts'] },
    ],
  };
  writeFileSync(path, JSON.stringify(example, null, 2), 'utf8');
}

export function registerEval(program: Command): void {
  const evalCmd = program
    .command('eval')
    .description('Evaluate retrieval quality and agent output quality');

  // ── aion eval retrieval ───────────────────────────────────────────────────
  evalCmd
    .command('retrieval')
    .description('Measure recall@3, recall@5, MRR of memory search against a golden set')
    .option('--rerank <mode>', 'none | local | llm — apply re-ranking after retrieval (default: none)', 'none')
    .option('--top-k <n>', 'candidates to retrieve before re-ranking', '10')
    .option('--scaffold', 'create example golden set at .ai-memory/eval/retrieval.json and exit')
    .option('--json', 'output results as JSON')
    .action(async (options: { rerank: string; topK: string; scaffold?: boolean; json?: boolean }) => {
      const cwd = process.cwd();
      const goldenPath = join(cwd, '.ai-memory', 'eval', 'retrieval.json');

      if (options.scaffold) {
        scaffoldGoldenSet(goldenPath);
        console.log(chalk.green(`Created: ${goldenPath}`));
        console.log(chalk.gray('Edit the file with your project-specific queries and expected files, then run `aion eval retrieval`.'));
        return;
      }

      if (!existsSync(goldenPath)) {
        console.error(chalk.yellow(`No golden set found at ${goldenPath}`));
        console.error(chalk.gray('Run `aion eval retrieval --scaffold` to create an example.'));
        process.exit(1);
      }

      const golden = loadGoldenSet(goldenPath);
      if (!golden || golden.queries.length === 0) {
        console.error(chalk.red('Golden set is empty or invalid.'));
        process.exit(1);
      }

      const topK = Math.max(5, parseInt(options.topK, 10) || 10);
      const spinner = ora(`Evaluating ${golden.queries.length} queries (rerank: ${options.rerank})...`).start();

      const vectorStore = createVectorStore(cwd);
      if (vectorStore.size() === 0) {
        spinner.fail(chalk.yellow('No vector index. Run `aion memory build` first.'));
        process.exit(1);
      }

      const results: EvalResult[] = [];

      for (const { query, expected } of golden.queries) {
        // 1. Embed query
        const remote = await embedTextRemote(query);
        const queryVec = remote ? remote : Array.from(embedText(query, 500));

        // 2. Vector search → top-K candidates
        const vecResults = await vectorStore.search(queryVec, topK);

        // 3. BM25 over the same candidates (in-memory)
        const bm25 = new BM25Index();
        for (const r of vecResults) {
          bm25.add(r.id, String(r.payload['preview'] ?? r.id));
        }
        const bm25Results = bm25.score(query);

        // 4. RRF fusion
        const fused = rrfScore(
          vecResults.map((r, i) => ({ id: r.id, score: vecResults.length - i })),
          bm25Results,
        );

        // 5. Optional re-ranking
        let finalIds: string[];
        if (options.rerank === 'llm') {
          const candidates = fused.slice(0, topK).map((r) => {
            const hit = vecResults.find((v) => v.id === r.id);
            return { id: r.id, content: String(hit?.payload['preview'] ?? r.id) };
          });
          const reranked = await rerankWithLLM(query, candidates, 5);
          finalIds = reranked.map((r) => r.id);
        } else if (options.rerank === 'local') {
          const candidates = fused.slice(0, topK).map((r) => {
            const hit = vecResults.find((v) => v.id === r.id);
            return { id: r.id, content: String(hit?.payload['preview'] ?? r.id) };
          });
          finalIds = rerankLocal(query, candidates, 5).map((r) => r.id);
        } else {
          finalIds = fused.slice(0, 5).map((r) => r.id);
        }

        // 6. Score: match by file path substring
        const matchesExpected = (id: string) =>
          expected.some((exp) => id.includes(exp) || exp.includes(id.split(':')[0] ?? ''));

        const rankOfFirst = finalIds.findIndex(matchesExpected);
        results.push({
          query,
          expected,
          retrieved: finalIds,
          hitAt3: rankOfFirst >= 0 && rankOfFirst < 3,
          hitAt5: rankOfFirst >= 0 && rankOfFirst < 5,
          rr: rankOfFirst >= 0 ? 1 / (rankOfFirst + 1) : 0,
        });
      }

      spinner.stop();

      const n = results.length;
      const recall3 = results.filter((r) => r.hitAt3).length / n;
      const recall5 = results.filter((r) => r.hitAt5).length / n;
      const mrr = results.reduce((s, r) => s + r.rr, 0) / n;

      const { embeddingProvider } = await import('../../infra/embeddings.js');
      const { vectorStoreBackend } = await import('../../infra/vector-store.js');

      const report: EvalReport = {
        provider: embeddingProvider(),
        backend: vectorStoreBackend(),
        rerankMode: options.rerank,
        queries: n,
        recall3: Math.round(recall3 * 1000) / 1000,
        recall5: Math.round(recall5 * 1000) / 1000,
        mrr: Math.round(mrr * 1000) / 1000,
        results,
        ranAt: new Date().toISOString(),
      };

      if (options.json) {
        console.log(JSON.stringify(report, null, 2));
        return;
      }

      // Human-readable output
      console.log(chalk.bold(`\nRetrieval Evaluation — ${n} queries\n`));
      console.log(`  Provider:  ${chalk.cyan(report.provider)}`);
      console.log(`  Backend:   ${chalk.cyan(report.backend)}`);
      console.log(`  Re-rank:   ${chalk.cyan(options.rerank)}\n`);

      const pct = (v: number) => chalk.bold(`${(v * 100).toFixed(1)}%`);
      console.log(`  recall@3   ${pct(recall3)}`);
      console.log(`  recall@5   ${pct(recall5)}`);
      console.log(`  MRR        ${pct(mrr)}\n`);

      for (const r of results) {
        const status = r.hitAt3 ? chalk.green('✓') : r.hitAt5 ? chalk.yellow('~') : chalk.red('✗');
        console.log(`  ${status}  ${chalk.gray(r.query.slice(0, 60))}`);
        if (!r.hitAt5) {
          console.log(chalk.gray(`       expected: ${r.expected.join(', ')}`));
          console.log(chalk.gray(`       got:      ${r.retrieved.slice(0, 3).join(', ')}`));
        }
      }

      // Save report
      const outDir = join(cwd, AI_RUNTIME_DIR, 'eval');
      mkdirSync(outDir, { recursive: true });
      const outPath = join(outDir, `retrieval-${Date.now()}.json`);
      writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8');
      console.log(chalk.gray(`\n  Report saved: ${outPath}`));
    });
}
