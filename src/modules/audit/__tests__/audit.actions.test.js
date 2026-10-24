const { REQUEST_ACTIONS, ACTION_NAMES, pickMetadata } = require('../audit.actions');

test('lists every action an admin can filter by, including the one written by the script', () => {
  expect(ACTION_NAMES).toEqual([
    'auth.register',
    'auth.login',
    'transaction.deposit',
    'transaction.withdraw',
    'transaction.transfer',
    'admin.role_granted',
  ]);
});

describe('what is kept from a request', () => {
  test('login and register keep only the email', () => {
    const body = { email: 'a@x.com', password: 'secret123', fullName: 'A', extra: 1 };
    expect(pickMetadata('auth.login', body)).toEqual({ email: 'a@x.com' });
    expect(pickMetadata('auth.register', body)).toEqual({ email: 'a@x.com' });
  });

  test('a password is never copied, whatever the field is called', () => {
    for (const action of Object.keys(REQUEST_ACTIONS)) {
      const body = {
        email: 'a@x.com',
        password: 'secret123',
        newPassword: 'secret456',
        token: 'abc',
        amount: 5,
      };
      expect(JSON.stringify(pickMetadata(action, body))).not.toMatch(/secret|abc/);
    }
  });

  test('deposit and withdraw keep the account and the amount', () => {
    const body = { accountId: 'acc-1', amount: 500, description: 'private note' };
    expect(pickMetadata('transaction.deposit', body)).toEqual({ accountId: 'acc-1', amount: 500 });
    expect(pickMetadata('transaction.withdraw', body)).toEqual({ accountId: 'acc-1', amount: 500 });
  });

  test('a transfer keeps the source account, the amount and a MASKED destination', () => {
    const body = {
      fromAccountId: 'acc-1',
      toAccountNumber: '123456789012',
      amount: 700,
      description: 'rent',
    };
    expect(pickMetadata('transaction.transfer', body)).toEqual({
      fromAccountId: 'acc-1',
      toAccount: 'XXXXXXXX9012',
      amount: 700,
    });
  });
});

describe('a request body cannot put surprises into the log', () => {
  test('values that are not the expected type become null', () => {
    const body = { email: { $ne: 1 }, accountId: 42, amount: '500' };
    expect(pickMetadata('auth.login', body)).toEqual({ email: null });
    expect(pickMetadata('transaction.deposit', body)).toEqual({ accountId: null, amount: null });
  });

  test('amounts must be whole, safe numbers', () => {
    for (const amount of [1.5, NaN, Infinity, 2 ** 60, -0.1]) {
      expect(pickMetadata('transaction.deposit', { amount }).amount).toBeNull();
    }
    expect(pickMetadata('transaction.deposit', { amount: 100 }).amount).toBe(100);
  });

  test('long text is cut short', () => {
    expect(pickMetadata('auth.login', { email: 'a'.repeat(1000) }).email).toHaveLength(254);
    expect(
      pickMetadata('transaction.deposit', { accountId: 'a'.repeat(500) }).accountId
    ).toHaveLength(64);
  });

  test.each([undefined, null, 'text', 42, [], [1, 2]])(
    'a body of %p gives empty values, not a crash',
    (body) => {
      expect(pickMetadata('auth.login', body)).toEqual({ email: null });
      expect(pickMetadata('transaction.transfer', body)).toEqual({
        fromAccountId: null,
        toAccount: null,
        amount: null,
      });
    }
  );
});
