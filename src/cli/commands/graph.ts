import type { Command } from 'commander';
import { mkdirSync, writeFileSync, existsSync, readFileSync, copyFileSync } from 'fs';
import { dirname } from 'path';
import { join } from 'path';
import { spawnSync } from 'child_process';
import { GraphAgent } from '../../agents/graph-agent.js';
import { detectLang } from '../../infra/lang-detect.js';
import { buildDepGraph, buildDepGraphAuto } from '../../infra/dep-graph.js';
import { displayProjectName } from '../../infra/project-name.js';

import type { DepGraph } from '../../infra/dep-graph.js';
import type { RepoIndex } from '../../infra/repo-index.js';

interface GraphNode {
  id: string;
  label: string;
  group: string;
  size: number;
  fanIn: number;
  fanOut: number;
  loc: number;
  isTest: boolean;
  isHotspot: boolean;
  symbols: string[];
}

interface GraphEdge {
  source: string;
  target: string;
}

interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
  stats: { files: number; symbols: number; cycles: number; hotspots: number; lang: string };
}

function groupFromPath(path: string): string {
  const parts = path.split('/');
  return parts.length === 1 ? 'root' : (parts[0] ?? 'root');
}

function buildGraphData(index: RepoIndex, dep: DepGraph): GraphData {
  const hotspotSet = new Set(dep.hotspots.slice(0, 15).map((h) => h.file));
  const hotspotMap = new Map(dep.hotspots.map((h) => [h.file, h]));
  const symbolsByFile = new Map<string, string[]>();
  for (const sym of index.symbols) {
    if (!symbolsByFile.has(sym.file)) symbolsByFile.set(sym.file, []);
    symbolsByFile.get(sym.file)!.push(sym.name);
  }

  const scored = index.files
    .map((f) => ({ file: f, score: (hotspotMap.get(f.path)?.score ?? 0) + (f.isTest ? 0 : 2) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 200);

  const includedPaths = new Set(scored.map((s) => s.file.path));

  const nodes: GraphNode[] = scored.map(({ file }) => {
    const h = hotspotMap.get(file.path);
    const base = Math.max(4, Math.min(20, Math.sqrt(file.loc / 5)));
    return {
      id: file.path,
      label: file.path.split('/').pop() ?? file.path,
      group: groupFromPath(file.path),
      size: base + (hotspotSet.has(file.path) ? 8 : 0),
      fanIn: h?.fanIn ?? 0,
      fanOut: h?.fanOut ?? 0,
      loc: file.loc,
      isTest: file.isTest,
      isHotspot: hotspotSet.has(file.path),
      symbols: (symbolsByFile.get(file.path) ?? []).slice(0, 8),
    };
  });

  const seenEdges = new Set<string>();
  const edges: GraphEdge[] = [];
  for (const imp of index.imports) {
    if (!imp.resolved) continue;
    if (!includedPaths.has(imp.from) || !includedPaths.has(imp.resolved)) continue;
    const key = `${imp.from}→${imp.resolved}`;
    if (seenEdges.has(key)) continue;
    seenEdges.add(key);
    edges.push({ source: imp.from, target: imp.resolved });
  }

  return {
    nodes, edges,
    stats: { files: index.stats.files, symbols: index.stats.symbols, cycles: dep.cycles.length, hotspots: dep.hotspots.length, lang: '' },
  };
}

function fetchD3(cacheDir: string): string {
  const cachePath = join(cacheDir, 'd3.v7.min.js');
  if (existsSync(cachePath)) return readFileSync(cachePath, 'utf8');
  try {
    const res = spawnSync('curl', ['-fsSL', '--max-time', '10', 'https://cdn.jsdelivr.net/npm/d3@7.9.0/dist/d3.min.js'], { encoding: 'utf8', timeout: 15000 });
    if (res.status === 0 && res.stdout.length > 1000) {
      writeFileSync(cachePath, res.stdout, 'utf8');
      return res.stdout;
    }
  } catch { /* fall through */ }
  // wget fallback
  try {
    const res = spawnSync('wget', ['-qO-', 'https://cdn.jsdelivr.net/npm/d3@7.9.0/dist/d3.min.js'], { encoding: 'utf8', timeout: 15000 });
    if (res.status === 0 && res.stdout.length > 1000) {
      writeFileSync(cachePath, res.stdout, 'utf8');
      return res.stdout;
    }
  } catch { /* fall through */ }
  return ''; // caller will use CDN fallback
}

const HEX_COLOR_RE = /^#[0-9a-fA-F]{3,8}$/;

function safeJson(obj: unknown): string {
  // Prevent </script> breakout by escaping < as <
  return JSON.stringify(obj).replace(/</g, '\\u003c');
}

function renderHtml(data: GraphData, projectName: string, d3Src: string): string {
  const groups = [...new Set(data.nodes.map((n) => n.group))];
  const palette = [
    '#4f8ef7','#f76b4f','#4fcf8e','#f7c94f','#9b4ff7',
    '#4fd4f7','#f74fa0','#a0f74f','#f7804f','#4f6ff7',
    '#f7504f','#4ff7c4','#d4f74f','#7f4ff7','#f7d44f',
  ];
  const groupColors = Object.fromEntries(groups.map((g, i) => [g, palette[i % palette.length]]));

  // D3: inline if available, CDN with SRI as fallback
  const d3Tag = d3Src
    ? `<script>${d3Src}</script>`
    : `<script src="https://cdn.jsdelivr.net/npm/d3@7.9.0/dist/d3.min.js" integrity="sha384-eeLEj9/VSJI/iPEDEFEBYbNjOCvmIE7GBm/YAcAnCK1e7V5E3rF+ULh3OzIhFWQ" crossorigin="anonymous"></script>`;

  // Escape group names and validate colors before HTML interpolation
  const legendItems = groups
    .map((g) => {
      const color = groupColors[g] ?? '#4f8ef7';
      const safeColor = HEX_COLOR_RE.test(color) ? color : '#4f8ef7';
      return `<div class="legend-item" data-group="${esc(g)}"><div class="legend-dot" style="background:${safeColor}"></div><span>${esc(g)}</span></div>`;
    })
    .join('');

  // Browser-side JS: uses DOM API for tooltip — no innerHTML with untrusted data
  const browserJs = `
const RAW = ${safeJson(data)};
const groupColors = ${safeJson(groupColors)};
let showTests = true, hotspotMode = false, activeGroup = null;

function esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

const svg = d3.select('#canvas');
const w = window.innerWidth, h = window.innerHeight;
const g = svg.append('g');
const zoom = d3.zoom().scaleExtent([0.05,4]).on('zoom', e => g.attr('transform', e.transform));
svg.call(zoom);
window.resetZoom = () => svg.transition().duration(500).call(zoom.transform, d3.zoomIdentity);

const nodes = RAW.nodes.map(d => ({...d}));
const edges = RAW.edges.map(d => ({...d}));

const sim = d3.forceSimulation(nodes)
  .force('link', d3.forceLink(edges).id(d=>d.id).distance(d=>60+d.source.fanIn*4).strength(0.3))
  .force('charge', d3.forceManyBody().strength(d=>-80-d.size*6))
  .force('center', d3.forceCenter(w/2, h/2))
  .force('collision', d3.forceCollide().radius(d=>d.size+4));

const link = g.append('g').selectAll('line').data(edges).join('line')
  .attr('stroke','#30363d').attr('stroke-opacity',0.5).attr('stroke-width',0.8);

const node = g.append('g').selectAll('g').data(nodes).join('g')
  .attr('class', d=>'node'+(d.isHotspot?' hotspot':'')+(d.isTest?' test':''))
  .call(d3.drag()
    .on('start',(e,d)=>{if(!e.active)sim.alphaTarget(0.3).restart();d.fx=d.x;d.fy=d.y;})
    .on('drag',(e,d)=>{d.fx=e.x;d.fy=e.y;})
    .on('end',(e,d)=>{if(!e.active)sim.alphaTarget(0);d.fx=null;d.fy=null;})
  );

node.append('circle')
  .attr('r',d=>d.size)
  .attr('fill',d=>groupColors[d.group]??'#4f8ef7')
  .attr('fill-opacity',d=>d.isTest?0.3:0.75)
  .attr('stroke',d=>d.isHotspot?'#f7c94f':(groupColors[d.group]??'#4f8ef7'))
  .attr('stroke-width',d=>d.isHotspot?2.5:1.5);

node.append('text')
  .attr('dy',d=>d.size+10).attr('text-anchor','middle')
  .attr('font-size','9px').attr('fill','#8b949e').attr('pointer-events','none')
  .text(d=>d.size>8?esc(d.label):'');

const tip = document.getElementById('tooltip');
node.on('mouseover',(e,d)=>{
  // Build tooltip with DOM API — no untrusted innerHTML
  tip.innerHTML = '';

  const pathEl = document.createElement('div');
  pathEl.className = 'path';
  pathEl.textContent = d.id;
  tip.appendChild(pathEl);

  const badges = document.createElement('div');
  if (d.isHotspot) { const b=document.createElement('span'); b.className='badge hotspot-badge'; b.textContent='🔥 hotspot'; badges.appendChild(b); }
  if (d.isTest)    { const b=document.createElement('span'); b.className='badge'; b.textContent='test'; badges.appendChild(b); }
  ['in: '+d.fanIn, 'out: '+d.fanOut, d.loc+' loc'].forEach(t=>{ const b=document.createElement('span'); b.className='badge'; b.textContent=t; badges.appendChild(b); });
  tip.appendChild(badges);

  if (d.symbols.length) {
    const sym=document.createElement('div'); sym.className='symbols';
    sym.textContent=d.symbols.join(', ');
    tip.appendChild(sym);
  }
  tip.style.display='block';
}).on('mousemove',e=>{
  tip.style.left=(e.clientX+14)+'px'; tip.style.top=(e.clientY-10)+'px';
}).on('mouseout',()=>{ tip.style.display='none'; });

sim.on('tick',()=>{
  link.attr('x1',d=>d.source.x).attr('y1',d=>d.source.y).attr('x2',d=>d.target.x).attr('y2',d=>d.target.y);
  node.attr('transform',d=>\`translate(\${d.x},\${d.y})\`);
});

document.getElementById('search').addEventListener('input',function(){
  const q=this.value.toLowerCase();
  node.select('circle').attr('fill-opacity',d=>!q?(d.isTest?0.3:0.75):
    (d.id.toLowerCase().includes(q)||d.symbols.some(s=>s.toLowerCase().includes(q))?1:0.05));
});

window.toggleTests=()=>{ showTests=!showTests; node.style('display',d=>!showTests&&d.isTest?'none':null); };
window.highlightHotspots=()=>{ hotspotMode=!hotspotMode; node.select('circle').attr('fill-opacity',d=>hotspotMode?(d.isHotspot?1:0.05):(d.isTest?0.3:0.75)); };
window.filterGroup=(group)=>{ activeGroup=activeGroup===group?null:group; node.select('circle').attr('fill-opacity',d=>!activeGroup?(d.isTest?0.3:0.75):(d.group===group?1:0.05)); };

document.querySelectorAll('.legend-item[data-group]').forEach(el=>{
  el.addEventListener('click',()=>window.filterGroup(el.dataset.group));
});
`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>${esc(projectName)} — Dependency Graph</title>
${d3Tag}
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{background:#0d1117;color:#e6edf3;font-family:-apple-system,monospace;overflow:hidden}
#canvas{width:100vw;height:100vh}
#tooltip{position:fixed;background:#161b22;border:1px solid #30363d;border-radius:8px;padding:12px 16px;font-size:12px;pointer-events:none;display:none;max-width:300px;z-index:100;line-height:1.6}
#tooltip .path{color:#79c0ff;font-weight:bold;word-break:break-all;margin-bottom:6px}
#tooltip .badge{display:inline-block;background:#21262d;border-radius:4px;padding:1px 6px;margin:2px;font-size:10px}
#tooltip .hotspot-badge{background:#3d2f00;color:#f7c94f}
#tooltip .symbols{color:#8b949e;font-size:11px;margin-top:6px}
#legend{position:fixed;top:16px;right:16px;background:#161b22;border:1px solid #30363d;border-radius:8px;padding:12px 16px;font-size:11px;max-height:80vh;overflow-y:auto;z-index:50}
#legend h3{color:#79c0ff;margin-bottom:8px;font-size:13px}
.legend-item{display:flex;align-items:center;gap:8px;margin:4px 0;cursor:pointer;user-select:none}
.legend-dot{width:10px;height:10px;border-radius:50%;flex-shrink:0}
#stats{position:fixed;bottom:16px;left:16px;background:#161b22;border:1px solid #30363d;border-radius:8px;padding:10px 14px;font-size:11px;color:#8b949e;z-index:50}
#stats span{color:#e6edf3;font-weight:bold}
#controls{position:fixed;top:16px;left:16px;display:flex;gap:8px;z-index:50}
button{background:#21262d;border:1px solid #30363d;color:#e6edf3;border-radius:6px;padding:6px 12px;cursor:pointer;font-size:11px}
button:hover{background:#30363d}
#search{background:#21262d;border:1px solid #30363d;color:#e6edf3;border-radius:6px;padding:6px 12px;font-size:11px;width:200px;outline:none}
</style>
</head>
<body>
<div id="controls">
  <input id="search" placeholder="Search file or symbol…" />
  <button onclick="resetZoom()">Reset</button>
  <button onclick="toggleTests()">Toggle Tests</button>
  <button onclick="highlightHotspots()">Hotspots</button>
</div>
<div id="legend">
  <h3>${esc(projectName)}</h3>
  ${legendItems}
  <div style="margin-top:8px;border-top:1px solid #30363d;padding-top:8px">
    <div class="legend-item"><div class="legend-dot" style="background:#f7c94f"></div><span>Hotspot</span></div>
    <div class="legend-item"><div class="legend-dot" style="background:#8b949e;opacity:0.4"></div><span>Test file</span></div>
  </div>
</div>
<svg id="canvas"></svg>
<div id="tooltip"></div>
<div id="stats">
  <span>${data.stats.files}</span> files &nbsp;·&nbsp;
  <span>${data.stats.symbols}</span> symbols &nbsp;·&nbsp;
  <span>${data.nodes.length}</span> shown &nbsp;·&nbsp;
  <span>${data.edges.length}</span> edges &nbsp;·&nbsp;
  <span style="color:${data.stats.cycles>0?'#f85149':'#3fb950'}">${data.stats.cycles}</span> cycles &nbsp;·&nbsp;
  <span>${data.stats.hotspots}</span> hotspots
</div>
<script>${browserJs}</script>
</body>
</html>`;
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function openFile(filePath: string): void {
  const opener = process.platform === 'darwin' ? 'open'
    : process.platform === 'win32' ? 'cmd'
    : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', filePath] : [filePath];
  spawnSync(opener, args, { stdio: 'ignore', timeout: 5000 });
}

export function writeGraphHtml(cwd: string, index: RepoIndex, dep: DepGraph): string {
  const outDir = join(cwd, '.ai-runtime');
  mkdirSync(outDir, { recursive: true });
  const d3Src = fetchD3(outDir);
  const data = buildGraphData(index, dep);
  data.stats.lang = detectLang(cwd).lang;
  const projectName = displayProjectName(cwd);
  const outFile = join(outDir, 'graph.html');
  writeFileSync(outFile, renderHtml(data, projectName, d3Src), 'utf8');
  return outFile;
}

export function registerGraph(program: Command): void {
  program
    .command('graph [target]')
    .description('Generate interactive dependency graph (HTML + D3.js, opens in browser)')
    .option('--no-open', 'generate HTML without opening browser')
    .option('--output <file>', 'copy generated HTML to this file')
    .option('--rebuild', 'force rebuild of repo index before generating')
    .action(async (_target: string = '.', options: { open: boolean; rebuild?: boolean; output?: string }) => {
      const cwd = process.cwd();
      const outDir = join(cwd, '.ai-runtime');
      mkdirSync(outDir, { recursive: true });

      console.log('Building repository index…');
      const graph = new GraphAgent(cwd);
      const index = options.rebuild ? await graph.buildIndex() : await graph.ensureIndex();
      console.log(`  ${index.stats.files} files, ${index.stats.symbols} symbols`);

      console.log('Building dependency graph…');
      const lang = detectLang(cwd);
      let dep: DepGraph;
      try {
        dep = buildDepGraphAuto(cwd, lang.lang);
        console.log(`  ${dep.nodes.size} modules, ${dep.cycles.length} cycles, ${dep.hotspots.length} hotspots`);
      } catch {
        dep = { nodes: new Map(), cycles: [], hotspots: [] };
        console.log('  dep-graph unavailable, using index only');
      }

      console.log('Generating interactive graph…');
      const outFile = writeGraphHtml(cwd, index, dep);
      const data = buildGraphData(index, dep);

      console.log(`\nGraph: ${outFile}`);
      console.log(`  ${data.nodes.length} nodes · ${data.edges.length} edges`);

      if (options.output) {
        mkdirSync(dirname(options.output), { recursive: true });
        copyFileSync(outFile, options.output);
        console.log(`  Output: ${options.output}`);
      }

      if (options.open !== false) {
        openFile(outFile);
        console.log('  Opened in browser');
      }
    });
}
