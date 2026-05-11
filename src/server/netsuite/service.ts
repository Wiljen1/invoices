import crypto from "node:crypto";
import type {
  CommerceTransactionType,
  CustomerOption,
  CustomerTransactionOptions,
  TransactionDetail,
  TransactionLineDetail,
  TransactionOption,
  TransactionSearchFilters,
  TransactionSearchResult
} from "../../types";
import type { ServerConfig } from "../env";
import { NetSuiteClient } from "./client";
import {
  assertInternalId,
  commerceTransactionDetailQuery,
  commerceTransactionLinesQuery,
  commerceTransactionSearchQuery,
  commerceTransactionsForCustomerQuery,
  customerListQuery
} from "./queries";

interface NetSuiteCustomerRow {
  id?: string | number;
  entityid?: string;
  companyname?: string;
  altname?: string;
  email?: string;
  currency_name?: string;
}

interface NetSuiteTransactionRow {
  id?: string | number;
  tranid?: string;
  type?: string;
  status?: string;
  status_label?: string;
  trandate?: string;
  duedate?: string;
  shipdate?: string;
  foreigntotal?: string | number;
  foreignamountpaid?: string | number;
  foreignamountunpaid?: string | number;
  currency_name?: string;
  memo?: string;
  entity?: string | number;
  customer_name?: string;
  lastmodifieddate?: string;
}

interface NetSuiteTransactionLineRow {
  linesequencenumber?: string | number;
  item_name?: string;
  memo?: string;
  quantity?: string | number;
  rate?: string | number;
  foreignamount?: string | number;
}

export class InvoiceService {
  private readonly client: NetSuiteClient;
  private readonly customerIdsByKey = new Map<string, string>();
  private readonly customerKeysById = new Map<string, string>();
  private readonly transactionIdsByKey = new Map<string, string>();
  private readonly transactionKeysById = new Map<string, string>();

  constructor(config: ServerConfig) {
    this.client = new NetSuiteClient(config.netsuite);
  }

  async getCustomers(): Promise<CustomerOption[]> {
    const rows = await this.client.suiteql<NetSuiteCustomerRow>(customerListQuery());
    return rows.map((customer) => this.customerOptionFromRow(customer)).filter(Boolean) as CustomerOption[];
  }

  async searchTransactions(filters: TransactionSearchFilters): Promise<TransactionSearchResult[]> {
    const rows = await this.client.suiteql<NetSuiteTransactionRow>(
      commerceTransactionSearchQuery({
        query: filters.query,
        customerId: filters.customerKey ? this.resolveCustomerId(filters.customerKey) : undefined,
        from: filters.from,
        to: filters.to,
        type: filters.type ?? "all",
        limit: 15
      })
    );

    return rows.map((row) => this.transactionSearchResultFromRow(row));
  }

  async getCustomerTransactions(customerKey: string): Promise<CustomerTransactionOptions> {
    const customerId = this.resolveCustomerId(customerKey);
    const [salesOrders, invoices] = await Promise.all([
      this.client.suiteql<NetSuiteTransactionRow>(commerceTransactionsForCustomerQuery(customerId, "sales_order")),
      this.client.suiteql<NetSuiteTransactionRow>(commerceTransactionsForCustomerQuery(customerId, "invoice"))
    ]);

    return {
      salesOrders: salesOrders.map((row) => this.transactionOptionFromRow(row)),
      invoices: invoices.map((row) => this.transactionOptionFromRow(row))
    };
  }

  async getTransactionDetail(transactionKey: string): Promise<TransactionDetail> {
    const transactionId = this.resolveTransactionId(transactionKey);
    const [headers, lines] = await Promise.all([
      this.client.suiteql<NetSuiteTransactionRow>(commerceTransactionDetailQuery(transactionId)),
      this.client.suiteql<NetSuiteTransactionLineRow>(commerceTransactionLinesQuery(transactionId))
    ]);

    const transaction = headers[0];
    if (!transaction) {
      throw new Error("Transaction not found.");
    }

    return this.transactionDetailFromRow(transaction, lines);
  }

  private customerOptionFromRow(customer: NetSuiteCustomerRow) {
    if (!customer.id) return undefined;
    return {
      customerKey: this.customerKeyForInternalId(customer.id),
      name: customer.companyname || customer.altname || customer.entityid || "Customer",
      accountNumber: customer.entityid,
      email: customer.email,
      currency: customer.currency_name
    };
  }

  private customerKeyForInternalId(customerId: string | number) {
    const id = assertInternalId(customerId, "customer ID");
    const existingKey = this.customerKeysById.get(id);
    if (existingKey) return existingKey;

    const customerKey = `cust_${crypto.randomBytes(12).toString("base64url")}`;
    this.customerKeysById.set(id, customerKey);
    this.customerIdsByKey.set(customerKey, id);
    return customerKey;
  }

  private resolveCustomerId(customerKey: string) {
    const customerId = this.customerIdsByKey.get(customerKey);
    if (!customerId) {
      throw new Error("Customer selection expired. Refresh the customer list and try again.");
    }
    return customerId;
  }

  private transactionSearchResultFromRow(row: NetSuiteTransactionRow): TransactionSearchResult {
    const option = this.transactionOptionFromRow(row);
    const balanceDue = transactionBalanceDue(row);
    return {
      ...option,
      customerName: row.customer_name,
      dueDate: normalizeDate(row.duedate),
      balanceDue,
      paidAmount: transactionPaidAmount(row),
      overdue: isTransactionOverdue(row, balanceDue),
      memo: row.memo
    };
  }

  private transactionOptionFromRow(row: NetSuiteTransactionRow): TransactionOption {
    if (!row.id) {
      throw new Error("NetSuite returned a transaction without an internal ID.");
    }

    return {
      transactionKey: this.transactionKeyForInternalId(row.id),
      transactionNumber: row.tranid || "Transaction",
      type: commerceType(row.type),
      statusLabel: row.status_label || row.status || "Updated",
      date: normalizeDate(row.trandate),
      total: Math.abs(toNumber(row.foreigntotal) ?? 0),
      currency: row.currency_name
    };
  }

  private transactionDetailFromRow(
    row: NetSuiteTransactionRow,
    lines: NetSuiteTransactionLineRow[]
  ): TransactionDetail {
    if (!row.id) {
      throw new Error("NetSuite returned a transaction without an internal ID.");
    }

    const type = commerceType(row.type);
    const balanceDue = transactionBalanceDue(row);
    const paidAmount = transactionPaidAmount(row);
    const total = Math.abs(toNumber(row.foreigntotal) ?? 0);
    const currency = row.currency_name || "USD";
    const overdue = isTransactionOverdue(row, balanceDue);

    return {
      transactionKey: this.transactionKeyForInternalId(row.id),
      transactionNumber: row.tranid || "Transaction",
      type,
      customerName: row.customer_name,
      statusLabel: row.status_label || row.status || "Updated",
      date: normalizeDate(row.trandate),
      dueDate: normalizeDate(row.duedate),
      shipDate: normalizeDate(row.shipdate),
      lastModifiedDate: normalizeDateTime(row.lastmodifieddate),
      total,
      paidAmount,
      balanceDue,
      overdue,
      currency,
      memo: row.memo,
      nextAction: transactionNextAction(row, balanceDue, overdue),
      fields: detailFields(row, type, total, paidAmount, balanceDue, currency),
      lines: lines.map((line) => transactionLineFromRow(line))
    };
  }

  private resolveTransactionId(transactionKey: string) {
    const transactionId = this.transactionIdsByKey.get(transactionKey);
    if (!transactionId) {
      throw new Error("Transaction selection expired. Search again and reopen the transaction.");
    }
    return transactionId;
  }

  private transactionKeyForInternalId(transactionId: string | number) {
    const id = assertInternalId(transactionId, "transaction ID");
    const existingKey = this.transactionKeysById.get(id);
    if (existingKey) return existingKey;

    const transactionKey = `txn_${crypto.randomBytes(12).toString("base64url")}`;
    this.transactionKeysById.set(id, transactionKey);
    this.transactionIdsByKey.set(transactionKey, id);
    return transactionKey;
  }
}

function commerceType(type?: string): CommerceTransactionType {
  return type === "SalesOrd" ? "sales_order" : "invoice";
}

function commerceTypeLabel(type: CommerceTransactionType) {
  return type === "sales_order" ? "Sales order" : "Invoice";
}

function transactionBalanceDue(row: NetSuiteTransactionRow) {
  if (row.type !== "CustInvc") return undefined;
  return Math.max(0, Math.abs(toNumber(row.foreignamountunpaid) ?? 0));
}

function transactionPaidAmount(row: NetSuiteTransactionRow) {
  if (row.type !== "CustInvc") return undefined;
  return Math.abs(toNumber(row.foreignamountpaid) ?? 0);
}

function isTransactionOverdue(row: NetSuiteTransactionRow, balanceDue = 0) {
  const dueDate = parseNetSuiteDate(row.duedate);
  return row.type === "CustInvc" && balanceDue > 0 && Boolean(dueDate && dueDate < new Date());
}

function transactionNextAction(row: NetSuiteTransactionRow, balanceDue = 0, overdue = false) {
  const status = `${row.status_label ?? row.status ?? ""}`.toLowerCase();
  if (row.type === "CustInvc") {
    if (overdue) return "Payment overdue";
    if (balanceDue > 0) return "Awaiting payment";
    return "Paid in full";
  }
  if (status.includes("pending fulfillment")) return "In fulfillment";
  if (status.includes("pending approval")) return "Awaiting approval";
  if (status.includes("billed") || status.includes("closed")) return "No action needed";
  return "Review order status";
}

function detailFields(
  row: NetSuiteTransactionRow,
  type: CommerceTransactionType,
  total: number,
  paidAmount: number | undefined,
  balanceDue: number | undefined,
  currency: string
) {
  return [
    { label: "Type", value: commerceTypeLabel(type) },
    { label: "Number", value: row.tranid },
    { label: "Customer", value: row.customer_name },
    { label: "Status", value: row.status_label || row.status },
    { label: "Transaction date", value: normalizeDate(row.trandate) },
    { label: "Due date", value: normalizeDate(row.duedate) },
    { label: "Expected ship date", value: normalizeDate(row.shipdate) },
    { label: "Total", value: `${currency} ${total.toFixed(2)}` },
    paidAmount !== undefined ? { label: "Paid", value: `${currency} ${paidAmount.toFixed(2)}` } : undefined,
    balanceDue !== undefined ? { label: "Balance due", value: `${currency} ${balanceDue.toFixed(2)}` } : undefined,
    { label: "Last changed", value: normalizeDateTime(row.lastmodifieddate) },
    { label: "Memo", value: row.memo }
  ].filter(
    (field): field is { label: string; value: string | number | boolean } =>
      field !== undefined && field.value !== undefined && field.value !== ""
  );
}

function transactionLineFromRow(row: NetSuiteTransactionLineRow): TransactionLineDetail {
  return {
    lineNumber: toNumber(row.linesequencenumber),
    itemName: row.item_name,
    description: row.memo || row.item_name || "Transaction line",
    quantity: toNumber(row.quantity),
    rate: toNumber(row.rate),
    amount: Math.abs(toNumber(row.foreignamount) ?? 0)
  };
}

function toNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function normalizeDate(value?: string) {
  return parseNetSuiteDate(value)?.toISOString().slice(0, 10);
}

function normalizeDateTime(value?: string) {
  return parseNetSuiteDate(value)?.toISOString() ?? undefined;
}

export function parseNetSuiteDate(value?: string) {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;

  const slashDate = trimmed.match(
    /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2})(?::(\d{2}))?(?::(\d{2}))?\s*(am|pm)?)?$/i
  );
  if (slashDate) {
    const first = Number(slashDate[1]);
    const second = Number(slashDate[2]);
    const year = Number(slashDate[3]);
    const usesMonthFirst = second > 12;
    const day = usesMonthFirst ? second : first;
    const month = usesMonthFirst ? first : second;
    const time = normalizeTimeParts(slashDate[4], slashDate[5], slashDate[6], slashDate[7]);
    return validDateFromParts(year, month, day, time.hour, time.minute, time.second);
  }

  const isoDate = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoDate) {
    return validDateFromParts(Number(isoDate[1]), Number(isoDate[2]), Number(isoDate[3]));
  }

  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function normalizeTimeParts(hourValue?: string, minuteValue?: string, secondValue?: string, meridiem?: string) {
  let hour = Number(hourValue ?? 0);
  const minute = Number(minuteValue ?? 0);
  const second = Number(secondValue ?? 0);
  const normalizedMeridiem = meridiem?.toLowerCase();

  if (normalizedMeridiem === "pm" && hour < 12) hour += 12;
  if (normalizedMeridiem === "am" && hour === 12) hour = 0;

  return { hour, minute, second };
}

function validDateFromParts(year: number, month: number, day: number, hour = 0, minute = 0, second = 0) {
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  const valid =
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day &&
    date.getUTCHours() === hour &&
    date.getUTCMinutes() === minute &&
    date.getUTCSeconds() === second;

  return valid ? date : undefined;
}
