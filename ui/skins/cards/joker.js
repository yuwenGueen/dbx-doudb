// Shared Joker artwork. Card skins provide its red/gold or monochrome ink colors.
const lettering = [..."JOKER"].map((letter) => `<b>${letter}</b>`).join("");
const jester = String.raw`<svg class="joker-illustration" viewBox="0 0 80 108" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">
  <g stroke="currentColor" stroke-width="1.5" stroke-linejoin="round">
    <path d="M20 48C10 44 13 26 7 18C23 15 31 25 34 39L37 48Z" fill="var(--joker-main)"/>
    <path d="M43 47C48 28 60 15 72 22C60 29 69 43 56 50Z" fill="var(--joker-light)"/>
    <path d="M27 44C25 25 41 24 43 9C55 20 53 35 47 46Z" fill="var(--joker-main)"/>
    <path d="M30 43C30 30 43 27 43 18" fill="none" stroke="var(--joker-light)" stroke-width="3"/>
    <circle cx="7" cy="18" r="4" fill="var(--joker-light)"/>
    <circle cx="43" cy="9" r="4" fill="var(--joker-light)"/>
    <circle cx="72" cy="22" r="4" fill="var(--joker-light)"/>
    <path d="M22 50C22 68 27 82 41 85C54 80 59 65 57 50Z" fill="#fffdf5"/>
    <path d="M20 44Q40 35 60 44L57 53Q40 45 23 53Z" fill="var(--joker-light)"/>
    <path d="M25 47Q40 41 55 47" fill="none" stroke="var(--joker-main)" stroke-width="3"/>
    <path d="M28 59L33 54L38 61L33 68Z" fill="var(--joker-light)" stroke="none"/>
    <path d="M44 61L49 54L54 59L49 68Z" fill="var(--joker-main)" stroke="none"/>
    <path d="M30 60L35 60M47 60L51 59" fill="none" stroke="#24262a" stroke-width="2" stroke-linecap="round"/>
    <path d="M40 61L38 68L42 69" fill="none" stroke="#7e7064" stroke-width="1.2" stroke-linecap="round"/>
    <path d="M32 72Q41 78 50 70Q43 83 32 72Z" fill="var(--joker-main)" stroke="none"/>
    <path d="M23 78L16 88L27 89L29 100L40 94L50 101L54 90L65 87L57 78L41 87Z" fill="#fffdf5"/>
    <path d="M23 84L28 89M32 87L35 93M47 87L45 94M57 84L53 90" fill="none" stroke="var(--joker-light)" stroke-width="2"/>
    <path d="M40 94L45 100L40 106L35 100Z" fill="var(--joker-main)"/>
  </g>
</svg>`;

export function jokerFace(big, { mini = false, hero = false } = {}) {
  return `<span class="card-face joker ${big ? "joker-big" : "joker-small"} ${mini ? "mini" : ""} ${hero ? "hero-card" : ""}" role="img" aria-label="${big ? "大王" : "小王"}"><span class="joker-index" aria-hidden="true">${lettering}</span>${jester}<span class="joker-index joker-index-bottom" aria-hidden="true">${lettering}</span></span>`;
}
