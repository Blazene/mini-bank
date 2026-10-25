jest.mock('../../auth/auth.repository');
jest.mock('../applications.repository');
const users = require('../../auth/auth.repository');
const repository = require('../applications.repository');
const service = require('../reviews.service');

const body = { decision: 'approved', reason: 'Income documents reviewed' };
const pending = {
  application: { id: 'loan', status: 'pending', review: null },
  applicantId: 'borrower',
  reviewerId: null,
};
const approved = {
  application: {
    id: 'loan',
    status: 'approved',
    review: { reason: body.reason, reviewedAt: 'timestamp' },
  },
  applicantId: 'borrower',
  reviewerId: 'admin',
};

beforeEach(() => {
  jest.resetAllMocks();
  users.findById.mockResolvedValue({ id: 'admin', role: 'admin' });
  repository.findForReview.mockResolvedValue(pending);
  repository.decidePending.mockResolvedValue(approved.application);
});

test('fresh admin check precedes unscoped application access', async () => {
  expect(await service.get('admin', 'loan')).toEqual(pending.application);
  expect(users.findById).toHaveBeenCalledWith('admin');
  expect(repository.findForReview).toHaveBeenCalledWith('loan');
  expect(users.findById.mock.invocationCallOrder[0]).toBeLessThan(
    repository.findForReview.mock.invocationCallOrder[0]
  );
});

test.each(['get', 'review'])(
  '%s refuses demoted and deleted admins before reading loans',
  async (method) => {
    users.findById.mockResolvedValue({ role: 'user' });
    await expect(service[method]('admin', 'loan', body)).rejects.toMatchObject({ statusCode: 403 });
    users.findById.mockResolvedValue(null);
    await expect(service[method]('admin', 'loan', body)).rejects.toMatchObject({ statusCode: 401 });
    expect(repository.findForReview).not.toHaveBeenCalled();
    expect(repository.decidePending).not.toHaveBeenCalled();
  }
);

test('a missing application returns 404', async () => {
  repository.findForReview.mockResolvedValue(null);
  await expect(service.review('admin', 'missing', body)).rejects.toMatchObject({
    statusCode: 404,
    code: 'LOAN_APPLICATION_NOT_FOUND',
  });
});

test('self review fails before any update', async () => {
  repository.findForReview.mockResolvedValue({ ...pending, applicantId: 'admin' });
  await expect(service.review('admin', 'loan', body)).rejects.toMatchObject({
    statusCode: 403,
    code: 'SELF_REVIEW_FORBIDDEN',
  });
  expect(repository.decidePending).not.toHaveBeenCalled();
});

test('writes only validated decision fields through the conditional update', async () => {
  expect(
    await service.review('admin', 'loan', {
      ...body,
      reason: ` ${body.reason} `,
      principal: 1,
      reviewedBy: 'other',
    })
  ).toEqual({ application: approved.application, replayed: false });
  expect(repository.decidePending).toHaveBeenCalledWith(
    'loan',
    'admin',
    body.decision,
    body.reason
  );
});

test('an identical retry returns the recorded decision without another update', async () => {
  repository.findForReview.mockResolvedValue(approved);
  expect(await service.review('admin', 'loan', body)).toEqual({
    application: approved.application,
    replayed: true,
  });
  expect(repository.decidePending).not.toHaveBeenCalled();
});

test.each([
  { decision: 'rejected', reason: body.reason },
  { decision: 'approved', reason: 'A different explanation' },
])('changed review payload cannot overwrite an existing decision (%p)', async (changed) => {
  repository.findForReview.mockResolvedValue(approved);
  await expect(service.review('admin', 'loan', changed)).rejects.toMatchObject({
    code: 'LOAN_ALREADY_REVIEWED',
  });
  expect(repository.decidePending).not.toHaveBeenCalled();
});

test('another admin cannot claim an identical previous decision as their retry', async () => {
  repository.findForReview.mockResolvedValue(approved);
  await expect(service.review('other-admin', 'loan', body)).rejects.toMatchObject({
    statusCode: 409,
  });
});

test('a lost conditional-update race replays the winning identical decision', async () => {
  repository.decidePending.mockResolvedValue(null);
  repository.findForReview.mockResolvedValueOnce(pending).mockResolvedValueOnce(approved);
  expect(await service.review('admin', 'loan', body)).toEqual({
    application: approved.application,
    replayed: true,
  });
});

test('a lost conditional-update race refuses a different winning admin', async () => {
  repository.decidePending.mockResolvedValue(null);
  repository.findForReview
    .mockResolvedValueOnce(pending)
    .mockResolvedValueOnce({ ...approved, reviewerId: 'someone-else' });
  await expect(service.review('admin', 'loan', body)).rejects.toMatchObject({ statusCode: 409 });
});
