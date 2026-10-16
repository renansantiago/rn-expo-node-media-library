import { ItemSchema } from '@media-library/contracts';
import { contract, contractViolations } from './server';
import { makeItem } from './fixtures';

describe('fake API contract guard', () => {
  it('records responses that break the shared schemas (so the test fails)', () => {
    contract(ItemSchema, makeItem());
    expect(contractViolations).toEqual([]);

    contract(ItemSchema, { ...makeItem(), durationSec: -1 });
    expect(contractViolations).toHaveLength(1);
    contractViolations.length = 0; // this test expects the violation; don't fail it in afterEach
  });
});
