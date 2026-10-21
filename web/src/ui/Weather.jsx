import { Icon } from './icons.jsx';

export function weatherIcon(w) {
  if (!w) return 'sun';
  if (!w.ok || w.rainProb >= 40) return 'rain';
  if (/cloud|mostly dry/i.test(w.summary || '') || w.rainProb >= 20) return 'cloudsun';
  return 'sun';
}

// "Dry, feels like 31°" or "34% chance of rain, feels like 34°": one number for rain, one for heat.
export function weatherWords(w) {
  if (!w) return '';
  const rain = w.rainProb == null ? 'No rain forecast yet' : w.rainProb < 20 ? 'Dry' : `${w.rainProb}% chance of rain`;
  return w.tempC == null ? rain : `${rain}, feels like ${Math.round(w.tempC)}°`;
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
