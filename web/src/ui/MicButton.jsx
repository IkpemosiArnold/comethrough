import { Icon } from './icons.jsx';

export function MicButton({ speech, value }) {
  if (!speech.supported) return null;
  return (
    <button
      type="button"
      class={`mic${speech.listening ? ' on' : ''}`}
      onClick={() => (speech.listening ? speech.stop() : speech.start(value))}
      aria-pressed={speech.listening}
      aria-label={speech.listening ? 'Stop the voice note' : 'Say it instead'}
    >
      <Icon name="mic" size={20} />
      <span class="mic-label">{speech.listening ? 'Listening' : 'Say it'}</span>
    </button>
  );
}
