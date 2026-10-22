const { encodeCursor, decodeCursor } = require('../history.cursor');

const POSITION = {
  createdAt: '2026-10-22T10:47:38.534123Z',
  id: '11111111-1111-4111-8111-111111111111',
};
const pack = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');

test('a cursor survives a round trip, keeping all six microsecond digits', () => {
  expect(decodeCursor(encodeCursor(POSITION))).toEqual(POSITION);
});

test('is URL safe: no plus, slash or equals signs', () => {
  expect(encodeCursor(POSITION)).toMatch(/^[A-Za-z0-9_-]+$/);
});

test.each([
  ['plain text', 'hello'],
  ['empty text', ''],
  ['base64 of something that is not JSON', Buffer.from('not json').toString('base64url')],
  ['JSON null', pack(null)],
  ['a JSON array', pack([1, 2])],
  ['a missing id', pack({ t: POSITION.createdAt })],
  ['a timestamp with only milliseconds', pack({ t: '2026-10-22T10:47:38.534Z', i: POSITION.id })],
  ['a timestamp that is not a date', pack({ t: '9999-99-99T99:99:99.123456Z', i: POSITION.id })],
  ['a day that does not exist', pack({ t: '2026-02-30T10:00:00.000000Z', i: POSITION.id })],
  ['an id that is not a UUID', pack({ t: POSITION.createdAt, i: '1; DROP TABLE accounts' })],
  [
    'an id with capital letters',
    pack({ t: POSITION.createdAt, i: 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA' }),
  ],
  ['numbers instead of text', pack({ t: 1, i: 2 })],
])('refuses a cursor made of %s', (_label, text) => {
  expect(decodeCursor(text)).toBeNull();
});
