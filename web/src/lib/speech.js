// Voice notes through the Web Speech API (Chrome on Android, Safari on iPhone).
// On browsers without it the mic button simply doesn't show.
import { useEffect, useRef, useState } from 'preact/hooks';

export function useSpeech(onText) {
  const rec = useRef(null);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState(null);
  const supported = typeof window !== 'undefined' && !!(window.SpeechRecognition || window.webkitSpeechRecognition);

  useEffect(() => () => { try { rec.current && rec.current.abort(); } catch { /* ignore */ } }, []);

  function start(base = '') {
    if (!supported) return;
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    const r = new SR();
    r.lang = 'en-NG';
    r.interimResults = true;
    r.continuous = false;
    let finalText = '';
    r.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) finalText += t; else interim += t;
      }
      const joined = [base, (finalText + interim).trim()].filter(Boolean).join(base && !/\s$/.test(base) ? ' ' : '');
      onText(joined);
    };
    r.onerror = (e) => {
      setError(e.error === 'not-allowed' ? 'Allow the microphone to use voice.' : e.error === 'no-speech' ? "Didn't catch that. Try again?" : null);
      setListening(false);
    };
    r.onend = () => setListening(false);
    rec.current = r;
    setError(null);
    setListening(true);
    try { r.start(); } catch { setListening(false); }
  }
  function stop() {
    try { rec.current && rec.current.stop(); } catch { /* ignore */ }
    setListening(false);
  }
  return { supported, listening, error, start, stop };
}
