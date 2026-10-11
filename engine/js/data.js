// Timeline data: every visual/audio cue is derived from the project's two data files.
//  - vo/timing.json   word-level times of the voice-over (film time = vo_start + t)
//  - assets/music/cues.json   BPM/beat grid/hits of the soundtrack + its film offset + mix profile
// '@project' is the video folder; the build resolves it (see tools/build.mjs).
import TIMING_JSON from '@project/vo/timing.json';
import CUES_JSON from '@project/assets/music/cues.json';
import { makeData } from './data-core.js';

const D = makeData(TIMING_JSON, CUES_JSON);
export const { TIMING, CUES, VO_START, WORDS, W, WE, Wa, S, MOFF, BEAT, BEATS, DOWNBEATS, HIT, ACCENTS, accent, onBeat, beatFrom, DURATION } = D;
