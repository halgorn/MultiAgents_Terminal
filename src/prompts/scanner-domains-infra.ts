export interface DomainConfig {
  title: string;
  grepPatterns: string[];
  instructions: string;
}

export const INFRA_DOMAIN_CONFIG = {
  infrastructure: {
    title: 'Infrastructure Scanner',
    grepPatterns: [
      'image:', 'resources:', 'limits:', 'requests:', 'securityContext:',
      'runAsRoot', 'runAsUser', 'privileged:', 'readOnlyRootFilesystem:',
      'livenessProbe', 'readinessProbe', 'startupProbe',
      'latest', 'FROM ', 'RUN apt', 'RUN pip', 'ADD ',
      'replicas:', 'strategy:', 'PodDisruptionBudget', 'NetworkPolicy',
    ],
    instructions: `Use Bash and Grep to scan Kubernetes manifests, Dockerfiles, and docker-compose files:
1. Find Dockerfiles: find . -name "Dockerfile*" | head -20
2. Find K8s manifests: find . -name "*.yaml" -o -name "*.yml" | xargs grep -l "apiVersion:" 2>/dev/null | head -20
3. Check for: containers running as root (no runAsNonRoot or runAsUser), missing resource limits/requests, image:latest tags, missing liveness/readiness probes, privileged:true, missing securityContext
4. In Dockerfiles: ADD instead of COPY, apt-get without pinned versions, missing .dockerignore reference, root USER
5. docker-compose: find . -name "docker-compose*.yml" | head -5 — check for exposed ports, missing healthchecks, host volume mounts
Read only the relevant sections (offset/limit). Report file+line for each finding.`,
  },
  observability: {
    title: 'Observability Scanner',
    grepPatterns: [
      'print(', 'console.log', 'logger.', 'logging.',
      'traceid', 'trace_id', 'request_id', 'opentelemetry', 'jaeger',
      '/health', '/ready', '/live', '/metrics',
      'prometheus', 'datadog', 'sentry',
      'except:', 'catch (', 'catch{',
    ],
    instructions: `Use Grep and Bash to find observability gaps:
1. Unstructured logging: grep -rn "print(\\|console.log\\|fmt.Print" --include="*.py" --include="*.ts" --include="*.go" . | grep -v "test\\|spec" | head -30 — log statements without structured fields (no level, no trace_id, no service)
2. Missing health endpoints: grep -rn "/health\\|/ready\\|/live\\|/ping" --include="*.py" --include="*.ts" . | head -20 — if none found, report missing
3. Missing metrics: grep -rn "prometheus\\|metrics\\|gauge\\|counter\\|histogram" --include="*.py" --include="*.ts" . | head -10
4. Exception swallowing without logging: grep -rn "except:\\|catch (" --include="*.py" --include="*.ts" . | head -20 — then Read those sections to confirm no log statement inside
5. No trace context propagation: grep -rn "trace_id\\|traceparent\\|X-Request-ID" --include="*.py" --include="*.ts" . | head -10
Report file+line for each confirmed gap.`,
  },
  resilience: {
    title: 'Resilience Scanner',
    grepPatterns: [
      'requests.get(', 'requests.post(', 'fetch(', 'axios.',
      'timeout', 'retry', 'backoff', 'circuit',
      'sleep(', 'time.sleep(', 'setTimeout(',
      'connect(', 'pool', 'max_connections',
      'signal.signal', 'SIGTERM', 'graceful',
    ],
    instructions: `Use Grep and Bash to find resilience gaps:
1. HTTP calls without timeout: grep -rn "requests.get(\\|requests.post(\\|fetch(\\|axios." --include="*.py" --include="*.ts" . | head -30 — then Read those sections to check for timeout parameter
2. No retry logic: grep -rn "def.*retry\\|backoff\\|tenacity\\|retry(" --include="*.py" . | head -10 — if absent on external calls, report missing
3. No circuit breaker: grep -rn "circuit\\|hystrix\\|breaker\\|resilience4j" --include="*.py" --include="*.ts" . | head -5
4. Missing SIGTERM handler: grep -rn "SIGTERM\\|signal.signal\\|graceful" --include="*.py" --include="*.ts" . | head -10
5. Database connection pool not configured: grep -rn "create_engine\\|pool_size\\|max_overflow\\|pool=" --include="*.py" . | head -10
6. Unbounded queue/task submission: grep -rn "ThreadPoolExecutor\\|asyncio.create_task\\|celery" --include="*.py" . | head -10 — check for missing max_workers or queue size limits
Report file+line for each gap confirmed by reading the section.`,
  },
  data: {
    title: 'Data Layer Scanner',
    grepPatterns: [
      'for ', 'forEach(', '.all()', 'SELECT', 'query(',
      'paginate', 'limit', 'offset', 'LIMIT',
      'migrate', 'revision', 'alembic', 'flyway',
      'INDEX', 'CREATE TABLE', 'ALTER TABLE',
      'BEGIN', 'COMMIT', 'transaction', 'session.',
    ],
    instructions: `Use Grep and Bash to find data layer issues:
1. N+1 queries: grep -rn "for.*in.*:$\\|forEach(" --include="*.py" --include="*.ts" . | head -30 — then Read those sections to check if there's a DB call inside the loop
2. Missing pagination: grep -rn "\.all()\\|\\.find({})" --include="*.py" --include="*.ts" . | head -20 — list endpoints returning all rows without limit
3. Missing migrations tool: find . -name "alembic.ini" -o -name "flyway.conf" -o -name "liquibase*" | head -5 — if absent, check for raw SQL schema creation
4. Indexes on foreign keys: grep -rn "ForeignKey\\|REFERENCES\\|foreign_key" --include="*.py" . | head -20 — cross-check with index definitions
5. Transaction boundaries: grep -rn "session.commit()\\|db.commit()\\|transaction" --include="*.py" . | head -20 — operations that should be atomic but aren't in a transaction
6. Distributed transaction without saga: grep -rn "requests.post\\|httpx.post" --include="*.py" . | head -10 — external calls inside a transaction block
Report file+line for each confirmed issue.`,
  },
  dependencies: {
    title: 'Dependencies Scanner',
    grepPatterns: [
      'requirements.txt', 'package.json', 'Pipfile', 'poetry.lock',
      'import ', 'from ', 'require(',
      'password', 'secret', 'api_key', 'token', 'private_key',
      'CORS', 'allow_origins', 'cors(',
      '@app.route', 'app.get(', 'app.post(',
    ],
    instructions: `Use Bash and Grep to find dependency and supply chain issues:
1. Unpinned dependencies: cat requirements.txt 2>/dev/null | grep -v "==" | grep -v "^#" | head -20; cat package.json 2>/dev/null | python3 -c "import sys,json; d=json.load(sys.stdin); [print(k,v) for k,v in {**d.get('dependencies',{}),**d.get('devDependencies',{})}.items() if '^' in str(v) or '~' in str(v) or '*' in str(v)]" 2>/dev/null | head -20
2. Secrets in source: grep -rn "password\s*=\s*['\"]\\|api_key\s*=\s*['\"]\\|secret\s*=\s*['\"]" --include="*.py" --include="*.ts" --include="*.env" . | grep -v "test\\|example\\|sample" | head -20
3. CORS misconfigured: grep -rn "allow_origins\\|CORS\\|cors(" --include="*.py" --include="*.ts" . | head -20 — check for wildcard "*"
4. Rate limiting on auth endpoints: grep -rn "login\\|auth\\|password\\|token" --include="*.py" . | grep "route\\|endpoint\\|@app" | head -10 — then check for rate_limit decorator/middleware nearby
5. Dependency confusion: find . -name "requirements*.txt" -o -name "package*.json" | xargs grep -l "internal\\|private\\|corp" 2>/dev/null | head -5
Report file+line for each finding.`,
  },
  compliance: {
    title: 'Compliance Scanner (LGPD/GDPR)',
    grepPatterns: [
      'email', 'cpf', 'cnpj', 'phone', 'telefone', 'nome', 'name',
      'logger', 'logging', 'print(', 'console.log',
      'password', 'senha', 'token',
      'delete', 'DELETE', 'soft_delete', 'is_deleted',
      'created_at', 'expires_at', 'retention',
    ],
    instructions: `Use Grep to find LGPD/GDPR compliance gaps:
1. PII in logs: grep -rn "logger.*email\\|logger.*cpf\\|logger.*phone\\|print.*user\\|log.*password" --include="*.py" --include="*.ts" . | grep -v "test\\|spec" | head -30
2. PII in error responses: grep -rn "return.*email\\|jsonify.*cpf\\|res.json.*phone" --include="*.py" --include="*.ts" . | head -20 — error handlers returning personal data
3. No soft delete for user data: grep -rn "DELETE FROM.*user\\|\.delete().*user\\|User\.delete" --include="*.py" --include="*.ts" . | head -10 — hard deletes without audit trail
4. Missing audit trail: grep -rn "def delete\\|def update\\|def create" --include="*.py" . | head -20 — then Read those sections to check for audit log call
5. Data retention not enforced: grep -rn "expires_at\\|retention\\|purge\\|cleanup" --include="*.py" . | head -10 — if absent, report missing retention policy
6. Sensitive data in GET params: grep -rn "request.args.get.*token\\|request.args.get.*password\\|query.*secret" --include="*.py" . | head -10
Report file+line for each confirmed issue.`,
  },
  multitenancy: {
    title: 'Multi-tenancy Scanner',
    grepPatterns: [
      'tenant_id', 'tenant', 'organization_id', 'org_id',
      'SELECT', 'WHERE', 'filter(', 'query(',
      'cache', 'redis', 'memcache', 'get(', 'set(',
      'request.user', 'current_user', 'g.user',
    ],
    instructions: `Use Grep to find multi-tenancy isolation gaps:
1. Queries without tenant filter: grep -rn "\.query(\\|\.filter(\\|SELECT" --include="*.py" . | head -40 — then Read those sections to check if tenant_id/organization_id is in the filter
2. Cache keys without tenant prefix: grep -rn "cache.get(\\|redis.get(\\|cache.set(" --include="*.py" --include="*.ts" . | head -20 — check if key includes tenant_id
3. File paths without tenant isolation: grep -rn "open(\\|os.path\\|upload" --include="*.py" . | head -20 — check if path includes tenant identifier
4. Background jobs without tenant context: grep -rn "\.delay(\\|\.apply_async(\\|celery" --include="*.py" . | head -10 — tasks that process data without tenant scoping
5. Admin endpoints without tenant check: grep -rn "@admin\\|is_admin\\|role.*admin" --include="*.py" . | head -10 — verify tenant boundary in admin logic
Report file+line for each gap confirmed by reading the section.`,
  },
};
