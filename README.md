# Invoices

Customer-facing invoice and sales order lookup for NetSuite.

This app is intentionally focused on one portal workflow:

- Search invoices and sales orders by number, customer, and date range.
- Autocomplete matching NetSuite transactions while typing.
- Pick a customer, then choose that customer's sales orders or invoices from dropdowns.
- View transaction header details, payment/overdue status, and line-level detail.

The browser never receives NetSuite credentials. All NetSuite calls run through the Node/Express API layer.

## Stack

- React + TypeScript
- Vite
- Node + Express
- NetSuite REST Web Services with SuiteQL
- OAuth 2.0 or Token-Based Authentication

## Codespaces Setup

1. Create `.env` from the example:

   ```bash
   cp .env.example .env
   ```

2. Fill in your NetSuite values in `.env`.

3. Install dependencies:

   ```bash
   npm install
   ```

4. Start the app:

   ```bash
   npm run dev
   ```

5. Open the Vite web URL. In Codespaces this is usually:

   ```bash
   echo "https://${CODESPACE_NAME}-5173.app.github.dev/"
   ```

The API runs on port `3001`, and the React app runs on port `5173`.

## Environment Variables

Required:

```bash
NETSUITE_ACCOUNT_ID=TD3063882
NETSUITE_REALM=TD3063882
NETSUITE_REST_BASE_URL=https://td3063882.suitetalk.api.netsuite.com
NETSUITE_AUTH_MODE=tba
```

For Token-Based Authentication:

```bash
NETSUITE_TBA_CONSUMER_KEY=...
NETSUITE_TBA_CONSUMER_SECRET=...
NETSUITE_TBA_TOKEN_ID=...
NETSUITE_TBA_TOKEN_SECRET=...
```

For OAuth 2.0:

```bash
NETSUITE_AUTH_MODE=oauth2
NETSUITE_OAUTH2_ACCESS_TOKEN=...
```

or configure client credentials / client assertion values from `.env.example`.

## NetSuite Permissions

The NetSuite role used for the token should have:

- REST Web Services
- SuiteAnalytics Workbook / SuiteQL access
- Lists: Customers, view or higher
- Transactions: Sales Orders, view or higher
- Transactions: Invoices, view or higher

If line-level results are empty, confirm the role can view transaction lines and item display values.

## Useful Scripts

```bash
npm run dev
npm run build
npm run test
```

## Project Structure

```text
src/App.tsx                         # invoice and sales order portal UI
src/api.ts                          # browser API client
src/server/index.ts                 # Express routes
src/server/netsuite/client.ts       # secure NetSuite REST client
src/server/netsuite/queries.ts      # SuiteQL query builders
src/server/netsuite/service.ts      # NetSuite response mapping
```
