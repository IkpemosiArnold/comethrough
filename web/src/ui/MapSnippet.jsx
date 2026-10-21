// A light map: six OpenStreetMap tiles positioned with CSS, a painted pin, and the attribution.
// No map library. Tapping opens the phone's maps app at the spot.
import { useState } from 'preact/hooks';

const Z = 16;
const TILE = 256;

function project(lat, lon) {
  const n = 2 ** Z;
  const x = ((lon + 180) / 360) * n * TILE;
  const r = (lat * Math.PI) / 180;
  const y = ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n * TILE;
  return { x, y };
}

export function mapsUrl(place) {
  if (place.lat != null) return `https://www.google.com/maps/search/?api=1&query=${place.lat},${place.lon}`;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([place.name, place.address].filter(Boolean).join(', '))}`;
}

export function MapSnippet({ place, height = 168 }) {
  const [failed, setFailed] = useState(0);
  if (!place || place.lat == null || place.lon == null) return null;
  const { x, y } = project(place.lat, place.lon);
  const tx = Math.floor(x / TILE), ty = Math.floor(y / TILE);
  const ox = x - tx * TILE, oy = y - ty * TILE;
  // Pick the 3x2 block of tiles that keeps the pin well inside
  const cols = [tx - 1, tx, tx + 1];
  const rows = oy < TILE / 2 ? [ty - 1, ty] : [ty, ty + 1];
  const left0 = (cols[0] - tx) * TILE - ox;  // relative to the pin
  const top0 = (rows[0] - ty) * TILE - oy;
  const tiles = [];
  rows.forEach((r, ri) => cols.forEach((c, ci) => {
    tiles.push({ key: `${c}-${r}`, src: `https://tile.openstreetmap.org/${Z}/${c}/${r}.png`, left: left0 + ci * TILE, top: top0 + ri * TILE });
  }));
  return (
    <div class="map" style={{ height: `${height}px` }}>
      <a class="map-link" href={mapsUrl(place)} target="_blank" rel="noopener" aria-label={`Open ${place.name || 'the place'} in maps`}>
        <div class="map-tiles" aria-hidden="true">
          {failed < 3 && tiles.map((t) => (
            <img
              key={t.key}
              src={t.src}
              width={TILE}
              height={TILE}
              alt=""
              loading="lazy"
              decoding="async"
              referrerpolicy="strict-origin-when-cross-origin"
              style={{ transform: `translate(${t.left}px, ${t.top}px)` }}
              onError={() => setFailed((n) => n + 1)}
            />
          ))}
        </div>
        <svg class="map-pin" width="34" height="44" viewBox="0 0 34 44" aria-hidden="true">
          <path d="M17 42s-14-13.5-14-24a14 14 0 0128 0c0 10.5-14 24-14 24z" fill="var(--danfo)" stroke="#14302a" stroke-width="3" />
          <circle cx="17" cy="18" r="5" fill="#14302a" />
        </svg>
      </a>
      <a class="map-attr" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap</a>
    </div>
  );
}
