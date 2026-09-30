import "dotenv/config";
import bcrypt from "bcryptjs";
import MongoStore from "connect-mongo";
import express from "express";
import multer from "multer";
import rateLimit from "express-rate-limit";
import session from "express-session";
import mongoose from "mongoose";
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Account, Category, NewsletterSubscriber, Order, Product } from "./models.js";

const app = express();
const port = Number(process.env.PORT) || 5000;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const catalog = JSON.parse(await readFile(path.join(root, "shared", "catalog.json"), "utf8"));
const isProduction = process.env.NODE_ENV === "production";
if (isProduction && !process.env.MONGODB_URI) {
  throw new Error("Set MONGODB_URI to a cloud MongoDB database before starting the production store.");
}
if (isProduction && (!process.env.ADMIN_EMAIL || !process.env.ADMIN_PASSWORD)) {
  throw new Error("Set ADMIN_EMAIL and ADMIN_PASSWORD before starting the production store.");
}
if (isProduction &&
    (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32 ||
     process.env.SESSION_SECRET.startsWith("replace-with-"))) {
  throw new Error("Set SESSION_SECRET to a private random value of at least 32 characters for production.");
}

app.disable("x-powered-by");
if (isProduction) app.set("trust proxy", 1);
app.use(express.json({ limit: "2mb" }));
app.use(session({
  name: "zariya.sid",
  secret: process.env.SESSION_SECRET || randomBytes(48).toString("hex"),
  store: isProduction && process.env.MONGODB_URI
    ? MongoStore.create({
      mongoUrl: process.env.MONGODB_URI,
      collectionName: "sessions",
      ttl: 60 * 60 * 24 * 7
    })
    : new session.MemoryStore(),
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: isProduction,
    sameSite: "strict",
    maxAge: 1000 * 60 * 60 * 24 * 7
  }
}));
app.use("/api", (_request, response, next) => {
  response.set("Cache-Control", "no-store");
  next();
});

let storeReady = false;
const databaseReady = () => mongoose.connection.readyState === 1;
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many sign-in attempts. Please wait a little and try again." }
});
const imageUrl = (id, width = 800) =>
  `https://images.unsplash.com/${id}?auto=format&fit=crop&w=${width}&q=85`;
const uploadedImagePattern = /^\/uploads\/products\/[a-f0-9-]{36}\.(?:jpg|png|webp)$/;
const productImageUrl = (image, width = 800) =>
  uploadedImagePattern.test(image) ? image : imageUrl(image, width);
const productUploadDirectory = path.join(root, "uploads", "products");
const productImageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024, files: 10 },
  fileFilter: (_request, file, callback) => {
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.mimetype)) {
      return callback(new Error("Upload JPEG, PNG, or WebP images only."));
    }
    callback(null, true);
  }
});

function uploadedImageExtension(buffer) {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "jpg";
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "png";
  if (buffer.length >= 12 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP") return "webp";
  return null;
}

async function storeProductImage(filename, contentType, buffer) {
  const bucket = new mongoose.mongo.GridFSBucket(mongoose.connection.db, { bucketName: "productImages" });
  await new Promise((resolve, reject) => {
    const upload = bucket.openUploadStream(filename, { metadata: { contentType } });
    upload.once("error", reject);
    upload.once("finish", resolve);
    upload.end(buffer);
  });
}

async function seedDatabaseCatalogIfEmpty() {
  const [categoryCount, productCount] = await Promise.all([
    Category.countDocuments(),
    Product.countDocuments()
  ]);
  if (categoryCount || productCount) return;

  await Category.bulkWrite(catalog.categories.map(({ id, ...category }) => ({
    updateOne: { filter: { _id: id }, update: { $set: category }, upsert: true }
  })));
  await Product.bulkWrite(catalog.products.map(({ id, stockQuantity = 12, ...product }) => ({
    updateOne: {
      filter: { _id: id },
      update: {
        $set: {
          ...product,
          productType: product.productType ?? "simple",
          regularPrice: product.regularPrice ?? product.compareAt ?? product.price,
          salePrice: product.salePrice ?? (product.compareAt && product.price < product.compareAt ? product.price : null),
          gallery: product.gallery ?? [],
          attributes: product.attributes ?? [],
          variations: product.variations ?? [],
          groupedProductIds: product.groupedProductIds ?? [],
          stockStatus: product.stockStatus ?? (stockQuantity > 0 ? "instock" : "outofstock"),
          manageStock: product.manageStock ?? true,
          sku: product.sku ?? `ZR-${id.toUpperCase()}`
        },
        $setOnInsert: { stockQuantity, active: true }
      },
      upsert: true
    }
  })));
  console.info(`Initialized MongoDB with ${catalog.categories.length} categories and ${catalog.products.length} products.`);
}

const publicProduct = (product) => ({
  id: product._id ?? product.id,
  categoryId: product.categoryId,
  subcategoryId: product.subcategoryId ?? null,
  name: product.name,
  description: product.description,
  shortDescription: product.shortDescription ?? "",
  productType: product.productType ?? "simple",
  regularPrice: product.regularPrice ?? product.compareAt ?? product.price,
  salePrice: product.salePrice ?? (product.compareAt && product.price < product.compareAt ? product.price : null),
  price: product.salePrice ?? product.price,
  compareAt: product.regularPrice ?? product.compareAt ?? null,
  sku: product.sku ?? "",
  stockQuantity: product.stockQuantity ?? 0,
  stockStatus: product.stockStatus ?? ((product.stockQuantity ?? 0) > 0 ? "instock" : "outofstock"),
  manageStock: product.manageStock ?? true,
  virtual: product.virtual ?? product.productType === "virtual",
  image: product.image,
  gallery: product.gallery ?? [],
  attributes: product.attributes ?? [],
  variations: product.variations ?? [],
  groupedProductIds: product.groupedProductIds ?? [],
  badge: product.badge,
  active: product.active !== false
});

function asyncRoute(handler) {
  return (request, response, next) =>
    Promise.resolve(handler(request, response, next)).catch(next);
}

async function restoreStockReservations(reservations) {
  const results = await Promise.allSettled(reservations.map(({ productId, quantity, variants = [] }) => {
    const inc = { stockQuantity: quantity };
    const arrayFilters = [];
    variants.forEach((variant, index) => {
      inc[`variations.$[variation${index}].stockQuantity`] = variant.quantity;
      arrayFilters.push({ [`variation${index}.sku`]: variant.sku });
    });
    return Product.updateOne({ _id: productId }, { $inc: inc }, arrayFilters.length ? { arrayFilters } : {});
  }));
  const failures = results.flatMap((result, index) => {
    if (result.status === "rejected") return [result.reason];
    if (result.value.modifiedCount !== 1) {
      return [new Error(`Could not restore reserved stock for product ${reservations[index].productId}.`)];
    }
    return [];
  });
  if (failures.length) {
    throw new AggregateError(failures, "One or more stock reservations could not be restored.");
  }
}

function isDemoAdmin(request) {
  return isAutomaticAdminSession(request) && !databaseReady();
}

function catalogProductIndex(id) {
  return catalog.products.findIndex((product) => product._id === id || product.id === id);
}

async function findMissingGroupedProducts(ids, currentProductId) {
  if (ids.includes(currentProductId)) return [currentProductId];
  if (!ids.length) return [];
  const existingIds = databaseReady()
    ? (await Product.find({ _id: { $in: ids } }).select("_id").lean()).map((product) => product._id)
    : catalog.products.map((product) => product._id ?? product.id).filter((id) => ids.includes(id));
  const existing = new Set(existingIds);
  return ids.filter((id) => !existing.has(id));
}

function validateProduct(input, existing = {}) {
  const fields = { ...existing, ...input };
  const errors = [];
  const text = (value, max) => typeof value === "string" && value.length <= max;
  const photo = (value) => typeof value === "string" &&
    (/^photo-[a-zA-Z0-9-]{6,100}$/.test(value) || uploadedImagePattern.test(value));
  const price = fields.regularPrice ?? fields.compareAt ?? fields.price;
  const sale = fields.salePrice ?? null;
  const variations = Array.isArray(fields.variations) ? fields.variations : [];
  const attributes = Array.isArray(fields.attributes) ? fields.attributes : [];

  if (!text(fields.name, 160) || !fields.name.trim()) errors.push("Product name is required (160 characters maximum).");
  if (!text(fields.categoryId, 80) || !fields.categoryId) errors.push("Choose a product category.");
  if (!["simple", "variable", "grouped", "virtual"].includes(fields.productType ?? "simple")) errors.push("Choose a valid product type.");
  if (!Number.isFinite(price) || price < 0) errors.push("Regular price must be zero or greater.");
  if (sale !== null && (!Number.isFinite(sale) || sale < 0 || sale >= price)) errors.push("Sale price must be less than the regular price.");
  if (fields.sku && (!text(fields.sku, 64) || !/^[A-Z0-9][A-Z0-9._-]*$/i.test(fields.sku))) errors.push("SKU may contain letters, numbers, dots, underscores, and hyphens.");
  if (!text(fields.description ?? "", 10000) || !text(fields.shortDescription ?? "", 1000)) errors.push("Descriptions are too long.");
  if (!text(fields.badge ?? "", 50)) errors.push("Product badge must be 50 characters or fewer.");
  if (fields.subcategoryId && !text(fields.subcategoryId, 80)) errors.push("Choose a valid subcategory.");
  if (!photo(fields.image)) errors.push("Upload a featured image or provide a valid Unsplash photo ID.");
  if (!Array.isArray(fields.gallery ?? []) || fields.gallery.length > 10 || !(fields.gallery ?? []).every(photo)) errors.push("Gallery must contain up to 10 uploaded images or valid Unsplash photo IDs.");
  if (!Number.isInteger(fields.stockQuantity ?? 0) || (fields.stockQuantity ?? 0) < 0 || (fields.stockQuantity ?? 0) > 1000000) errors.push("Stock quantity must be a whole number between 0 and 1,000,000.");
  if (!["instock", "outofstock", "onbackorder"].includes(fields.stockStatus ?? "instock")) errors.push("Choose a valid stock status.");
  if (typeof (fields.manageStock ?? true) !== "boolean" || typeof (fields.virtual ?? false) !== "boolean" || typeof (fields.active ?? true) !== "boolean") errors.push("Stock, virtual, and visibility options must be true or false.");
  if (!Array.isArray(attributes) || attributes.length > 30) errors.push("Provide up to 30 product attributes.");
  if (!Array.isArray(variations) || variations.length > 100) errors.push("Provide up to 100 variations.");
  if (!Array.isArray(fields.groupedProductIds ?? []) || (fields.groupedProductIds ?? []).length > 100) errors.push("Provide up to 100 grouped product IDs.");

  const variationSkus = new Set();
  variations.forEach((variation) => {
    if (!variation || typeof variation !== "object" || Array.isArray(variation) ||
        typeof variation.sku !== "string" || !/^[A-Z0-9][A-Z0-9._-]*$/i.test(variation.sku) ||
        variationSkus.has(variation.sku.toUpperCase()) ||
        !Number.isFinite(variation.regularPrice) || variation.regularPrice < 0 ||
        (variation.salePrice !== undefined && variation.salePrice !== null &&
          (!Number.isFinite(variation.salePrice) || variation.salePrice < 0 || variation.salePrice >= variation.regularPrice)) ||
        !Number.isInteger(variation.stockQuantity) || variation.stockQuantity < 0 ||
        !variation.attributes || typeof variation.attributes !== "object" || Array.isArray(variation.attributes) ||
        Object.values(variation.attributes).some((value) => typeof value !== "string" || !value.trim()) ||
        (variation.image && !photo(variation.image))) {
      errors.push("Every variation needs a unique SKU, text attributes, valid regular/sale pricing, stock, and optional photo ID.");
    } else {
      variationSkus.add(variation.sku.toUpperCase());
    }
  });
  if ((fields.productType ?? "simple") === "variable" && variations.length === 0) errors.push("Add at least one variation to a variable product.");
  if (attributes.some((attribute) =>
    !attribute || typeof attribute !== "object" || typeof attribute.name !== "string" ||
    !attribute.name.trim() || attribute.name.length > 80 || !Array.isArray(attribute.values) ||
    attribute.values.length > 50 || attribute.values.some((value) => typeof value !== "string" || !value.trim() || value.length > 100)
  )) errors.push("Each attribute needs a name and up to 50 text values.");
  if ((fields.groupedProductIds ?? []).some((id) => typeof id !== "string" || !/^[a-z0-9][a-z0-9-]{1,79}$/i.test(id))) errors.push("Grouped product IDs must be valid product IDs.");
  if (errors.length) return { errors };

  const regularPrice = Number(price);
  const salePrice = sale === null || sale === "" ? null : Number(sale);
  const stockQuantity = Number(fields.stockQuantity ?? 0);
  const productType = fields.productType ?? "simple";
  const stockStatus = productType === "virtual"
    ? "instock"
    : fields.stockStatus === "onbackorder"
      ? "onbackorder"
      : fields.stockStatus === "outofstock" || stockQuantity === 0 ? "outofstock" : "instock";
  return {
    value: {
      sku: fields.sku?.trim().toUpperCase() || undefined,
      categoryId: fields.categoryId,
      subcategoryId: fields.subcategoryId || null,
      name: fields.name.trim(),
      description: (fields.description ?? "").trim(),
      shortDescription: (fields.shortDescription ?? "").trim(),
      productType,
      regularPrice,
      salePrice,
      compareAt: regularPrice,
      price: salePrice ?? regularPrice,
      stockQuantity,
      stockStatus,
      manageStock: fields.manageStock ?? true,
      virtual: productType === "virtual" || fields.virtual === true,
      image: fields.image,
      gallery: fields.gallery ?? [],
      attributes,
      variations,
      groupedProductIds: fields.groupedProductIds ?? [],
      badge: fields.badge ?? "",
      active: fields.active ?? true
    }
  };
}

function parseCsv(text) {
  text = text.replace(/^\uFEFF/, "");
  const rows = [];
  let row = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted && char === '"' && text[index + 1] === '"') {
      value += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (!quoted && char === ",") {
      row.push(value);
      value = "";
    } else if (!quoted && (char === "\n" || char === "\r")) {
      if (char === "\r" && text[index + 1] === "\n") index += 1;
      row.push(value);
      if (row.some((cell) => cell.trim())) rows.push(row);
      row = [];
      value = "";
    } else {
      value += char;
    }
  }
  if (quoted) throw new Error("CSV contains an unfinished quoted field.");
  if (value || row.length) {
    row.push(value);
    rows.push(row);
  }
  if (rows.length < 2) throw new Error("CSV must include a header row and at least one product.");
  const headers = rows.shift().map((header) => header.trim().replace(/^\uFEFF/, ""));
  return rows.map((cells) => Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? ""])));
}

const productCsvColumns = [
  "id", "sku", "name", "productType", "categoryId", "subcategoryId", "shortDescription",
  "description", "regularPrice", "salePrice", "stockQuantity", "stockStatus", "manageStock",
  "virtual", "image", "gallery", "attributes", "variations", "groupedProductIds", "badge", "active"
];

function escapeCsv(value) {
  const cell = value === null || value === undefined
    ? ""
    : typeof value === "string" || typeof value === "number" || typeof value === "boolean"
      ? String(value)
      : JSON.stringify(value);
  return `"${cell.replaceAll('"', '""')}"`;
}

function parseImportRow(row) {
  const parseJson = (value, fallback) => {
    if (!value) return fallback;
    return JSON.parse(value);
  };
  return {
    ...row,
    regularPrice: Number(row.regularPrice),
    salePrice: row.salePrice ? Number(row.salePrice) : null,
    stockQuantity: row.stockQuantity ? Number(row.stockQuantity) : 0,
    manageStock: row.manageStock !== "false",
    virtual: row.virtual === "true",
    active: row.active !== "false",
    gallery: parseJson(row.gallery, []),
    attributes: parseJson(row.attributes, []),
    variations: parseJson(row.variations, []),
    groupedProductIds: parseJson(row.groupedProductIds, [])
  };
}

function requireDatabase(_request, response, next) {
  if (!databaseReady()) {
    return response.status(503).json({
      error: "This feature is temporarily unavailable. Connect MongoDB and try again."
    });
  }
  next();
}

function requireAdmin(request, response, next) {
  if (request.session?.role === "admin") return next();
  const configuredKey = process.env.ADMIN_API_KEY;
  const suppliedKey = request.get("x-admin-key");
  const validKey = configuredKey && suppliedKey &&
    configuredKey.length >= 32 &&
    !configuredKey.startsWith("replace-with-") &&
    Buffer.byteLength(configuredKey) === Buffer.byteLength(suppliedKey) &&
    timingSafeEqual(Buffer.from(configuredKey), Buffer.from(suppliedKey));
  if (!validKey) {
    return response.status(401).json({ error: "A valid X-Admin-Key is required." });
  }
  next();
}

function isAutomaticAdminSession(request) {
  return process.env.NODE_ENV === "development" &&
    process.env.AUTO_ADMIN_LOGIN === "true" &&
    request.session?.role === "admin" &&
    request.session?.userId === "development-admin";
}

function isLocalDevelopmentRequest(request) {
  if (process.env.NODE_ENV !== "development" || process.env.AUTO_ADMIN_LOGIN !== "true") {
    return false;
  }
  const remoteAddress = request.socket.remoteAddress?.replace(/^::ffff:/, "");
  return remoteAddress === "127.0.0.1" || remoteAddress === "::1";
}

function requireRole(role) {
  return (request, response, next) => {
    if (request.session?.role !== role) {
      return response.status(401).json({ error: `Sign in to your ${role} account to continue.` });
    }
    next();
  };
}

const requireCustomer = requireRole("customer");

function establishSession(request, account) {
  return new Promise((resolve, reject) => {
    request.session.regenerate((error) => {
      if (error) return reject(error);
      request.session.userId = account._id.toString();
      request.session.role = account.role;
      request.session.save((saveError) => saveError ? reject(saveError) : resolve());
    });
  });
}

function destroySession(request, response) {
  return new Promise((resolve, reject) => {
    request.session.destroy((error) => {
      if (error) return reject(error);
      response.clearCookie("zariya.sid", {
        httpOnly: true,
        secure: isProduction,
        sameSite: "strict"
      });
      resolve();
    });
  });
}

function publicAccount(account) {
  return { name: account.name, email: account.email, role: account.role };
}

async function createAdminFromEnvironment() {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  if (!email && !password) {
    console.warn("Admin sign-in is disabled until ADMIN_EMAIL and ADMIN_PASSWORD are configured.");
    return;
  }
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      !password || Buffer.byteLength(password, "utf8") < 12 ||
      Buffer.byteLength(password, "utf8") > 72 ||
      email === "admin@change-me.invalid" ||
      password.startsWith("CHANGE-ME")) {
    throw new Error("Set a valid ADMIN_EMAIL and a unique ADMIN_PASSWORD between 12 and 72 bytes.");
  }
  const existing = await Account.findOne({ email });
  if (existing) {
    if (existing.role !== "admin") {
      throw new Error("ADMIN_EMAIL belongs to a customer account; use a separate administrator email.");
    }
    return;
  }
  await Account.create({
    name: "Zariya Administrator",
    email,
    passwordHash: await bcrypt.hash(password, 12),
    role: "admin"
  });
  console.info(`Created initial Zariya admin account for ${email}.`);
}

app.get("/api/health", (_request, response) => {
  response.json({
    status: "ok",
    database: databaseReady() ? "connected" : "disconnected"
  });
});

app.get("/api/health/ready", (_request, response) => {
  if (!databaseReady() || !storeReady) {
    return response.status(503).json({
      status: "not-ready",
      database: databaseReady() ? "initializing" : "disconnected"
    });
  }
  response.json({ status: "ready", database: "connected" });
});

app.post("/api/auth/customer/register", authLimiter, requireDatabase, asyncRoute(async (request, response) => {
  const name = typeof request.body?.name === "string" ? request.body.name.trim() : "";
  const email = typeof request.body?.email === "string" ? request.body.email.trim().toLowerCase() : "";
  const password = request.body?.password;
  if (!name || name.length > 100 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      email.length > 200 || typeof password !== "string" ||
      Buffer.byteLength(password, "utf8") < 12 || Buffer.byteLength(password, "utf8") > 72) {
    return response.status(400).json({
      error: "Enter your name, a valid email, and a unique password between 12 and 72 bytes."
    });
  }
  const account = await Account.create({
    name,
    email,
    passwordHash: await bcrypt.hash(password, 12),
    role: "customer"
  });
  await establishSession(request, account);
  response.status(201).json({ account: publicAccount(account) });
}));

app.post("/api/auth/customer/login", authLimiter, requireDatabase, asyncRoute(async (request, response) => {
  const email = typeof request.body?.email === "string" ? request.body.email.trim().toLowerCase() : "";
  const password = request.body?.password;
  const account = typeof password === "string" && password.length <= 72
    ? await Account.findOne({ email, role: "customer" }).select("+passwordHash")
    : null;
  if (!account || !(await bcrypt.compare(password, account.passwordHash))) {
    return response.status(401).json({ error: "We couldn't find a matching customer account." });
  }
  await establishSession(request, account);
  response.json({ account: publicAccount(account) });
}));

app.get("/api/auth/customer/me", requireCustomer, asyncRoute(async (request, response) => {
  const account = await Account.findOne({ _id: request.session.userId, role: "customer" }).lean();
  if (!account) {
    await destroySession(request, response);
    return response.status(401).json({ error: "Your customer account is no longer available." });
  }
  response.json({ account: publicAccount(account) });
}));

app.post("/api/auth/customer/logout", requireCustomer, asyncRoute(async (request, response) => {
  await destroySession(request, response);
  response.json({ message: "Signed out." });
}));

app.get("/api/customer/orders", requireCustomer, requireDatabase, asyncRoute(async (request, response) => {
  const orders = await Order.find({ customerId: request.session.userId }).sort({ createdAt: -1 }).limit(100).lean();
  response.json({ orders });
}));

app.post("/api/auth/admin/login", authLimiter, requireDatabase, asyncRoute(async (request, response) => {
  const email = typeof request.body?.email === "string" ? request.body.email.trim().toLowerCase() : "";
  const password = request.body?.password;
  const account = typeof password === "string" && password.length <= 72
    ? await Account.findOne({ email, role: "admin" }).select("+passwordHash")
    : null;
  if (!account || !(await bcrypt.compare(password, account.passwordHash))) {
    return response.status(401).json({ error: "We couldn't verify those administrator credentials." });
  }
  await establishSession(request, account);
  response.json({ account: publicAccount(account) });
}));

app.get("/api/auth/admin/me", asyncRoute(async (request, response) => {
  if (isLocalDevelopmentRequest(request) && !request.session?.userId) {
    await new Promise((resolve, reject) => {
      request.session.regenerate((error) => {
        if (error) return reject(error);
        request.session.userId = "development-admin";
        request.session.role = "admin";
        request.session.save((saveError) => saveError ? reject(saveError) : resolve());
      });
    });
  }
  if (isAutomaticAdminSession(request)) {
    return response.json({
      account: { name: "Local development admin", email: "admin@localhost.example", role: "admin", demo: true }
    });
  }
  if (request.session?.role !== "admin") {
    return response.status(401).json({ error: "Sign in to your admin account to continue." });
  }
  const account = await Account.findOne({ _id: request.session.userId, role: "admin" }).lean();
  if (!account) {
    await destroySession(request, response);
    return response.status(401).json({ error: "This administrator account is no longer available." });
  }
  response.json({ account: publicAccount(account) });
}));

app.post("/api/auth/admin/logout", requireRole("admin"), asyncRoute(async (request, response) => {
  await destroySession(request, response);
  response.json({ message: "Signed out." });
}));

app.get("/api/categories", asyncRoute(async (_request, response) => {
  const categories = databaseReady()
    ? await Category.find().sort({ name: 1 }).lean()
    : catalog.categories;
  response.json({ categories: categories.map((category) => ({
    id: category._id ?? category.id,
    name: category.name,
    description: category.description,
    parentId: category.parentId ?? null,
    image: imageUrl(category.image, 640)
  })) });
}));

app.get("/api/products", asyncRoute(async (request, response) => {
  const { category, q, sort = "featured", page = "1", limit = "30" } = request.query;
  const pageNumber = Math.max(1, Number.parseInt(page, 10) || 1);
  const pageSize = Math.min(60, Math.max(1, Number.parseInt(limit, 10) || 30));
  let products = databaseReady()
    ? await Product.find({ active: true }).lean()
    : catalog.products;

  if (category) products = products.filter((product) => product.categoryId === category || product.subcategoryId === category);
  if (q) {
    const search = String(q).trim().slice(0, 100).toLowerCase();
    products = products.filter((product) =>
      `${product.name} ${product.description} ${product.categoryId}`.toLowerCase().includes(search)
    );
  }
  if (sort === "price-asc") products.sort((a, b) => a.price - b.price);
  if (sort === "price-desc") products.sort((a, b) => b.price - a.price);
  if (sort === "name") products.sort((a, b) => a.name.localeCompare(b.name));

  const total = products.length;
  const pageProducts = products.slice((pageNumber - 1) * pageSize, pageNumber * pageSize);
  response.json({
    products: pageProducts.map((product) => ({
      ...publicProduct(product),
      image: productImageUrl(product.image, 900),
      gallery: (product.gallery ?? []).map((image) => productImageUrl(image, 900)),
      variations: (product.variations ?? []).map((variation) => ({
        ...variation,
        image: variation.image ? productImageUrl(variation.image, 900) : ""
      }))
    })),
    pagination: { page: pageNumber, limit: pageSize, total, pages: Math.ceil(total / pageSize) }
  });
}));

app.get("/api/products/:id", asyncRoute(async (request, response) => {
  const product = databaseReady()
    ? await Product.findOne({ _id: request.params.id, active: true }).lean()
    : catalog.products.find((item) => item.id === request.params.id);
  if (!product) return response.status(404).json({ error: "Product not found." });
  response.json({
    product: {
      ...publicProduct(product),
      image: productImageUrl(product.image, 1000),
      gallery: (product.gallery ?? []).map((image) => productImageUrl(image, 1000)),
      variations: (product.variations ?? []).map((variation) => ({
        ...variation,
        image: variation.image ? productImageUrl(variation.image, 1000) : ""
      }))
    }
  });
}));

app.post("/api/newsletter", requireDatabase, asyncRoute(async (request, response) => {
  const email = typeof request.body?.email === "string" ? request.body.email.trim().toLowerCase() : "";
  if (email.length > 200 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return response.status(400).json({ error: "Enter a valid email address." });
  }
  await NewsletterSubscriber.updateOne(
    { email },
    { $setOnInsert: { email } },
    { upsert: true }
  );
  response.status(201).json({ message: "You're on the list. Look out for something lovely." });
}));

app.post("/api/orders", requireDatabase, asyncRoute(async (request, response) => {
  const { customer, items } = request.body ?? {};
  const email = typeof customer?.email === "string" ? customer.email.trim() : "";
  const validCustomer = ["name", "phone", "address"].every(
    (field) => typeof customer?.[field] === "string" && customer[field].trim().length > 0
  );
  if (!validCustomer || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return response.status(400).json({ error: "Enter a name, valid email, phone number, and delivery address." });
  }
  if (!Array.isArray(items) || items.length === 0 || items.length > 30) {
    return response.status(400).json({ error: "Your order must contain between 1 and 30 products." });
  }
  const quantities = new Map();
  const requestedItems = [];
  for (const item of items) {
    if (!item || typeof item.productId !== "string" || !Number.isInteger(item.quantity) || item.quantity < 1 ||
        (item.sku !== undefined && (typeof item.sku !== "string" || item.sku.length > 64)) ||
        (item.variationAttributes !== undefined && (!item.variationAttributes || typeof item.variationAttributes !== "object" || Array.isArray(item.variationAttributes)))) {
      return response.status(400).json({ error: "Each product needs a valid ID and a positive whole-number quantity." });
    }
    quantities.set(item.productId, (quantities.get(item.productId) ?? 0) + item.quantity);
    requestedItems.push(item);
  }
  if ([...quantities.values()].some((quantity) => quantity > 20)) {
    return response.status(400).json({ error: "A maximum of 20 units per product can be ordered." });
  }
  if (request.session?.role === "customer") {
    const account = await Account.findOne({ _id: request.session.userId, role: "customer" }).lean();
    if (!account) return response.status(401).json({ error: "Sign in to your customer account again before ordering." });
    if (email.toLowerCase() !== account.email) {
      return response.status(400).json({ error: "Use the email address linked to your customer account for this order." });
    }
  }

  const products = await Product.find({
    _id: { $in: [...quantities.keys()] },
    active: true
  }).lean();
  if (products.length !== quantities.size) {
    return response.status(400).json({ error: "One or more products are unavailable. Refresh your bag and try again." });
  }
  const productsById = new Map(products.map((product) => [String(product._id), product]));
  const variantQuantities = new Map();
  for (const item of requestedItems) {
    const product = productsById.get(item.productId);
    if (product.productType !== "variable") continue;
    const variation = (product.variations ?? []).find((variant) => variant.sku === item.sku && variant.active !== false);
    if (!variation || !variation.sku) return response.status(400).json({ error: `${product.name} needs a valid product variation. Please choose again.` });
    if (variation.stockQuantity !== undefined && variation.stockQuantity < item.quantity && product.manageStock !== false && product.stockStatus !== "onbackorder") {
      return response.status(409).json({ error: `The selected option for ${product.name} is out of stock.` });
    }
    const productVariants = variantQuantities.get(item.productId) ?? new Map();
    productVariants.set(item.sku, (productVariants.get(item.sku) ?? 0) + item.quantity);
    variantQuantities.set(item.productId, productVariants);
  }

  const reservedItems = [];
  for (const [productId, quantity] of quantities) {
    const product = productsById.get(productId);
    if (product?.virtual || product?.manageStock === false || product?.stockStatus === "onbackorder") continue;
    if (product?.stockStatus === "outofstock") {
      await restoreStockReservations(reservedItems);
      return response.status(409).json({ error: "One or more products are out of stock. Refresh your bag and try again." });
    }
    let reservation;
    try {
      const variants = [...(variantQuantities.get(productId) ?? new Map())].map(([sku, variantQuantity]) => ({ sku, quantity: variantQuantity }));
      const inc = { stockQuantity: -quantity };
      const arrayFilters = [];
      const variantChecks = [];
      variants.forEach((variant, index) => {
        inc[`variations.$[variation${index}].stockQuantity`] = -variant.quantity;
        arrayFilters.push({ [`variation${index}.sku`]: variant.sku, [`variation${index}.stockQuantity`]: { $gte: variant.quantity } });
        variantChecks.push({ variations: { $elemMatch: { sku: variant.sku, stockQuantity: { $gte: variant.quantity } } } });
      });
      reservation = await Product.updateOne(
        { _id: productId, active: true, stockStatus: { $ne: "outofstock" }, stockQuantity: { $gte: quantity }, ...(variantChecks.length ? { $and: variantChecks } : {}) },
        { $inc: inc },
        arrayFilters.length ? { arrayFilters } : {}
      );
    } catch (error) {
      try {
        await restoreStockReservations(reservedItems);
      } catch (rollbackError) {
        throw new AggregateError([error, rollbackError], "Stock reservation failed and rollback was incomplete.");
      }
      throw error;
    }
    if (reservation.modifiedCount !== 1) {
      await restoreStockReservations(reservedItems);
      return response.status(409).json({
        error: "One or more products no longer have enough stock. Refresh your bag and try again."
      });
    }
    reservedItems.push({ productId, quantity, variants: [...(variantQuantities.get(productId) ?? new Map())].map(([sku, variantQuantity]) => ({ sku, quantity: variantQuantity })) });
  }

  const orderItems = requestedItems.map((item) => {
    const product = productsById.get(item.productId);
    const variation = product.productType === "variable"
      ? product.variations.find((variant) => variant.sku === item.sku)
      : null;
    return {
      productId: product._id,
      name: product.name,
      sku: variation?.sku || product.sku || "",
      variationAttributes: variation?.attributes || {},
      image: variation?.image || product.image,
      unitPrice: variation?.salePrice ?? variation?.regularPrice ?? product.price,
      quantity: item.quantity
    };
  });
  const subtotal = orderItems.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
  const shipping = subtotal >= 7500 || orderItems.every((item) => productsById.get(String(item.productId))?.virtual) ? 0 : 250;
  let order;
  try {
    order = await Order.create({
      orderNumber: `ZR-${Date.now().toString(36).toUpperCase()}-${randomBytes(2).toString("hex").toUpperCase()}`,
      customerId: request.session?.role === "customer" ? request.session.userId : null,
      customer: { name: customer.name.trim(), email, phone: customer.phone.trim(), address: customer.address.trim() },
      items: orderItems,
      subtotal,
      shipping,
      total: subtotal + shipping
    });
  } catch (error) {
    try {
      await restoreStockReservations(reservedItems);
    } catch (rollbackError) {
      throw new AggregateError([error, rollbackError], "Order creation failed and stock rollback was incomplete.");
    }
    throw error;
  }
  response.status(201).json({
    order: { orderNumber: order.orderNumber, total: order.total, status: order.status }
  });
}));

app.get("/api/orders", requireAdmin, asyncRoute(async (request, response) => {
  if (!databaseReady()) {
    if (isAutomaticAdminSession(request)) return response.json({ orders: [] });
    return response.status(503).json({
      error: "Order management requires a MongoDB connection."
    });
  }
  const orders = await Order.find().sort({ createdAt: -1 }).limit(100).lean();
  response.json({ orders });
}));

app.get("/api/admin/dashboard", requireAdmin, asyncRoute(async (request, response) => {
  if (!databaseReady()) {
    if (!isAutomaticAdminSession(request)) {
      return response.status(503).json({ error: "Dashboard reports require a MongoDB connection." });
    }
    return response.json({
      metrics: { revenue: 0, orderCount: 0, pendingOrders: 0, customerCount: 0, lowStockProducts: 0 }
    });
  }
  const [products, orderMetrics, customerCount] = await Promise.all([
    Product.find({ active: true }).select("stockQuantity").lean(),
    Order.aggregate([
      { $group: {
        _id: null,
        revenue: { $sum: { $cond: [{ $ne: ["$status", "cancelled"] }, "$total", 0] } },
        orderCount: { $sum: 1 },
        pendingOrders: { $sum: { $cond: [{ $in: ["$status", ["pending", "processing"]] }, 1, 0] } }
      } }
    ]),
    Account.countDocuments({ role: "customer" })
  ]);
  response.json({
    metrics: {
      revenue: orderMetrics[0]?.revenue ?? 0,
      orderCount: orderMetrics[0]?.orderCount ?? 0,
      pendingOrders: orderMetrics[0]?.pendingOrders ?? 0,
      customerCount,
      lowStockProducts: products.filter((product) => product.stockQuantity <= 5).length
    }
  });
}));

app.get("/api/admin/products", requireAdmin, asyncRoute(async (request, response) => {
  if (!databaseReady()) {
    if (!isAutomaticAdminSession(request)) {
      return response.status(503).json({ error: "Product management requires a MongoDB connection." });
    }
    return response.json({ products: catalog.products.map((product) => publicProduct({
      ...product,
      stockQuantity: product.stockQuantity ?? 12,
      active: product.active !== false
    })) });
  }
  const products = await Product.find().sort({ createdAt: -1 }).limit(1000).lean();
  response.json({ products: products.map((product) => ({
    ...publicProduct(product),
    active: product.active
  })) });
}));

app.get("/api/admin/categories", requireAdmin, asyncRoute(async (request, response) => {
  let categories;
  if (!databaseReady()) {
    if (!isAutomaticAdminSession(request)) {
      return response.status(503).json({ error: "Collection management requires a MongoDB connection." });
    }
    categories = catalog.categories.map((category) => ({ ...category, productCount: catalog.products.filter((product) => product.categoryId === category.id || product.subcategoryId === category.id).length }));
  } else {
    const [storedCategories, productCounts] = await Promise.all([
      Category.find().sort({ name: 1 }).lean(),
      Product.aggregate([
        { $project: { categoryIds: ["$categoryId", "$subcategoryId"] } },
        { $unwind: "$categoryIds" },
        { $match: { categoryIds: { $ne: null } } },
        { $group: { _id: "$categoryIds", count: { $sum: 1 } } }
      ])
    ]);
    const counts = new Map(productCounts.map(({ _id, count }) => [_id, count]));
    categories = storedCategories.map((category) => ({
      ...category,
      productCount: counts.get(category._id) ?? 0
    }));
  }
  response.json({
    categories: categories.map((category) => ({
      id: category._id ?? category.id,
      name: category.name,
      description: category.description,
      imageId: category.image,
      parentId: category.parentId ?? null,
      image: imageUrl(category.image, 320),
      productCount: category.productCount ?? catalog.products.filter((product) =>
        product.categoryId === (category._id ?? category.id)
      ).length
    }))
  });
}));

app.get("/api/admin/customers", requireAdmin, asyncRoute(async (_request, response) => {
  if (!databaseReady()) {
    if (isAutomaticAdminSession(_request)) return response.json({ customers: [] });
    return response.status(503).json({ error: "Customer records require a MongoDB connection." });
  }
  const [customers, summaries] = await Promise.all([
    Account.find({ role: "customer" }).select("name email createdAt").sort({ createdAt: -1 }).limit(500).lean(),
    Order.aggregate([
      { $group: {
        _id: { $toLower: "$customer.email" },
        orderCount: { $sum: 1 },
        lifetimeSpend: { $sum: "$total" },
        lastOrderAt: { $max: "$createdAt" }
      } }
    ])
  ]);
  const summaryByEmail = new Map(summaries.map((summary) => [summary._id, summary]));
  response.json({
    customers: customers.map((customer) => {
      const summary = summaryByEmail.get(customer.email);
      return {
        id: customer._id,
        name: customer.name,
        email: customer.email,
        joinedAt: customer.createdAt,
        orderCount: summary?.orderCount ?? 0,
        lifetimeSpend: summary?.lifetimeSpend ?? 0,
        lastOrderAt: summary?.lastOrderAt ?? null
      };
    })
  });
}));

app.patch("/api/orders/:orderNumber", requireAdmin, requireDatabase, asyncRoute(async (request, response) => {
  const allowedStatuses = ["pending", "processing", "shipped", "completed", "cancelled"];
  const allowedPayments = ["unpaid", "paid", "refunded"];
  const update = {};
  if (request.body?.status !== undefined && allowedStatuses.includes(request.body.status)) {
    update.status = request.body.status;
  }
  if (request.body?.paymentStatus !== undefined && allowedPayments.includes(request.body.paymentStatus)) {
    update.paymentStatus = request.body.paymentStatus;
  }
  if (Object.keys(update).length === 0) {
    return response.status(400).json({ error: "Provide a valid order status or payment status to update." });
  }
  const order = await Order.findOneAndUpdate(
    { orderNumber: request.params.orderNumber },
    { $set: update },
    { new: true, runValidators: true }
  ).lean();
  if (!order) return response.status(404).json({ error: "Order not found." });
  response.json({ order });
}));

app.post("/api/admin/uploads/products", requireAdmin, (request, response, next) => {
  productImageUpload.array("images", 10)(request, response, async (error) => {
    if (error) return next(error);
    try {
      const files = request.files ?? [];
      if (!files.length) return response.status(400).json({ error: "Choose at least one image to upload." });
      const prepared = files.map((file) => ({ file, extension: uploadedImageExtension(file.buffer) }));
      const invalid = prepared.find(({ extension }) => !extension);
      if (invalid) return response.status(400).json({ error: `${invalid.file.originalname} is not a supported JPEG, PNG, or WebP image.` });
      const images = [];
      if (databaseReady()) {
        const storedFiles = [];
        try {
          for (const { file, extension } of prepared) {
            const filename = `${randomUUID()}.${extension}`;
            const contentType = extension === "jpg" ? "image/jpeg" : `image/${extension}`;
            await storeProductImage(filename, contentType, file.buffer);
            storedFiles.push(filename);
            images.push(`/uploads/products/${filename}`);
          }
        } catch (writeError) {
          const bucket = new mongoose.mongo.GridFSBucket(mongoose.connection.db, { bucketName: "productImages" });
          await Promise.allSettled(storedFiles.map(async (filename) => {
            const [storedFile] = await bucket.find({ filename }).limit(1).toArray();
            if (storedFile) await bucket.delete(storedFile._id);
          }));
          throw writeError;
        }
      } else {
        await mkdir(productUploadDirectory, { recursive: true });
        const writtenPaths = [];
        try {
          for (const { file, extension } of prepared) {
            const filename = `${randomUUID()}.${extension}`;
            const filePath = path.join(productUploadDirectory, filename);
            await writeFile(filePath, file.buffer, { flag: "wx" });
            writtenPaths.push(filePath);
            images.push(`/uploads/products/${filename}`);
          }
        } catch (writeError) {
          await Promise.allSettled(writtenPaths.map((filePath) => unlink(filePath)));
          throw writeError;
        }
      }
      response.status(201).json({ images });
    } catch (uploadError) {
      next(uploadError);
    }
  });
});

app.post("/api/products", requireAdmin, asyncRoute(async (request, response) => {
  if (!databaseReady() && !isDemoAdmin(request)) return response.status(503).json({ error: "Product management requires a MongoDB connection." });
  const raw = request.body ?? {};
  const { id } = raw;
  if (id !== undefined && (typeof id !== "string" || !/^[a-z0-9][a-z0-9-]{1,79}$/i.test(id))) {
    return response.status(400).json({ error: "Product ID must use letters, numbers, and hyphens." });
  }
  const validation = validateProduct(raw);
  if (validation.errors) return response.status(400).json({ error: validation.errors.join(" ") });
  const categoryExists = databaseReady()
    ? await Category.exists({ _id: validation.value.categoryId, parentId: null })
    : catalog.categories.some((category) => category.id === validation.value.categoryId && !category.parentId);
  if (!categoryExists) return response.status(400).json({ error: "Choose an existing product category." });
  const productId = id || `product-${randomBytes(6).toString("hex")}`;
  if (validation.value.subcategoryId) {
    const subcategoryExists = databaseReady()
      ? await Category.exists({ _id: validation.value.subcategoryId, parentId: validation.value.categoryId })
      : catalog.categories.some((category) => category.id === validation.value.subcategoryId && category.parentId === validation.value.categoryId);
    if (!subcategoryExists) return response.status(400).json({ error: "Choose a subcategory belonging to the selected category." });
  }
  const missingGroupedProducts = await findMissingGroupedProducts(validation.value.groupedProductIds, productId);
  if (missingGroupedProducts.length) return response.status(400).json({ error: `Grouped products not found: ${missingGroupedProducts.join(", ")}.` });
  const skuTaken = validation.value.sku && (databaseReady()
    ? await Product.exists({ sku: validation.value.sku })
    : catalog.products.some((product) => product.sku?.toUpperCase() === validation.value.sku));
  if (skuTaken) return response.status(409).json({ error: "That SKU is already assigned to a product." });
  if (!databaseReady()) {
    if (catalogProductIndex(productId) !== -1) return response.status(409).json({ error: "That product ID already exists." });
    const product = { ...validation.value, _id: productId, id: productId, imageId: validation.value.image };
    catalog.products.unshift(product);
    return response.status(201).json({ product: publicProduct(product) });
  }
  const product = await Product.create({ ...validation.value, _id: productId });
  response.status(201).json({ product: publicProduct(product) });
}));

app.patch("/api/products/:id", requireAdmin, asyncRoute(async (request, response) => {
  if (!databaseReady() && !isDemoAdmin(request)) return response.status(503).json({ error: "Product management requires a MongoDB connection." });
  const index = databaseReady() ? -1 : catalogProductIndex(request.params.id);
  const existing = databaseReady() ? await Product.findById(request.params.id).lean() : catalog.products[index];
  if (!existing) return response.status(404).json({ error: "Product not found." });
  const raw = { ...request.body, id: undefined };
  const validation = validateProduct(raw, publicProduct(existing));
  if (validation.errors) return response.status(400).json({ error: validation.errors.join(" ") });
  const categoryExists = databaseReady()
    ? await Category.exists({ _id: validation.value.categoryId, parentId: null })
    : catalog.categories.some((category) => category.id === validation.value.categoryId && !category.parentId);
  if (!categoryExists) return response.status(400).json({ error: "Choose an existing product category." });
  if (validation.value.subcategoryId) {
    const subcategoryExists = databaseReady()
      ? await Category.exists({ _id: validation.value.subcategoryId, parentId: validation.value.categoryId })
      : catalog.categories.some((category) => category.id === validation.value.subcategoryId && category.parentId === validation.value.categoryId);
    if (!subcategoryExists) return response.status(400).json({ error: "Choose a subcategory belonging to the selected category." });
  }
  const missingGroupedProducts = await findMissingGroupedProducts(validation.value.groupedProductIds, request.params.id);
  if (missingGroupedProducts.length) return response.status(400).json({ error: `Grouped products not found: ${missingGroupedProducts.join(", ")}.` });
  if (validation.value.sku) {
    const duplicate = databaseReady()
      ? await Product.exists({ sku: validation.value.sku, _id: { $ne: request.params.id } })
      : catalog.products.some((product) => (product._id ?? product.id) !== request.params.id && product.sku?.toUpperCase() === validation.value.sku);
    if (duplicate) return response.status(409).json({ error: "That SKU is already assigned to another product." });
  }
  if (!databaseReady()) {
    catalog.products[index] = { ...existing, ...validation.value, imageId: validation.value.image };
    return response.json({ product: publicProduct(catalog.products[index]) });
  }
  const product = await Product.findByIdAndUpdate(request.params.id, { $set: validation.value }, { new: true, runValidators: true });
  response.json({ product: publicProduct(product) });
}));

app.delete("/api/products/:id", requireAdmin, asyncRoute(async (request, response) => {
  if (!databaseReady() && !isDemoAdmin(request)) return response.status(503).json({ error: "Product management requires a MongoDB connection." });
  const hasGroupedReferences = databaseReady()
    ? await Product.exists({ _id: { $ne: request.params.id }, groupedProductIds: request.params.id })
    : catalog.products.some((product) => (product._id ?? product.id) !== request.params.id && (product.groupedProductIds ?? []).includes(request.params.id));
  if (hasGroupedReferences) return response.status(409).json({ error: "This product is included in a grouped product. Remove that group reference before deleting it." });
  if (!databaseReady()) {
    const index = catalogProductIndex(request.params.id);
    if (index === -1) return response.status(404).json({ error: "Product not found." });
    catalog.products.splice(index, 1);
  } else {
    const product = await Product.findByIdAndDelete(request.params.id);
    if (!product) return response.status(404).json({ error: "Product not found." });
  }
  response.json({ message: "Product deleted." });
}));

app.patch("/api/admin/products/bulk", requireAdmin, asyncRoute(async (request, response) => {
  if (!databaseReady() && !isDemoAdmin(request)) return response.status(503).json({ error: "Product management requires a MongoDB connection." });
  const { ids, fields } = request.body ?? {};
  const allowed = ["categoryId", "stockQuantity", "stockStatus", "active", "regularPrice", "salePrice"];
  if (!Array.isArray(ids) || !ids.length || ids.length > 200 || !ids.every((id) => typeof id === "string") ||
      !fields || typeof fields !== "object" || Array.isArray(fields) ||
      !Object.keys(fields).length || Object.keys(fields).some((key) => !allowed.includes(key))) {
    return response.status(400).json({ error: "Choose products and valid bulk fields to update." });
  }
  const update = { ...fields };
  if (update.categoryId && !(databaseReady()
    ? await Category.exists({ _id: update.categoryId, parentId: null })
    : catalog.categories.some((category) => category.id === update.categoryId && !category.parentId))) {
    return response.status(400).json({ error: "Choose an existing category." });
  }
  if (update.stockQuantity !== undefined && (!Number.isInteger(update.stockQuantity) || update.stockQuantity < 0 || update.stockQuantity > 1000000)) {
    return response.status(400).json({ error: "Stock quantity must be a whole number between 0 and 1,000,000." });
  }
  if (update.regularPrice !== undefined && (!Number.isFinite(update.regularPrice) || update.regularPrice < 0)) {
    return response.status(400).json({ error: "Regular price must be zero or greater." });
  }
  if (update.salePrice !== undefined && update.salePrice !== null && (!Number.isFinite(update.salePrice) || update.salePrice < 0)) {
    return response.status(400).json({ error: "Sale price must be zero or greater." });
  }
  if (update.stockStatus !== undefined && !["instock", "outofstock", "onbackorder"].includes(update.stockStatus)) return response.status(400).json({ error: "Choose a valid stock status." });
  if (update.active !== undefined && typeof update.active !== "boolean") return response.status(400).json({ error: "Visibility must be true or false." });
  const matchingProducts = databaseReady()
    ? await Product.find({ _id: { $in: ids } }).lean()
    : catalog.products.filter((product) => ids.includes(product._id ?? product.id));
  if (fields.regularPrice !== undefined || fields.salePrice !== undefined) {
    for (const product of matchingProducts) {
      const regular = fields.regularPrice ?? product.regularPrice ?? product.compareAt ?? product.price;
      const sale = fields.salePrice === undefined ? product.salePrice : fields.salePrice;
      if (sale !== null && sale !== undefined && sale >= regular) return response.status(400).json({ error: `Sale price must be less than regular price for ${product.name}.` });
    }
  }
  const updates = matchingProducts.map((product) => {
    const perProductUpdate = { ...update };
    if (fields.categoryId) perProductUpdate.subcategoryId = null;
    if (fields.regularPrice !== undefined || fields.salePrice !== undefined) {
      perProductUpdate.regularPrice = fields.regularPrice ?? product.regularPrice ?? product.compareAt ?? product.price;
      perProductUpdate.salePrice = fields.salePrice === undefined ? product.salePrice ?? null : fields.salePrice;
      perProductUpdate.compareAt = perProductUpdate.regularPrice;
      perProductUpdate.price = perProductUpdate.salePrice ?? perProductUpdate.regularPrice;
    }
    if (fields.stockQuantity !== undefined) perProductUpdate.stockStatus = fields.stockQuantity > 0 ? "instock" : "outofstock";
    return { id: String(product._id ?? product.id), fields: perProductUpdate };
  });
  let matchedCount = updates.length;
  if (!databaseReady()) {
    for (const change of updates) {
      const product = catalog.products.find((item) => (item._id ?? item.id) === change.id);
      Object.assign(product, change.fields);
    }
  } else {
    if (updates.length) await Product.bulkWrite(updates.map(({ id, fields: productFields }) => ({
      updateOne: { filter: { _id: id }, update: { $set: productFields } }
    })), { ordered: true });
  }
  response.json({ updated: matchedCount });
}));

app.get("/api/admin/products/export.csv", requireAdmin, asyncRoute(async (request, response) => {
  let products;
  if (!databaseReady()) {
    if (!isDemoAdmin(request)) return response.status(503).json({ error: "Product export requires a MongoDB connection." });
    products = catalog.products;
  } else {
    products = await Product.find().sort({ name: 1 }).lean();
  }
  const rows = [productCsvColumns, ...products.map((product) => {
    const item = publicProduct(product);
    return productCsvColumns.map((column) => column === "id" ? item.id : item[column]);
  })];
  const csv = rows.map((row) => row.map(escapeCsv).join(",")).join("\r\n");
  response.set("Content-Type", "text/csv; charset=utf-8");
  response.set("Content-Disposition", 'attachment; filename="zariya-products.csv"');
  response.send(`\uFEFF${csv}`);
}));

app.post("/api/admin/products/import", requireAdmin, asyncRoute(async (request, response) => {
  if (!databaseReady() && !isDemoAdmin(request)) return response.status(503).json({ error: "Product import requires a MongoDB connection." });
  if (typeof request.body?.csv !== "string" || request.body.csv.length > 1500000) return response.status(400).json({ error: "Upload a CSV file under 1.5 MB." });
  let rows;
  try {
    rows = parseCsv(request.body.csv);
  } catch (error) {
    return response.status(400).json({ error: error.message });
  }
  if (rows.length > 500) return response.status(400).json({ error: "Import up to 500 products at a time." });
  const batchSkus = new Set();
  const prepared = [];
  for (const [index, row] of rows.entries()) {
    let input;
    try {
      input = parseImportRow(row);
    } catch {
      return response.status(400).json({ error: `CSV row ${index + 2}: gallery, attributes, variations, and grouped IDs must be valid JSON.` });
    }
    let existing = null;
    if (databaseReady()) {
      existing = input.id
        ? await Product.findById(input.id).lean()
        : input.sku ? await Product.findOne({ sku: input.sku.trim().toUpperCase() }).lean() : null;
    } else {
      const existingProduct = input.id
        ? catalog.products.find((product) => (product._id ?? product.id) === input.id)
        : input.sku ? catalog.products.find((product) => product.sku?.toUpperCase() === input.sku.trim().toUpperCase()) : null;
      existing = existingProduct;
    }
    if (input.id && (typeof input.id !== "string" || !/^[a-z0-9][a-z0-9-]{1,79}$/i.test(input.id))) {
      return response.status(400).json({ error: `CSV row ${index + 2}: product ID must use letters, numbers, and hyphens.` });
    }
    const productId = input.id || existing?._id || existing?.id || `product-${randomBytes(6).toString("hex")}`;
    delete input.id;
    const validation = validateProduct(input, existing ? publicProduct(existing) : {});
    if (validation.errors) return response.status(400).json({ error: `CSV row ${index + 2}: ${validation.errors.join(" ")}` });
    const categoryExists = databaseReady()
      ? await Category.exists({ _id: validation.value.categoryId, parentId: null })
      : catalog.categories.some((category) => category.id === validation.value.categoryId && !category.parentId);
    if (!categoryExists) return response.status(400).json({ error: `CSV row ${index + 2}: category "${validation.value.categoryId}" does not exist.` });
    if (validation.value.subcategoryId) {
      const subcategoryExists = databaseReady()
        ? await Category.exists({ _id: validation.value.subcategoryId, parentId: validation.value.categoryId })
        : catalog.categories.some((category) => category.id === validation.value.subcategoryId && category.parentId === validation.value.categoryId);
      if (!subcategoryExists) return response.status(400).json({ error: `CSV row ${index + 2}: subcategory does not belong to the selected category.` });
    }
    const duplicateInBatch = validation.value.sku && batchSkus.has(validation.value.sku);
    const duplicateSku = validation.value.sku && (databaseReady()
      ? await Product.exists({ sku: validation.value.sku, _id: { $ne: productId } })
      : catalog.products.some((product) => (product._id ?? product.id) !== productId && product.sku?.toUpperCase() === validation.value.sku));
    if (duplicateInBatch || duplicateSku) return response.status(409).json({ error: `CSV row ${index + 2}: SKU "${validation.value.sku}" is already in use.` });
    if (validation.value.sku) batchSkus.add(validation.value.sku);
    prepared.push({ productId, value: validation.value, existing });
  }
  const batchProductIds = new Set(prepared.map(({ productId }) => productId));
  for (const [index, item] of prepared.entries()) {
    const missingGroupedProducts = (await findMissingGroupedProducts(item.value.groupedProductIds, item.productId))
      .filter((id) => !batchProductIds.has(id));
    if (missingGroupedProducts.length) return response.status(400).json({ error: `CSV row ${index + 2}: grouped products not found: ${missingGroupedProducts.join(", ")}.` });
  }
  if (!databaseReady()) {
    for (const { productId, value } of prepared) {
      const index = catalogProductIndex(productId);
      const product = { ...value, _id: productId, id: productId, imageId: value.image };
      if (index === -1) catalog.products.push(product);
      else catalog.products[index] = { ...catalog.products[index], ...product };
    }
  } else {
    await Product.bulkWrite(prepared.map(({ productId, value }) => ({
      updateOne: { filter: { _id: productId }, update: { $set: value, $setOnInsert: { _id: productId } }, upsert: true }
    })), { ordered: true });
  }
  response.json({ imported: prepared.length });
}));

app.post("/api/categories", requireAdmin, asyncRoute(async (request, response) => {
  if (!databaseReady() && !isDemoAdmin(request)) return response.status(503).json({ error: "Category management requires a MongoDB connection." });
  const { id, name, description = "", image, parentId = null } = request.body ?? {};
  if (typeof id !== "string" || !/^[a-z0-9][a-z0-9-]{1,79}$/i.test(id) ||
      typeof name !== "string" || !name.trim() || name.trim().length > 100 ||
      typeof description !== "string" || description.length > 1000 ||
      typeof image !== "string" || !/^photo-[a-zA-Z0-9-]{6,100}$/.test(image) ||
      (parentId !== null && (typeof parentId !== "string" || parentId === id))) {
    return response.status(400).json({ error: "Provide a valid category ID, name, description, image, and parent category." });
  }
  const parentExists = !parentId || (databaseReady()
    ? await Category.exists({ _id: parentId, parentId: null })
    : catalog.categories.some((category) => category.id === parentId && !category.parentId));
  if (!parentExists) return response.status(400).json({ error: "A subcategory must belong to an existing top-level category." });
  const category = { id, name: name.trim(), description: description.trim(), image, parentId };
  if (!databaseReady()) {
    if (catalog.categories.some((item) => item.id === id)) return response.status(409).json({ error: "That category ID already exists." });
    catalog.categories.push(category);
    return response.status(201).json({ category });
  }
  const saved = await Category.create({ _id: id, ...category });
  response.status(201).json({ category: saved });
}));

app.patch("/api/categories/:id", requireAdmin, asyncRoute(async (request, response) => {
  if (!databaseReady() && !isDemoAdmin(request)) return response.status(503).json({ error: "Category management requires a MongoDB connection." });
  const index = databaseReady() ? -1 : catalog.categories.findIndex((category) => category.id === request.params.id);
  const existing = databaseReady() ? await Category.findById(request.params.id).lean() : catalog.categories[index];
  if (!existing) return response.status(404).json({ error: "Category not found." });
  const { name, description, image, parentId } = request.body ?? {};
  if (name !== undefined && (typeof name !== "string" || !name.trim() || name.trim().length > 100)) return response.status(400).json({ error: "Category name is required and must be under 100 characters." });
  if (description !== undefined && (typeof description !== "string" || description.length > 1000)) return response.status(400).json({ error: "Category description is too long." });
  if (image !== undefined && (typeof image !== "string" || !/^photo-[a-zA-Z0-9-]{6,100}$/.test(image))) return response.status(400).json({ error: "Enter a valid Unsplash photo ID." });
  if (parentId !== undefined && parentId !== null) {
    if (parentId === request.params.id) return response.status(400).json({ error: "A category cannot be its own parent." });
    const parentExists = databaseReady()
      ? await Category.exists({ _id: parentId, parentId: null })
      : catalog.categories.some((category) => category.id === parentId && !category.parentId);
    if (!parentExists) return response.status(400).json({ error: "Choose a top-level category as the parent." });
  }
  if (parentId !== undefined && parentId !== (existing.parentId ?? null)) {
    const referencedProducts = databaseReady()
      ? await Product.exists({ subcategoryId: request.params.id })
      : catalog.products.some((product) => product.subcategoryId === request.params.id);
    if (referencedProducts) return response.status(409).json({ error: "Move products to another subcategory before changing this category's parent." });
  }
  const hasChildren = databaseReady()
    ? await Category.exists({ parentId: request.params.id })
    : catalog.categories.some((category) => category.parentId === request.params.id);
  if (hasChildren && parentId !== undefined && parentId !== (existing.parentId ?? null)) {
    return response.status(409).json({ error: "Move or delete subcategories before changing this category's parent." });
  }
  const fields = Object.fromEntries(Object.entries({ name, description, image, parentId }).filter(([, value]) => value !== undefined));
  if (!Object.keys(fields).length) return response.status(400).json({ error: "Provide category fields to update." });
  if (!databaseReady()) {
    catalog.categories[index] = { ...existing, ...fields };
    return response.json({ category: catalog.categories[index] });
  }
  const category = await Category.findByIdAndUpdate(request.params.id, { $set: fields }, { new: true, runValidators: true });
  response.json({ category });
}));

app.delete("/api/categories/:id", requireAdmin, asyncRoute(async (request, response) => {
  if (!databaseReady() && !isDemoAdmin(request)) return response.status(503).json({ error: "Category management requires a MongoDB connection." });
  const hasChildren = databaseReady()
    ? await Category.exists({ parentId: request.params.id })
    : catalog.categories.some((category) => category.parentId === request.params.id);
  const hasProducts = databaseReady()
    ? await Product.exists({ $or: [{ categoryId: request.params.id }, { subcategoryId: request.params.id }] })
    : catalog.products.some((product) => product.categoryId === request.params.id || product.subcategoryId === request.params.id);
  if (hasChildren || hasProducts) return response.status(409).json({ error: "This category still has products or subcategories. Move them before deleting it." });
  if (!databaseReady()) {
    const index = catalog.categories.findIndex((category) => category.id === request.params.id);
    if (index === -1) return response.status(404).json({ error: "Category not found." });
    catalog.categories.splice(index, 1);
  } else {
    const category = await Category.findByIdAndDelete(request.params.id);
    if (!category) return response.status(404).json({ error: "Category not found." });
  }
  response.json({ message: "Category deleted." });
}));

app.get("/uploads/products/:filename", asyncRoute(async (request, response, next) => {
  const { filename } = request.params;
  if (!uploadedImagePattern.test(`/uploads/products/${filename}`)) {
    return response.status(404).json({ error: "Product image not found." });
  }
  if (!databaseReady()) {
    return response.sendFile(path.join(productUploadDirectory, filename), (error) => {
      if (error && !response.headersSent) {
        if (error.code === "ENOENT") return response.status(404).json({ error: "Product image not found." });
        next(error);
      }
    });
  }

  const bucket = new mongoose.mongo.GridFSBucket(mongoose.connection.db, { bucketName: "productImages" });
  const [file] = await bucket.find({ filename }).limit(1).toArray();
  if (!file) return response.status(404).json({ error: "Product image not found." });
  const extension = path.extname(filename).slice(1);
  response.set({
    "Cache-Control": "public, max-age=31536000, immutable",
    "Content-Type": extension === "jpg" ? "image/jpeg" : `image/${extension}`
  });
  bucket.openDownloadStream(file._id).on("error", next).pipe(response);
}));

app.use("/uploads", express.static(path.join(root, "uploads"), {
  fallthrough: false,
  immutable: true,
  maxAge: "1y"
}));
app.use(express.static(path.join(root, "dist")));
app.get("*", (request, response, next) => {
  if (request.path.startsWith("/api/")) {
    return response.status(404).json({ error: "API endpoint not found." });
  }
  response.sendFile(path.join(root, "dist", "index.html"), (error) => {
    if (error) next(error);
  });
});

app.use((error, _request, response, _next) => {
  if (error instanceof multer.MulterError) {
    const message = error.code === "LIMIT_FILE_SIZE"
      ? "Each image must be 8 MB or smaller."
      : error.code === "LIMIT_FILE_COUNT"
        ? "Upload no more than 10 images at a time."
        : "Choose images using the product image upload control.";
    return response.status(400).json({ error: message });
  }
  if (error?.message === "Upload JPEG, PNG, or WebP images only.") {
    return response.status(400).json({ error: error.message });
  }
  if (error instanceof mongoose.Error.ValidationError || error instanceof mongoose.Error.CastError) {
    return response.status(400).json({ error: error.message });
  }
  if (error?.code === 11000) {
    return response.status(409).json({ error: "That record already exists." });
  }
  if (error instanceof SyntaxError && "body" in error) {
    return response.status(400).json({ error: "Request body must be valid JSON." });
  }
  console.error("Request failed:", error);
  response.status(500).json({ error: "Something went wrong. Please try again." });
});

if (process.env.MONGODB_URI) {
  mongoose.connect(process.env.MONGODB_URI)
    .then(async () => {
      console.info("Connected to MongoDB.");
      await createAdminFromEnvironment();
      await seedDatabaseCatalogIfEmpty();
      storeReady = true;
    })
    .catch((error) => {
      console.error("MongoDB connection or store setup failed:", error.message);
      if (isProduction) process.exitCode = 1;
    });
} else {
  console.warn("MongoDB is not configured. Catalog browsing uses demo data; order checkout is disabled.");
}

app.listen(port, () => console.info(`Zariya API and storefront listening on http://localhost:${port}`));
