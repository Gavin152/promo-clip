// Pure layout-check functions: overlap detection, clipping, and safe-zone verification.
// Operates on bounding boxes in design units as returned by window.__frameBoxes.
// Severity rules:
//   'error'   -> caller should FAIL (clipping outside frame, safe-zone violation)
//   'warning' -> reported but does not fail (box overlaps with a peer)
//
// Containment rule (overlap skip): if box A fully contains box B, or vice versa, the pair is
// NOT reported as an overlap. Backgrounds, phones, and other container props draw their content
// inside themselves; reporting that overlap would produce only noise.
//
// Safe zone (vertical format only): y 250–1750 design units.
// Landscape safe zone: none defined; enforcement skipped.
// Square safe zone: none defined; enforcement skipped.
//
// Clipping: any box whose corner extends outside the design-space frame boundary is an error.
// A 2-unit tolerance is applied to ignore hairline shadow/border overhangs that are invisible.

export const SAFE_ZONE = {
  vertical: { y0: 250, y1: 1750 },
};

// design frame dimensions by format
export const DESIGN_FRAME = {
  landscape: { w: 1920, h: 1080 },
  vertical: { w: 1260, h: 2240 },
  square: { w: 1260, h: 1260 },
};

/** Intersection area of two boxes (0 if they don't overlap). */
/** '[x0,y0 → x1,y1]' in whole design units */
const rect = (b) => `[${Math.round(b.x0)},${Math.round(b.y0)} → ${Math.round(b.x1)},${Math.round(b.y1)}]`;

export function intersectArea(a, b) {
  const ox = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
  const oy = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
  return ox > 0 && oy > 0 ? ox * oy : 0;
}

/** True if outer fully contains inner (all four sides). */
export function fullyContains(outer, inner) {
  return (
    outer.x0 <= inner.x0 &&
    outer.y0 <= inner.y0 &&
    outer.x1 >= inner.x1 &&
    outer.y1 >= inner.y1
  );
}

/**
 * Area of a box (may be 0 or negative for degenerate boxes, treated as 0).
 */
export function area(b) {
  return Math.max(0, b.x1 - b.x0) * Math.max(0, b.y1 - b.y0);
}

/**
 * Find overlapping pairs of boxes.
 * Pairs where one box fully contains the other are skipped (containment rule).
 * minOverlapArea: minimum intersection area to report (default 400 = 20×20 px in design units).
 * Returns array of { a, b, overlapArea, scene }.
 */
export function findOverlaps(boxes, minOverlapArea = 400) {
  const results = [];
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i], b = boxes[j];
      // skip if either fully contains the other
      if (fullyContains(a, b) || fullyContains(b, a)) continue;
      const ov = intersectArea(a, b);
      if (ov >= minOverlapArea) {
        results.push({ a, b, overlapArea: ov });
      }
    }
  }
  return results;
}

/**
 * Find boxes that extend outside the design frame.
 * tolerance: allow this many design-unit overhangs (for shadow/border hairlines, default 2).
 */
export function findClipping(boxes, format, tolerance = 2) {
  const frame = DESIGN_FRAME[format] ?? DESIGN_FRAME.landscape;
  return boxes.filter(
    (b) =>
      b.x0 < -tolerance ||
      b.y0 < -tolerance ||
      b.x1 > frame.w + tolerance ||
      b.y1 > frame.h + tolerance,
  );
}

/**
 * Find boxes that violate the vertical safe zone (vertical format only).
 * Only applied when format === 'vertical', and only to boxes that hold text (text !== false).
 * Returns an array of { box, violation: 'above' | 'below' }.
 */
export function findSafeZoneViolations(boxes, format) {
  if (format !== 'vertical') return [];
  const { y0, y1 } = SAFE_ZONE.vertical;
  const violations = [];
  for (const b of boxes) {
    // the safe zone is for text (platform UI covers the top and bottom); decorative stickers may bleed
    if (b.text === false) continue;
    // a box violates if any part of it falls outside the safe band
    if (b.y0 < y0) violations.push({ box: b, violation: 'above', safeY: y0 });
    else if (b.y1 > y1) violations.push({ box: b, violation: 'below', safeY: y1 });
  }
  return violations;
}

/**
 * Run all layout checks for a set of boxes and a format.
 * Returns { warnings: [{kind, ...}], errors: [{kind, ...}] }.
 *   warnings -> overlap (does not fail QA)
 *   errors   -> clipping | safeZone (fails QA)
 */
export function checkLayout(boxes, format) {
  const warnings = [];
  const errors = [];

  const overlaps = findOverlaps(boxes);
  for (const { a, b, overlapArea } of overlaps) {
    warnings.push({
      kind: 'overlap',
      severity: 'warning',
      msg: `boxes overlap by ${Math.round(overlapArea)} du²: ${rect(a)}${a.text ? ' (text)' : ''} and ${rect(b)}${b.text ? ' (text)' : ''}`,
      a,
      b,
      overlapArea,
    });
  }

  const clipped = findClipping(boxes, format);
  for (const b of clipped) {
    errors.push({
      kind: 'clipping',
      severity: 'error',
      msg: `box [${b.x0.toFixed(0)},${b.y0.toFixed(0)},${b.x1.toFixed(0)},${b.y1.toFixed(0)}] extends outside the ${format} frame (scene ${b.scene ?? '?'})`,
      box: b,
    });
  }

  const szv = findSafeZoneViolations(boxes, format);
  for (const { box: b, violation, safeY } of szv) {
    errors.push({
      kind: 'safeZone',
      severity: 'error',
      msg: `box ${violation} safe zone y=${safeY} in ${format} (scene ${b.scene ?? '?'}, box y=[${b.y0.toFixed(0)},${b.y1.toFixed(0)}])`,
      box: b,
      violation,
      safeY,
    });
  }

  return { warnings, errors };
}
