import '@testing-library/jest-dom/vitest';

// Node 22+ ships a built-in localStorage global that needs --localstorage-file and has no working
// clear() in the test process, shadowing jsdom's window.localStorage. Install a simple in-memory
// Storage so component tests (the assistant persists its transcript to localStorage) get a real,
// resettable store.
class MemoryStorage implements Storage {
  private store = new Map<string, string>();
  get length(): number { return this.store.size; }
  clear(): void { this.store.clear(); }
  getItem(key: string): string | null { return this.store.has(key) ? this.store.get(key)! : null; }
  setItem(key: string, value: string): void { this.store.set(key, String(value)); }
  removeItem(key: string): void { this.store.delete(key); }
  key(index: number): string | null { return [...this.store.keys()][index] ?? null; }
}

Object.defineProperty(globalThis, 'localStorage', { value: new MemoryStorage(), configurable: true, writable: true });
