// Access to Capacitor native plugins without a bundler (registerPlugin returns a native proxy).
const cache = new Map();
export const isNative = () => !!window.Capacitor?.isNativePlatform?.();
export const platform = () => window.Capacitor?.getPlatform?.() || 'web';
export function native(name) {
  if (!isNative()) return null;
  if (!cache.has(name)) cache.set(name, window.Capacitor.registerPlugin(name));
  return cache.get(name);
}
