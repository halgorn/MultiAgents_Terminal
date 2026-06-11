import { spawnSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { AI_RUNTIME_DIR } from './paths.js';

export type CloudProvider = 'aws' | 'azure' | 'gcp';

export interface CloudResource {
  type: string;   // e.g. 'RDS', 'S3', 'EC2'
  name: string;
  region?: string;
  status?: string;
}

export interface CloudGap {
  severity: 'high' | 'medium' | 'low';
  category: 'missing-secret' | 'missing-service' | 'unused-resource' | 'config-mismatch';
  description: string;
  detail: string;
}

export interface CloudReport {
  provider: CloudProvider;
  authenticated: boolean;
  resources: CloudResource[];
  gaps: CloudGap[];
  summary: string;
}

// ── Provider detection ────────────────────────────────────────────────────────

export function detectProviders(): CloudProvider[] {
  const detected: CloudProvider[] = [];
  if (process.env['AWS_ACCESS_KEY_ID'] || process.env['AWS_PROFILE']) detected.push('aws');
  if (process.env['AZURE_SUBSCRIPTION_ID'] || process.env['AZURE_TENANT_ID']) detected.push('azure');
  if (process.env['GOOGLE_APPLICATION_CREDENTIALS'] || process.env['GOOGLE_CLOUD_PROJECT']) detected.push('gcp');
  return detected;
}

function cli(cmd: string, args: string[], timeout = 15000): { ok: boolean; stdout: string } {
  const r = spawnSync(cmd, args, { encoding: 'utf8', timeout });
  return { ok: r.status === 0, stdout: r.stdout ?? '' };
}

// ── AWS (read-only) ───────────────────────────────────────────────────────────

function readAws(): { ok: boolean; resources: CloudResource[] } {
  const check = cli('aws', ['sts', 'get-caller-identity', '--output', 'json']);
  if (!check.ok) return { ok: false, resources: [] };

  const resources: CloudResource[] = [];

  // EC2 instances
  const ec2 = cli('aws', ['ec2', 'describe-instances', '--query',
    'Reservations[].Instances[].[InstanceId,State.Name,InstanceType]', '--output', 'json']);
  if (ec2.ok) {
    try {
      const items = JSON.parse(ec2.stdout) as string[][];
      items.forEach(([id, state, type]) => resources.push({ type: 'EC2', name: `${id} (${type})`, status: state }));
    } catch { /* skip */ }
  }

  // RDS
  const rds = cli('aws', ['rds', 'describe-db-instances', '--query',
    'DBInstances[].[DBInstanceIdentifier,DBInstanceStatus,Engine]', '--output', 'json']);
  if (rds.ok) {
    try {
      const items = JSON.parse(rds.stdout) as string[][];
      items.forEach(([id, status, engine]) => resources.push({ type: 'RDS', name: `${id} (${engine})`, status }));
    } catch { /* skip */ }
  }

  // S3 buckets
  const s3 = cli('aws', ['s3api', 'list-buckets', '--query', 'Buckets[].Name', '--output', 'json']);
  if (s3.ok) {
    try {
      const names = JSON.parse(s3.stdout) as string[];
      names.forEach((n) => resources.push({ type: 'S3', name: n }));
    } catch { /* skip */ }
  }

  // Lambda
  const lambda = cli('aws', ['lambda', 'list-functions', '--query',
    'Functions[].[FunctionName,Runtime,State]', '--output', 'json']);
  if (lambda.ok) {
    try {
      const items = JSON.parse(lambda.stdout) as string[][];
      items.forEach(([name, runtime, state]) => resources.push({ type: 'Lambda', name: `${name} (${runtime})`, status: state }));
    } catch { /* skip */ }
  }

  return { ok: true, resources };
}

// ── Azure (read-only) ─────────────────────────────────────────────────────────

function readAzure(): { ok: boolean; resources: CloudResource[] } {
  const check = cli('az', ['account', 'show', '--output', 'json']);
  if (!check.ok) return { ok: false, resources: [] };

  const resources: CloudResource[] = [];

  // VMs
  const vms = cli('az', ['vm', 'list', '--output', 'json', '--query', '[].{name:name,status:provisioningState,location:location}']);
  if (vms.ok) {
    try {
      const items = JSON.parse(vms.stdout) as Array<{ name: string; status: string; location: string }>;
      items.forEach((vm) => resources.push({ type: 'VM', name: vm.name, region: vm.location, status: vm.status }));
    } catch { /* skip */ }
  }

  // AKS
  const aks = cli('az', ['aks', 'list', '--output', 'json', '--query', '[].{name:name,location:location}']);
  if (aks.ok) {
    try {
      const items = JSON.parse(aks.stdout) as Array<{ name: string; location: string }>;
      items.forEach((c) => resources.push({ type: 'AKS', name: c.name, region: c.location }));
    } catch { /* skip */ }
  }

  // Databases
  const sql = cli('az', ['sql', 'server', 'list', '--output', 'json', '--query', '[].{name:name,location:location}']);
  if (sql.ok) {
    try {
      const items = JSON.parse(sql.stdout) as Array<{ name: string; location: string }>;
      items.forEach((s) => resources.push({ type: 'SQL', name: s.name, region: s.location }));
    } catch { /* skip */ }
  }

  return { ok: true, resources };
}

// ── GCP (read-only) ───────────────────────────────────────────────────────────

function readGcp(): { ok: boolean; resources: CloudResource[] } {
  const check = cli('gcloud', ['auth', 'print-access-token'], 5000);
  if (!check.ok) return { ok: false, resources: [] };

  const resources: CloudResource[] = [];
  const project = process.env['GOOGLE_CLOUD_PROJECT'] ?? '';

  // Compute instances
  const gce = cli('gcloud', ['compute', 'instances', 'list', '--format=json', ...(project ? ['--project', project] : [])]);
  if (gce.ok) {
    try {
      const items = JSON.parse(gce.stdout) as Array<{ name: string; status: string; zone: string }>;
      items.forEach((i) => resources.push({ type: 'GCE', name: i.name, region: i.zone, status: i.status }));
    } catch { /* skip */ }
  }

  // Cloud SQL
  const sql = cli('gcloud', ['sql', 'instances', 'list', '--format=json', ...(project ? ['--project', project] : [])]);
  if (sql.ok) {
    try {
      const items = JSON.parse(sql.stdout) as Array<{ name: string; state: string; region: string }>;
      items.forEach((i) => resources.push({ type: 'CloudSQL', name: i.name, region: i.region, status: i.state }));
    } catch { /* skip */ }
  }

  return { ok: true, resources };
}

// ── Gap detection ─────────────────────────────────────────────────────────────

function detectGaps(cwd: string, resources: CloudResource[]): CloudGap[] {
  const gaps: CloudGap[] = [];
  const resourceTypes = new Set(resources.map((r) => r.type.toLowerCase()));

  // Read project signals
  let envContent = '';
  for (const f of ['.env.example', '.env.sample', '.env']) {
    try { envContent += readFileSync(join(cwd, f), 'utf8'); } catch { /* ok */ }
  }

  // Check sbom for common services
  const sbomPath = join(cwd, AI_RUNTIME_DIR, 'sbom.json');
  let deps: string[] = [];
  if (existsSync(sbomPath)) {
    try { deps = Object.keys((JSON.parse(readFileSync(sbomPath, 'utf8')) as { packages?: Record<string, unknown> }).packages ?? {}); } catch { /* ok */ }
  }

  // Check IaC files
  const hasIac = ['terraform', 'serverless.yml', 'docker-compose.yml', 'k8s', 'helm'].some(
    (f) => existsSync(join(cwd, f)),
  );
  if (!hasIac) {
    gaps.push({ severity: 'medium', category: 'missing-service', description: 'No IaC files detected', detail: 'No terraform/, serverless.yml, docker-compose.yml, or k8s/ found — infrastructure is not version-controlled' });
  }

  // DB dependency but no DB resource in cloud
  const hasDbDep = deps.some((d) => /pg|mysql|mongo|redis|sqlite|prisma|sequelize|typeorm/i.test(d)) ||
    /DATABASE_URL|REDIS_URL|MONGO_URI|DB_HOST/i.test(envContent);
  const hasDbResource = resourceTypes.has('rds') || resourceTypes.has('sql') || resourceTypes.has('cloudsql') || resourceTypes.has('cosmos');
  if (hasDbDep && !hasDbResource) {
    gaps.push({ severity: 'high', category: 'missing-service', description: 'Database dependency with no managed DB resource', detail: 'Project uses a database client but no managed database found in cloud account' });
  }

  // S3/storage usage but no bucket
  const hasStorageDep = deps.some((d) => /aws-sdk|@aws-sdk\/client-s3|googleapis|azure-storage/i.test(d)) ||
    /S3_BUCKET|STORAGE_BUCKET|BLOB_CONTAINER/i.test(envContent);
  const hasStorage = resourceTypes.has('s3') || resourceTypes.has('blob') || resourceTypes.has('gcs');
  if (hasStorageDep && !hasStorage) {
    gaps.push({ severity: 'high', category: 'missing-service', description: 'Storage SDK used but no bucket/container found', detail: 'Project imports cloud storage SDK but no bucket or container visible in cloud account' });
  }

  // No compute at all
  const hasCompute = resourceTypes.has('ec2') || resourceTypes.has('vm') || resourceTypes.has('gce') ||
    resourceTypes.has('lambda') || resourceTypes.has('aks') || resourceTypes.has('gke');
  if (resources.length > 0 && !hasCompute) {
    gaps.push({ severity: 'medium', category: 'missing-service', description: 'No compute resources visible', detail: 'Cloud account has resources but no compute instances, containers, or functions found' });
  }

  // Secrets in env but not likely in secrets manager
  const secretVars = (envContent.match(/^[A-Z_]+_(?:KEY|SECRET|TOKEN|PASSWORD|CREDENTIAL)=.+/gm) ?? []);
  if (secretVars.length > 3) {
    gaps.push({ severity: 'medium', category: 'config-mismatch', description: `${secretVars.length} secret-like env vars in .env.example`, detail: 'Consider moving secrets to AWS Secrets Manager / Azure Key Vault / GCP Secret Manager' });
  }

  return gaps;
}

// ── Main ──────────────────────────────────────────────────────────────────────

export function analyzeCloud(cwd: string, provider: CloudProvider): CloudReport {
  let result: { ok: boolean; resources: CloudResource[] };

  if (provider === 'aws')   result = readAws();
  else if (provider === 'azure') result = readAzure();
  else result = readGcp();

  if (!result.ok) {
    return {
      provider,
      authenticated: false,
      resources: [],
      gaps: [],
      summary: `Not authenticated — configure credentials for ${provider.toUpperCase()} CLI`,
    };
  }

  const gaps = detectGaps(cwd, result.resources);
  const highCount = gaps.filter((g) => g.severity === 'high').length;

  return {
    provider,
    authenticated: true,
    resources: result.resources,
    gaps,
    summary: `${result.resources.length} resources found, ${gaps.length} gaps${highCount > 0 ? ` (${highCount} critical)` : ''}`,
  };
}
