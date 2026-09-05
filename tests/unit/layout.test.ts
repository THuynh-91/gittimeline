import { describe, expect, it } from 'vitest';
import { LANE_GAP, MAX_LANES, layoutGraph, type ThreadLayoutInput } from '@/layout/layout';

describe('lane assignment', () => {
  /**
   * A chain of branches, each one taken off the previous branch rather than
   * off the spine — the shape a project has when a long-lived branch grows its
   * own long-lived branches. Every fixture in the corpus is too shallow to
   * reach it, which is why this went unseen.
   */
  const nested = (depth: number) => {
    const perThread = 3;
    const threads: ThreadLayoutInput[] = [
      { idx: 0, id: 'spine', nodeIds: Array.from({ length: depth + 2 }, (_, i) => i), baseId: -1, mergeId: -1, isSpine: true },
    ];
    let next = depth + 2;
    let baseId = 0;
    for (let d = 0; d < depth; d++) {
      const nodeIds = Array.from({ length: perThread }, () => next++);
      threads.push({ idx: threads.length, id: `t${d}`, nodeIds, baseId, mergeId: -1, isSpine: false });
      baseId = nodeIds[0]!; // the next branch comes off this one
    }
    const impact = new Float64Array(next);
    for (let i = 0; i < next; i++) impact[i] = i;
    return { threads, impact };
  };

  it('nesting never places a thread outside the lanes the camera can reach', () => {
    // Before: `minLane = baseLay.lane + 1` was a running total, and the guard
    // meant to catch it read `... % Math.max(1, MAX_LANES - minLane)` — which
    // collapses to `% 1` once minLane reaches MAX_LANES, and every integer is
    // 0 mod 1. So `lane = minLane`, unclamped, and 300 levels of nesting put a
    // thread 300 lanes out. CPython reached 2,304.
    const { threads, impact } = nested(300);
    const out = layoutGraph(threads, impact, 96, 'test');

    expect(out.maxLane).toBeLessThan(MAX_LANES);
    for (const l of out.threads) expect(l.lane).toBeLessThan(MAX_LANES);
    const reach = MAX_LANES * LANE_GAP + LANE_GAP;
    for (const yv of out.y) expect(Math.abs(yv)).toBeLessThanOrEqual(reach);
  });

  it('shallow nesting still steps outward, which is what makes it readable', () => {
    const { threads, impact } = nested(3);
    const out = layoutGraph(threads, impact, 96, 'test');
    const lanes = threads.slice(1).map((t) => out.threads[t.idx]!.lane);
    // Each branch of a branch sits further from the spine than its parent.
    for (let i = 1; i < lanes.length; i++) expect(lanes[i]!).toBeGreaterThan(lanes[i - 1]!);
  });

  it('is deterministic', () => {
    const a = layoutGraph(...(({ threads, impact }) => [threads, impact, 96, 'seed'] as const)(nested(40)));
    const b = layoutGraph(...(({ threads, impact }) => [threads, impact, 96, 'seed'] as const)(nested(40)));
    expect([...a.y]).toEqual([...b.y]);
  });
});
