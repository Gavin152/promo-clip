// The collage style: hand-drawn ink, paper stickers, torn paper, handwritten text.
// Scenes import everything they draw with from here:
//   import * as St from '@engine/style/collage/index.js';   or named imports.
// A future style is another folder exporting the same names.
import { W, H } from '../../util.js';

export * from './draw.js';
export * from './props.js';
export * from './characters.js';
export * from './helpers.js';
export { drawTransitions, transitionSfx, SWIPE_HALF } from './transitions.js';

/** warm vignette over the whole frame (design units) */
export function makeVignette(w = W, h = H) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(w / 2, h / 2, h * 0.45, w / 2, h / 2, h * 1.05);
  g.addColorStop(0, 'rgba(40,25,10,0)');
  g.addColorStop(1, 'rgba(40,25,10,0.28)');
  x.fillStyle = g;
  x.fillRect(0, 0, w, h);
  return c;
}
