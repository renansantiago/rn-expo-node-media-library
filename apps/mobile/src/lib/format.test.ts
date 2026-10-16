import { formatDuration } from './format';

describe('formatDuration', () => {
  it.each([
    [0, '0:00'],
    [5, '0:05'],
    [75, '1:15'],
    [635, '10:35'],
    [3600, '1:00:00'],
    [3725, '1:02:05'],
    [-3, '0:00'],
    [59.9, '0:59'],
  ])('%s → %s', (input, expected) => {
    expect(formatDuration(input)).toBe(expected);
  });
});
