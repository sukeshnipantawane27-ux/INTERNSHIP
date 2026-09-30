import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight, BarChart3, Check, ChevronDown, CircleAlert, Download, Eye, EyeOff,
  Layers3, LogIn, PackageCheck, Pencil, Plus, RefreshCw, Search, ShieldCheck,
  Trash2, Upload, Users, Wallet, X
} from "lucide-react";

const money = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0
});

const orderStatuses = ["pending", "processing", "shipped", "completed", "cancelled"];
const paymentStatuses = ["unpaid", "paid", "refunded"];
const navigation = [
  { id: "overview", label: "Overview", icon: BarChart3 },
  { id: "orders", label: "Orders", icon: PackageCheck },
  { id: "products", label: "Products", icon: Layers3 },
  { id: "categories", label: "Collections", icon: Layers3 },
  { id: "customers", label: "Customers", icon: Users }
];

async function requestJson(path, options) {
  const response = await fetch(path, options);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Something went wrong. Please try again.");
  return data;
}

function photoUrl(imageId) {
  if (!imageId) return "";
  if (imageId.startsWith("/") || /^https?:\/\//i.test(imageId)) return imageId;
  return `https://images.unsplash.com/${imageId}?auto=format&fit=crop&w=180&q=80`;
}

function PanelHeading({ eyebrow, title, children }) {
  return (
    <div className="admin-panel-heading">
      <div><span className="footer-label">{eyebrow}</span><h2>{title}</h2></div>
      {children}
    </div>
  );
}

function OrdersTable({ orders, categories, demo, onUpdate }) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const filtered = orders.filter((order) => {
    const haystack = `${order.orderNumber} ${order.customer.name} ${order.customer.email} ${order.items.map((item) => item.name).join(" ")}`.toLowerCase();
    return haystack.includes(query.trim().toLowerCase()) && (status === "all" || order.status === status);
  });
  return (
    <>
      <div className="admin-table-tools">
        <label className="admin-search"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search orders, customers, products…" aria-label="Search orders" /></label>
        <label className="admin-filter"><span className="visually-hidden">Filter orders by status</span><select value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">All order statuses</option>{orderStatuses.map((item) => <option key={item}>{item}</option>)}</select><ChevronDown size={14} /></label>
      </div>
      <div className="admin-table-wrap">
        <table className="admin-table admin-orders-table">
          <thead><tr><th>ORDER</th><th>DATE</th><th>CUSTOMER</th><th>ITEMS</th><th>TOTAL</th><th>ORDER STATUS</th><th>PAYMENT</th></tr></thead>
          <tbody>
            {filtered.map((order) => (
              <tr key={order.orderNumber}>
                <td><strong className="admin-order-number">{order.orderNumber}</strong></td>
                <td>{new Date(order.createdAt).toLocaleDateString()}</td>
                <td><strong className="admin-customer-name">{order.customer.name}</strong><span className="admin-cell-secondary">{order.customer.email}</span></td>
                <td><details className="admin-items-details"><summary>{order.items.reduce((sum, item) => sum + item.quantity, 0)} item(s)</summary>{order.items.map((item) => <span key={`${order.orderNumber}-${item.productId}`}>{item.quantity} × {item.name}</span>)}<span>Ship to: {order.customer.address}</span></details></td>
                <td><strong>{money.format(order.total)}</strong></td>
                <td><select aria-label={`Order status for ${order.orderNumber}`} value={order.status} disabled={demo} onChange={(event) => onUpdate(order.orderNumber, "status", event.target.value)}>{orderStatuses.map((item) => <option key={item}>{item}</option>)}</select></td>
                <td><select aria-label={`Payment status for ${order.orderNumber}`} value={order.paymentStatus} disabled={demo} onChange={(event) => onUpdate(order.orderNumber, "paymentStatus", event.target.value)}>{paymentStatuses.map((item) => <option key={item}>{item}</option>)}</select></td>
              </tr>
            ))}
            {!filtered.length && <tr><td className="admin-table-empty" colSpan="7">No orders match this search yet.</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="admin-table-footnote">Showing {filtered.length} of {orders.length} recent orders.</p>
    </>
  );
}

function ProductEditor({ product, products, categories, onSave, onCancel, saving }) {
  const [categoryId, setCategoryId] = useState(product?.categoryId || categories.find((category) => !category.parentId)?.id || "");
  const [subcategoryId, setSubcategoryId] = useState(product?.subcategoryId || "");
  const [image, setImage] = useState(product?.imageId || product?.image || "");
  const [gallery, setGallery] = useState(product?.gallery || []);
  const [active, setActive] = useState(product?.active !== false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const featuredImageInput = useRef(null);
  const galleryInput = useRef(null);
  const attributesText = (product?.attributes || []).map((attribute) => `${attribute.name}: ${(attribute.values || []).join(", ")}`).join("\n");

  async function uploadImages(fileList, featured = false) {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    const gallerySlots = 10 - gallery.length;
    if (!featured && files.length > gallerySlots) {
      setUploadError(`You can add ${gallerySlots} more gallery image${gallerySlots === 1 ? "" : "s"}.`);
      if (galleryInput.current) galleryInput.current.value = "";
      return;
    }
    const invalidFile = files.find((file) => !["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 8 * 1024 * 1024);
    if (invalidFile) {
      setUploadError(`${invalidFile.name} is not a supported image or is larger than 8 MB.`);
      return;
    }
    setUploading(true);
    setUploadError("");
    try {
      const formData = new FormData();
      files.forEach((file) => formData.append("images", file));
      const response = await fetch("/api/admin/uploads/products", { method: "POST", body: formData });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Image upload failed. Please try again.");
      if (featured) setImage(result.images[0]);
      else setGallery((current) => [...current, ...result.images].slice(0, 10));
    } catch (error) {
      setUploadError(error.message);
    } finally {
      setUploading(false);
      if (featuredImageInput.current) featuredImageInput.current.value = "";
      if (galleryInput.current) galleryInput.current.value = "";
    }
  }

  function submit(event) {
    event.preventDefault();
    if (!image) {
      setUploadError("Add a featured image before saving this product.");
      return;
    }
    const form = Object.fromEntries(new FormData(event.currentTarget));
    const groupedProductIds = Array.from(event.currentTarget.elements.groupedProductIds.selectedOptions, (option) => option.value);
    let variations = [];
    try {
      variations = form.variations.trim() ? JSON.parse(form.variations) : [];
      if (!Array.isArray(variations)) throw new Error("Variations must be a JSON array.");
    } catch (error) {
      event.currentTarget.elements.variations.setCustomValidity(error.message);
      event.currentTarget.elements.variations.reportValidity();
      event.currentTarget.elements.variations.setCustomValidity("");
      return;
    }
    const attributes = form.attributes.split("\n").map((line) => {
      const separator = line.indexOf(":");
      return separator > 0 ? { name: line.slice(0, separator).trim(), values: line.slice(separator + 1).split(",").map((value) => value.trim()).filter(Boolean), visible: true, variation: form.productType === "variable" } : null;
    }).filter((attribute) => attribute?.name && attribute.values.length);
    onSave({
      ...form,
      categoryId,
      subcategoryId: subcategoryId || null,
      sku: form.sku.trim().toUpperCase(),
      regularPrice: Number(form.regularPrice),
      salePrice: form.salePrice ? Number(form.salePrice) : null,
      stockQuantity: Number(form.stockQuantity),
      manageStock: form.manageStock === "true",
      virtual: form.productType === "virtual",
      active,
      image,
      gallery,
      attributes,
      variations,
      groupedProductIds,
      ...(product ? { id: product.id } : {})
    });
  }

  return (
    <form className="admin-editor-form product-editor" key={product?.id || "new-product"} onSubmit={submit}>
      <div className="admin-editor-heading"><div><span className="footer-label">{product ? "ZARIYA LUXURY CATALOG" : "NEW ROYAL ARRIVAL"}</span><h3>{product ? "Edit product" : "Create a product"}</h3></div><button className="text-link" type="button" onClick={onCancel}><X size={14} /> Close</button></div>
      <div className="product-editor-layout">
        <div className="product-editor-media">
          <section className="product-editor-card">
            <h4>Product gallery</h4>
            <div className="product-featured-preview">{image ? <img src={photoUrl(image)} alt={product?.name || "Featured product preview"} /> : <span><Layers3 size={24} />Add a featured image</span>}</div>
            <button type="button" className="button button-outline product-upload-button" onClick={() => featuredImageInput.current?.click()} disabled={uploading}><Upload size={15} />{uploading ? "Uploading…" : image ? "Replace featured image" : "Upload featured image"}</button>
            <input ref={featuredImageInput} className="product-file-input" type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => uploadImages(event.target.files, true)} />
            <div className="product-gallery-preview">{gallery.map((item, index) => <figure key={`${item}-${index}`}><img src={photoUrl(item)} alt={`Gallery image ${index + 1}`} /><button type="button" aria-label={`Remove gallery image ${index + 1}`} onClick={() => setGallery((current) => current.filter((_, itemIndex) => itemIndex !== index))}><X size={12} /></button></figure>)}</div>
            <button type="button" className="button button-outline product-upload-button" onClick={() => galleryInput.current?.click()} disabled={uploading || gallery.length >= 10}><Plus size={15} />Add gallery images ({gallery.length}/10)</button>
            <input ref={galleryInput} className="product-file-input" type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={(event) => uploadImages(event.target.files)} />
            <p className="field-hint">JPEG, PNG, or WebP · up to 8 MB each</p>
            {uploadError && <p className="product-upload-error" role="alert">{uploadError}</p>}
          </section>
          <section className="product-editor-card product-data-card"><h4>Inventory & visibility</h4>
            <label>Stock quantity<input name="stockQuantity" type="number" min="0" max="1000000" step="1" defaultValue={product?.stockQuantity ?? 12} required /></label>
            <label>Stock status<select name="stockStatus" defaultValue={product?.stockStatus || ((product?.stockQuantity ?? 12) > 0 ? "instock" : "outofstock")}><option value="instock">In stock</option><option value="outofstock">Out of stock</option><option value="onbackorder">On backorder</option></select></label>
            <label>Manage stock<select name="manageStock" defaultValue={String(product?.manageStock ?? true)}><option value="true">Track stock quantity</option><option value="false">Do not track stock</option></select></label>
          </section>
        </div>
        <div className="product-editor-main">
          <section className="product-editor-card product-title-card"><label>Product name<input name="name" defaultValue={product?.name} maxLength={160} placeholder="Maharani Banarasi Silk Saree" required /></label>{product && <p>Product ID: <strong>{product.id}</strong></p>}</section>
          <section className="product-editor-card"><h4>Product data</h4>
            <div className="admin-form-grid">
              <label>Product type<select name="productType" defaultValue={product?.productType || "simple"}><option value="simple">Simple product</option><option value="variable">Variable product</option><option value="grouped">Grouped product</option><option value="virtual">Virtual product</option></select></label>
              <label>SKU<input name="sku" defaultValue={product?.sku} maxLength={64} pattern="[A-Za-z0-9][A-Za-z0-9._-]*" placeholder="ZR-SAREE-001" /></label>
              <label>Regular price (₹)<input name="regularPrice" type="number" min="0" step="0.01" defaultValue={product?.regularPrice ?? product?.compareAt ?? product?.price ?? ""} required /></label>
              <label>Sale price (₹)<input name="salePrice" type="number" min="0" step="0.01" defaultValue={product?.salePrice ?? ""} placeholder="Optional" /></label>
              <label>Product badge<input name="badge" maxLength={50} placeholder="Royal collection" defaultValue={product?.badge || ""} /></label>
            </div>
          </section>
          <section className="product-editor-card"><h4>Product description</h4>
            <label>Short description<textarea name="shortDescription" maxLength={1000} rows={2} defaultValue={product?.shortDescription || ""} placeholder="A refined, one-line introduction for your product." /></label>
            <label>Full description<textarea name="description" maxLength={10000} rows={5} defaultValue={product?.description || ""} /></label>
          </section>
          <section className="product-editor-card"><h4>Attributes & variations</h4>
            <label>Attributes — one per line: Name: value, value<textarea name="attributes" rows={3} defaultValue={attributesText} placeholder={"Size: S, M, L, XL\nColor: Royal red, Antique gold\nMaterial: Pure Banarasi silk"} /></label>
            <label>Variations — JSON array<textarea name="variations" rows={5} defaultValue={JSON.stringify(product?.variations || [], null, 2)} placeholder={'[{"sku":"ZR-RED-M","attributes":{"Color":"Red","Size":"M"},"regularPrice":15999,"salePrice":null,"stockQuantity":2,"image":"photo-1234567890"}]'} /></label>
          </section>
          <section className="product-editor-card"><h4>Linked products</h4>
            <label>Grouped products — select items to include<select name="groupedProductIds" multiple defaultValue={product?.groupedProductIds || []}>{products.filter((item) => item.id !== product?.id).map((item) => <option value={item.id} key={item.id}>{item.name} · {item.sku || item.id}</option>)}</select><span className="field-hint">Use Ctrl or Command to select more than one item.</span></label>
          </section>
        </div>
        <aside className="product-editor-sidebar">
          <section className="product-editor-card"><h4>Publish</h4>
            <label>Status<select value={active ? "true" : "false"} onChange={(event) => setActive(event.target.value === "true")}><option value="true">Published</option><option value="false">Draft / hidden</option></select></label>
            <p>Changes are saved to your catalog when you select the button below.</p>
            <button className="button button-dark product-publish-button" type="submit" disabled={saving || uploading}>{saving ? "Saving…" : product ? "Update product" : "Publish product"} <Check size={15} /></button>
            <button className="button button-outline product-publish-button" type="button" onClick={onCancel}>Cancel</button>
          </section>
          <section className="product-editor-card"><h4>Product categories</h4>
            <label>Category<select value={categoryId} onChange={(event) => { setCategoryId(event.target.value); setSubcategoryId(""); }} required>{categories.filter((category) => !category.parentId).map((category) => <option value={category.id} key={category.id}>{category.name}</option>)}</select></label>
            <label>Subcategory<select value={subcategoryId} onChange={(event) => setSubcategoryId(event.target.value)}><option value="">No subcategory</option>{categories.filter((category) => category.parentId === categoryId).map((category) => <option value={category.id} key={category.id}>{category.name}</option>)}</select></label>
          </section>
        </aside>
      </div>
    </form>
  );
}

function CollectionEditor({ category, categories, onSave, onCancel, saving }) {
  function submit(event) {
    event.preventDefault();
    const fields = Object.fromEntries(new FormData(event.currentTarget));
    fields.parentId = fields.parentId || null;
    onSave({ ...fields, ...(category ? { id: category.id } : {}) });
  }
  return (
    <form className="admin-editor-form" key={category?.id || "new-collection"} onSubmit={submit}>
      <div className="admin-editor-heading"><div><span className="footer-label">{category ? "UPDATE YOUR COLLECTION" : "CREATE A COLLECTION"}</span><h3>{category ? "Edit collection" : "Add a collection"}</h3></div><button className="text-link" type="button" onClick={onCancel}>Close</button></div>
      <div className="admin-form-grid">
        {!category && <label>Collection ID<input name="id" pattern="[a-zA-Z0-9][a-zA-Z0-9-]{1,79}" placeholder="new-collection" required /></label>}
        <label>Collection name<input name="name" maxLength={100} defaultValue={category?.name} required /></label>
        <label>Parent category<select name="parentId" defaultValue={category?.parentId || ""}><option value="">Top-level category</option>{categories.filter((item) => !item.parentId && item.id !== category?.id).map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>
        <label>Unsplash photo ID<input name="image" pattern="photo-[a-zA-Z0-9-]{6,100}" placeholder="photo-1234567890" defaultValue={category?.imageId || ""} required /></label>
        <label className="admin-form-full">Description<textarea name="description" maxLength={1000} rows={2} defaultValue={category?.description || ""} /></label>
      </div>
      <div className="admin-editor-actions"><button className="button button-outline" type="button" onClick={onCancel}>Cancel</button><button className="button button-dark" type="submit" disabled={saving}>{saving ? "Saving…" : category ? "Save collection" : "Create collection"} <Check size={15} /></button></div>
    </form>
  );
}

export function AdminPanel() {
  const [admin, setAdmin] = useState(null);
  const [orders, setOrders] = useState([]);
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [metrics, setMetrics] = useState({});
  const [activeTab, setActiveTab] = useState("overview");
  const [productQuery, setProductQuery] = useState("");
  const [customerQuery, setCustomerQuery] = useState("");
  const [productFilter, setProductFilter] = useState("all");
  const [selectedProducts, setSelectedProducts] = useState([]);
  const [bulkField, setBulkField] = useState("categoryId");
  const [bulkValue, setBulkValue] = useState("");
  const [productEditor, setProductEditor] = useState(undefined);
  const [categoryEditor, setCategoryEditor] = useState(undefined);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function loadDashboard() {
    const [dashboardData, orderData, productData, categoryData, customerData] = await Promise.all([
      requestJson("/api/admin/dashboard"),
      requestJson("/api/orders"),
      requestJson("/api/admin/products"),
      requestJson("/api/admin/categories"),
      requestJson("/api/admin/customers")
    ]);
    setMetrics(dashboardData.metrics);
    setOrders(orderData.orders);
    setProducts(productData.products);
    setCategories(categoryData.categories);
    setCustomers(customerData.customers);
  }

  useEffect(() => {
    let active = true;
    requestJson("/api/auth/admin/me")
      .then((data) => {
        if (!active) return;
        setAdmin(data.account);
        return loadDashboard().catch((loadError) => {
          if (active) setError(loadError.message);
        });
      })
      .catch(() => {})
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, []);

  async function signIn(event) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const data = await requestJson("/api/auth/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget)))
      });
      setAdmin(data.account);
      await loadDashboard();
    } catch (signInError) {
      setError(signInError.message);
    } finally {
      setSaving(false);
    }
  }

  async function signOut() {
    try {
      await requestJson("/api/auth/admin/logout", { method: "POST" });
      setAdmin(null);
      setOrders([]);
      setProducts([]);
      setCategories([]);
      setCustomers([]);
    } catch (signOutError) {
      setError(signOutError.message);
    }
  }

  async function refresh() {
    setRefreshing(true);
    setError("");
    try {
      await loadDashboard();
      setNotice("Your store details are up to date.");
    } catch (refreshError) {
      setError(refreshError.message);
    } finally {
      setRefreshing(false);
    }
  }

  async function updateOrder(orderNumber, field, value) {
    setError("");
    setNotice("");
    try {
      await requestJson(`/api/orders/${encodeURIComponent(orderNumber)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: value })
      });
      await loadDashboard();
      setNotice(`${orderNumber} was updated.`);
    } catch (updateError) {
      setError(updateError.message);
      await loadDashboard().catch(() => {});
    }
  }

  async function saveProduct(fields) {
    setSaving(true);
    setError("");
    setNotice("");
    const editing = fields.id;
    const { id, ...product } = fields;
    try {
      await requestJson(editing ? `/api/products/${encodeURIComponent(editing)}` : "/api/products", {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(product)
      });
      setProductEditor(undefined);
      await loadDashboard();
      setNotice(editing ? "Product details saved." : "The product was added to your store.");
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setSaving(false);
    }
  }

  async function setProductVisibility(product) {
    setError("");
    try {
      await requestJson(`/api/products/${encodeURIComponent(product.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: !product.active })
      });
      await loadDashboard();
      setNotice(`${product.name} is now ${product.active ? "hidden" : "visible"} in the shop.`);
    } catch (visibilityError) {
      setError(visibilityError.message);
    }
  }

  async function saveCategory(fields) {
    setSaving(true);
    setError("");
    setNotice("");
    const editing = categories.some((category) => category.id === fields.id);
    const categoryId = fields.id;
    const { id, ...category } = fields;
    try {
      await requestJson(editing ? `/api/categories/${encodeURIComponent(categoryId)}` : "/api/categories", {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editing ? category : { ...category, id })
      });
      setCategoryEditor(undefined);
      await loadDashboard();
      setNotice(editing ? "Collection details saved." : "Your new collection is ready.");
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setSaving(false);
    }
  }

  async function deleteCategory(category) {
    if (!window.confirm(`Delete the “${category.name}” collection? This cannot be undone.`)) return;
    setError("");
    try {
      await requestJson(`/api/categories/${encodeURIComponent(category.id)}`, { method: "DELETE" });
      await loadDashboard();
      setNotice(`${category.name} was deleted.`);
    } catch (deleteError) {
      setError(deleteError.message);
    }
  }

  async function deleteProduct(product) {
    if (!window.confirm(`Permanently delete “${product.name}”? This cannot be undone.`)) return;
    setError("");
    try {
      await requestJson(`/api/products/${encodeURIComponent(product.id)}`, { method: "DELETE" });
      setSelectedProducts((selected) => selected.filter((id) => id !== product.id));
      await loadDashboard();
      setNotice(`${product.name} was deleted.`);
    } catch (deleteError) {
      setError(deleteError.message);
    }
  }

  async function applyBulkEdit(event) {
    event.preventDefault();
    setError("");
    let value = bulkValue;
    if (bulkField === "active") value = value === "true";
    if (bulkField === "stockQuantity" || bulkField === "regularPrice") value = Number(value);
    if (bulkField === "salePrice") value = value === "" ? null : Number(value);
    try {
      const result = await requestJson("/api/admin/products/bulk", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: selectedProducts, fields: { [bulkField]: value } })
      });
      setSelectedProducts([]);
      setBulkValue("");
      await loadDashboard();
      setNotice(`${result.updated} product${result.updated === 1 ? "" : "s"} updated.`);
    } catch (bulkError) {
      setError(bulkError.message);
    }
  }

  async function importProducts(event) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) return;
    setError("");
    setNotice("");
    try {
      if (file.size > 1500000) throw new Error("Choose a CSV file under 1.5 MB.");
      const result = await requestJson("/api/admin/products/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ csv: await file.text() })
      });
      await loadDashboard();
      setNotice(`${result.imported} products imported or updated.`);
    } catch (importError) {
      setError(importError.message);
    } finally {
      input.value = "";
    }
  }

  function toggleProductSelection(id) {
    setSelectedProducts((selected) => selected.includes(id) ? selected.filter((item) => item !== id) : [...selected, id]);
  }

  function toggleAllProducts() {
    setSelectedProducts((selected) => visibleProducts.length && visibleProducts.every((product) => selected.includes(product.id))
      ? selected.filter((id) => !visibleProducts.some((product) => product.id === id))
      : [...new Set([...selected, ...visibleProducts.map((product) => product.id)])]);
  }

  const visibleProducts = useMemo(() => products.filter((product) =>
    `${product.name} ${product.categoryId}`.toLowerCase().includes(productQuery.trim().toLowerCase()) &&
    (productFilter === "all" || (productFilter === "active" ? product.active : !product.active))
  ), [products, productQuery, productFilter]);

  const visibleCustomers = useMemo(() => customers.filter((customer) =>
    `${customer.name} ${customer.email}`.toLowerCase().includes(customerQuery.trim().toLowerCase())
  ), [customers, customerQuery]);
  const allVisibleSelected = visibleProducts.length > 0 && visibleProducts.every((product) => selectedProducts.includes(product.id));

  return (
    <main className={`studio-page ${admin ? "studio-is-signed-in" : ""}`}>
      <header className="studio-topbar">
        <a className="wordmark" href="/">zariya<span>.</span><small>THE ART OF EVERYDAY</small></a>
        <div className="studio-topbar-actions">
          <a href="/" className="studio-store-link">View storefront <ArrowRight size={14} /></a>
          {admin && <span className="studio-user">{admin.email}</span>}
          {admin && <button className="studio-signout" onClick={signOut}>Sign out</button>}
        </div>
      </header>

      {!admin ? (
        <section className="studio-login">
          <div className="studio-login-copy"><ShieldCheck size={27} /><span className="footer-label">ZARIYA STUDIO · PRIVATE ACCESS</span><h1>Your store,<br /><em>thoughtfully managed.</em></h1><p>Orders, products, inventory, customers, and collections—all in one place.</p></div>
          <form className="studio-login-card" onSubmit={signIn}>
            <span className="footer-label">ADMINISTRATOR</span><h2>Sign in to your store.</h2>
            <label>Email address<input name="email" type="email" autoComplete="username" maxLength={200} required /></label>
            <label>Password<input name="password" type="password" autoComplete="current-password" maxLength={72} required /></label>
            {error && <div className="auth-error" role="alert">{error}</div>}
            <button className="button button-dark" type="submit" disabled={saving}>{saving ? "Checking your details…" : "Open store dashboard"} <LogIn size={15} /></button>
            <p>Private admin access. Customer sign-in is separate.</p>
          </form>
        </section>
      ) : loading ? (
        <div className="studio-loading">Opening your store…</div>
      ) : (
        <>
          <div className="studio-intro">
            <div><span className="footer-label">YOUR ZARIYA STORE</span><h1>Good morning, <em>{admin.demo ? "studio" : admin.name.split(" ")[0]}.</em></h1><p>Here's what's happening with your shop.</p></div>
            <button className="studio-refresh" onClick={refresh} disabled={refreshing}><RefreshCw size={15} className={refreshing ? "is-spinning" : ""} /> {refreshing ? "Refreshing…" : "Refresh data"}</button>
          </div>

          {admin.demo && <div className="studio-demo-notice"><CircleAlert size={17} /><span><strong>Local preview mode.</strong> You can test product and collection management here. Preview edits reset when the server restarts; connect MongoDB for durable products, orders, and customer records.</span></div>}
          {(error || notice) && <div className={`studio-feedback ${error ? "is-error" : ""}`} role={error ? "alert" : "status"}>{error || notice}</div>}

          <nav className="studio-nav" aria-label="Store management">
            {navigation.map(({ id, label, icon: Icon }) => (
              <button key={id} className={activeTab === id ? "is-active" : ""} onClick={() => { setActiveTab(id); setError(""); }}><Icon size={16} />{label}{id === "orders" && metrics.pendingOrders > 0 && <span className="studio-nav-count">{metrics.pendingOrders}</span>}</button>
            ))}
          </nav>

          {activeTab === "overview" && (
            <div className="studio-content">
              <div className="studio-stat-grid">
                <article className="studio-stat"><span><Wallet size={17} /> GROSS SALES</span><strong>{money.format(metrics.revenue ?? 0)}</strong><small>Across non-cancelled orders</small></article>
                <article className="studio-stat"><span><PackageCheck size={17} /> TOTAL ORDERS</span><strong>{metrics.orderCount ?? 0}</strong><small>{metrics.pendingOrders ?? 0} awaiting fulfilment</small></article>
                <article className="studio-stat"><span><Users size={17} /> CUSTOMERS</span><strong>{metrics.customerCount ?? customers.length}</strong><small>Registered accounts</small></article>
                <article className="studio-stat"><span><CircleAlert size={17} /> LOW STOCK</span><strong>{metrics.lowStockProducts ?? 0}</strong><small>Products with 5 or fewer left</small></article>
              </div>
              <section className="studio-section">
                <PanelHeading eyebrow="RECENT ACTIVITY" title="Your latest orders"><button className="studio-inline-link" onClick={() => setActiveTab("orders")}>Manage orders <ArrowRight size={14} /></button></PanelHeading>
                <OrdersTable orders={orders.slice(0, 8)} categories={categories} demo={admin.demo} onUpdate={updateOrder} />
              </section>
              <section className="studio-section">
                <PanelHeading eyebrow="KEEP AN EYE ON STOCK" title="Items running low"><button className="studio-inline-link" onClick={() => { setProductFilter("active"); setActiveTab("products"); }}>View products <ArrowRight size={14} /></button></PanelHeading>
                {products.filter((product) => product.active && product.stockQuantity <= 5).length
                  ? <div className="studio-low-stock">{products.filter((product) => product.active && product.stockQuantity <= 5).map((product) => <article key={product.id}><img src={photoUrl(product.imageId || product.image)} alt="" /><span><strong>{product.name}</strong><small>{product.stockQuantity} left in stock</small></span><button className="studio-inline-link" onClick={() => { setProductEditor(product); setActiveTab("products"); }}>Restock <Pencil size={13} /></button></article>)}</div>
                  : <div className="studio-good-news"><Check size={16} /> Everything is well stocked.</div>}
              </section>
            </div>
          )}

          {activeTab === "orders" && (
            <section className="studio-section studio-content">
              <PanelHeading eyebrow="SALES & FULFILMENT" title="Orders"><span className="studio-section-count">{orders.length} recent</span></PanelHeading>
              <OrdersTable orders={orders} categories={categories} demo={admin.demo} onUpdate={updateOrder} />
            </section>
          )}

          {activeTab === "products" && (
            <section className="studio-section studio-content">
              <PanelHeading eyebrow="YOUR STORE CATALOG" title="Products">
                <div className="studio-product-tools">
                  <a className="button button-outline studio-add-button" href="/api/admin/products/export.csv" download><Download size={15} /> Export CSV</a>
                  <label className="button button-outline studio-add-button studio-import-button"><Upload size={15} /> Import CSV<input type="file" accept=".csv,text/csv" onChange={importProducts} /></label>
                  <button className="button button-dark studio-add-button" onClick={() => setProductEditor(productEditor === null ? undefined : null)}><Plus size={15} /> Add product</button>
                </div>
              </PanelHeading>
              {productEditor !== undefined && <ProductEditor key={productEditor?.id || "new-product"} product={productEditor} products={products} categories={categories} onSave={saveProduct} onCancel={() => setProductEditor(undefined)} saving={saving} />}
              {selectedProducts.length > 0 && <form className="studio-bulk-toolbar" onSubmit={applyBulkEdit}>
                <strong>{selectedProducts.length} selected</strong>
                <select aria-label="Bulk edit field" value={bulkField} onChange={(event) => { setBulkField(event.target.value); setBulkValue(""); }}>
                  <option value="categoryId">Set category</option><option value="regularPrice">Set regular price</option><option value="salePrice">Set sale price</option><option value="stockQuantity">Set stock quantity</option><option value="active">Set visibility</option>
                </select>
                {bulkField === "categoryId" ? <select value={bulkValue} onChange={(event) => setBulkValue(event.target.value)} required><option value="">Choose category</option>{categories.filter((category) => !category.parentId).map((category) => <option value={category.id} key={category.id}>{category.name}</option>)}</select>
                  : bulkField === "active" ? <select value={bulkValue} onChange={(event) => setBulkValue(event.target.value)} required><option value="">Choose visibility</option><option value="true">Published</option><option value="false">Draft</option></select>
                    : <input aria-label="Bulk value" type="number" min="0" step={bulkField === "stockQuantity" ? "1" : "0.01"} value={bulkValue} onChange={(event) => setBulkValue(event.target.value)} placeholder={bulkField === "stockQuantity" ? "Quantity" : "Amount (₹)"} required />}
                <button type="submit" className="button button-dark" disabled={saving}>Apply changes</button><button type="button" className="studio-bulk-clear" onClick={() => setSelectedProducts([])}>Clear</button>
              </form>}
              <div className="admin-table-tools">
                <label className="admin-search"><Search size={16} /><input value={productQuery} onChange={(event) => setProductQuery(event.target.value)} placeholder="Search your catalog…" aria-label="Search products" /></label>
                <label className="admin-filter"><span className="visually-hidden">Filter products</span><select value={productFilter} onChange={(event) => setProductFilter(event.target.value)}><option value="all">All products</option><option value="active">Shop visible</option><option value="archived">Hidden / archived</option></select><ChevronDown size={14} /></label>
              </div>
              <div className="admin-table-wrap">
                <table className="admin-table">
                  <thead><tr><th><input type="checkbox" aria-label="Select all visible products" checked={allVisibleSelected} onChange={toggleAllProducts} /></th><th>PRODUCT</th><th>SKU / COLLECTION</th><th>PRICE</th><th>IN STOCK</th><th>STATUS</th><th>ACTIONS</th></tr></thead>
                  <tbody>{visibleProducts.map((product) => (
                    <tr key={product.id}>
                      <td><input type="checkbox" aria-label={`Select ${product.name}`} checked={selectedProducts.includes(product.id)} onChange={() => toggleProductSelection(product.id)} /></td>
                      <td><div className="studio-product-cell"><img src={photoUrl(product.imageId || product.image)} alt="" /><span><strong>{product.name}</strong><small>{product.badge || "—"}</small></span></div></td>
                      <td><span className="admin-order-number">{product.sku || "No SKU"}</span><span className="admin-cell-secondary">{categories.find((category) => category.id === product.categoryId)?.name || product.categoryId}</span><span className="admin-cell-secondary">{product.id}</span></td>
                      <td><strong>{money.format(product.salePrice ?? product.price)}</strong>{product.salePrice !== null && product.salePrice !== undefined && <span className="admin-cell-secondary"><s>{money.format(product.regularPrice)}</s></span>}<span className="admin-cell-secondary">{product.productType || "simple"}</span></td>
                      <td><span className={`studio-stock ${product.stockQuantity <= 5 ? "stock-low" : ""}`}>{product.stockQuantity === 0 ? "Out of stock" : `${product.stockQuantity} units`}</span></td>
                      <td><span className={`studio-pill ${product.active ? "pill-active" : "pill-hidden"}`}>{product.active ? "Visible" : "Hidden"}</span></td>
                      <td><div className="studio-row-actions"><button aria-label={`Edit ${product.name}`} title="Edit product and inventory" onClick={() => setProductEditor(product)}><Pencil size={15} /></button><button aria-label={`${product.active ? "Hide" : "Show"} ${product.name}`} title={product.active ? "Hide in storefront" : "Show in storefront"} onClick={() => setProductVisibility(product)}>{product.active ? <EyeOff size={15} /> : <Eye size={15} />}</button><button aria-label={`Delete ${product.name}`} title="Delete product" onClick={() => deleteProduct(product)}><Trash2 size={15} /></button></div></td>
                    </tr>
                  ))}{!visibleProducts.length && <tr><td className="admin-table-empty" colSpan="7">No products match your search.</td></tr>}</tbody>
                </table>
              </div>
              <p className="admin-table-footnote">Showing {visibleProducts.length} of {products.length} products. Update stock before you sell out.</p>
            </section>
          )}

          {activeTab === "categories" && (
            <section className="studio-section studio-content">
              <PanelHeading eyebrow="HOW YOUR SHOP IS ORGANIZED" title="Collections">
                <button className="button button-dark studio-add-button" onClick={() => setCategoryEditor(categoryEditor === null ? undefined : null)}><Plus size={15} /> Add collection</button>
              </PanelHeading>
              {categoryEditor !== undefined && <CollectionEditor category={categoryEditor} categories={categories} onSave={saveCategory} onCancel={() => setCategoryEditor(undefined)} saving={saving} />}
              <div className="studio-collection-grid">
                {categories.map((category) => (
                  <article className="studio-collection-card" key={category.id}>
                    <img src={category.image || photoUrl(category.imageId)} alt="" />
                    <div className="studio-collection-copy"><span className="footer-label">{category.parentId ? `SUBCATEGORY · ${categories.find((item) => item.id === category.parentId)?.name || ""}` : `${category.productCount} PRODUCTS`}</span><h3>{category.name}</h3><p>{category.description}</p><span className="studio-collection-id">{category.id}</span></div>
                    <div className="studio-row-actions"><button aria-label={`Edit ${category.name}`} title="Edit collection" onClick={() => setCategoryEditor(category)}><Pencil size={15} /></button>{category.productCount === 0 && <button aria-label={`Delete ${category.name}`} title="Delete empty collection" onClick={() => deleteCategory(category)}><Trash2 size={14} /></button>}</div>
                  </article>
                ))}
              </div>
              {!categories.length && <div className="admin-table-empty">No collections have been created yet.</div>}
            </section>
          )}

          {activeTab === "customers" && (
            <section className="studio-section studio-content">
              <PanelHeading eyebrow="THE PEOPLE WHO SHOP WITH YOU" title="Customers"><span className="studio-section-count">{customers.length} registered</span></PanelHeading>
              {admin.demo && <div className="studio-feature-note">Customer records appear here when MongoDB is connected and shoppers create accounts.</div>}
              <div className="admin-table-tools"><label className="admin-search"><Search size={16} /><input value={customerQuery} onChange={(event) => setCustomerQuery(event.target.value)} placeholder="Find a customer by name or email…" aria-label="Search customers" /></label></div>
              <div className="admin-table-wrap"><table className="admin-table">
                <thead><tr><th>CUSTOMER</th><th>JOINED</th><th>ORDERS</th><th>LIFETIME SPEND</th><th>LAST ORDER</th></tr></thead>
                <tbody>{visibleCustomers.map((customer) => <tr key={customer.id}><td><strong className="admin-customer-name">{customer.name}</strong><span className="admin-cell-secondary">{customer.email}</span></td><td>{new Date(customer.joinedAt).toLocaleDateString()}</td><td>{customer.orderCount}</td><td>{money.format(customer.lifetimeSpend)}</td><td>{customer.lastOrderAt ? new Date(customer.lastOrderAt).toLocaleDateString() : "No orders yet"}</td></tr>)}{!visibleCustomers.length && <tr><td className="admin-table-empty" colSpan="5">No customers found.</td></tr>}</tbody>
              </table></div>
            </section>
          )}
        </>
      )}
      <footer className="studio-footer">Zariya Studio · Secure store management</footer>
    </main>
  );
}
