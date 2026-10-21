// Capability checks. Feature-detect where possible; the OS check is only for copy
// ("Add to Home Screen" on iPhone) where no feature test exists.
const ua = navigator.userAgent || '';
export const isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const isAndroid = /Android/i.test(ua);
export const isMobile = isIOS || isAndroid || /Mobi/i.test(ua);
export const isStandalone = (() => {
  try { return matchMedia('(display-mode: standalone)').matches || navigator.standalone === true; } catch { return false; }
})();
export const canPush = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
export const notifyState = () => ('Notification' in window ? Notification.permission : 'unsupported');
export const canShareFiles = !!(navigator.canShare && navigator.share);
export const hasSpeech = !!(window.SpeechRecognition || window.webkitSpeechRecognition);

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    ta.remove();
    return ok;
  }
}

export function whatsappUrl(text) {
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}

function b64ToBytes(b64) {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

// Ask for notification permission and subscribe. Returns 'granted', 'denied', 'default' or 'unsupported'.
export async function enablePush(api, slug) {
  if (!canPush) return 'unsupported';
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') return perm;
  try {
    const { publicKey } = await api.pushKey();
    if (publicKey) {
      const reg = await navigator.serviceWorker.ready;
      const sub = (await reg.pushManager.getSubscription()) ||
        (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(publicKey) }));
      await api.subscribePush(slug, sub.toJSON());
    }
  } catch { /* permission is still granted; the server can retry on the next visit */ }
  return 'granted';
}
