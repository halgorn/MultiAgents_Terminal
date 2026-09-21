import type { RepoIndex } from './repo-index.js';

function esc(s: unknown): string {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

export interface ArchitectureNode {
  id: string;
  files: number;
  loc: number;
  symbols: number;
  fanIn: number;
  fanOut: number;
}

export interface ArchitectureEdge {
  from: string;
  to: string;
  weight: number;
}

function moduleName(path: string): string {
  const parts = path.split('/');
  if (parts[0] === 'src' && parts[1]) return `src/${parts[1]}`;
  return parts[0] ?? 'root';
}

export function buildArchitectureView(index: RepoIndex, cycles: number, lang: string) {
  const nodes = new Map<string, ArchitectureNode>();
  const edgeCounts = new Map<string, ArchitectureEdge>();

  for (const file of index.files) {
    const id = moduleName(file.path);
    const node = nodes.get(id) ?? { id, files: 0, loc: 0, symbols: 0, fanIn: 0, fanOut: 0 };
    node.files++;
    node.loc += file.loc;
    nodes.set(id, node);
  }

  for (const symbol of index.symbols) {
    const node = nodes.get(moduleName(symbol.file));
    if (node) node.symbols++;
  }

  for (const imp of index.imports) {
    if (!imp.resolved) continue;
    const from = moduleName(imp.from);
    const to = moduleName(imp.resolved);
    if (from === to) continue;
    const key = `${from} -> ${to}`;
    const edge = edgeCounts.get(key) ?? { from, to, weight: 0 };
    edge.weight++;
    edgeCounts.set(key, edge);
    const fromNode = nodes.get(from);
    const toNode = nodes.get(to);
    if (fromNode) fromNode.fanOut++;
    if (toNode) toNode.fanIn++;
  }

  const topNodes = [...nodes.values()]
    .sort((a, b) => (b.fanIn + b.fanOut + b.files) - (a.fanIn + a.fanOut + a.files) || a.id.localeCompare(b.id))
    .slice(0, 12);
  const kept = new Set(topNodes.map((node) => node.id));
  const edges = [...edgeCounts.values()]
    .filter((edge) => kept.has(edge.from) && kept.has(edge.to))
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 24);

  const style = cycles > 0 ? 'Cyclic / coupled' : edges.length > topNodes.length * 1.5 ? 'Layered with cross-module coupling' : 'Modular / low-cycle';
  return { lang, style, nodes: topNodes, edges };
}

function shortNodeLabel(id: string, max = 20): string {
  const base = id.split(/[/\\]/).pop() ?? id;
  return base.length > max ? `${base.slice(0, max - 1)}…` : base;
}

export function renderArchitectureSvg(nodes: ArchitectureNode[], edges: ArchitectureEdge[]): string {
  if (nodes.length === 0) return '<p class="muted">No architecture graph data available.</p>';
  const width = 1040;
  const height = Math.max(360, Math.ceil(nodes.length / 4) * 130 + 80);
  const positions = new Map<string, { x: number; y: number }>();
  nodes.forEach((node, i) => {
    const col = i % 4;
    const row = Math.floor(i / 4);
    positions.set(node.id, { x: 140 + col * 250, y: 90 + row * 130 });
  });
  const edgeSvg = edges.map((edge) => {
    const from = positions.get(edge.from);
    const to = positions.get(edge.to);
    if (!from || !to) return '';
    const stroke = Math.min(5, 1 + edge.weight / 2);
    return `<line x1="${from.x}" y1="${from.y}" x2="${to.x}" y2="${to.y}" stroke="#30363d" stroke-width="${stroke}" marker-end="url(#arrow)"><title>${esc(edge.from)} -> ${esc(edge.to)} (${edge.weight})</title></line>`;
  }).join('');
  const nodeSvg = nodes.map((node) => {
    const pos = positions.get(node.id)!;
    const r = Math.max(34, Math.min(58, 28 + Math.sqrt(node.files + node.symbols)));
    const hot = node.fanIn + node.fanOut >= 10;
    return `<g transform="translate(${pos.x},${pos.y})">
  <title>${esc(node.id)}</title>
  <circle r="${r}" fill="${hot ? '#3d2f00' : '#161b22'}" stroke="${hot ? '#e3b341' : '#58a6ff'}" stroke-width="2"></circle>
  <text text-anchor="middle" y="-6" fill="#e6edf3" font-size="12" font-weight="700">${esc(shortNodeLabel(node.id))}</text>
  <text text-anchor="middle" y="14" fill="#8b949e" font-size="11">${node.files} files · ${node.symbols} sym</text>
  <text text-anchor="middle" y="31" fill="#8b949e" font-size="10">in ${node.fanIn} / out ${node.fanOut}</text>
</g>`;
  }).join('');
  return `<div class="graph-wrap"><svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Application module graph">
<defs><marker id="arrow" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto"><path d="M0,0 L0,6 L9,3 z" fill="#30363d"/></marker></defs>
${edgeSvg}${nodeSvg}
</svg></div>`;
}
