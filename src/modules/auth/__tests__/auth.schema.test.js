const { registerSchema, loginSchema } = require('../auth.schema');

const valid = { email: 'a@x.com', fullName: 'Anurag Raut', password: 'secret123' };

describe('registerSchema', () => {
  test('accepts valid input', () => {
    expect(registerSchema.safeParse(valid).success).toBe(true);
  });

  test('trims and lowercases the email', () => {
    const result = registerSchema.parse({ ...valid, email: '  A@X.COM ' });
    expect(result.email).toBe('a@x.com');
  });

  test('rejects an invalid email', () => {
    expect(registerSchema.safeParse({ ...valid, email: 'not-an-email' }).success).toBe(false);
  });

  test('rejects a short password', () => {
    expect(registerSchema.safeParse({ ...valid, password: 'abc123' }).success).toBe(false);
  });

  test('rejects a password with no number', () => {
    expect(registerSchema.safeParse({ ...valid, password: 'onlyletters' }).success).toBe(false);
  });

  test('rejects a password with no letter', () => {
    expect(registerSchema.safeParse({ ...valid, password: '12345678' }).success).toBe(false);
  });

  test('rejects a password longer than 72 bytes', () => {
    expect(registerSchema.safeParse({ ...valid, password: 'a1'.repeat(37) }).success).toBe(false);
  });

  test('rejects a missing name', () => {
    const input = { ...valid };
    delete input.fullName;
    expect(registerSchema.safeParse(input).success).toBe(false);
  });

  test('strips unknown fields such as role', () => {
    const result = registerSchema.parse({ ...valid, role: 'admin' });
    expect(result.role).toBeUndefined();
  });
});

describe('loginSchema', () => {
  test('accepts any non-empty password', () => {
    expect(loginSchema.safeParse({ email: 'a@x.com', password: 'x' }).success).toBe(true);
  });

  test('rejects an empty password', () => {
    expect(loginSchema.safeParse({ email: 'a@x.com', password: '' }).success).toBe(false);
  });
});
