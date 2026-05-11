const INTERNAL_ID_PATTERN = /^\d+$/;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export interface DateRange {
  from?: string;
  to?: string;
}

export interface TransactionSearchQueryOptions extends DateRange {
  query?: string;
  customerId?: string | number;
  type?: "invoice" | "sales_order" | "all";
  limit?: number;
}

export function assertInternalId(value: string | number, label = "internal ID") {
  const normalized = String(value).trim();
  if (!INTERNAL_ID_PATTERN.test(normalized)) {
    throw new Error(`Invalid ${label}. Expected a numeric NetSuite internal ID.`);
  }
  return normalized;
}

export function assertIsoDate(value: string, label: string) {
  if (!ISO_DATE_PATTERN.test(value)) {
    throw new Error(`Invalid ${label}. Expected YYYY-MM-DD.`);
  }
  return value;
}

export function sqlString(value: string) {
  return `'${value.replaceAll("'", "''")}'`;
}

function dateRangeClause(column: string, range: DateRange = {}) {
  const clauses: string[] = [];
  if (range.from) {
    clauses.push(`${column} >= TO_DATE(${sqlString(assertIsoDate(range.from, "from date"))}, 'YYYY-MM-DD')`);
  }
  if (range.to) {
    clauses.push(`${column} <= TO_DATE(${sqlString(assertIsoDate(range.to, "to date"))}, 'YYYY-MM-DD')`);
  }
  return clauses.length ? `AND ${clauses.join(" AND ")}` : "";
}

function safeLimit(limit = 25, max = 100) {
  const parsedLimit = Number.isFinite(limit) ? Math.floor(limit) : 25;
  return Math.min(Math.max(parsedLimit, 1), max);
}

function transactionTypeClause(type: TransactionSearchQueryOptions["type"] = "all") {
  if (type === "invoice") return "t.type = 'CustInvc'";
  if (type === "sales_order") return "t.type = 'SalesOrd'";
  return "t.type IN ('CustInvc', 'SalesOrd')";
}

export function customerListQuery(limit = 500) {
  const limitValue = safeLimit(limit, 1000);
  return `
SELECT
  c.id,
  c.entityid,
  c.companyname,
  c.altname,
  c.email,
  c.currency,
  BUILTIN.DF(c.currency) AS currency_name
FROM customer c
WHERE NVL(c.isinactive, 'F') = 'F'
  AND ROWNUM <= ${limitValue}
ORDER BY c.companyname, c.altname, c.entityid
`.trim();
}

export function commerceTransactionSearchQuery(options: TransactionSearchQueryOptions = {}) {
  const clauses = [transactionTypeClause(options.type)];
  const limit = safeLimit(options.limit, 100);

  if (options.customerId) {
    clauses.push(`t.entity = ${assertInternalId(options.customerId, "customer ID")}`);
  }

  if (options.query?.trim()) {
    const query = options.query.trim().slice(0, 80).toLowerCase();
    clauses.push(
      `(LOWER(t.tranid) LIKE ${sqlString(`${query}%`)} OR LOWER(c.companyname) LIKE ${sqlString(`%${query}%`)} OR LOWER(c.altname) LIKE ${sqlString(`%${query}%`)} OR LOWER(c.entityid) LIKE ${sqlString(`${query}%`)})`
    );
  }

  const rangeClause = dateRangeClause("t.trandate", options);
  if (rangeClause) clauses.push(rangeClause.replace(/^AND\s+/, ""));

  return `
SELECT
  t.id,
  t.tranid,
  t.type,
  t.status,
  BUILTIN.DF(t.status) AS status_label,
  t.trandate,
  t.duedate,
  t.shipdate,
  t.foreigntotal,
  t.foreignamountpaid,
  t.foreignamountunpaid,
  t.currency,
  BUILTIN.DF(t.currency) AS currency_name,
  t.memo,
  t.entity,
  NVL(c.companyname, NVL(c.altname, BUILTIN.DF(t.entity))) AS customer_name,
  t.lastmodifieddate
FROM transaction t
LEFT JOIN customer c ON c.id = t.entity
WHERE ${clauses.join("\n  AND ")}
  AND ROWNUM <= ${limit}
ORDER BY t.trandate DESC, t.tranid DESC
`.trim();
}

export function commerceTransactionsForCustomerQuery(customerId: string | number, type: "invoice" | "sales_order") {
  const id = assertInternalId(customerId, "customer ID");
  return commerceTransactionSearchQuery({
    customerId: id,
    type,
    limit: 100
  });
}

export function commerceTransactionDetailQuery(transactionId: string | number) {
  const id = assertInternalId(transactionId, "transaction ID");
  return `
SELECT
  t.id,
  t.tranid,
  t.type,
  t.status,
  BUILTIN.DF(t.status) AS status_label,
  t.trandate,
  t.duedate,
  t.shipdate,
  t.foreigntotal,
  t.foreignamountpaid,
  t.foreignamountunpaid,
  t.currency,
  BUILTIN.DF(t.currency) AS currency_name,
  t.memo,
  t.entity,
  NVL(c.companyname, NVL(c.altname, BUILTIN.DF(t.entity))) AS customer_name,
  t.lastmodifieddate
FROM transaction t
LEFT JOIN customer c ON c.id = t.entity
WHERE t.id = ${id}
  AND t.type IN ('CustInvc', 'SalesOrd')
`.trim();
}

export function commerceTransactionLinesQuery(transactionId: string | number) {
  const id = assertInternalId(transactionId, "transaction ID");
  return `
SELECT
  tl.linesequencenumber,
  BUILTIN.DF(tl.item) AS item_name,
  tl.memo,
  tl.quantity,
  tl.rate,
  tl.foreignamount
FROM transactionline tl
WHERE tl.transaction = ${id}
  AND NVL(tl.mainline, 'F') = 'F'
  AND NVL(tl.taxline, 'F') = 'F'
ORDER BY tl.linesequencenumber
`.trim();
}
