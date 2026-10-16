import { MIN_RESUME_SEC, resumePositionSec } from './resume';

describe('resumePositionSec', () => {
  it.each([
    ['no progress', null, 0],
    ['barely started', { positionSec: MIN_RESUME_SEC - 1, durationSec: 600 }, 0],
    ['mid-way', { positionSec: 321.5, durationSec: 600 }, 321.5],
    ['just before the end', { positionSec: 569, durationSec: 600 }, 569],
    ['watched (≥ 95%)', { positionSec: 570, durationSec: 600 }, 0],
  ])('%s → %s', (_label, progress, expected) => {
    expect(resumePositionSec(progress)).toBe(expected);
  });
});
