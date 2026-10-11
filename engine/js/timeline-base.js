// Helpers for a video's timeline.js. The engine ships no story events: each video defines its own
// named events from word lookups, e.g.
//   import { W, sceneStart } from '@engine/timeline-base.js';
//   const T = { s1: 0 };
//   T.title = W('introducing');
//   T.s2 = sceneStart('try');
//   export default T;
//   export const TRANSITIONS = [{ t: T.s2, type: 'swipe' }];
import { W } from './data.js';

export { W, WE, Wa, S, HIT, BEAT, BEATS, DOWNBEATS, ACCENTS, accent, onBeat, beatFrom, DURATION, VO_START } from './data.js';

/** default gap between a scene cut and the next line, so each scene's final state holds before the swipe */
export const CUT_PAD = 0.3;

/** scene start = the nth occurrence of `word` minus pad (default 0.3 s) */
export function sceneStart(word, nth = 0, pad = CUT_PAD) {
  return W(word, nth) - pad;
}
