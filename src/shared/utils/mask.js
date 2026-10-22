// Shows only the last four digits of an account number: 123456789012 becomes XXXXXXXX9012.
// Used when a statement line names the OTHER party's account. You recognise it, but the full
// number (which is all someone needs to send money to that account) is not handed out.
function maskAccountNumber(accountNumber) {
  const text = String(accountNumber);
  return 'X'.repeat(Math.max(0, text.length - 4)) + text.slice(-4);
}

module.exports = { maskAccountNumber };
