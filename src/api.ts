import type {
  CustomerOption,
  CustomerTransactionOptions,
  TransactionDetail,
  TransactionSearchFilters,
  TransactionSearchResult
} from "./types";

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {})
    },
    ...init
  });

  if (!response.ok) {
    const errorBody = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new Error(errorBody?.message ?? `Request failed with status ${response.status}`);
  }

  return (await response.json()) as T;
}

export async function fetchCustomers(): Promise<CustomerOption[]> {
  return requestJson<CustomerOption[]>("/api/customers");
}

export async function searchTransactions(filters: TransactionSearchFilters): Promise<TransactionSearchResult[]> {
  const params = new URLSearchParams();
  if (filters.query) params.set("query", filters.query);
  if (filters.customerKey) params.set("customerKey", filters.customerKey);
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  if (filters.type) params.set("type", filters.type);

  const query = params.toString();
  return requestJson<TransactionSearchResult[]>(`/api/transactions/search${query ? `?${query}` : ""}`);
}

export async function fetchCustomerTransactionOptions(customerKey: string): Promise<CustomerTransactionOptions> {
  const params = new URLSearchParams({ customerKey });
  return requestJson<CustomerTransactionOptions>(`/api/transactions/customer-options?${params.toString()}`);
}

export async function fetchTransactionDetail(transactionKey: string): Promise<TransactionDetail> {
  return requestJson<TransactionDetail>(`/api/transactions/${encodeURIComponent(transactionKey)}`);
}
