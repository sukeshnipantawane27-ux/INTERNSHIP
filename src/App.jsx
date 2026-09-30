import { useEffect, useMemo, useState } from "react";
import {
  ArrowDown, ArrowLeft, ArrowRight, ArrowUpRight, Check, ChevronDown, Heart,
  Instagram, Menu, Minus, Plus, Search, ShoppingBag, Sparkles, Truck, UserRound, X
} from "lucide-react";
import { AdminPanel, CustomerAccount } from "./Auth.jsx";
import sampleCatalog from "../shared/catalog.json";

const catalogPreview = import.meta.env.VITE_CATALOG_PREVIEW === "true";
const previewCategories = sampleCatalog.categories.map((category) => ({
  ...category,
  parentId: null,
  image: imageUrl(category.image, 640)
}));
const previewProducts = sampleCatalog.products.map((product) => {
  const regularPrice = product.regularPrice ?? product.compareAt ?? product.price;
  const salePrice = product.salePrice ?? (product.compareAt && product.price < product.compareAt ? product.price : null);
  return {
    ...product,
    regularPrice,
    salePrice,
    price: salePrice ?? product.price,
    stockQuantity: product.stockQuantity ?? 12,
    stockStatus: product.stockStatus ?? "instock",
    productType: product.productType ?? "simple",
    gallery: (product.gallery ?? []).map((image) => imageUrl(image)),
    image: imageUrl(product.image)
  };
});

const money = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0
});

function readSavedBag() {
  try {
    const saved = JSON.parse(localStorage.getItem("zariya-bag") || "[]");
    return Array.isArray(saved) ? saved : [];
  } catch {
    return [];
  }
}

function imageUrl(id, width = 900) {
  return `https://images.unsplash.com/${id}?auto=format&fit=crop&w=${width}&q=85`;
}

function ProductCard({ product, categories, onAdd, onBuyNow, onOpen, isFavorite, onFavorite }) {
  const category = categories.find((item) => item.id === (product.subcategoryId || product.categoryId));
  const unavailable = !["grouped", "virtual"].includes(product.productType) && product.stockStatus === "outofstock";
  return (
    <article className="product-card">
      <button
        className="product-image-button"
        onClick={() => onOpen(product)}
        aria-label={`View ${product.name}`}
      >
        <img src={product.image} alt={product.name} loading="lazy" />
        {product.badge && <span className="product-badge">{product.badge}</span>}
        <span className="quick-view">Discover <ArrowUpRight size={14} /></span>
      </button>
      <button
        className={`favorite-button ${isFavorite ? "is-favorite" : ""}`}
        onClick={() => onFavorite(product.id)}
        aria-label={isFavorite ? `Remove ${product.name} from saved items` : `Save ${product.name}`}
      >
        <Heart size={17} fill={isFavorite ? "currentColor" : "none"} />
      </button>
      <div className="product-category-label">{category?.name}</div>
      <div className="product-meta">
        <button className="product-name" onClick={() => onOpen(product)}>{product.name}</button>
        <strong>{product.productType === "grouped" ? "Curated group" : money.format(product.price)}</strong>
        {product.compareAt > product.price && <small className="product-compare-price">{money.format(product.compareAt)}</small>}
      </div>
      <div className="product-purchase-actions">
        <button className="add-to-bag" disabled={unavailable} onClick={() => onAdd(product)}>{unavailable ? "Currently unavailable" : "Add to bag"} {!unavailable && <Plus size={15} />}</button>
        <button className="buy-now-button" disabled={unavailable} onClick={() => onBuyNow(product)}>{unavailable ? "Out of stock" : "Buy now"} {!unavailable && <ArrowRight size={14} />}</button>
      </div>
    </article>
  );
}

function Storefront() {
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [bag, setBag] = useState(readSavedBag);
  const [favorites, setFavorites] = useState([]);
  const [selectedCategory, setSelectedCategory] = useState(null);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("featured");
  const [bagOpen, setBagOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [selectedVariantSku, setSelectedVariantSku] = useState("");
  const [selectedImage, setSelectedImage] = useState(null);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [checkoutItems, setCheckoutItems] = useState(null);
  const [order, setOrder] = useState(null);
  const [toast, setToast] = useState("");
  const [subscribed, setSubscribed] = useState(false);
  const [newsletterError, setNewsletterError] = useState("");
  const [newsletterLoading, setNewsletterLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [catalogError, setCatalogError] = useState("");
  const [customerAccount, setCustomerAccount] = useState(null);

  useEffect(() => {
    if (catalogPreview) {
      setProducts(previewProducts);
      setCategories(previewCategories);
      setLoading(false);
      return undefined;
    }
    let active = true;
    Promise.all([
      fetch("/api/products?limit=60").then((response) => {
        if (!response.ok) throw new Error("Products could not be loaded.");
        return response.json();
      }),
      fetch("/api/categories").then((response) => {
        if (!response.ok) throw new Error("Collections could not be loaded.");
        return response.json();
      })
    ])
      .then(([productData, categoryData]) => {
        if (!active) return;
        setProducts(productData.products);
        setCategories(categoryData.categories);
      })
      .catch((error) => active && setCatalogError(error.message))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (catalogPreview) return undefined;
    fetch("/api/auth/customer/me")
      .then((response) => response.ok ? response.json() : null)
      .then((data) => data && setCustomerAccount(data.account))
      .catch(() => {});
  }, []);

  useEffect(() => {
    localStorage.setItem("zariya-bag", JSON.stringify(bag));
  }, [bag]);

  useEffect(() => {
    if (!toast) return undefined;
    const timeout = window.setTimeout(() => setToast(""), 2600);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  const filteredProducts = useMemo(() => {
    const term = search.trim().toLowerCase();
    const result = products.filter((product) =>
      (!selectedCategory || product.categoryId === selectedCategory) &&
      (!term || `${product.name} ${product.description} ${product.categoryId}`.toLowerCase().includes(term))
    );
    if (sort === "price-asc") result.sort((a, b) => a.price - b.price);
    if (sort === "price-desc") result.sort((a, b) => b.price - a.price);
    if (sort === "name") result.sort((a, b) => a.name.localeCompare(b.name));
    return result;
  }, [products, search, selectedCategory, sort]);

  const selectedCategoryInfo = categories.find((category) => category.id === selectedCategory);
  const bagCount = bag.reduce((sum, item) => sum + item.quantity, 0);
  const checkoutBag = checkoutItems ?? bag;
  const checkoutCount = checkoutBag.reduce((sum, item) => sum + item.quantity, 0);
  const subtotal = checkoutBag.reduce((sum, item) => sum + item.product.price * item.quantity, 0);
  const shipping = subtotal >= 7500 || subtotal === 0 || checkoutBag.every(({ product }) => product.virtual) ? 0 : 250;
  const visibleProducts = search || selectedCategory ? filteredProducts : products;

  function navigateToCollection(categoryId = null) {
    setSelectedCategory(categoryId);
    setSearch("");
    setMobileMenuOpen(false);
    document.getElementById("collection")?.scrollIntoView({ behavior: "smooth" });
  }

  function addToBag(product) {
    if (product.productType === "variable" || product.productType === "grouped") {
      setSelectedVariantSku("");
      setSelectedImage(null);
      setSelectedProduct(product);
      return;
    }
    setBag((current) => addProductToBag(current, product));
    setToast(`${product.name} added to your bag`);
  }

  function buyNow(product) {
    if (product.productType === "variable" || product.productType === "grouped") {
      setSelectedVariantSku("");
      setSelectedImage(null);
      setSelectedProduct(product);
      return;
    }
    setCheckoutItems([{ product, quantity: 1 }]);
    setSelectedProduct(null);
    setBagOpen(true);
    setCheckoutOpen(true);
  }

  function updateQuantity(productId, sku, amount) {
    const lineKey = (item) => `${item.product.id}:${item.product.sku || ""}`;
    const targetKey = `${productId}:${sku || ""}`;
    setBag((current) => current
      .map((item) => lineKey(item) === targetKey
        ? { ...item, quantity: item.quantity + amount }
        : item)
      .filter((item) => item.quantity > 0));
  }

  function toggleFavorite(productId) {
    setFavorites((current) => current.includes(productId)
      ? current.filter((id) => id !== productId)
      : [...current, productId]);
  }

  async function submitOrder(event) {
    event.preventDefault();
    if (catalogPreview) {
      setToast("This preview is for browsing only; ordering is not enabled.");
      return;
    }
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customer: Object.fromEntries(form.entries()),
          items: checkoutBag.map(({ product, quantity }) => ({
            productId: product.id,
            sku: product.sku || "",
            variationAttributes: product.variationAttributes || {},
            quantity
          }))
        })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Your order could not be placed.");
      setOrder(data.order);
      if (checkoutItems === null) setBag([]);
      setCheckoutItems(null);
      setCheckoutOpen(false);
    } catch (error) {
      setToast(error.message);
    }
  }

  async function submitNewsletter(event) {
    event.preventDefault();
    if (catalogPreview) return;
    const email = new FormData(event.currentTarget).get("email");
    setNewsletterLoading(true);
    setNewsletterError("");
    try {
      const response = await fetch("/api/newsletter", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Your sign-up could not be saved.");
      setSubscribed(true);
    } catch (error) {
      setNewsletterError(error.message);
    } finally {
      setNewsletterLoading(false);
    }
  }

  return (
    <>
      {catalogPreview && <div className="preview-mode-banner">CATALOG PREVIEW · Browsing only — checkout, accounts, newsletter and admin tools are not connected.</div>}
      <div className="announcement">
        <Sparkles size={13} />
        <span>A little luxury, delivered with love.</span>
        <span className="announcement-dot">·</span>
        <span>Complimentary shipping over ₹7,500</span>
      </div>

      <header className="site-header">
        <div className="header-inner">
          <button className="mobile-menu-toggle icon-button" onClick={() => setMobileMenuOpen((value) => !value)} aria-label="Open menu">
            {mobileMenuOpen ? <X size={21} /> : <Menu size={21} />}
          </button>
          <a className="wordmark" href="#" onClick={() => { setSelectedCategory(null); setSearch(""); }}>
            zariya<span>.</span>
            <small>THE ART OF EVERYDAY</small>
          </a>
          <nav className={`main-nav ${mobileMenuOpen ? "mobile-open" : ""}`} aria-label="Main navigation">
            <button onClick={() => navigateToCollection(null)}>Shop all</button>
            {categories.filter((category) => !category.parentId).slice(0, 4).map((category) => (
              <button key={category.id} onClick={() => navigateToCollection(category.id)}>{category.name}</button>
            ))}
            <button onClick={() => navigateToCollection("gifting")}>Gifts</button>
          </nav>
          <div className="header-actions">
            <label className="header-search">
              <Search size={17} />
              <input
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setSelectedCategory(null);
                }}
                onFocus={() => document.getElementById("collection")?.scrollIntoView({ behavior: "smooth" })}
                placeholder="Find something lovely"
                aria-label="Search products"
              />
            </label>
            {!catalogPreview && <a className="account-trigger" href="/account" aria-label={customerAccount ? `Your account, ${customerAccount.name}` : "Customer sign in"}>
              <UserRound size={18} /><span>{customerAccount ? "Account" : "Sign in"}</span>
            </a>}
            <button className="bag-trigger" onClick={() => setBagOpen(true)} aria-label={`Shopping bag, ${bagCount} items`}>
              <ShoppingBag size={19} />
              <span>Bag</span>
              <span className="bag-count">{bagCount}</span>
            </button>
          </div>
        </div>
      </header>

      <main>
        <section className="hero">
          <div className="hero-copy">
            <div className="eyebrow"><span className="eyebrow-line" /> A MORE CONSIDERED COLLECTION</div>
            <h1>Find your<br /><em>kind</em> of lovely.</h1>
            <p>Beautifully useful things, thoughtfully found. Made for your home, your rituals, and every little moment in between.</p>
            <button className="button button-dark" onClick={() => navigateToCollection(null)}>
              Discover the collection <ArrowRight size={16} />
            </button>
            <div className="hero-footnote"><ArrowDown size={13} /> GOOD THINGS, JUST A LITTLE FURTHER DOWN</div>
          </div>
          <div className="hero-visual">
            <img src={imageUrl("photo-1616486338812-3dadae4b4ace", 1500)} alt="Sunlit, thoughtfully styled living room with warm natural textures" />
            <div className="hero-image-caption">
              <span>THE SLOW LIVING EDIT</span>
              <span>01 / 03</span>
            </div>
            <div className="hero-stamp">
              <span>GOOD THINGS</span><Sparkles size={18} /><span>FOUND HERE</span>
            </div>
            <div className="hero-card">
              <div className="hero-card-label">THE LITTLE THINGS THAT FEEL LIKE A LOT</div>
              <span>Made with feeling.<br /><em>Found with you.</em></span>
              <button onClick={() => navigateToCollection("home-living")} aria-label="Shop home and living"><ArrowUpRight size={17} /></button>
            </div>
          </div>
        </section>

        <section className="promise-strip" aria-label="Our promises">
          <div><Sparkles size={18} /><span>Only the lovely things</span><i>·</i></div>
          <div><Truck size={19} /><span>Free delivery over ₹7,500</span><i>·</i></div>
          <div><Heart size={18} /><span>A little love in every order</span></div>
        </section>

        <section className="category-section">
          <div className="section-heading category-heading">
            <div>
              <div className="eyebrow"><span className="eyebrow-line" /> A LITTLE SOMETHING FOR EVERYONE</div>
              <h2>Find your little corner.</h2>
              <p>Fifteen thoughtful edits. Thirty very good reasons to stay a while.</p>
            </div>
            <button className="text-link" onClick={() => navigateToCollection(null)}>Explore everything <ArrowRight size={15} /></button>
          </div>
          <div className="category-grid">
            {categories.filter((category) => !category.parentId).map((category, index) => (
              <button
                key={category.id}
                className={`category-card category-card-${index % 5}`}
                onClick={() => navigateToCollection(category.id)}
              >
                <img src={category.image} alt="" loading="lazy" />
                <span className="category-card-overlay" />
                <span className="category-card-number">{String(index + 1).padStart(2, "0")}</span>
                <span className="category-card-title">{category.name}<ArrowUpRight size={16} /></span>
                <span className="category-product-count">2 THOUGHTFUL FINDS</span>
              </button>
            ))}
          </div>
        </section>

        <section className="section products-section" id="collection">
          <div className="section-heading">
            <div>
              <div className="eyebrow"><span className="eyebrow-line" /> {selectedCategoryInfo ? "A LITTLE SOMETHING FOR YOU" : "THOUGHTFULLY FOUND"}</div>
              <h2>{search ? "A lovely little find." : selectedCategoryInfo?.name || "The things we <3 lately."}</h2>
              <p>{search ? `A few good matches for “${search}”.` : selectedCategoryInfo?.description || "A few favorites, picked with feeling. Yours to find."}</p>
            </div>
            <div className="section-controls">
              <label className="sort-control">
                <span className="visually-hidden">Sort products</span>
                <select value={sort} onChange={(event) => setSort(event.target.value)}>
                  <option value="featured">Featured</option>
                  <option value="price-asc">Price: low to high</option>
                  <option value="price-desc">Price: high to low</option>
                  <option value="name">Name: A to Z</option>
                </select>
                <ChevronDown size={15} />
              </label>
              {(selectedCategory || search) && <button className="text-link" onClick={() => { setSelectedCategory(null); setSearch(""); }}>Clear filters <X size={14} /></button>}
            </div>
          </div>

          {catalogError && <div className="catalog-message">{catalogError} Try refreshing the page.</div>}
          {loading ? (
            <div className="loading-state"><span className="loading-spinner" /> Finding lovely things for you…</div>
          ) : visibleProducts.length ? (
            <div className="product-grid">
              {visibleProducts.map((product) => (
                <ProductCard
                  key={product.id}
                  product={product}
                  categories={categories}
                  onAdd={addToBag}
                  onBuyNow={buyNow}
                  onOpen={(product) => { setSelectedProduct(product); setSelectedImage(null); setSelectedVariantSku(""); }}
                  isFavorite={favorites.includes(product.id)}
                  onFavorite={toggleFavorite}
                />
              ))}
            </div>
          ) : (
            <div className="empty-state"><Sparkles size={24} /><h3>Nothing here just yet.</h3><p>Try another search or explore all our lovely finds.</p><button className="text-link" onClick={() => { setSelectedCategory(null); setSearch(""); }}>Browse everything <ArrowRight size={15} /></button></div>
          )}
          {!search && !selectedCategory && <button className="button button-outline view-all-button" onClick={() => navigateToCollection(null)}>Find your next favorite <ArrowRight size={16} /></button>}
        </section>

        <section className="story-banner">
          <img src={imageUrl("photo-1600210492486-724fe5c67fb0", 1500)} alt="Considered everyday pieces arranged in a light-filled space" loading="lazy" />
          <div className="story-overlay" />
          <div className="story-content">
            <div className="eyebrow"><span className="eyebrow-line" /> LESS, BUT A LITTLE LOVELIER</div>
            <h2>Not more things.<br /><em>More feeling.</em></h2>
            <p>We believe the best things aren't just bought. They're found, kept close, and loved for a long, long time.</p>
            <button className="button button-light" onClick={() => navigateToCollection("home-living")}>A little about our edit <ArrowRight size={16} /></button>
          </div>
          <div className="story-note">THOUGHTFULLY PICKED · ALWAYS KEPT PERSONAL</div>
        </section>

        <section className="newsletter-section">
          <div className="newsletter-deco">z.</div>
          <div className="eyebrow"><span className="eyebrow-line" /> A LETTER, NOW AND THEN</div>
          <h2>A little lovely<br /><em>in your inbox.</em></h2>
          <p>First looks, thoughtful notes, and a little treat for signing up.</p>
          {catalogPreview ? (
            <div className="preview-newsletter-note">Newsletter sign-up will be available when the store is connected.</div>
          ) : subscribed ? (
            <div className="subscribe-success"><Check size={17} /> You're on the list. Look out for something lovely.</div>
          ) : (
            <>
            <form className="newsletter-form" onSubmit={submitNewsletter}>
              <label className="visually-hidden" htmlFor="newsletter-email">Your email address</label>
              <input id="newsletter-email" name="email" type="email" required placeholder="Your email address" />
              <button type="submit" aria-label="Subscribe to newsletter" disabled={newsletterLoading}><ArrowRight size={18} /></button>
            </form>
            {newsletterError && <span className="newsletter-error" role="alert">{newsletterError}</span>}
            </>
          )}
          <span className="newsletter-small">No noise, just nice things. Unsubscribe whenever.</span>
        </section>
      </main>

      <footer className="site-footer">
        <div className="footer-main">
          <div className="footer-brand">
            <a className="wordmark footer-wordmark" href="#">zariya<span>.</span><small>THE ART OF EVERYDAY</small></a>
            <p>Good things, found with feeling.<br />And always a little something extra.</p>
            <a className="social-link" href="https://www.instagram.com/" target="_blank" rel="noreferrer"><Instagram size={17} /> A little more on Instagram</a>
          </div>
          <div className="footer-links">
            <div><span className="footer-label">FIND YOUR THING</span><button onClick={() => navigateToCollection(null)}>Shop everything</button><button onClick={() => navigateToCollection("gifting")}>Gifts with feeling</button><button onClick={() => navigateToCollection("home-living")}>The home edit</button></div>
            <div><span className="footer-label">A LITTLE HELP</span><a href="mailto:hello@zariya.example">Say hello</a><span>Thoughtful delivery</span><span>Returns, made easy</span></div>
            <div><span className="footer-label">THE ZARIYA STUDIO</span><a href="/admin">Admin sign in</a></div>
          </div>
        </div>
        <div className="footer-bottom"><span>© 2025 Zariya. Made with feeling.</span><span>Made to be found. Made to be kept.</span><span>India · INR ₹</span></div>
      </footer>

      {toast && <div className="toast" role="status"><Check size={16} />{toast}</div>}

      {bagOpen && (
        <>
          <button className="drawer-scrim" onClick={() => { setBagOpen(false); setCheckoutOpen(false); setCheckoutItems(null); }} aria-label="Close bag" />
          <aside className="bag-drawer" aria-label={checkoutItems ? "Buy now checkout" : "Your shopping bag"}>
            <div className="drawer-heading">
              <div><span className="eyebrow"><span className="eyebrow-line" /> {checkoutItems ? "A VERY GOOD CHOICE" : "THE GOOD THINGS YOU FOUND"}</span><h2>{checkoutItems ? "Buy now" : "Your bag"} <span>({checkoutCount})</span></h2></div>
              <button className="icon-button" onClick={() => { setBagOpen(false); setCheckoutOpen(false); setCheckoutItems(null); }} aria-label="Close bag"><X size={21} /></button>
            </div>
            {checkoutBag.length === 0 ? (
              <div className="bag-empty"><ShoppingBag size={31} /><h3>Nothing in your bag, just yet.</h3><p>There are lovely things waiting to be found.</p><button className="button button-dark" onClick={() => setBagOpen(false)}>Have a little look <ArrowRight size={15} /></button></div>
            ) : (
              <>
                {!checkoutOpen ? (
                  <>
                    <div className="shipping-progress">
                      <p>{subtotal >= 7500 ? "Your delivery is on us. How lovely." : `You're ${money.format(7500 - subtotal)} away from complimentary delivery.`}</p>
                      <div><span style={{ width: `${Math.min(100, (subtotal / 7500) * 100)}%` }} /></div>
                    </div>
                    <div className="bag-items">
                      {checkoutBag.map(({ product, quantity }) => (
                        <div className="bag-item" key={`${product.id}-${product.sku || ""}`}>
                          <img src={product.image} alt="" />
                          <div className="bag-item-details"><span className="bag-product-name">{product.name}</span>{product.variationAttributes && <small>{Object.entries(product.variationAttributes).map(([name, value]) => `${name}: ${value}`).join(" · ")}</small>}<strong>{money.format(product.price)}</strong><div className="quantity-stepper"><button onClick={() => updateQuantity(product.id, product.sku, -1)} aria-label="Remove one"><Minus size={13} /></button><span>{quantity}</span><button onClick={() => updateQuantity(product.id, product.sku, 1)} aria-label="Add one"><Plus size={13} /></button></div></div>
                          <button className="remove-item" onClick={() => updateQuantity(product.id, product.sku, -quantity)} aria-label={`Remove ${product.name}`}><X size={16} /></button>
                        </div>
                      ))}
                    </div>
                    <div className="bag-summary"><div><span>Subtotal</span><span>{money.format(subtotal)}</span></div><div><span>Delivery</span><span>{shipping === 0 ? "On us" : money.format(shipping)}</span></div><div className="bag-total"><span>Total</span><strong>{money.format(subtotal + shipping)}</strong></div><small>Delivery calculated before your order is placed.</small></div>
                    {catalogPreview
                      ? <button className="button button-dark checkout-button" disabled>Checkout unavailable in preview</button>
                      : <button className="button button-dark checkout-button" onClick={() => setCheckoutOpen(true)}>A few details, then it's yours <ArrowRight size={16} /></button>}
                  </>
                ) : (
                  catalogPreview ? (
                    <div className="checkout-panel preview-checkout-note">
                      <button className="text-link checkout-back" onClick={() => { setCheckoutOpen(false); setCheckoutItems(null); }}><ArrowLeft size={14} /> Back to browsing</button>
                      <h3>Thanks for exploring Zariya.</h3>
                      <p>This public catalog preview does not accept orders. The live store needs its cloud database and checkout service connected.</p>
                    </div>
                  ) : (
                  <div className="checkout-panel">
                    <button className="text-link checkout-back" onClick={() => { setCheckoutOpen(false); setCheckoutItems(null); }}><ArrowLeft size={14} /> Back to your bag</button>
                    <h3>Where shall we send it?</h3>
                    <p>Your good things are almost on their way.</p>
                    <div className="checkout-review">
                    {checkoutBag.map(({ product, quantity }) => (
                      <div key={`${product.id}-${product.sku || ""}`}><img src={product.image} alt="" /><span>{quantity} × {product.name}{product.variationAttributes && <small>{Object.entries(product.variationAttributes).map(([name, value]) => `${name}: ${value}`).join(" · ")}</small>}</span><strong>{money.format(product.price * quantity)}</strong></div>
                    ))}
                    <div className="checkout-review-shipping"><span>Delivery</span><span>{shipping === 0 ? "On us" : money.format(shipping)}</span></div>
                    </div>
                    <form className="checkout-form" onSubmit={submitOrder}>
                      <label>Your name<input name="name" autoComplete="name" defaultValue={customerAccount?.name || ""} required maxLength={100} /></label>
                      <label>Email address<input name="email" type="email" autoComplete="email" defaultValue={customerAccount?.email || ""} required maxLength={200} /></label>
                      <label>Phone number<input name="phone" type="tel" autoComplete="tel" required maxLength={30} /></label>
                      <label>Delivery address<textarea name="address" autoComplete="street-address" required maxLength={500} rows={3} /></label>
                      <div className="checkout-total"><span>Total</span><strong>{money.format(subtotal + shipping)}</strong></div>
                      <button className="button button-dark checkout-button" type="submit">Place your order <ArrowRight size={16} /></button>
                      <span className="checkout-note">Your order will be placed as pending. Payment is arranged separately.</span>
                    </form>
                  </div>
                  )
                )}
              </>
            )}
          </aside>
        </>
      )}

      {selectedProduct && (
        <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setSelectedProduct(null)}>
          <section className="product-modal" role="dialog" aria-modal="true" aria-label={selectedProduct.name}>
            <button className="modal-close icon-button" onClick={() => setSelectedProduct(null)} aria-label="Close product"><X size={20} /></button>
            <div className="product-modal-gallery">
              <img src={selectedImage || selectedProduct.image} alt={selectedProduct.name} />
              {selectedProduct.gallery?.length > 0 && <div className="product-modal-thumbnails">{[selectedProduct.image, ...selectedProduct.gallery].map((image, index) => <button type="button" key={`${image}-${index}`} className={(selectedImage || selectedProduct.image) === image ? "is-selected" : ""} onClick={() => setSelectedImage(image)} aria-label={`View product image ${index + 1}`}><img src={image} alt="" /></button>)}</div>}
            </div>
            <div className="modal-product-copy">
              <div className="eyebrow"><span className="eyebrow-line" /> {categories.find((item) => item.id === (selectedProduct.subcategoryId || selectedProduct.categoryId))?.name}</div>
              <h2>{selectedProduct.name}</h2>
              {selectedProduct.productType !== "grouped" && <strong className="modal-price">{money.format(selectedProduct.productType === "variable" ? (selectedProduct.variations.find((variation) => variation.sku === selectedVariantSku)?.salePrice ?? selectedProduct.variations.find((variation) => variation.sku === selectedVariantSku)?.regularPrice ?? selectedProduct.price) : selectedProduct.price)}</strong>}
              <p>{selectedProduct.shortDescription || selectedProduct.description}</p>
              {selectedProduct.sku && <span className="modal-product-sku">SKU · {selectedProduct.sku}</span>}
              {selectedProduct.attributes?.length > 0 && <div className="modal-product-attributes">{selectedProduct.attributes.map((attribute) => <span key={attribute.name}><strong>{attribute.name}</strong> {attribute.values.join(" · ")}</span>)}</div>}
              {selectedProduct.productType === "grouped" && <div className="grouped-product-list"><span className="footer-label">THE PIECES IN THIS EDIT</span>{(selectedProduct.groupedProductIds || []).map((id) => products.find((product) => product.id === id)).filter(Boolean).map((product) => <article key={product.id}><img src={product.image} alt="" /><span><strong>{product.name}</strong><small>{product.sku || product.id} · {money.format(product.price)}</small></span><button disabled={product.stockStatus === "outofstock"} onClick={() => addToBag(product)}>Add</button><button disabled={product.stockStatus === "outofstock"} onClick={() => buyNow(product)}>Buy</button></article>)}{!selectedProduct.groupedProductIds?.length && <p>Add linked products in your store dashboard to complete this group.</p>}</div>}
              {selectedProduct.productType === "variable" && <label className="product-variant-picker">Choose an option<select value={selectedVariantSku} onChange={(event) => setSelectedVariantSku(event.target.value)}><option value="">Select a variation</option>{(selectedProduct.variations || []).map((variation, index) => <option disabled={(variation.stockQuantity ?? 0) <= 0 && selectedProduct.manageStock !== false && selectedProduct.stockStatus !== "onbackorder"} value={variation.sku || `variant-${index}`} key={`${variation.sku || index}`}>{Object.entries(variation.attributes || {}).map(([name, value]) => `${name}: ${value}`).join(" · ") || variation.sku} · {money.format(variation.salePrice ?? variation.regularPrice ?? selectedProduct.price)}</option>)}</select></label>}
              <div className="modal-note"><Check size={15} /> Thoughtfully picked. Made to be kept.</div>
              {selectedProduct.productType !== "grouped" && <div className="modal-purchase-actions">
                <button className="button button-outline" disabled={selectedProduct.productType === "variable" && !selectedVariantSku} onClick={() => { const variation = selectedProduct.variations?.find((item, index) => (item.sku || `variant-${index}`) === selectedVariantSku); const product = variation ? { ...selectedProduct, sku: variation.sku, variationAttributes: variation.attributes, price: variation.salePrice ?? variation.regularPrice ?? selectedProduct.price, stockQuantity: variation.stockQuantity } : selectedProduct; setBag((current) => addProductToBag(current, product)); setSelectedProduct(null); setToast(`${product.name} added to your bag`); }}>Add to your bag <Plus size={16} /></button>
                <button className="button button-dark" disabled={selectedProduct.productType === "variable" && !selectedVariantSku} onClick={() => { const variation = selectedProduct.variations?.find((item, index) => (item.sku || `variant-${index}`) === selectedVariantSku); const product = variation ? { ...selectedProduct, sku: variation.sku, variationAttributes: variation.attributes, price: variation.salePrice ?? variation.regularPrice ?? selectedProduct.price, stockQuantity: variation.stockQuantity } : selectedProduct; setCheckoutItems([{ product, quantity: 1 }]); setSelectedProduct(null); setBagOpen(true); setCheckoutOpen(true); }}>Buy now <ArrowRight size={16} /></button>
              </div>}
            </div>
          </section>
        </div>
      )}

      {order && (
        <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setOrder(null)}>
          <section className="order-success" role="dialog" aria-modal="true" aria-label="Order confirmation">
            <div className="success-icon"><Check size={25} /></div>
            <div className="eyebrow"><span className="eyebrow-line" /> SOMETHING LOVELY IS ON ITS WAY</div>
            <h2>It's a little more lovely now.</h2>
            <p>Your order <strong>{order.orderNumber}</strong> is confirmed as pending. We'll be in touch about your next steps.</p>
            <div className="success-total"><span>Order total</span><strong>{money.format(order.total)}</strong></div>
            <button className="button button-dark checkout-button" onClick={() => setOrder(null)}>Back to the lovely things <ArrowRight size={16} /></button>
          </section>
        </div>
      )}
    </>
  );
}

function addProductToBag(current, product) {
  const existing = current.find((item) => item.product.id === product.id && item.product.sku === product.sku);
  return existing
    ? current.map((item) => item.product.id === product.id && item.product.sku === product.sku
      ? { ...item, quantity: Math.min(20, item.quantity + 1) }
      : item)
    : [...current, { product, quantity: 1 }];
}

export default function App() {
  const pathname = window.location.pathname.replace(/\/+$/, "") || "/";
  if (catalogPreview && (pathname === "/account" || pathname === "/admin")) {
    return <main className="preview-unavailable"><a className="wordmark" href="/">zariya<span>.</span><small>THE ART OF EVERYDAY</small></a><span className="eyebrow"><span className="eyebrow-line" /> CATALOG PREVIEW</span><h1>Not part of this preview.</h1><p>Customer accounts and store management require the full connected service.</p><a className="button button-dark" href="/">Return to the collection <ArrowRight size={15} /></a></main>;
  }
  if (pathname === "/account") return <CustomerAccount />;
  if (pathname === "/admin") return <AdminPanel />;
  return <Storefront />;
}
