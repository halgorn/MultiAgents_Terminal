export type Intent = 'fix' | 'analyze' | 'audit' | 'review' | 'memory-build' | 'memory-search' | 'graph-index' | 'unknown';

interface Classification {
  intent: Intent;
  target: string;
}

const FIX_WORDS = [
  'fix', 'corrija', 'conserte', 'resolva', 'arrume', 'corrigi', 'corrige',
  'bug', 'erro', 'error', 'quebrado', 'broken', 'falha', 'falhou', 'crash',
  'não funciona', 'nao funciona', 'failing', 'failed',
];

const AUDIT_WORDS = [
  'audit', 'auditoria', 'audite', 'scan', 'escaneie', 'varredura',
  'todos os arquivos', 'all files', 'cobertura completa', 'full scan',
  'todos os problemas', 'all issues', 'everything', 'tudo',
];

const ANALYZE_WORDS = [
  'analyze', 'analise', 'analisa', 'investigue', 'investiga', 'examine',
  'procure', 'encontre', 'find', 'look', 'check', 'investigate',
  'o que está', 'o que esta', "what's wrong", 'whats wrong', 'why is',
  'por que', 'porque', 'entenda', 'entender',
];

const REVIEW_WORDS = [
  'review', 'revise', 'revisa', 'revisar', 'verifique', 'verifica',
  'olhe', 'leia', 'read', 'code review', 'pull request', 'pr', 'diff',
  'cheque', 'valide', 'validate',
];

const MEMORY_BUILD_WORDS = [
  'memory build', 'indexar', 'index', 'build index', 'build memory',
  'atualizar memória', 'atualizar memoria', 'update memory',
];

const MEMORY_SEARCH_WORDS = [
  'memory search', 'buscar', 'search memory', 'procurar na memória',
  'procurar na memoria', 'encontrar na memória',
];

const GRAPH_INDEX_WORDS = [
  'graph', 'grafo', 'index repo', 'indexar repositório', 'indexar repositorio',
  'repo index', 'build graph', 'construir grafo', 'estrutura do projeto',
  'mapa do projeto', 'dependências', 'dependencias', 'dep graph',
];

function score(text: string, words: string[]): number {
  const lower = text.toLowerCase();
  return words.reduce((n, w) => n + (lower.includes(w) ? 1 : 0), 0);
}

export function classify(input: string): Classification {
  const scores: Record<Intent, number> = {
    fix: score(input, FIX_WORDS),
    audit: score(input, AUDIT_WORDS),
    analyze: score(input, ANALYZE_WORDS),
    review: score(input, REVIEW_WORDS),
    'memory-build': score(input, MEMORY_BUILD_WORDS),
    'memory-search': score(input, MEMORY_SEARCH_WORDS),
    'graph-index': score(input, GRAPH_INDEX_WORDS),
    unknown: 0,
  };

  const best = (Object.entries(scores) as [Intent, number][])
    .filter(([, s]) => s > 0)
    .sort(([, a], [, b]) => b - a)[0];

  const intent: Intent = best ? best[0] : 'unknown';

  // Strip leading intent words to extract the actual target
  const target = input
    .replace(/^(fix|corrija|conserte|resolva|arrume|analise|analisa|investigue|review|revise|revisa|verifique|olhe)\s+/i, '')
    .trim() || input.trim();

  return { intent, target };
}
