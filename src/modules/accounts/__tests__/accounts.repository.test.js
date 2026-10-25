const repository = require('../accounts.repository');

test('destination lock returns null if the account disappeared after number lookup', async () => {
  const client = { query: jest.fn().mockResolvedValue({ rows: [] }) };
  const id = '11111111-1111-4111-8111-111111111111';
  expect(await repository.lockById(client, id)).toBeNull();
  expect(client.query).toHaveBeenCalledWith(expect.stringMatching(/WHERE id = \$1\s+FOR UPDATE/), [
    id,
  ]);
});
