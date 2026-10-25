jest.mock('../auth.repository');
const repository = require('../auth.repository');
const service = require('../auth.service');

beforeEach(() => jest.resetAllMocks());

test.each([
  { code: '08006', constraint: undefined },
  { code: '23505', constraint: 'some_other_unique_constraint' },
])('does not disguise unexpected registration errors as duplicate emails: %p', async (fields) => {
  const error = Object.assign(new Error('unexpected database error'), fields);
  repository.createUser.mockRejectedValueOnce(error);
  await expect(
    service.register({ email: 'test@x.com', fullName: 'Test User', password: 'secret123' })
  ).rejects.toBe(error);
  expect(repository.createUser).toHaveBeenCalledWith({
    email: 'test@x.com',
    fullName: 'Test User',
    passwordHash: expect.stringMatching(/^\$2[aby]\$/),
  });
});
