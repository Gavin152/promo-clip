// Story events for the sample-15s fixture, in film seconds, all derived from the word times
// (vo/timing.json) and the music cue sheet (assets/music/cues.json). No hand-typed times.
import { W, WE, HIT, onBeat, sceneStart } from '@engine/timeline-base.js';

const T = {};
// 01 intro: "Introducing Demo Product. Your week, sorted in seconds."
T.s1 = 0;
T.title = W('introducing');
T.box = W('demo', 0);
T.sorted = W('sorted');
T.seconds = W('seconds');
// 02 feature: "Try the feature. Tap once, and it just works."
T.s2 = sceneStart('try');
T.phone = W('try');
T.tap = W('tap');
T.tags = W('once');
T.works = onBeat(W('works'));
// 03 end: "Get Demo Product now."
T.s3 = sceneStart('get');
T.logo = W('demo', 1);
T.now = W('now');
T.final = HIT.final; // the music's final hit lands on "now"
T.qr = WE('now') + 0.2;

export default T;

export const TRANSITIONS = [
  { t: T.s2, type: 'swipe', color: 'navy2', dir: 1 },
  { t: T.s3, type: 'swipe', color: 'orange', dir: -1 },
  { t: T.final, type: 'flash', dur: 0.35 },
];
