import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  intersectArea,
  fullyContains,
  area,
  findOverlaps,
  findClipping,
  findSafeZoneViolations,
  checkLayout,
  SAFE_ZONE,
  DESIGN_FRAME,
} from '../../engine/tools/lib/layout-check.mjs';

// ---- helper box factories ----
const box = (x0, y0, x1, y1, scene = null) => ({ x0, y0, x1, y1, scene });

// ---- intersectArea ----
test('intersectArea: non-overlapping boxes return 0', () => {
  assert.equal(intersectArea(box(0, 0, 100, 100), box(200, 0, 300, 100)), 0);
  assert.equal(intersectArea(box(0, 0, 100, 100), box(0, 200, 100, 300)), 0);
  assert.equal(intersectArea(box(0, 0, 100, 100), box(100, 0, 200, 100)), 0); // edge touch = 0
});

test('intersectArea: partial overlap', () => {
  // 50x50 = 2500
  assert.equal(intersectArea(box(0, 0, 100, 100), box(50, 50, 150, 150)), 50 * 50);
});

test('intersectArea: one inside another', () => {
  // inner = 40x40 = 1600
  assert.equal(intersectArea(box(0, 0, 100, 100), box(30, 30, 70, 70)), 40 * 40);
});

test('intersectArea: identical boxes', () => {
  assert.equal(intersectArea(box(10, 10, 110, 110), box(10, 10, 110, 110)), 100 * 100);
});

// ---- fullyContains ----
test('fullyContains: inner inside outer', () => {
  assert.ok(fullyContains(box(0, 0, 200, 200), box(50, 50, 150, 150)));
});

test('fullyContains: partial overlap is not containment', () => {
  assert.ok(!fullyContains(box(0, 0, 100, 100), box(50, 50, 150, 150)));
});

test('fullyContains: same box is self-contained', () => {
  assert.ok(fullyContains(box(0, 0, 100, 100), box(0, 0, 100, 100)));
});

test('fullyContains: touching edges counts as containment', () => {
  assert.ok(fullyContains(box(0, 0, 100, 100), box(0, 0, 100, 100)));
  assert.ok(fullyContains(box(0, 0, 200, 200), box(0, 0, 100, 100)));
});

// ---- area ----
test('area: simple rect', () => {
  assert.equal(area(box(10, 10, 60, 70)), 50 * 60);
});

test('area: degenerate zero-area box', () => {
  assert.equal(area(box(10, 10, 10, 100)), 0);
});

// ---- findOverlaps ----
test('findOverlaps: returns overlapping pairs above threshold', () => {
  const boxes = [
    box(0, 0, 100, 100, 'A'),
    box(80, 80, 200, 200, 'B'), // 20x20=400 overlap
  ];
  const result = findOverlaps(boxes, 400);
  assert.equal(result.length, 1);
  assert.equal(result[0].overlapArea, 400);
});

test('findOverlaps: skips pairs below threshold', () => {
  const boxes = [
    box(0, 0, 100, 100),
    box(95, 95, 200, 200), // 5x5=25 overlap
  ];
  assert.equal(findOverlaps(boxes, 400).length, 0);
});

test('findOverlaps: skips contained boxes (containment rule)', () => {
  const boxes = [
    box(0, 0, 500, 500, 'bg'), // background fully contains inner
    box(100, 100, 200, 200, 'content'),
  ];
  // bg fully contains content -> skip
  assert.equal(findOverlaps(boxes).length, 0);
});

test('findOverlaps: three boxes, only the two true overlaps reported', () => {
  const boxes = [
    box(0, 0, 500, 500), // large container
    box(50, 50, 100, 100), // fully inside the large one -> containment, skip
    box(100, 100, 200, 200), // also fully inside the large one -> containment, skip
  ];
  // both small boxes are inside boxes[0], no pair is a true peer overlap
  assert.equal(findOverlaps(boxes).length, 0, 'contained pairs should be skipped');
});

test('findOverlaps: two non-contained overlapping boxes', () => {
  const boxes = [
    box(0, 0, 300, 300, 'A'),
    box(250, 250, 600, 600, 'B'), // 50x50 = 2500 overlap
  ];
  const r = findOverlaps(boxes, 400);
  assert.equal(r.length, 1);
  assert.ok(r[0].overlapArea >= 2500);
});

// ---- findClipping ----
test('findClipping: box fully inside frame returns empty', () => {
  const boxes = [box(100, 100, 800, 600)];
  assert.equal(findClipping(boxes, 'landscape').length, 0);
});

test('findClipping: box outside left edge is clipping', () => {
  const boxes = [box(-10, 100, 200, 300)]; // x0 = -10 < -2 (tolerance)
  assert.equal(findClipping(boxes, 'landscape').length, 1);
});

test('findClipping: box outside right edge is clipping', () => {
  const { w } = DESIGN_FRAME.landscape;
  const boxes = [box(100, 100, w + 20, 300)];
  assert.equal(findClipping(boxes, 'landscape').length, 1);
});

test('findClipping: box within tolerance is not clipping', () => {
  // x0 = -1 (within default tol=2)
  const boxes = [box(-1, 100, 200, 300)];
  assert.equal(findClipping(boxes, 'landscape').length, 0);
});

test('findClipping: vertical format uses vertical frame dims', () => {
  const { w, h } = DESIGN_FRAME.vertical;
  const inside = box(10, 10, w - 10, h - 10);
  assert.equal(findClipping([inside], 'vertical').length, 0);
  const outsideH = box(10, 10, w - 10, h + 30); // y1 > h+2
  assert.equal(findClipping([outsideH], 'vertical').length, 1);
});

// ---- findSafeZoneViolations ----
test('findSafeZoneViolations: only applies to vertical format', () => {
  // a box at y0=100 is fine in landscape (no safe zone)
  assert.equal(findSafeZoneViolations([box(100, 100, 500, 500)], 'landscape').length, 0);
  assert.equal(findSafeZoneViolations([box(100, 100, 500, 500)], 'square').length, 0);
});

test('findSafeZoneViolations: box above safe zone in vertical', () => {
  const { y0 } = SAFE_ZONE.vertical;
  const b = box(100, 50, 500, 400); // y0 = 50 < 250 => above
  const r = findSafeZoneViolations([b], 'vertical');
  assert.equal(r.length, 1);
  assert.equal(r[0].violation, 'above');
});

test('findSafeZoneViolations: box below safe zone in vertical', () => {
  const { y1 } = SAFE_ZONE.vertical;
  const b = box(100, 1200, 500, y1 + 100); // y1 > 1750 => below
  const r = findSafeZoneViolations([b], 'vertical');
  assert.equal(r.length, 1);
  assert.equal(r[0].violation, 'below');
});

test('findSafeZoneViolations: box fully inside safe zone', () => {
  const b = box(100, 300, 900, 1600); // 300-1600 within 250-1750
  assert.equal(findSafeZoneViolations([b], 'vertical').length, 0);
});

test('findSafeZoneViolations: box at exact boundary is fine', () => {
  const { y0, y1 } = SAFE_ZONE.vertical;
  const b = box(100, y0, 900, y1); // exactly at boundary
  assert.equal(findSafeZoneViolations([b], 'vertical').length, 0);
});

// ---- checkLayout ----
test('checkLayout: no issues for clean set of boxes', () => {
  const boxes = [
    box(100, 300, 500, 600, 'sc1'),
    box(800, 400, 1200, 700, 'sc1'),
  ];
  const { warnings, errors } = checkLayout(boxes, 'landscape');
  assert.equal(errors.length, 0);
  assert.equal(warnings.length, 0);
});

test('checkLayout: overlap produces a warning, not an error', () => {
  const boxes = [
    box(0, 0, 500, 500, 'sc1'),
    box(400, 400, 800, 800, 'sc1'), // 100x100=10000 overlap
  ];
  const { warnings, errors } = checkLayout(boxes, 'landscape');
  assert.equal(errors.length, 0);
  assert.ok(warnings.length > 0);
  assert.equal(warnings[0].kind, 'overlap');
  assert.equal(warnings[0].severity, 'warning');
});

test('checkLayout: clipping produces an error', () => {
  const boxes = [box(-50, 100, 200, 300)]; // outside left
  const { errors } = checkLayout(boxes, 'landscape');
  assert.ok(errors.some((e) => e.kind === 'clipping'));
  assert.ok(errors.every((e) => e.severity === 'error'));
});

test('checkLayout: safe-zone violation in vertical produces an error', () => {
  const boxes = [box(100, 50, 500, 400)]; // y0=50 above safe zone
  const { errors } = checkLayout(boxes, 'vertical');
  assert.ok(errors.some((e) => e.kind === 'safeZone'));
});

test('checkLayout: safe-zone only enforced in vertical', () => {
  const boxes = [box(100, 50, 500, 400)]; // y0=50 - fine in landscape
  const { errors } = checkLayout(boxes, 'landscape');
  assert.ok(!errors.some((e) => e.kind === 'safeZone'));
});

// ---- DESIGN_FRAME constants ----
test('DESIGN_FRAME has correct values', () => {
  assert.deepEqual(DESIGN_FRAME.landscape, { w: 1920, h: 1080 });
  assert.deepEqual(DESIGN_FRAME.vertical, { w: 1260, h: 2240 });
  assert.deepEqual(DESIGN_FRAME.square, { w: 1260, h: 1260 });
});

// ---- SAFE_ZONE constants ----
test('SAFE_ZONE.vertical covers the correct range', () => {
  assert.equal(SAFE_ZONE.vertical.y0, 250);
  assert.equal(SAFE_ZONE.vertical.y1, 1750);
});
