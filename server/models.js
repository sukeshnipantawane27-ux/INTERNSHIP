import mongoose from "mongoose";

const categorySchema = new mongoose.Schema(
  {
    _id: { type: String, required: true },
    name: { type: String, required: true },
    description: { type: String, default: "" },
    image: { type: String, default: "" },
    parentId: { type: String, default: null, index: true }
  },
  { timestamps: true, versionKey: false }
);

const productSchema = new mongoose.Schema(
  {
    _id: { type: String, required: true },
    sku: { type: String, trim: true, uppercase: true, sparse: true, unique: true },
    categoryId: { type: String, required: true, index: true },
    subcategoryId: { type: String, default: null, index: true },
    name: { type: String, required: true, trim: true },
    description: { type: String, default: "" },
    shortDescription: { type: String, default: "" },
    productType: { type: String, enum: ["simple", "variable", "grouped", "virtual"], default: "simple" },
    price: { type: Number, required: true, min: 0 },
    regularPrice: { type: Number, default: null, min: 0 },
    salePrice: { type: Number, default: null, min: 0 },
    compareAt: { type: Number, default: null, min: 0 },
    stockQuantity: { type: Number, default: 0, min: 0 },
    stockStatus: { type: String, enum: ["instock", "outofstock", "onbackorder"], default: "instock" },
    manageStock: { type: Boolean, default: true },
    virtual: { type: Boolean, default: false },
    image: { type: String, default: "" },
    gallery: { type: [String], default: [] },
    attributes: { type: [mongoose.Schema.Types.Mixed], default: [] },
    variations: { type: [mongoose.Schema.Types.Mixed], default: [] },
    groupedProductIds: { type: [String], default: [] },
    badge: { type: String, default: "" },
    active: { type: Boolean, default: true }
  },
  { timestamps: true, versionKey: false }
);

const orderSchema = new mongoose.Schema(
  {
    orderNumber: { type: String, required: true, unique: true },
    customerId: { type: mongoose.Schema.Types.ObjectId, ref: "Account", default: null, index: true },
    customer: {
      name: { type: String, required: true, trim: true },
      email: { type: String, required: true, trim: true, lowercase: true },
      phone: { type: String, required: true, trim: true },
      address: { type: String, required: true, trim: true }
    },
    items: [{
      productId: { type: String, required: true },
      name: { type: String, required: true },
      sku: { type: String, default: "" },
      variationAttributes: { type: mongoose.Schema.Types.Mixed, default: {} },
      image: { type: String, default: "" },
      unitPrice: { type: Number, required: true },
      quantity: { type: Number, required: true, min: 1 }
    }],
    subtotal: { type: Number, required: true, min: 0 },
    shipping: { type: Number, required: true, min: 0 },
    total: { type: Number, required: true, min: 0 },
    status: {
      type: String,
      enum: ["pending", "processing", "shipped", "completed", "cancelled"],
      default: "pending"
    },
    paymentStatus: { type: String, enum: ["unpaid", "paid", "refunded"], default: "unpaid" }
  },
  { timestamps: true, versionKey: false }
);

const accountSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 100 },
    email: { type: String, required: true, unique: true, trim: true, lowercase: true, maxlength: 200 },
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, enum: ["customer", "admin"], required: true, immutable: true }
  },
  { timestamps: true, versionKey: false }
);

const newsletterSubscriberSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, unique: true, trim: true, lowercase: true }
  },
  { timestamps: true, versionKey: false }
);

export const Category = mongoose.models.Category || mongoose.model("Category", categorySchema);
export const Product = mongoose.models.Product || mongoose.model("Product", productSchema);
export const Order = mongoose.models.Order || mongoose.model("Order", orderSchema);
export const Account = mongoose.models.Account || mongoose.model("Account", accountSchema);
export const NewsletterSubscriber =
  mongoose.models.NewsletterSubscriber ||
  mongoose.model("NewsletterSubscriber", newsletterSubscriberSchema);
