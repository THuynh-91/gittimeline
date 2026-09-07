import { expect, test } from './muted';

test('the fixture silences native media state, not just property getters', async ({ page }) => {
  await page.goto('about:blank');
  const state = await page.evaluate(async () => {
    // Check the getters themselves as well as their values: init scripts
    // also run in child frames, so a second realm alone cannot rule out a
    // fake zero supplied by the fixture.
    const frame = document.createElement('iframe');
    document.body.append(frame);
    const realm = frame.contentWindow as Window & typeof globalThis;
    const proto = realm.HTMLMediaElement.prototype;
    const volume = Object.getOwnPropertyDescriptor(proto, 'volume')!.get!;
    const muted = Object.getOwnPropertyDescriptor(proto, 'muted')!.get!;
    const read = (el: HTMLMediaElement) => ({ volume: volume.call(el) as number, muted: muted.call(el) as boolean });
    const assigned = new Audio();
    assigned.volume = 0.7;
    assigned.muted = false;
    const untouched = new Audio();
    // No source: exercise the play guard without emitting any sound.
    const pending = untouched.play().catch(() => {});
    const result = {
      nativeGetters: [volume, muted].every(get => Function.prototype.toString.call(get).includes('[native code]')),
      assigned: read(assigned), guardedPlay: read(untouched),
    };
    untouched.pause();
    await pending;
    frame.remove();
    return result;
  });
  expect(state.nativeGetters).toBe(true);
  expect(state.assigned).toEqual({ volume: 0, muted: true });
  expect(state.guardedPlay).toEqual({ volume: 0, muted: true });
});
