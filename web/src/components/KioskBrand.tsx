export function ServiceMark() {
  return <svg viewBox="0 0 160 160" className="service-mark" aria-hidden="true">
    <defs><radialGradient id="seal-paper"><stop stopColor="#fffef4" /><stop offset="1" stopColor="#f5e8b8" /></radialGradient></defs>
    <circle cx="80" cy="80" r="77" fill="url(#seal-paper)" />
    <circle cx="80" cy="80" r="70" fill="none" stroke="#d6b86b" strokeWidth="1" />
    <circle cx="80" cy="80" r="65" fill="none" stroke="#d6b86b" strokeWidth="5" strokeDasharray="1 5" opacity=".45" />
    {[0, 72, 144, 216, 288].map(angle => <g key={angle} transform={`rotate(${angle} 80 80)`}>
      <path d="M61 23H94C102 23 107 28 107 36V48L90 60V42H60C54 42 50 38 50 33S54 23 61 23Z" fill="#be1722" />
      <path d="M61 29H88M60 34H88M61 39H88" stroke="#fff8e7" strokeWidth="2.3" strokeLinecap="round" />
    </g>)}
  </svg>;
}

export function DrumPattern() {
  const star = Array.from({ length: 32 }, (_, i) => {
    const angle = i * Math.PI / 16 - Math.PI / 2, radius = i % 2 ? 40 : 112;
    return `${360 + Math.cos(angle) * radius},${380 + Math.sin(angle) * radius}`;
  }).join(' ');
  return <svg className="drum-pattern" viewBox="0 0 1000 860" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
    <defs>
      <pattern id="drum-weave" width="66" height="66" patternUnits="userSpaceOnUse" patternTransform="rotate(35)"><path d="M0 0H66V66H0ZM8 8H58V58H8ZM16 16H50V50H16Z" fill="none" stroke="currentColor" strokeWidth="2" /></pattern>
    </defs>
    <path fill="url(#drum-weave)" opacity=".2" d="M0 0H1000V860H0Z" />
    <g fill="none" stroke="currentColor">
      {[125, 137, 155, 178, 188, 220, 230, 268, 281, 300, 335, 350, 372, 411, 425, 455].map((radius, i) => <circle key={radius} cx="360" cy="380" r={radius} strokeWidth={i % 3 === 0 ? 5 : 2} />)}
      <circle cx="360" cy="380" r="168" strokeWidth="13" strokeDasharray="2 12" />
      <circle cx="360" cy="380" r="244" strokeWidth="14" strokeDasharray="2 14" />
      <circle cx="360" cy="380" r="390" strokeWidth="19" strokeDasharray="2 18" />
      {Array.from({ length: 40 }, (_, i) => <path key={i} d="M350 80L360 56L370 80M350 84L360 60L370 84" transform={`rotate(${i * 9} 360 380)`} strokeWidth="2.2" />)}
      {Array.from({ length: 24 }, (_, i) => <path key={i} d="M347 176L361 162L374 176L362 189Z" transform={`rotate(${i * 15} 360 380)`} strokeWidth="3" />)}
    </g>
    <polygon points={star} fill="currentColor" opacity=".65" />
  </svg>;
}
