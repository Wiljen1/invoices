import { describe, expect, it } from "vitest";
import {
  assertInternalId,
  commerceTransactionSearchQuery,
  sqlString
} from "./queries";

describe("NetSuite query helpers", () => {
  it("escapes SQL string values", () => {
    expect(sqlString("O'Brien")).toBe("'O''Brien'");
  });

  it("rejects non-numeric internal IDs", () => {
    expect(() => assertInternalId("12 OR 1=1")).toThrow("Invalid internal ID");
  });

  it("builds focused invoice and sales order search queries", () => {
    const query = commerceTransactionSearchQuery({
      query: "SO23",
      customerId: "1964",
      type: "sales_order",
      from: "2026-01-01",
      to: "2026-05-08",
      limit: 500
    });

    expect(query).toContain("t.type = 'SalesOrd'");
    expect(query).toContain("t.entity = 1964");
    expect(query).toContain("LOWER(t.tranid) LIKE 'so23%'");
    expect(query).toContain("ROWNUM <= 100");
  });
});
