import { useEffect, useState } from "react";
import {
  ArrowLeft, ArrowRight, BarChart3, Check, ChevronDown, CircleAlert, Eye, EyeOff,
  Layers3, LogIn, PackageCheck, PackagePlus, Pencil, Plus, RefreshCw, Search,
  ShieldCheck, ShoppingBag, UserRound, Users, Wallet
} from "lucide-react";

const currency = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0
});

function productImage(id) {
  return `https://images.unsplash.com/${id}?auto=format&fit=crop&w=160&q=80`;
}

async function requestJson(path, options) {
  const response = await fetch(path, options);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Something went wrong. Please try again.");
  return data;
}

function SiteLogo() {
  return <a className="wordmark" href="/">zariya<span>.</span><small>THE ART OF EVERYDAY</small></a>;
}

function PortalLayout({ eyebrow, title, description, icon, children }) {
  const Icon = icon;
  return (
    <main className="auth-page">
      <header className="auth-header">
        <SiteLogo />
        <a className="text-link" href="/"><ArrowLeft size={15} /> Back to the shop</a>
      </header>
      <div className="auth-layout">
        <section className="auth-story">
          <div className="auth-story-icon"><Icon size={23} /></div>
          <div className="eyebrow"><span className="eyebrow-line" /> {eyebrow}</div>
          <h1>{title}</h1>
          <p>{description}</p>
          <div className="auth-promise"><Check size={15} /> A little more lovely, every visit.</div>
        </section>
        <section className="auth-card">{children}</section>
      </div>
      <footer className="auth-footer">© 2025 Zariya · Made with feeling.</footer>
    </main>
  );
}

export function CustomerAccount() {
  const [account, setAccount] = useState(null);
  const [orders, setOrders] = useState([]);
  const [mode, setMode] = useState("login");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function loadOrders() {
    try {
      const data = await requestJson("/api/customer/orders");
      setOrders(data.orders);
    } catch (loadError) {
      setError(loadError.message);
    }
  }

  useEffect(() => {
    let active = true;
    requestJson("/api/auth/customer/me")
      .then((data) => {
        if (active) setAccount(data.account);
        return loadOrders();
      })
      .catch(() => {})
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, []);

  async function submit(event) {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    const form = Object.fromEntries(new FormData(event.currentTarget));
    try {
      const data = await requestJson(`/api/auth/customer/${mode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form)
      });
      setAccount(data.account);
      if (mode === "login") await loadOrders();
      else setOrders([]);
    } catch (submitError) {
      setError(submitError.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function signOut() {
    try {
      await requestJson("/api/auth/customer/logout", { method: "POST" });
      setAccount(null);
      setOrders([]);
      setError("");
    } catch (signOutError) {
      setError(signOutError.message);
    }
  }

  return (
    <PortalLayout
      eyebrow="YOUR LITTLE CORNER"
      title={account ? "Lovely to see you." : <>Your things.<br /><em>Your corner.</em></>}
      description={account
        ? `Signed in as ${account.email}. Find your recent orders and pick up where you left off.`
        : "Sign in to find your Zariya orders. New around here? Make a little account in a moment."}
      icon={UserRound}
    >
      {loading ? (
        <div className="portal-loading">Just a little moment…</div>
      ) : account ? (
        <div className="account-dashboard">
          <div className="portal-card-heading"><ShoppingBag size={19} /><div><span className="footer-label">YOUR ZARIYA ORDERS</span><h2>Order history</h2></div></div>
          {orders.length ? (
            <div className="customer-orders">
              {orders.map((order) => (
                <article className="customer-order" key={order.orderNumber}>
                  <div><strong>{order.orderNumber}</strong><span>{new Date(order.createdAt).toLocaleDateString()}</span></div>
                  <span>{order.items.reduce((count, item) => count + item.quantity, 0)} thoughtful find{order.items.reduce((count, item) => count + item.quantity, 0) === 1 ? "" : "s"}</span>
                  <div><span className={`order-status status-${order.status}`}>{order.status}</span><strong>{currency.format(order.total)}</strong></div>
                </article>
              ))}
            </div>
          ) : (
            <div className="account-empty"><PackageCheck size={24} /><span>Your order history will feel right at home here.</span></div>
          )}
          {error && <div className="auth-error" role="alert">{error}</div>}
          <button className="button button-outline auth-submit" onClick={signOut}>Sign out <ArrowRight size={15} /></button>
          <a className="account-shop-link" href="/">Find something lovely <ArrowRight size={14} /></a>
        </div>
      ) : (
        <>
          <div className="auth-card-heading">
            <h2>{mode === "login" ? "Welcome back." : "Let's make it yours."}</h2>
            <p>{mode === "login" ? "Your good things are right where you left them." : "A little account for your orders and all your good finds."}</p>
          </div>
          <form className="portal-form" onSubmit={submit}>
            {mode === "register" && <label>Your name<input name="name" autoComplete="name" minLength={1} maxLength={100} required /></label>}
            <label>Email address<input name="email" type="email" autoComplete="email" maxLength={200} required /></label>
            <label>Password<input name="password" type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} minLength={mode === "login" ? 1 : 12} maxLength={72} required />{mode === "register" && <span className="field-hint">Use at least 12 characters.</span>}</label>
            {error && <div className="auth-error" role="alert">{error}</div>}
            <button className="button button-dark auth-submit" type="submit" disabled={submitting}>
              {submitting ? "One little moment…" : mode === "login" ? "Sign in to your account" : "Create your account"} <ArrowRight size={15} />
            </button>
          </form>
          <div className="auth-switch">
            {mode === "login" ? "New to Zariya?" : "Already have an account?"}
            <button onClick={() => { setMode(mode === "login" ? "register" : "login"); setError(""); }}>
              {mode === "login" ? "Create an account" : "Sign in"}
            </button>
          </div>
        </>
      )}
    </PortalLayout>
  );
}

const orderStatuses = ["pending", "processing", "shipped", "completed", "cancelled"];
const paymentStatuses = ["unpaid", "paid", "refunded"];

function LegacyAdminPanel() {
  const [admin, setAdmin] = useState(null);
  const [orders, setOrders] = useState([]);
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function loadDashboard() {
    const [ordersData, productsData, categoryData] = await Promise.all([
      requestJson("/api/orders"),
      requestJson("/api/admin/products"),
      requestJson("/api/categories")
    ]);
    setOrders(ordersData.orders);
    setProducts(productsData.products);
    setCategories(categoryData.categories);
  }

  useEffect(() => {
    let active = true;
    requestJson("/api/auth/admin/me")
      .then((data) => {
        if (active) setAdmin(data.account);
        return loadDashboard();
      })
      .catch(() => {})
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, []);

  async function signIn(event) {
    event.preventDefault();
    setSubmitting(true);
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
      setSubmitting(false);
    }
  }

  async function signOut() {
    try {
      await requestJson("/api/auth/admin/logout", { method: "POST" });
      setAdmin(null);
      setOrders([]);
      setProducts([]);
      setNotice("");
    } catch (signOutError) {
      setError(signOutError.message);
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
      setNotice(`${orderNumber} updated.`);
    } catch (updateError) {
      setError(updateError.message);
    }
  }

  async function archiveProduct(product) {
    if (!window.confirm(`Archive “${product.name}”? It will no longer appear in the storefront.`)) return;
    setError("");
    setNotice("");
    try {
      await requestJson(`/api/products/${encodeURIComponent(product.id)}`, { method: "DELETE" });
      await loadDashboard();
      setNotice(`${product.name} was archived.`);
    } catch (archiveError) {
      setError(archiveError.message);
    }
  }

  async function createProduct(event) {
    event.preventDefault();
    const formElement = event.currentTarget;
    setError("");
    setNotice("");
    const form = Object.fromEntries(new FormData(formElement));
    const product = {
      ...form,
      price: Number(form.price),
      compareAt: form.compareAt ? Number(form.compareAt) : null
    };
    setSubmitting(true);
    try {
      await requestJson("/api/products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(product)
      });
      formElement.reset();
      await loadDashboard();
      setNotice("Your new product is in the collection.");
    } catch (createError) {
      setError(createError.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <PortalLayout
      eyebrow="ZARIYA STUDIO · PRIVATE ACCESS"
      title={admin ? "The things behind the scenes." : <>A separate door.<br /><em>For the studio.</em></>}
      description={admin
        ? `Signed in as ${admin.email}. Look after the orders and lovely things that make Zariya.`
        : "A private sign-in for the people who look after Zariya. Customer accounts use a different sign-in."}
      icon={ShieldCheck}
    >
      {loading ? (
        <div className="portal-loading">Opening the studio…</div>
      ) : admin ? (
        <div className="admin-dashboard">
          <div className="admin-welcome">
            <div><span className="footer-label">THE STUDIO</span><h2>Your shop, at a glance.</h2></div>
            <button className="text-link" onClick={signOut}>Sign out <ArrowRight size={14} /></button>
          </div>
          {(error || notice) && <div className={error ? "auth-error" : "auth-notice"} role={error ? "alert" : "status"}>{error || notice}</div>}
          {admin.demo && <div className="auth-notice">Automatic local sign-in is on. Demo changes are not saved; connect MongoDB to use real orders, accounts, and product management.</div>}
          <div className="admin-stats"><div><span>ACTIVE FINDS</span><strong>{products.filter((product) => product.active).length}</strong></div><div><span>RECENT ORDERS</span><strong>{orders.length}</strong></div><div><span>WAITING FOR YOU</span><strong>{orders.filter((order) => order.status === "pending").length}</strong></div></div>
          <section className="admin-section">
            <div className="admin-section-title"><div><span className="footer-label">THE GOOD THINGS GOING OUT</span><h3>Recent orders</h3></div><button className="text-link" onClick={() => loadDashboard().catch((loadError) => setError(loadError.message))}>Refresh <ArrowRight size={14} /></button></div>
            {orders.length ? (
              <div className="admin-orders">
                {orders.map((order) => (
                  <article className="admin-order" key={order.orderNumber}>
                    <div className="admin-order-heading"><strong>{order.orderNumber}</strong><span>{new Date(order.createdAt).toLocaleDateString()}</span><strong>{currency.format(order.total)}</strong></div>
                    <p>{order.customer.name} · {order.customer.email}</p>
                    <div className="admin-order-items">{order.items.map((item) => `${item.quantity} × ${item.name}`).join(" · ")}</div>
                    <div className="admin-order-controls">
                      <label>Order <span className="visually-hidden">status</span><span className="select-wrap"><select value={order.status} onChange={(event) => updateOrder(order.orderNumber, "status", event.target.value)}>{orderStatuses.map((status) => <option key={status} value={status}>{status}</option>)}</select><ChevronDown size={13} /></span></label>
                      <label>Payment <span className="visually-hidden">status</span><span className="select-wrap"><select value={order.paymentStatus} onChange={(event) => updateOrder(order.orderNumber, "paymentStatus", event.target.value)}>{paymentStatuses.map((status) => <option key={status} value={status}>{status}</option>)}</select><ChevronDown size={13} /></span></label>
                    </div>
                  </article>
                ))}
              </div>
            ) : <p className="admin-muted">No orders yet. New orders will find their way here.</p>}
          </section>
          <section className="admin-section">
            <div className="admin-section-title"><div><span className="footer-label">THE SHOP FLOOR</span><h3>Products</h3></div></div>
            {!admin.demo && <form className="portal-form admin-product-form" onSubmit={createProduct}>
              <h4>Add a thoughtful find</h4>
              <label>Product name<input name="name" maxLength={160} required /></label>
              <label>Collection<select name="categoryId" required defaultValue=""><option value="" disabled>Choose a category</option>{categories.map((category) => <option value={category.id} key={category.id}>{category.name}</option>)}</select></label>
              <div className="admin-form-row"><label>Price (₹)<input name="price" type="number" min="0" step="1" required /></label><label>Compare-at price (₹)<input name="compareAt" type="number" min="0" step="1" /></label></div>
              <label>Unsplash photo ID<input name="image" placeholder="photo-1234567890" pattern="photo-[a-zA-Z0-9-]{6,100}" title="Enter a valid Unsplash photo ID, starting with photo-" required /></label>
              <label>Short description<textarea name="description" maxLength={2000} rows={2} /></label>
              <label>Small badge<input name="badge" maxLength={50} placeholder="New arrival" /></label>
              <button className="button button-dark auth-submit" type="submit" disabled={submitting}>Add to the collection <ArrowRight size={15} /></button>
            </form>}
            <div className="admin-products">
              {products.map((product) => (
                <article className={`admin-product ${!product.active ? "is-archived" : ""}`} key={product.id}>
                  <img src={productImage(product.image)} alt="" />
                  <div><span className="product-category-label">{categories.find((item) => item.id === product.categoryId)?.name || product.categoryId}</span><strong>{product.name}</strong><span>{currency.format(product.price)} · {product.active ? "Active" : "Archived"}</span></div>
                  {product.active && !admin.demo && <button className="text-link" onClick={() => archiveProduct(product)}>Archive</button>}
                </article>
              ))}
            </div>
          </section>
        </div>
      ) : (
        <>
          <div className="auth-card-heading"><h2>Administrator sign in</h2><p>Only configured Zariya studio administrators can get in.</p></div>
          <form className="portal-form" onSubmit={signIn}>
            <label>Administrator email<input name="email" type="email" autoComplete="username" maxLength={200} required /></label>
            <label>Password<input name="password" type="password" autoComplete="current-password" maxLength={72} required /></label>
            {error && <div className="auth-error" role="alert">{error}</div>}
            <button className="button button-dark auth-submit" type="submit" disabled={submitting}>{submitting ? "Checking your details…" : "Sign in to the studio"} <LogIn size={15} /></button>
          </form>
          <div className="admin-secure-note"><ShieldCheck size={15} /> Private admin access. Customer sign-in is completely separate.</div>
        </>
      )}
    </PortalLayout>
  );
}

export { AdminPanel } from "./Admin.jsx";
