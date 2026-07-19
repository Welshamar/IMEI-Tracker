function luhnCheck(digits) {
  let sum = 0;
  const contrib = [];
  for (let i = 0; i < 14; i++) {
    let d = digits[i];
    const doubled = i % 2 === 1;
    if (doubled) {
      d = d * 2;
      if (d > 9) d -= 9;
    }
    contrib.push({ val: digits[i], doubled });
    sum += d;
  }
  const checkDigit = (10 - (sum % 10)) % 10;
  contrib.push({ val: digits[14], doubled: false, isCheck: true });
  return { valid: checkDigit === digits[14], checkDigit, contrib };
}

module.exports = { luhnCheck };
