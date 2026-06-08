export function displayProjectName(cwdOrName: string, fallback = 'project'): string {
  const raw = cwdOrName.split(/[\\/]/).filter(Boolean).pop() ?? cwdOrName ?? fallback;
  const normalized = raw.toLowerCase().replace(/[-_\s]/g, '');
  if (normalized === 'multiagentsterminal') return 'Aion';
  return raw || fallback;
}
