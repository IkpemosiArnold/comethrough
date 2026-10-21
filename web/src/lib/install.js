// Holds Chrome's install prompt so a screen can offer "Install" at a useful moment.
let deferred = null;
const subs = new Set();
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferred = e;
  subs.forEach((fn) => fn(deferred));
});
window.addEventListener('appinstalled', () => {
  deferred = null;
  subs.forEach((fn) => fn(null));
});

export const installPrompt = {
  get: () => deferred,
  on(fn) { subs.add(fn); return () => subs.delete(fn); },
  async fire() {
    if (!deferred) return false;
    deferred.prompt();
    const { outcome } = await deferred.userChoice;
    deferred = null;
    subs.forEach((fn) => fn(null));
    return outcome === 'accepted';
  },
};
