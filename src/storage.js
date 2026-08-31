// Drop-in replacement for the Claude-artifact `window.storage` API,
// backed by the browser's localStorage. Same async shape (get/set/list),
// so the rest of the app's code didn't need to change.
const PREFIX = "folion:";

function fullKey(key) {
  return PREFIX + key;
}

export const storage = {
  async get(key) {
    const raw = window.localStorage.getItem(fullKey(key));
    if (raw === null) return null;
    return { key, value: raw };
  },
  async set(key, value) {
    window.localStorage.setItem(fullKey(key), value);
    return { key, value };
  },
  async delete(key) {
    window.localStorage.removeItem(fullKey(key));
    return { key, deleted: true };
  },
  async list(prefix = "") {
    const keys = [];
    const target = fullKey(prefix);
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (k && k.startsWith(target)) keys.push(k.slice(PREFIX.length));
    }
    return { keys, prefix };
  },
};

if (typeof window !== "undefined") {
  window.storage = storage;
}
