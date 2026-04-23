// Professional avatar selection system with SVG-based designs
// Color gradient avatars + icon-based character avatars for maximum differentiation

export const AVATAR_OPTIONS = [
  // === Gradient color avatars (letter-based) ===
  {
    id: 'avatar-1',
    name: 'כחול קלאסי',
    bg: 'linear-gradient(135deg, #3b82f6, #1d4ed8)',
    textColor: '#ffffff',
  },
  {
    id: 'avatar-2',
    name: 'סגול עמוק',
    bg: 'linear-gradient(135deg, #8b5cf6, #6d28d9)',
    textColor: '#ffffff',
  },
  {
    id: 'avatar-3',
    name: 'ירוק אמרלד',
    bg: 'linear-gradient(135deg, #10b981, #047857)',
    textColor: '#ffffff',
  },
  {
    id: 'avatar-4',
    name: 'אדום חם',
    bg: 'linear-gradient(135deg, #ef4444, #b91c1c)',
    textColor: '#ffffff',
  },
  {
    id: 'avatar-5',
    name: 'כתום שקיעה',
    bg: 'linear-gradient(135deg, #f97316, #c2410c)',
    textColor: '#ffffff',
  },
  {
    id: 'avatar-6',
    name: 'ורוד מודרני',
    bg: 'linear-gradient(135deg, #ec4899, #be185d)',
    textColor: '#ffffff',
  },
  {
    id: 'avatar-7',
    name: 'טורקיז',
    bg: 'linear-gradient(135deg, #14b8a6, #0f766e)',
    textColor: '#ffffff',
  },
  {
    id: 'avatar-8',
    name: 'אינדיגו',
    bg: 'linear-gradient(135deg, #6366f1, #4338ca)',
    textColor: '#ffffff',
  },
  {
    id: 'avatar-9',
    name: 'זהב חם',
    bg: 'linear-gradient(135deg, #f59e0b, #b45309)',
    textColor: '#ffffff',
  },
  {
    id: 'avatar-10',
    name: 'אפור אלגנטי',
    bg: 'linear-gradient(135deg, #6b7280, #374151)',
    textColor: '#ffffff',
  },
  {
    id: 'avatar-11',
    name: 'שחר ורוד',
    bg: 'linear-gradient(135deg, #f472b6, #a855f7)',
    textColor: '#ffffff',
  },
  {
    id: 'avatar-12',
    name: 'אוקיינוס',
    bg: 'linear-gradient(135deg, #06b6d4, #2563eb)',
    textColor: '#ffffff',
  },
  {
    id: 'avatar-13',
    name: 'יער',
    bg: 'linear-gradient(135deg, #22c55e, #15803d)',
    textColor: '#ffffff',
  },
  {
    id: 'avatar-14',
    name: 'לבנדר',
    bg: 'linear-gradient(135deg, #a78bfa, #7c3aed)',
    textColor: '#ffffff',
  },
  {
    id: 'avatar-15',
    name: 'פחם כהה',
    bg: 'linear-gradient(135deg, #475569, #1e293b)',
    textColor: '#ffffff',
  },
  {
    id: 'avatar-16',
    name: 'קורל',
    bg: 'linear-gradient(135deg, #fb7185, #e11d48)',
    textColor: '#ffffff',
  },

  // === Icon character avatars (minimalistic professional icons) ===
  {
    id: 'icon-star',
    name: 'כוכב',
    bg: 'linear-gradient(135deg, #f59e0b, #d97706)',
    textColor: '#ffffff',
    icon: 'star',
  },
  {
    id: 'icon-bolt',
    name: 'ברק',
    bg: 'linear-gradient(135deg, #eab308, #ca8a04)',
    textColor: '#ffffff',
    icon: 'bolt',
  },
  {
    id: 'icon-mountain',
    name: 'הר',
    bg: 'linear-gradient(135deg, #64748b, #334155)',
    textColor: '#ffffff',
    icon: 'mountain',
  },
  {
    id: 'icon-sun',
    name: 'שמש',
    bg: 'linear-gradient(135deg, #fb923c, #ea580c)',
    textColor: '#ffffff',
    icon: 'sun',
  },
  {
    id: 'icon-moon',
    name: 'ירח',
    bg: 'linear-gradient(135deg, #6366f1, #312e81)',
    textColor: '#ffffff',
    icon: 'moon',
  },
  {
    id: 'icon-diamond',
    name: 'יהלום',
    bg: 'linear-gradient(135deg, #06b6d4, #0e7490)',
    textColor: '#ffffff',
    icon: 'diamond',
  },
  {
    id: 'icon-crown',
    name: 'כתר',
    bg: 'linear-gradient(135deg, #a855f7, #7e22ce)',
    textColor: '#ffffff',
    icon: 'crown',
  },
  {
    id: 'icon-leaf',
    name: 'עלה',
    bg: 'linear-gradient(135deg, #22c55e, #166534)',
    textColor: '#ffffff',
    icon: 'leaf',
  },
  {
    id: 'icon-shield',
    name: 'מגן',
    bg: 'linear-gradient(135deg, #3b82f6, #1e40af)',
    textColor: '#ffffff',
    icon: 'shield',
  },
  {
    id: 'icon-heart',
    name: 'לב',
    bg: 'linear-gradient(135deg, #f43f5e, #be123c)',
    textColor: '#ffffff',
    icon: 'heart',
  },
  {
    id: 'icon-rocket',
    name: 'רקטה',
    bg: 'linear-gradient(135deg, #8b5cf6, #5b21b6)',
    textColor: '#ffffff',
    icon: 'rocket',
  },
  {
    id: 'icon-music',
    name: 'מוזיקה',
    bg: 'linear-gradient(135deg, #ec4899, #9d174d)',
    textColor: '#ffffff',
    icon: 'music',
  },
  {
    id: 'icon-book',
    name: 'ספר',
    bg: 'linear-gradient(135deg, #14b8a6, #0f766e)',
    textColor: '#ffffff',
    icon: 'book',
  },
  {
    id: 'icon-compass',
    name: 'מצפן',
    bg: 'linear-gradient(135deg, #f97316, #9a3412)',
    textColor: '#ffffff',
    icon: 'compass',
  },
  {
    id: 'icon-flower',
    name: 'פרח',
    bg: 'linear-gradient(135deg, #d946ef, #a21caf)',
    textColor: '#ffffff',
    icon: 'flower',
  },
  {
    id: 'icon-flame',
    name: 'להבה',
    bg: 'linear-gradient(135deg, #ef4444, #991b1b)',
    textColor: '#ffffff',
    icon: 'flame',
  },
];

// SVG icon paths for icon avatars (24x24 viewbox, minimalistic style)
export const AVATAR_ICON_PATHS = {
  star: 'M12 2l3.09 6.26L22 9.27l-5 4.87L18.18 21 12 17.27 5.82 21 7 14.14l-5-4.87 6.91-1.01L12 2z',
  bolt: 'M13 2L3 14h9l-1 8 10-12h-9l1-8z',
  mountain: 'M12 4L3 20h18L12 4zm0 4.5l5.5 9.5h-11L12 8.5z',
  sun: 'M12 7c-2.76 0-5 2.24-5 5s2.24 5 5 5 5-2.24 5-5-2.24-5-5-5zm1-5h-2v3h2V2zm0 17h-2v3h2v-3zM5.99 4.58l-1.41 1.41 2.12 2.13 1.42-1.42-2.13-2.12zm12.03 12.02l-1.41 1.42 2.12 2.12 1.41-1.41-2.12-2.13zM2 11v2h3v-2H2zm17 0v2h3v-2h-3zM7.7 17.29L5.58 19.4l1.41 1.41 2.12-2.12-1.41-1.4zM18.01 6.71l-2.12 2.12 1.41 1.41 2.13-2.12-1.42-1.41z',
  moon: 'M12 3c-4.97 0-9 4.03-9 9s4.03 9 9 9c.83 0 1.5-.67 1.5-1.5 0-.39-.15-.74-.39-1.01-.23-.26-.38-.61-.38-.99 0-.83.67-1.5 1.5-1.5H16c2.76 0 5-2.24 5-5 0-4.42-4.03-8-9-8z',
  diamond: 'M12 2L2 12l10 10 10-10L12 2zm0 3.41L18.59 12 12 18.59 5.41 12 12 5.41z',
  crown: 'M5 16L3 5l5.5 5L12 4l3.5 6L21 5l-2 11H5zm0 2h14v2H5v-2z',
  leaf: 'M17.8 2.8C16 2.09 13.86 2 12 2c-1.86 0-4 .09-5.8.8C3.53 3.84 2 6.05 2 8.86V22l4-4 4 4 4-4 4 4V8.86c0-2.81-1.53-5.02-4.2-6.06zM12 11c-1.94 0-3.5-1.56-3.5-3.5S10.06 4 12 4s3.5 1.56 3.5 3.5S13.94 11 12 11z',
  shield: 'M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm0 10.99h7c-.53 4.12-3.28 7.79-7 8.94V12H5V6.3l7-3.11v8.8z',
  heart: 'M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z',
  rocket: 'M12 2.5c0 0-6 7-6 13 0 2.5 1.5 4.5 3 5.5l1-3h4l1 3c1.5-1 3-3 3-5.5 0-6-6-13-6-13zm0 11.5c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2z',
  music: 'M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z',
  book: 'M18 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zM6 4h5v8l-2.5-1.5L6 12V4z',
  compass: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm-5.5-2.5l7.51-3.49L17.5 6.5 9.99 9.99 6.5 17.5zm5.5-6.6c.61 0 1.1.49 1.1 1.1s-.49 1.1-1.1 1.1-1.1-.49-1.1-1.1.49-1.1 1.1-1.1z',
  flower: 'M12 22c4.97 0 9-4.03 9-9-4.97 0-9 4.03-9 9zM5.6 10.25c0 1.38 1.12 2.5 2.5 2.5.53 0 1.01-.16 1.42-.44l-.02.19c0 1.38 1.12 2.5 2.5 2.5s2.5-1.12 2.5-2.5l-.02-.19c.4.28.89.44 1.42.44 1.38 0 2.5-1.12 2.5-2.5 0-1-.59-1.85-1.43-2.25.84-.4 1.43-1.25 1.43-2.25 0-1.38-1.12-2.5-2.5-2.5-.53 0-1.01.16-1.42.44l.02-.19C14.5 2.12 13.38 1 12 1S9.5 2.12 9.5 3.5l.02.19c-.4-.28-.89-.44-1.42-.44-1.38 0-2.5 1.12-2.5 2.5 0 1 .59 1.85 1.43 2.25-.84.4-1.43 1.25-1.43 2.25zM12 5.5c1.38 0 2.5 1.12 2.5 2.5s-1.12 2.5-2.5 2.5S9.5 9.38 9.5 8s1.12-2.5 2.5-2.5zM3 13c0 4.97 4.03 9 9 9-4.97 0-9-4.03-9-9z',
  flame: 'M13.5.67s.74 2.65.74 4.8c0 2.06-1.35 3.73-3.41 3.73-2.07 0-3.63-1.67-3.63-3.73l.03-.36C5.21 7.51 4 10.62 4 14c0 4.42 3.58 8 8 8s8-3.58 8-8C20 8.61 17.41 3.8 13.5.67zM11.71 19c-1.78 0-3.22-1.4-3.22-3.14 0-1.62 1.05-2.76 2.81-3.12 1.77-.36 3.6-1.21 4.62-2.58.39 1.29.59 2.65.59 4.04 0 2.65-2.15 4.8-4.8 4.8z',
};

// SVG path data for the default user silhouette displayed when no initial is available
export const AVATAR_SVG_PATHS = {
  // Person silhouette (head and shoulders)
  user: 'M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8z',
};

/**
 * Generate an inline SVG string for a given avatar option.
 * If the avatar has an `icon` property, it renders the icon.
 * Otherwise if `initial` is provided, it renders the letter on the gradient background.
 * Otherwise, it renders the default user silhouette icon.
 */
export function generateAvatarSVG(avatar, initial = null, size = 48) {
  const gradientId = `grad-${avatar.id}`;

  // Parse gradient colors from the bg string
  const colorMatch = avatar.bg.match(/#[0-9a-fA-F]{6}/g);
  const color1 = colorMatch?.[0] || '#3b82f6';
  const color2 = colorMatch?.[1] || '#1d4ed8';

  let content;
  if (avatar.icon && AVATAR_ICON_PATHS[avatar.icon]) {
    // Render icon with slight scale-down and centering
    content = `<g transform="translate(4,4) scale(0.667)">
      <path d="${AVATAR_ICON_PATHS[avatar.icon]}" fill="${avatar.textColor}"/>
    </g>`;
  } else if (initial) {
    content = `<text x="12" y="12" dominant-baseline="central" text-anchor="middle"
        fill="${avatar.textColor}" font-family="Arial, sans-serif" font-weight="600"
        font-size="11">${initial.toUpperCase()}</text>`;
  } else {
    content = `<path d="${AVATAR_SVG_PATHS.user}" fill="${avatar.textColor}"/>`;
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24">
  <defs>
    <linearGradient id="${gradientId}" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${color1}"/>
      <stop offset="100%" stop-color="${color2}"/>
    </linearGradient>
  </defs>
  <rect width="24" height="24" rx="12" fill="url(#${gradientId})"/>
  ${content}
</svg>`;
}

/**
 * Get an avatar option by its id.
 * @param {string} id - The avatar id (e.g. 'avatar-1')
 * @returns {object|undefined} The matching avatar option
 */
export function getAvatarById(id) {
  return AVATAR_OPTIONS.find((a) => a.id === id);
}

/**
 * Get the default avatar (first option).
 * @returns {object} The default avatar option
 */
export function getDefaultAvatar() {
  return AVATAR_OPTIONS[0];
}
