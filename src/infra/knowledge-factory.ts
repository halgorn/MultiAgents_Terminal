import { KnowledgeStore } from './knowledge.js';

const cache = new Map<string, KnowledgeStore>();

export function getKnowledgeStore(cwd: string): KnowledgeStore {
  let store = cache.get(cwd);
  if (!store) {
    store = new KnowledgeStore(cwd);
    cache.set(cwd, store);
  }
  return store;
}
