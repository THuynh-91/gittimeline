import { describe, expect, it } from 'vitest';
import { travelEase } from '@/renderer/canvas';

/**
 * Nothing is drawn before it happens.
 *
 * That is the one rule the whole picture's credibility rests on, and it has
 * now been broken twice in the same place. `48ca9d7` fixed the first half:
 * merges were stroked along their *entire* route with no bound at all, so you
 * could see where a branch was going to go before it went there. The bound it
 * added was a reveal fraction `u` — and `u` came from an easing curve that sat
 * *above* the diagonal, `f*f*(3-2f)*0.6 + 0.4*f^1.7`, which returns 0.829 at
 * f = 0.815. So the reveal still ran ahead of the clock; only less of it did.
 *
 * Measured on streamed Kubernetes at 40% of its show, before this test
 * existed: twenty-nine merge strokes in a single frame were drawn past the
 * playhead, the worst of them 7,600 px past it — off the right of the frame.
 * Sampled at six points across that show, bright ink reached the frame's right
 * edge at every one. A viewer reported "strings go in the future" and was
 * describing the renderer accurately.
 *
 * The property is cheap to state and cheap to check, which is the reason the
 * easing is an exported pure function rather than a private method: a reveal
 * may never exceed linear progress. Anything at or below the diagonal is
 * honest, whatever its shape.
 */
describe('travelEase', () => {
  const kinds = ['merge', 'secondary', 'divergence', 'aggregate', 'unknown', 'primary'];

  it('never reveals more of a path than has been travelled', () => {
    for (const kind of kinds) {
      for (const reduced of [false, true]) {
        for (let i = 0; i <= 2000; i++) {
          const f = i / 2000;
          const u = travelEase(kind, f, reduced);
          // The epsilon is for float error only; it is a thousandth of a
          // percent of the path, well under a pixel on any route drawn.
          expect(u, `${kind} reduced=${reduced} f=${f}`).toBeLessThanOrEqual(f + 1e-12);
        }
      }
    }
  });

  it('lands exactly on arrival, and starts at the departure', () => {
    for (const kind of kinds) {
      for (const reduced of [false, true]) {
        expect(travelEase(kind, 0, reduced)).toBe(0);
        expect(travelEase(kind, 1, reduced)).toBe(1);
      }
    }
  });

  it('clamps a clock that has run outside the edge', () => {
    // `travelU` divides by a floored duration, so f can leave [0,1] on a
    // zero-length edge or a seek past the end. A `u` above 1 indexes past the
    // point list; a negative one draws backwards from the tail.
    for (const kind of kinds) {
      expect(travelEase(kind, 2)).toBe(1);
      expect(travelEase(kind, -3)).toBe(0);
      expect(travelEase(kind, Number.POSITIVE_INFINITY)).toBe(1);
    }
  });

  it('still accelerates into the landing, so arrivals read as hits', () => {
    // The reason the leading curve was there in the first place. An easing
    // below the diagonal can still speed up throughout, and both of these do:
    // each successive tenth of the journey reveals more path than the last.
    for (const kind of ['merge', 'secondary']) {
      let prev = -1;
      for (let i = 1; i <= 10; i++) {
        const step = travelEase(kind, i / 10) - travelEase(kind, (i - 1) / 10);
        expect(step, `${kind} tenth ${i}`).toBeGreaterThan(prev);
        prev = step;
      }
    }
  });

  it('reveals a merge faster than an ordinary edge, as it did before', () => {
    // The relative intent survives the fix: merges are the snappier of the
    // two, so a convergence still arrives with more emphasis than a commit
    // travelling along its own lane.
    for (let i = 1; i < 10; i++) {
      const f = i / 10;
      expect(travelEase('merge', f)).toBeGreaterThan(travelEase('secondary', f));
    }
  });

  it('is honest under reduced motion too, which is where it always was', () => {
    // Reduced motion returned raw `f` before the fix and still does. That mode
    // was the only one drawing the truth, which is worth keeping on the record:
    // the defect was in the flourish, not in the geometry.
    for (let i = 0; i <= 10; i++) expect(travelEase('merge', i / 10, true)).toBe(i / 10);
  });
});
