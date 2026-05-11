import cors from "cors";
import express from "express";
import { z } from "zod";
import type { TransactionSearchFilters } from "../types";
import { getServerConfig } from "./env";
import { InvoiceService } from "./netsuite/service";

const config = getServerConfig();
const app = express();
const service = new InvoiceService(config);

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected date format YYYY-MM-DD");
const customerKey = z.string().min(1).max(160);
const transactionSearchQuerySchema = z.object({
  query: z.string().max(80).optional(),
  customerKey: customerKey.optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  type: z.enum(["invoice", "sales_order", "all"]).optional()
});
const customerTransactionOptionsQuerySchema = z.object({
  customerKey
});
const transactionDetailParamsSchema = z.object({
  transactionKey: z.string().min(1).max(160)
});

app.use(
  cors({
    origin: config.clientOrigin,
    credentials: false
  })
);
app.use(express.json({ limit: "1mb" }));

app.get("/", (request, response) => {
  const portalUrl = inferPortalUrl(request);
  response
    .status(200)
    .type("html")
    .send(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta http-equiv="refresh" content="0; url=${escapeHtml(portalUrl)}" />
    <title>Opening Invoices</title>
  </head>
  <body>
    <main>
      <h1>Opening invoices...</h1>
      <p>This is the API port. The invoices app runs on the Vite web port.</p>
      <a href="${escapeHtml(portalUrl)}">Open invoices</a>
    </main>
  </body>
</html>`);
});

app.get("/api/health", (_request, response) => {
  response.json({ ok: true, dataSource: "netsuite" });
});

app.get("/api/customers", async (_request, response) => {
  try {
    response.json(await service.getCustomers());
  } catch (error) {
    sendApiError(response, error, "Unable to load customers.");
  }
});

app.get("/api/transactions/search", async (request, response) => {
  try {
    const query = transactionSearchQuerySchema.parse(request.query) as TransactionSearchFilters;
    response.json(await service.searchTransactions(query));
  } catch (error) {
    sendApiError(response, error, "Unable to search invoices and sales orders.");
  }
});

app.get("/api/transactions/customer-options", async (request, response) => {
  try {
    const query = customerTransactionOptionsQuerySchema.parse(request.query);
    response.json(await service.getCustomerTransactions(query.customerKey));
  } catch (error) {
    sendApiError(response, error, "Unable to load customer transactions.");
  }
});

app.get("/api/transactions/:transactionKey", async (request, response) => {
  try {
    const params = transactionDetailParamsSchema.parse(request.params);
    response.json(await service.getTransactionDetail(params.transactionKey));
  } catch (error) {
    sendApiError(response, error, "Unable to load transaction detail.");
  }
});

app.listen(config.port, () => {
  console.log(`Invoices API listening on http://localhost:${config.port}`);
});

function inferPortalUrl(request: express.Request) {
  const forwardedHost = request.get("x-forwarded-host");
  const host = forwardedHost || request.get("host");
  const protocol = request.get("x-forwarded-proto") || request.protocol || "http";

  if (!host) return config.clientOrigin;

  if (host.includes("-3001.")) {
    return `${protocol}://${host.replace("-3001.", "-5173.")}`;
  }

  if (host.includes(":3001")) {
    return `${protocol}://${host.replace(":3001", ":5173")}`;
  }

  return config.clientOrigin;
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function sendApiError(response: express.Response, error: unknown, fallbackMessage: string) {
  if (error instanceof z.ZodError) {
    response.status(400).json({ message: error.errors[0]?.message ?? fallbackMessage });
    return;
  }

  const message = error instanceof Error ? error.message : fallbackMessage;
  response.status(500).json({ message });
}
