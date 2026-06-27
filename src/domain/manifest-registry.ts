export class ManifestRegistry<T extends { name: string }> {
  private readonly items = new Map<string, T>();
  private readonly aliases = new Map<string, string>();

  register(manifest: T): this {
    if (this.items.has(manifest.name)) {
      throw new Error(`Registry: duplicate name "${manifest.name}"`);
    }
    this.items.set(manifest.name, manifest);
    return this;
  }

  alias(alias: string, target: string): this {
    if (!this.items.has(target)) {
      throw new Error(`Registry: cannot alias unknown name "${target}"`);
    }
    this.aliases.set(alias, target);
    return this;
  }

  get(nameOrAlias: string): T | undefined {
    const target = this.aliases.get(nameOrAlias) ?? nameOrAlias;
    return this.items.get(target);
  }

  has(nameOrAlias: string): boolean {
    const target = this.aliases.get(nameOrAlias) ?? nameOrAlias;
    return this.items.has(target);
  }

  all(): readonly T[] {
    return Array.from(this.items.values());
  }

  names(): readonly string[] {
    return Array.from(this.items.keys());
  }

  size(): number {
    return this.items.size;
  }

  clear(): void {
    this.items.clear();
    this.aliases.clear();
  }

  validate(): { ok: true } | { ok: false; issues: string[] } {
    const issues: string[] = [];
    const seen = new Set<string>();
    for (const m of this.items.values()) {
      if (seen.has(m.name)) {
        issues.push(`Duplicate name: ${m.name}`);
      }
      seen.add(m.name);
    }
    for (const [alias, target] of this.aliases) {
      if (!this.items.has(target)) {
        issues.push(`Alias "${alias}" points to missing target "${target}"`);
      }
    }
    return issues.length === 0 ? { ok: true } : { ok: false, issues };
  }
}

export function validateAll<T extends { name: string }>(
  registries: Record<string, ManifestRegistry<T>>,
): { ok: boolean; issues: string[] } {
  const issues: string[] = [];
  for (const [label, reg] of Object.entries(registries)) {
    const result = reg.validate();
    if (!result.ok) {
      for (const issue of result.issues) {
        issues.push(`[${label}] ${issue}`);
      }
    }
  }
  return { ok: issues.length === 0, issues };
}