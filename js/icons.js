// ─────────────────────────────────────────────────────────────
// Inline SVG icon system. Replaces emoji with clean SVG icons.
// ─────────────────────────────────────────────────────────────

const I = {
  folder: '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>',
  'folder-open': '<path d="M5 19a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4l2 3h9a2 2 0 0 1 2 2v1M5 19h14a2 2 0 0 0 2-2l1-7H7.5"/>',
  file: '<path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/>',
  'file-code': '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><polyline points="10 15 8 17 10 19"/><polyline points="14 15 16 17 14 19"/>',
  'file-text': '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>',
  paperclip: '<path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>',
  brain: '<path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96.44 2.5 2.5 0 0 1-2.96-3.08 3 3 0 0 1-.34-5.58 2.5 2.5 0 0 1 1.32-4.24 2.5 2.5 0 0 1 1.98-3A2.5 2.5 0 0 1 9.5 2Z"/>',
  database: '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/>',
  'trash-2': '<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  x: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
  'chevron-right': '<polyline points="9 18 15 12 9 6"/>',
  'chevron-down': '<polyline points="6 9 12 15 18 9"/>',
  'undo-2': '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5v0a5.5 5.5 0 0 1-5.5 5.5H11"/>',
  check: '<polyline points="20 6 9 17 4 12"/>',
  'alert-circle': '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/>',
  globe: '<circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/>',
  palette: '<circle cx="13.5" cy="6.5" r=".5"/><circle cx="17.5" cy="10.5" r=".5"/><circle cx="8.5" cy="7.5" r=".5"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33"/>',
  lock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>',
  archive: '<polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/>',
  terminal: '<polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/>',
  rewind: '<polygon points="11 19 2 12 11 5 11 19"/><polygon points="22 19 13 12 22 5 22 19"/>',
  'rotate-ccw': '<polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/>',
  send: '<line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>',
  plus: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
  eye: '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
};

export function icon(name, size = 14) {
  const p = I[name];
  if (!p) return '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
}

export function setIcon(el, name, size = 14) {
  if (!el) return;
  el.innerHTML = icon(name, size);
}

// File type icon mapping (replaces emoji map in ui.js)
const FILE_ICONS = {
  // JavaScript / TypeScript
  js: 'file-code', mjs: 'file-code', cjs: 'file-code',
  ts: 'file-code', tsx: 'file-code', jsx: 'file-code',
  // Web
  html: 'globe', css: 'palette', scss: 'palette', less: 'palette',
  vue: 'file-code', svelte: 'file-code',
  // Data
  json: 'file-json', toml: 'settings', yaml: 'settings', yml: 'settings',
  // Docs
  md: 'file-text', txt: 'file-text', pdf: 'file-text',
  // Languages
  py: 'file-code', rs: 'file-code', go: 'file-code', rb: 'file-code',
  java: 'file-code', c: 'file-code', cpp: 'file-code', h: 'file-code',
  // Shell / Config
  sh: 'terminal', bash: 'terminal', zsh: 'terminal',
  env: 'lock', gitignore: 'shield', lock: 'shield',
  // Images
  png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', svg: 'image',
  webp: 'image', ico: 'image',
  // Archives
  zip: 'archive', tar: 'archive', gz: 'archive',
};

/**
 * Get the Lucide icon name for a file based on its extension.
 */
export function fileIconName(filename) {
  const ext = filename.split('.').pop()?.toLowerCase();
  return FILE_ICONS[ext] || 'file';
}

/**
 * Get the SVG string for a file icon.
 */
export function fileIcon(filename, size = 12) {
  return icon(fileIconName(filename), size);
}

// Common UI icons (pre-defined for convenience)
export const ICONS = {
  folder: (s = 14) => icon('folder', s),
  folderOpen: (s = 14) => icon('folder-open', s),
  file: (s = 14) => icon('file', s),
  fileCode: (s = 14) => icon('file-code', s),
  fileText: (s = 14) => icon('file-text', s),
  paperclip: (s = 14) => icon('paperclip', s),
  brain: (s = 14) => icon('brain', s),
  folderPlus: (s = 14) => icon('folder-plus', s),
  database: (s = 14) => icon('database', s),
  trash: (s = 14) => icon('trash-2', s),
  x: (s = 14) => icon('x', s),
  chevronRight: (s = 14) => icon('chevron-right', s),
  chevronDown: (s = 14) => icon('chevron-down', s),
  arrowUp: (s = 14) => icon('arrow-up', s),
  undo: (s = 14) => icon('undo-2', s),
  clock: (s = 14) => icon('clock', s),
  check: (s = 14) => icon('check', s),
  alertCircle: (s = 14) => icon('alert-circle', s),
};
