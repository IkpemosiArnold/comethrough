// The sloth. Used sparingly: the start screen, the ritual panel, empty states, and while Gemma reads.
// mood: "sleepy" (default), "awake", "reading" (one eye open)
export function Sloth({ size = 120, mood = 'sleepy', branch = true, class: cls = '', title }) {
  const eye = (cx, flip) => {
    if (mood === 'awake' || (mood === 'reading' && !flip)) {
      return <circle cx={cx} cy="73" r="2.6" fill="#f3e6cf" />;
    }
    return <path d={`M${cx - 3.6} 72.5 q3.6 3 7.2 0`} stroke="#f3e6cf" stroke-width="1.8" fill="none" stroke-linecap="round" />;
  };
  return (
    <svg
      class={`sloth ${cls}`}
      width={size}
      height={size * (140 / 120)}
      viewBox="0 0 120 140"
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : 'true'}
    >
      {branch && (
        <g class="sloth-branch">
          <path d="M-4 22 C 30 14, 70 30, 124 18" stroke="#5a4129" stroke-width="7" fill="none" stroke-linecap="round" />
          <path d="M96 20 c 6 -10 16 -12 22 -8 c -6 6 -14 10 -22 8z" fill="#3f8a5c" />
          <path d="M14 18 c -4 -9 -13 -12 -19 -9 c 4 7 11 10 19 9z" fill="#4f9b69" />
        </g>
      )}
      <g class="sloth-body">
        {/* arms up to the branch */}
        <path d="M40 74 C 34 52, 36 34, 42 22" stroke="#7a5b3e" stroke-width="11" fill="none" stroke-linecap="round" />
        <path d="M80 74 C 86 52, 84 34, 78 21" stroke="#7a5b3e" stroke-width="11" fill="none" stroke-linecap="round" />
        <path d="M38 22 q4 -6 9 -1 M76 21 q4 -6 9 -1" stroke="#3a2a1e" stroke-width="2.2" fill="none" stroke-linecap="round" />
        {/* body and head */}
        <ellipse cx="60" cy="100" rx="30" ry="32" fill="#7a5b3e" />
        <ellipse cx="60" cy="106" rx="18" ry="20" fill="#8e6c4b" />
        <circle cx="60" cy="72" r="25" fill="#8e6c4b" />
        <ellipse cx="60" cy="75" rx="20" ry="15.5" fill="#ead6b4" />
        {/* the sloth's dark eye patches, droopy */}
        <ellipse cx="50" cy="74" rx="7.5" ry="4.6" fill="#4a3626" transform="rotate(16 50 74)" />
        <ellipse cx="70" cy="74" rx="7.5" ry="4.6" fill="#4a3626" transform="rotate(-16 70 74)" />
        {eye(50, false)}
        {eye(70, true)}
        <ellipse cx="60" cy="81" rx="3.6" ry="2.6" fill="#3a2a1e" />
        <path d="M55 85.5 q5 3.6 10 0" stroke="#3a2a1e" stroke-width="1.8" fill="none" stroke-linecap="round" />
        {/* legs hanging */}
        <path d="M46 126 q-2 8 2 10 M74 126 q2 8 -2 10" stroke="#6b4f36" stroke-width="9" fill="none" stroke-linecap="round" />
      </g>
    </svg>
  );
}
