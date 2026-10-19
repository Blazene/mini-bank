// pg returns BIGINT as a string, because JavaScript numbers are only exact up to 2^53 - 1.
// Money is stored as whole paise, so the conversion is exact for any value below that limit
// (about 90 trillion rupees). Above it we refuse to answer rather than return a wrong number.
function paiseToNumber(value) {
  const number = Number(value);
  if (!Number.isSafeInteger(number)) {
    throw new Error(`Amount ${value} cannot be represented exactly as a JavaScript number`);
  }
  return number;
}

module.exports = { paiseToNumber };
