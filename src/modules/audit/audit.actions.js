const { maskAccountNumber } = require('../../shared/utils/mask');

// Request bodies come straight from the client, before any validation. Whatever is copied
// into the log goes through these helpers, so the log can never hold a surprise: an object,
// an enormous string, or a field that should never be stored.
const text = (value, max = 254) => (typeof value === 'string' ? value.slice(0, max) : null);
const whole = (value) => (Number.isSafeInteger(value) ? value : null);
const asObject = (body) =>
  body !== null && typeof body === 'object' && !Array.isArray(body) ? body : {};

// The actions that come from an HTTP request, each with the list of request fields worth
// keeping. This is a WHITELIST: a field that is not named here is never logged.
// In particular, "password" appears nowhere in this file.
const REQUEST_ACTIONS = {
  'auth.register': (body) => ({ email: text(body.email) }),
  'auth.login': (body) => ({ email: text(body.email) }),
  // Income and existing debt are sensitive and must not be copied into the audit log.
  'loan.apply': (body) => ({
    principal: whole(body.principal),
    tenureMonths: whole(body.tenureMonths),
  }),
  'transaction.deposit': (body) => ({
    accountId: text(body.accountId, 64),
    amount: whole(body.amount),
  }),
  'transaction.withdraw': (body) => ({
    accountId: text(body.accountId, 64),
    amount: whole(body.amount),
  }),
  'transaction.transfer': (body) => {
    const destination = text(body.toAccountNumber, 32);
    return {
      fromAccountId: text(body.fromAccountId, 64),
      // Masked: the log is read by admins, and a full number is all it takes to pay an account.
      toAccount: destination ? maskAccountNumber(destination) : null,
      amount: whole(body.amount),
    };
  },
};

// Actions written by something other than a request (an operator running a script).
const OTHER_ACTIONS = ['admin.role_granted'];

const ACTION_NAMES = [...Object.keys(REQUEST_ACTIONS), ...OTHER_ACTIONS];

function pickMetadata(action, body) {
  return REQUEST_ACTIONS[action](asObject(body));
}

module.exports = { REQUEST_ACTIONS, ACTION_NAMES, pickMetadata };
