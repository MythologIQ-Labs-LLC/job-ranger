const assert = require("assert");
const { parseSalary } = require("../electron/salary-parser.cjs");

// Range formats
assert.deepStrictEqual(
  parseSalary("$100,000 - $150,000 per year"),
  { min: 100000, max: 150000, currency: "USD", period: "year", raw: "$100,000 - $150,000", text: "$100,000 - $150,000 per year" }
);

assert.deepStrictEqual(
  parseSalary("100k-150k annually"),
  { min: 100000, max: 150000, currency: "USD", period: "year", raw: "100k-150k", text: "100k-150k annually" }
);

assert.deepStrictEqual(
  parseSalary("$80K to $120K"),
  { min: 80000, max: 120000, currency: "USD", period: "year", raw: "$80K to $120K", text: "$80K to $120K" }
);

// Single values
assert.deepStrictEqual(
  parseSalary("Salary: $120,000"),
  { min: 120000, max: 120000, currency: "USD", period: "year", raw: "$120,000", text: "$120,000" }
);

assert.deepStrictEqual(
  parseSalary("$150k per year"),
  { min: 150000, max: 150000, currency: "USD", period: "year", raw: "$150k", text: "$150k per year" }
);

// Currency detection
assert.strictEqual(parseSalary("\u20AC50,000 - \u20AC70,000")?.currency, "EUR");
assert.strictEqual(parseSalary("\u00A340,000 - \u00A360,000")?.currency, "GBP");
assert.strictEqual(parseSalary("CAD 80,000 - 100,000")?.currency, "CAD");
assert.strictEqual(parseSalary("AUD 90,000 - 120,000")?.currency, "AUD");

// Period detection
assert.strictEqual(parseSalary("$5,000 monthly")?.period, "month");
assert.strictEqual(parseSalary("$45/hour")?.period, "hour");
assert.strictEqual(parseSalary("$100,000 p.a.")?.period, "year");

// The salary text keeps a pay period written right next to the amount (#216): the assessment reads
// the pay basis from it, and "$24" alone made an hourly listing unknown.
const salaryText = (value) => parseSalary(value)?.text;
assert.strictEqual(salaryText("Pay is $24 per hour, weekdays."), "$24 per hour");
assert.strictEqual(salaryText("$24/hr"), "$24/hr");
assert.strictEqual(salaryText("$22 - $26 an hour"), "$22 - $26 an hour");
assert.strictEqual(salaryText("Hourly rate: $24.50"), "Hourly rate: $24.50");
assert.strictEqual(salaryText("Annual base salary of $90,000 plus benefits"), "Annual base salary of $90,000");
assert.strictEqual(salaryText("<p><strong>$24</strong> per hour</p>"), "$24 per hour");
assert.strictEqual(salaryText("$5,000 monthly"), "$5,000 monthly");
// A period word that is not attached to the amount is not borrowed.
assert.strictEqual(salaryText("Pay $24. Annual review in March."), "$24");
assert.strictEqual(salaryText("$24 hours of training"), "$24");
assert.strictEqual(salaryText("$100k yearly"), "$100k yearly");
assert.strictEqual(salaryText("$22.00 USD per hour"), "$22.00 USD per hour");
assert.strictEqual(salaryText("$24&nbsp;per hour"), "$24 per hour");
// ...nor taken from the next paragraph, list item or line.
assert.strictEqual(salaryText("<li>Starting pay $24</li><li>Annual raises and PTO</li>"), "$24");
assert.strictEqual(salaryText("<p>$24</p><p>Monthly team events</p>"), "$24");
assert.strictEqual(salaryText("$24\nHr department contact"), "$24");
assert.strictEqual(salaryText("<li>Hourly team huddles</li><li>$24</li>"), "$24");
// Abbreviations need "/", "per" or "a(n)"; "ago" is not a period.
assert.strictEqual(salaryText("$5,000 HR referral bonus"), "$5,000");
assert.strictEqual(salaryText("$24 a year ago"), "$24");
assert.strictEqual(salaryText("$24 per hr"), "$24 per hr");

// Edge cases
assert.strictEqual(parseSalary(null), null);
assert.strictEqual(parseSalary(undefined), null);
assert.strictEqual(parseSalary(""), null);
assert.strictEqual(parseSalary("No salary mentioned"), null);
assert.strictEqual(parseSalary("Competitive compensation"), null);

console.log("All salary-parser tests passed!");
