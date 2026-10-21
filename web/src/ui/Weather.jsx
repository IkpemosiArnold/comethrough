import { Icon } from './icons.jsx';

export function weatherIcon(w) {
  if (!w) return 'sun';
  if (!w.ok || w.rainProb >= 40) return 'rain';
  if (/cloud/i.test(w.summary || '')) return 'cloudsun';
  return 'sun';
}

// Compact: "29°" with an icon. Used in lists.
export function WeatherChip({ weather }) {
  if (!weather) return null;
  const bad = !weather.ok;
  return (
    <span class={`wx-chip${bad ? ' bad' : ''}`} title={weather.summary}>
      <Icon name={weatherIcon(weather)} size={18} />
      <span>{Math.round(weather.tempC)}°</span>
      <span class="sr-only">{weather.summary}{bad ? `, ${weather.rainProb}% chance of rain` : ''}</span>
    </span>
  );
}
