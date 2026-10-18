const jwt = require('jsonwebtoken');
const env = require('../../../config/env');
const { signAccessToken, verifyAccessToken } = require('../auth.tokens');

const user = { id: '11111111-1111-1111-1111-111111111111', role: 'user' };
const encode = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');

test('a signed token verifies and returns the user id and role', () => {
  const payload = verifyAccessToken(signAccessToken(user));

  expect(payload.sub).toBe(user.id);
  expect(payload.role).toBe('user');
});

test('the payload holds only sub, role, iat and exp', () => {
  const payload = verifyAccessToken(signAccessToken(user));

  expect(Object.keys(payload).sort()).toEqual(['exp', 'iat', 'role', 'sub']);
});

test('rejects an expired token with TOKEN_EXPIRED', () => {
  const expired = jwt.sign({ role: 'user', exp: Math.floor(Date.now() / 1000) - 10 }, env.JWT_SECRET, {
    subject: user.id,
  });

  expect(() => verifyAccessToken(expired)).toThrow(expect.objectContaining({ code: 'TOKEN_EXPIRED' }));
});

test('rejects a token signed with a different secret', () => {
  const forged = jwt.sign({ role: 'admin' }, 'a-completely-different-secret-value-1234', { subject: user.id });

  expect(() => verifyAccessToken(forged)).toThrow(expect.objectContaining({ code: 'INVALID_TOKEN' }));
});

test('rejects a token whose payload was tampered with', () => {
  const [header, , signature] = signAccessToken(user).split('.');
  const tamperedPayload = encode({ sub: user.id, role: 'admin', exp: Math.floor(Date.now() / 1000) + 3600 });

  expect(() => verifyAccessToken(`${header}.${tamperedPayload}.${signature}`)).toThrow(
    expect.objectContaining({ code: 'INVALID_TOKEN' })
  );
});

test('rejects an unsigned token that claims the none algorithm', () => {
  const header = encode({ alg: 'none', typ: 'JWT' });
  const payload = encode({ sub: user.id, role: 'admin', exp: Math.floor(Date.now() / 1000) + 3600 });

  expect(() => verifyAccessToken(`${header}.${payload}.`)).toThrow(
    expect.objectContaining({ code: 'INVALID_TOKEN' })
  );
});

test('rejects a token signed with a different algorithm, even with the right secret', () => {
  const hs512 = jwt.sign({ role: 'user' }, env.JWT_SECRET, { subject: user.id, algorithm: 'HS512' });

  expect(() => verifyAccessToken(hs512)).toThrow(expect.objectContaining({ code: 'INVALID_TOKEN' }));
});

test('rejects a string that is not a token', () => {
  expect(() => verifyAccessToken('not-a-token')).toThrow(expect.objectContaining({ code: 'INVALID_TOKEN' }));
});
