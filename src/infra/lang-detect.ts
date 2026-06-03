import { existsSync, readdirSync } from 'fs';
import { join } from 'path';

export type ProjectLang = 'typescript' | 'python' | 'go' | 'rust' | 'java' | 'ruby' | 'unknown';

export interface LangProfile {
  lang: ProjectLang;
  buildCommand: string;
  testCommand: string;
  lintCommand: string;
  packageFile: string | null;
}

const PROFILES: Array<{ marker: string; profile: LangProfile }> = [
  {
    marker: 'package.json',
    profile: {
      lang: 'typescript',
      buildCommand: 'npm run build',
      testCommand: 'npm test',
      lintCommand: 'npm run lint',
      packageFile: 'package.json',
    },
  },
  {
    marker: 'requirements.txt',
    profile: {
      lang: 'python',
      buildCommand: 'python -m py_compile $(find . -name "*.py" | head -20 | tr "\\n" " ")',
      testCommand: 'python -m pytest',
      lintCommand: 'python -m flake8 .',
      packageFile: 'requirements.txt',
    },
  },
  {
    marker: 'pyproject.toml',
    profile: {
      lang: 'python',
      buildCommand: 'python -m py_compile $(find . -name "*.py" | head -20 | tr "\\n" " ")',
      testCommand: 'python -m pytest',
      lintCommand: 'python -m flake8 .',
      packageFile: 'pyproject.toml',
    },
  },
  {
    marker: 'go.mod',
    profile: {
      lang: 'go',
      buildCommand: 'go build ./...',
      testCommand: 'go test ./...',
      lintCommand: 'go vet ./...',
      packageFile: 'go.mod',
    },
  },
  {
    marker: 'Cargo.toml',
    profile: {
      lang: 'rust',
      buildCommand: 'cargo build',
      testCommand: 'cargo test',
      lintCommand: 'cargo clippy',
      packageFile: 'Cargo.toml',
    },
  },
  {
    marker: 'pom.xml',
    profile: {
      lang: 'java',
      buildCommand: 'mvn compile -q',
      testCommand: 'mvn test -q',
      lintCommand: 'mvn checkstyle:check -q',
      packageFile: 'pom.xml',
    },
  },
  {
    marker: 'build.gradle',
    profile: {
      lang: 'java',
      buildCommand: 'gradle build -q',
      testCommand: 'gradle test -q',
      lintCommand: 'gradle check -q',
      packageFile: 'build.gradle',
    },
  },
  {
    marker: 'Gemfile',
    profile: {
      lang: 'ruby',
      buildCommand: 'bundle exec rake',
      testCommand: 'bundle exec rspec',
      lintCommand: 'bundle exec rubocop',
      packageFile: 'Gemfile',
    },
  },
];

const UNKNOWN_PROFILE: LangProfile = {
  lang: 'unknown',
  buildCommand: 'echo "no build command detected"',
  testCommand: 'echo "no test command detected"',
  lintCommand: 'echo "no lint command detected"',
  packageFile: null,
};

export function detectLang(cwd: string): LangProfile {
  for (const { marker, profile } of PROFILES) {
    if (existsSync(join(cwd, marker))) return profile;
  }

  // Fallback: count file extensions
  try {
    const counts: Record<string, number> = {};
    const scan = (dir: string, depth: number) => {
      if (depth > 2) return;
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
        if (entry.isDirectory()) { scan(join(dir, entry.name), depth + 1); continue; }
        const ext = entry.name.split('.').pop() ?? '';
        counts[ext] = (counts[ext] ?? 0) + 1;
      }
    };
    scan(cwd, 0);
    const dominant = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0];
    if (dominant === 'py') return PROFILES.find((p) => p.profile.lang === 'python')!.profile;
    if (dominant === 'go') return PROFILES.find((p) => p.profile.lang === 'go')!.profile;
    if (dominant === 'rs') return PROFILES.find((p) => p.profile.lang === 'rust')!.profile;
    if (dominant === 'ts' || dominant === 'js') return PROFILES.find((p) => p.profile.lang === 'typescript')!.profile;
  } catch { /* best-effort */ }

  return UNKNOWN_PROFILE;
}

export function resolveCommands(
  cwd: string,
  buildCommand?: string,
  testCommand?: string,
): { buildCommand: string; testCommand: string } {
  const profile = detectLang(cwd);
  return {
    buildCommand: buildCommand || profile.buildCommand,
    testCommand: testCommand || profile.testCommand,
  };
}
