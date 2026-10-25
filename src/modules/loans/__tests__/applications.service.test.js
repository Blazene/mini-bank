jest.mock('../applications.repository');
jest.mock('../loans.service');
const repository = require('../applications.repository');
const quotes = require('../loans.service');
const service = require('../applications.service');

const input = {
  principal: 10000000,
  tenureMonths: 12,
  monthlyIncome: 5000000,
  existingMonthlyEmi: 0,
};
const saved = { id: 'application', ...input, status: 'pending', quote: { saved: true } };

beforeEach(() => {
  jest.resetAllMocks();
  repository.findByKey.mockResolvedValue(null);
  repository.insert.mockResolvedValue(saved);
  quotes.quote.mockReturnValue({ eligibility: { eligible: true, reasons: [] } });
});

test('saves only normalized inputs and the server-generated quote', async () => {
  const result = await service.apply(
    'user',
    { ...input, status: 'approved', annualRateBps: 0 },
    'key'
  );
  expect(result).toEqual({ application: saved, replayed: false });
  expect(repository.insert).toHaveBeenCalledWith(
    'user',
    input,
    'key',
    quotes.quote.mock.results[0].value
  );
});

test('replays saved terms before recalculating eligibility', async () => {
  repository.findByKey.mockResolvedValue(saved);
  expect(await service.apply('user', input, 'key')).toEqual({ application: saved, replayed: true });
  expect(quotes.quote).not.toHaveBeenCalled();
  expect(repository.insert).not.toHaveBeenCalled();
});

test.each([
  ['principal', 9000000],
  ['tenureMonths', 24],
  ['monthlyIncome', 6000000],
  ['existingMonthlyEmi', 1],
])('rejects a reused key with a changed %s', async (field, value) => {
  repository.findByKey.mockResolvedValue(saved);
  await expect(service.apply('user', { ...input, [field]: value }, 'key')).rejects.toMatchObject({
    statusCode: 422,
    code: 'IDEMPOTENCY_KEY_REUSED',
  });
  expect(repository.insert).not.toHaveBeenCalled();
});

test('ineligible applications are not saved', async () => {
  quotes.quote.mockReturnValue({
    eligibility: { eligible: false, reasons: ['INCOME_BELOW_MINIMUM'] },
  });
  await expect(service.apply('user', input, 'key')).rejects.toMatchObject({
    code: 'LOAN_INELIGIBLE',
  });
  expect(repository.insert).not.toHaveBeenCalled();
});

test('a concurrent insert replays the winning row', async () => {
  repository.insert.mockResolvedValue(null);
  repository.findByKey.mockResolvedValueOnce(null).mockResolvedValueOnce(saved);
  expect(await service.apply('user', input, 'key')).toEqual({ application: saved, replayed: true });
});

test('a concurrent insert with changed inputs is refused', async () => {
  repository.insert.mockResolvedValue(null);
  repository.findByKey
    .mockResolvedValueOnce(null)
    .mockResolvedValueOnce({ ...saved, principal: 9000000 });
  await expect(service.apply('user', input, 'key')).rejects.toMatchObject({
    code: 'IDEMPOTENCY_KEY_REUSED',
  });
});

test('fails rather than inventing a replay if a conflicting row cannot be read', async () => {
  repository.insert.mockResolvedValue(null);
  repository.findByKey.mockResolvedValue(null);
  await expect(service.apply('user', input, 'key')).rejects.toThrow(
    'Concurrent loan application could not be read'
  );
  expect(repository.findByKey).toHaveBeenCalledTimes(2);
});

test('reads applications through the ownership-scoped repository', async () => {
  repository.findForUser.mockResolvedValue(saved);
  expect(await service.get('owner', 'application')).toEqual(saved);
  expect(repository.findForUser).toHaveBeenCalledWith('application', 'owner');
});

test('missing and unowned applications share the same 404', async () => {
  repository.findForUser.mockResolvedValue(null);
  await expect(service.get('stranger', 'application')).rejects.toMatchObject({
    statusCode: 404,
    code: 'LOAN_APPLICATION_NOT_FOUND',
  });
});
