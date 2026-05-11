export type CommerceTransactionType = "invoice" | "sales_order";

export interface CustomerOption {
  customerKey: string;
  name: string;
  accountNumber?: string;
  email?: string;
  currency?: string;
}

export interface TransactionSearchFilters {
  query?: string;
  customerKey?: string;
  from?: string;
  to?: string;
  type?: CommerceTransactionType | "all";
}

export interface TransactionOption {
  transactionKey: string;
  transactionNumber: string;
  type: CommerceTransactionType;
  statusLabel: string;
  date?: string;
  total?: number;
  currency?: string;
}

export interface CustomerTransactionOptions {
  salesOrders: TransactionOption[];
  invoices: TransactionOption[];
}

export interface TransactionSearchResult extends TransactionOption {
  customerName?: string;
  dueDate?: string;
  balanceDue?: number;
  paidAmount?: number;
  overdue?: boolean;
  memo?: string;
}

export interface TransactionDetailField {
  label: string;
  value?: string | number | boolean;
}

export interface TransactionLineDetail {
  lineNumber?: number;
  itemName?: string;
  description: string;
  quantity?: number;
  rate?: number;
  amount: number;
}

export interface TransactionDetail {
  transactionKey: string;
  transactionNumber: string;
  type: CommerceTransactionType;
  customerName?: string;
  statusLabel: string;
  date?: string;
  dueDate?: string;
  shipDate?: string;
  lastModifiedDate?: string;
  total: number;
  paidAmount?: number;
  balanceDue?: number;
  overdue: boolean;
  currency: string;
  memo?: string;
  nextAction: string;
  fields: TransactionDetailField[];
  lines: TransactionLineDetail[];
}
