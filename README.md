# Zariya

A considered, premium-style storefront with a React and Vite shop, an Express REST API, and MongoDB-backed products, collections, and orders. The sample catalog contains **15 categories and 30 curated products (two per category)**, including a royal edit of heirloom-inspired silk, jewellery, and fragrance. The private `/admin` Zariya Studio dashboard provides sales and inventory reporting, order and payment status management, and full product/category CRUD.

## Get started

1. Install Node.js 18 or newer and have MongoDB running locally, or create a MongoDB Atlas database.
2. Copy `.env.example` to `.env`. Set `MONGODB_URI` to your MongoDB connection string, and set `SESSION_SECRET` to a long, private random value (at least 32 characters). Set `ADMIN_EMAIL` and `ADMIN_PASSWORD` to a dedicated administrator email and a unique password of at least 12 characters. The first time the server connects, it hashes this password and creates the separate administrator account. `ADMIN_API_KEY` is optional for legacy server-to-server admin access.
3. Run `npm install` and `npm run seed` to populate the database.
4. Run `npm run dev` and open the Vite URL printed in the terminal. Vite forwards `/api` requests to the Express server on port 5000.

Browsing the included sample catalog works without MongoDB. In local `npm run dev`, the loopback-only auto-admin session can add, edit, bulk-edit, import/export, and delete products and categories against an in-memory preview catalog; preview edits reset when the server restarts. Connect MongoDB and configure the environment credentials above for durable products, customer accounts, and orders. Customers register at `/account`; administrators sign in separately at `/admin`, and customer accounts cannot self-register as administrators. Demo admin login is disabled by `npm start` and in production. The product editor supports parent categories and subcategories, SKUs, regular/sale prices, short/full descriptions, stock tracking/status, attributes, simple/variable/grouped/virtual types, and variation SKUs/prices/stock. Admins can upload JPEG, PNG, and WebP product images (up to 8 MB each) as featured images or gallery images; uploads are served from `/uploads` and stored in the server's `uploads/` directory, so production deployments must retain that directory or mount persistent storage there. The catalog also supports bulk updates and CSV import/export. Production sessions use MongoDB storage and secure, HTTP-only cookies; passwords are bcrypt-hashed. Stock is reserved when an order is placed, and failed order creation restores reserved inventory. Re-running `npm run seed` updates catalog details without resetting existing stock levels or product visibility. Orders are saved as **pending and unpaid**. A payment gateway, password reset, tax calculation, and shipping carrier integration have not been configured.

## Production

Run `npm run build`, set `MONGODB_URI`, `SESSION_SECRET`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, and optionally `PORT`, then run `npm start`. Express serves both the production build and the API. For production, use HTTPS so the session cookie's `Secure` flag is enforced.

## Public catalog preview

`.github/workflows/pages.yml` builds and deploys a GitHub Pages preview when changes are pushed to `sukeshnipantawane27-ux-zariya-ecommerce`. It reads the sample catalog bundled at build time and supports browsing, search, category filters, product details, and a local shopping bag. Checkout, customer accounts, admin tools, newsletter signup, database changes, and image uploads are intentionally unavailable. GitHub Pages must be enabled for the repository with **Settings → Pages → Build and deployment → GitHub Actions**. GitHub Free does not support Pages for private repositories; make the repository public only if you intend to expose its source, or upgrade the GitHub account plan. Use a cloud MongoDB URI and a Node.js host to enable the full live store; a local MongoDB connection cannot be reached by a public host.

## REST API

All endpoints are under `/api`. Product and category list responses are wrapped in `{ products }` and `{ categories }`; product lists accept `category`, `q`, `sort`, `page`, and `limit` query parameters.

| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/health` | API and database status |
| `GET` | `/categories` | Browse collections |
| `GET` | `/products` | Browse, search, filter, sort, and paginate active products |
| `GET` | `/products/:id` | Read a product |
| `POST` | `/orders` | Validate prices and create an unpaid order |
| `POST` | `/newsletter` | Save an email subscription |
| `POST` | `/auth/customer/register` | Create and sign in a customer account |
| `POST` | `/auth/customer/login` | Sign in to a customer account |
| `GET` | `/auth/customer/me` | Read the signed-in customer |
| `POST` | `/auth/customer/logout` | Sign out the current customer |
| `GET` | `/customer/orders` | Read the signed-in customer's order history |
| `POST` | `/auth/admin/login` | Sign in to the separately provisioned admin account |
| `GET` | `/auth/admin/me` | Read the signed-in administrator |
| `POST` | `/auth/admin/logout` | Sign out the current administrator |
| `GET` | `/orders` | List recent orders (admin session or key required) |
| `GET` | `/admin/dashboard` | Read sales, fulfilment, customer, and low-stock summaries (admin session or key required) |
| `GET` | `/admin/products` | List active and archived products (admin session or key required) |
| `POST` | `/admin/uploads/products` | Upload up to 10 JPEG, PNG, or WebP product images (admin session required) |
| `PATCH` | `/admin/products/bulk` | Bulk-update selected product prices, stock, visibility, or category |
| `GET` | `/admin/products/export.csv` | Export the full catalog as CSV |
| `POST` | `/admin/products/import` | Import/upsert products from CSV supplied in `{ "csv": "..." }` |
| `GET` | `/admin/categories` | List collections with product counts (admin session or key required) |
| `GET` | `/admin/customers` | List customer order summaries (admin session or key required) |
| `PATCH` | `/orders/:orderNumber` | Update an order or payment status (admin session or key required) |
| `POST` | `/products` | Create a product (admin session or key required) |
| `PATCH` | `/products/:id` | Update a product (admin session or key required) |
| `DELETE` | `/products/:id` | Permanently delete a product (admin session or key required) |
| `POST` | `/categories` | Create a collection (admin session or key required) |
| `PATCH` | `/categories/:id` | Update a collection (admin session or key required) |
| `DELETE` | `/categories/:id` | Delete an empty collection (admin session or key required) |

Include `X-Admin-Key: <ADMIN_API_KEY>` when calling protected endpoints. Catalog data is in `shared/catalog.json`; `npm run seed` safely upserts its categories and products.
