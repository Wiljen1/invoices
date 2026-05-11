import {
  CalendarDays,
  CheckCircle2,
  Clock3,
  CreditCard,
  Download,
  FileSearch,
  FileText,
  ListFilter,
  RefreshCw,
  Search,
  ShoppingCart
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  fetchCustomerTransactionOptions,
  fetchCustomers,
  fetchTransactionDetail,
  searchTransactions
} from "./api";
import type {
  CommerceTransactionType,
  CustomerOption,
  CustomerTransactionOptions,
  TransactionDetail,
  TransactionOption,
  TransactionSearchResult
} from "./types";

const currencyFormatterCache = new Map<string, Intl.NumberFormat>();

function formatMoney(amount?: number, currency = "USD") {
  if (amount === undefined) return "Not available";
  const cacheKey = currency;
  if (!currencyFormatterCache.has(cacheKey)) {
    currencyFormatterCache.set(
      cacheKey,
      new Intl.NumberFormat(undefined, {
        style: "currency",
        currency,
        maximumFractionDigits: 2
      })
    );
  }
  return currencyFormatterCache.get(cacheKey)!.format(amount);
}

function formatDate(value?: string) {
  if (!value) return "Not set";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(date);
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function defaultFromDate() {
  const date = new Date();
  date.setDate(date.getDate() - 180);
  return date.toISOString().slice(0, 10);
}

function transactionTypeLabel(type: CommerceTransactionType) {
  return type === "sales_order" ? "Sales order" : "Invoice";
}

function transactionIcon(type: CommerceTransactionType) {
  return type === "sales_order" ? <ShoppingCart size={18} /> : <CreditCard size={18} />;
}

function exportCsv(results: TransactionSearchResult[]) {
  const headers = ["Type", "Number", "Customer", "Status", "Date", "Due date", "Total", "Paid", "Balance due", "Currency"];
  const rows = results.map((result) => [
    transactionTypeLabel(result.type),
    result.transactionNumber,
    result.customerName ?? "",
    result.overdue ? "Overdue" : result.statusLabel,
    result.date ?? "",
    result.dueDate ?? "",
    result.total?.toFixed(2) ?? "",
    result.paidAmount?.toFixed(2) ?? "",
    result.balanceDue?.toFixed(2) ?? "",
    result.currency ?? ""
  ]);
  const csv = [headers, ...rows]
    .map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(","))
    .join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `invoices-search-${todayIso()}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export default function App() {
  const [customers, setCustomers] = useState<CustomerOption[]>([]);
  const [customersLoading, setCustomersLoading] = useState(true);
  const [customerError, setCustomerError] = useState<string | null>(null);

  const [searchTerm, setSearchTerm] = useState("");
  const [searchType, setSearchType] = useState<CommerceTransactionType | "all">("all");
  const [searchCustomerKey, setSearchCustomerKey] = useState("");
  const [from, setFrom] = useState(defaultFromDate);
  const [to, setTo] = useState(todayIso);
  const [results, setResults] = useState<TransactionSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  const [selectedCustomerKey, setSelectedCustomerKey] = useState("");
  const [customerTransactions, setCustomerTransactions] = useState<CustomerTransactionOptions>({
    salesOrders: [],
    invoices: []
  });
  const [customerTransactionsLoading, setCustomerTransactionsLoading] = useState(false);
  const [selectedSalesOrderKey, setSelectedSalesOrderKey] = useState("");
  const [selectedInvoiceKey, setSelectedInvoiceKey] = useState("");

  const [selectedDetail, setSelectedDetail] = useState<TransactionDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const selectedCustomerName = useMemo(
    () => customers.find((customer) => customer.customerKey === selectedCustomerKey)?.name,
    [customers, selectedCustomerKey]
  );

  useEffect(() => {
    let cancelled = false;
    setCustomersLoading(true);
    fetchCustomers()
      .then((options) => {
        if (cancelled) return;
        setCustomers(options);
        const first = options[0]?.customerKey ?? "";
        setSelectedCustomerKey(first);
        setSearchCustomerKey(first);
      })
      .catch((error) => {
        if (cancelled) return;
        setCustomerError(error instanceof Error ? error.message : "Unable to load customers.");
      })
      .finally(() => {
        if (!cancelled) setCustomersLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    setSelectedDetail(null);
    setDetailError(null);
    setSelectedSalesOrderKey("");
    setSelectedInvoiceKey("");

    if (!selectedCustomerKey) {
      setCustomerTransactions({ salesOrders: [], invoices: [] });
      return;
    }

    let cancelled = false;
    setCustomerTransactionsLoading(true);
    fetchCustomerTransactionOptions(selectedCustomerKey)
      .then((options) => {
        if (cancelled) return;
        setCustomerTransactions(options);
      })
      .catch((error) => {
        if (cancelled) return;
        setDetailError(error instanceof Error ? error.message : "Unable to load customer transactions.");
        setCustomerTransactions({ salesOrders: [], invoices: [] });
      })
      .finally(() => {
        if (!cancelled) setCustomerTransactionsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedCustomerKey]);

  useEffect(() => {
    const term = searchTerm.trim();
    const hasUsefulFilter = term.length >= 2 || Boolean(searchCustomerKey || from || to);
    if (!hasUsefulFilter) {
      setResults([]);
      return;
    }

    const timer = window.setTimeout(() => {
      void runSearch();
    }, 300);

    return () => window.clearTimeout(timer);
  }, [from, searchCustomerKey, searchTerm, searchType, to]);

  async function runSearch() {
    setSearching(true);
    setSearchError(null);
    try {
      const nextResults = await searchTransactions({
        query: searchTerm.trim() || undefined,
        customerKey: searchCustomerKey || undefined,
        from: from || undefined,
        to: to || undefined,
        type: searchType
      });
      setResults(nextResults);
    } catch (error) {
      setSearchError(error instanceof Error ? error.message : "Unable to search transactions.");
      setResults([]);
    } finally {
      setSearching(false);
    }
  }

  async function openTransaction(transactionKey: string, source: "search" | "sales_order" | "invoice" = "search") {
    if (!transactionKey) return;
    setDetailLoading(true);
    setDetailError(null);
    if (source === "sales_order") {
      setSelectedSalesOrderKey(transactionKey);
      setSelectedInvoiceKey("");
    }
    if (source === "invoice") {
      setSelectedInvoiceKey(transactionKey);
      setSelectedSalesOrderKey("");
    }

    try {
      setSelectedDetail(await fetchTransactionDetail(transactionKey));
    } catch (error) {
      setDetailError(error instanceof Error ? error.message : "Unable to load transaction detail.");
      setSelectedDetail(null);
    } finally {
      setDetailLoading(false);
    }
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">NetSuite</p>
          <h1>Invoices and sales orders</h1>
          <p className="topbar-copy">Search live NetSuite transactions by number, customer, and date range.</p>
        </div>
        <div className="topbar-actions">
          <button className="secondary-button" type="button" onClick={() => void runSearch()} disabled={searching}>
            <RefreshCw size={17} className={searching ? "spin" : undefined} />
            Refresh
          </button>
          <button className="primary-button" type="button" onClick={() => exportCsv(results)} disabled={!results.length}>
            <Download size={17} />
            Export CSV
          </button>
        </div>
      </header>

      {customerError ? (
        <section className="error-banner" role="alert">
          {customerError}
        </section>
      ) : null}

      <section className="workspace-grid">
        <article className="content-surface search-panel">
          <div className="surface-heading">
            <div>
              <p className="eyebrow">Search</p>
              <h2>Find a transaction</h2>
            </div>
            <FileSearch size={19} />
          </div>

          <div className="search-grid">
            <label className="search-field transaction-search">
              <Search size={17} />
              <input
                type="search"
                placeholder="Search SO23, INV360, customer, or account"
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
              />
            </label>
            <label>
              <span>Type</span>
              <select value={searchType} onChange={(event) => setSearchType(event.target.value as CommerceTransactionType | "all")}>
                <option value="all">Invoices and sales orders</option>
                <option value="sales_order">Sales orders only</option>
                <option value="invoice">Invoices only</option>
              </select>
            </label>
            <label>
              <span>Customer</span>
              <select
                value={searchCustomerKey}
                onChange={(event) => setSearchCustomerKey(event.target.value)}
                disabled={customersLoading}
              >
                <option value="">All customers</option>
                {customers.map((customer) => (
                  <option key={customer.customerKey} value={customer.customerKey}>
                    {customer.name}
                    {customer.accountNumber ? ` - ${customer.accountNumber}` : ""}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>From</span>
              <input type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
            </label>
            <label>
              <span>To</span>
              <input type="date" value={to} onChange={(event) => setTo(event.target.value)} />
            </label>
          </div>

          {searchError ? (
            <div className="inline-error" role="alert">
              {searchError}
            </div>
          ) : null}

          <div className="suggestion-panel">
            {searching ? (
              <div className="inline-loading">
                <RefreshCw className="spin" size={16} />
                Searching NetSuite...
              </div>
            ) : results.length ? (
              results.map((result) => (
                <button
                  className="suggestion-row"
                  type="button"
                  key={result.transactionKey}
                  onClick={() => void openTransaction(result.transactionKey)}
                >
                  <span className="suggestion-icon">{transactionIcon(result.type)}</span>
                  <span className="suggestion-main">
                    <strong>{result.transactionNumber}</strong>
                    <small>
                      {transactionTypeLabel(result.type)} - {result.customerName ?? "Customer"} - {formatDate(result.date)}
                    </small>
                  </span>
                  <span className={result.overdue ? "status-chip danger" : "status-chip neutral"}>
                    {result.overdue ? "Overdue" : result.statusLabel}
                  </span>
                  <b>{formatMoney(result.total, result.currency)}</b>
                </button>
              ))
            ) : (
              <EmptyState
                title="No matching invoices or sales orders"
                detail="Type at least two characters, choose a customer, or adjust the date filters."
              />
            )}
          </div>
        </article>

        <article className="content-surface quick-pick-panel">
          <div className="surface-heading">
            <div>
              <p className="eyebrow">Customer</p>
              <h2>Quick pick</h2>
            </div>
            <ListFilter size={19} />
          </div>

          <label>
            <span>Customer</span>
            <select
              value={selectedCustomerKey}
              onChange={(event) => setSelectedCustomerKey(event.target.value)}
              disabled={customersLoading}
            >
              <option value="">{customersLoading ? "Loading customers..." : "Select customer"}</option>
              {customers.map((customer) => (
                <option key={customer.customerKey} value={customer.customerKey}>
                  {customer.name}
                  {customer.accountNumber ? ` - ${customer.accountNumber}` : ""}
                </option>
              ))}
            </select>
          </label>

          <label>
            <span>Sales order</span>
            <select
              value={selectedSalesOrderKey}
              disabled={!selectedCustomerKey || customerTransactionsLoading}
              onChange={(event) => void openTransaction(event.target.value, "sales_order")}
            >
              <option value="">
                {customerTransactionsLoading ? "Loading sales orders..." : "Select sales order"}
              </option>
              {customerTransactions.salesOrders.map((option) => (
                <TransactionOptionElement key={option.transactionKey} option={option} />
              ))}
            </select>
          </label>

          <label>
            <span>Invoice</span>
            <select
              value={selectedInvoiceKey}
              disabled={!selectedCustomerKey || customerTransactionsLoading}
              onChange={(event) => void openTransaction(event.target.value, "invoice")}
            >
              <option value="">
                {customerTransactionsLoading ? "Loading invoices..." : "Select invoice"}
              </option>
              {customerTransactions.invoices.map((option) => (
                <TransactionOptionElement key={option.transactionKey} option={option} />
              ))}
            </select>
          </label>

          <div className="customer-summary">
            <strong>{selectedCustomerName ?? "Choose a customer"}</strong>
            <p>
              {customerTransactions.salesOrders.length} sales order(s), {customerTransactions.invoices.length} invoice(s)
            </p>
          </div>
        </article>
      </section>

      <article className="content-surface detail-panel">
        {detailLoading ? (
          <div className="loading-state">
            <RefreshCw className="spin" />
            <p>Loading transaction detail...</p>
          </div>
        ) : detailError ? (
          <div className="error-banner" role="alert">
            {detailError}
          </div>
        ) : selectedDetail ? (
          <TransactionDetailView detail={selectedDetail} />
        ) : (
          <EmptyState
            title="Select a transaction"
            detail="Search by number or choose a customer, then open a sales order or invoice to see the NetSuite detail."
          />
        )}
      </article>
    </main>
  );
}

function TransactionOptionElement({ option }: { option: TransactionOption }) {
  return (
    <option value={option.transactionKey}>
      {option.transactionNumber} - {option.statusLabel}
    </option>
  );
}

function TransactionDetailView({ detail }: { detail: TransactionDetail }) {
  return (
    <div className="transaction-detail">
      <div className="detail-header">
        <div>
          <p className="eyebrow">{transactionTypeLabel(detail.type)}</p>
          <h2>{detail.transactionNumber}</h2>
          <p>{detail.customerName ?? "Customer"}</p>
        </div>
        <div className="status-stack">
          <span className={detail.overdue ? "status-badge danger" : "status-badge ok"}>
            {detail.overdue ? <Clock3 size={16} /> : <CheckCircle2 size={16} />}
            {detail.nextAction}
          </span>
          <span className="status-chip neutral">{detail.statusLabel}</span>
        </div>
      </div>

      <div className="metric-grid">
        <Metric label="Total" value={formatMoney(detail.total, detail.currency)} icon={<CreditCard size={18} />} />
        <Metric label="Paid" value={formatMoney(detail.paidAmount, detail.currency)} icon={<CheckCircle2 size={18} />} />
        <Metric label="Balance due" value={formatMoney(detail.balanceDue, detail.currency)} icon={<Clock3 size={18} />} />
        <Metric label="Date" value={formatDate(detail.date)} icon={<CalendarDays size={18} />} />
      </div>

      <div className="detail-grid">
        {detail.fields.map((field) => (
          <div key={field.label}>
            <span>{field.label}</span>
            <strong>{typeof field.value === "boolean" ? (field.value ? "Yes" : "No") : field.value}</strong>
          </div>
        ))}
      </div>

      <div className="surface-heading lines-heading">
        <h3>Line detail</h3>
        <span className="status-chip neutral">{detail.lines.length} line(s)</span>
      </div>
      {detail.lines.length ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Line</th>
                <th>Item</th>
                <th>Description</th>
                <th>Quantity</th>
                <th>Rate</th>
                <th>Amount</th>
              </tr>
            </thead>
            <tbody>
              {detail.lines.map((line, index) => (
                <tr key={`${line.lineNumber ?? index}-${line.description}`}>
                  <td>{line.lineNumber ?? index + 1}</td>
                  <td>{line.itemName ?? "Item"}</td>
                  <td>{line.description}</td>
                  <td>{line.quantity ?? ""}</td>
                  <td>{line.rate !== undefined ? formatMoney(line.rate, detail.currency) : ""}</td>
                  <td>{formatMoney(line.amount, detail.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState title="No line detail returned" detail="NetSuite returned the header, but no item lines for this transaction." compact />
      )}
    </div>
  );
}

function Metric({ label, value, icon }: { label: string; value: string; icon: ReactNode }) {
  return (
    <div className="metric">
      <span>{icon}</span>
      <small>{label}</small>
      <strong>{value}</strong>
    </div>
  );
}

function EmptyState({ title, detail, compact = false }: { title: string; detail: string; compact?: boolean }) {
  return (
    <div className={compact ? "empty-state compact" : "empty-state"}>
      <FileText size={compact ? 20 : 30} />
      <strong>{title}</strong>
      <p>{detail}</p>
    </div>
  );
}
