(function () {
  let { store, categories, banners, products, lines } = window.ZANBIL;
  lines = lines || [];
  const app = document.getElementById("app");
  const toastEl = document.getElementById("toast");
  const cartCountEls = document.querySelectorAll("[data-cart-count]");
  const searchInput = document.getElementById("searchInput");
  const searchSuggest = document.getElementById("searchSuggest");
  const accountBtn = document.getElementById("accountBtn");
  const notifyDot = document.querySelector("[data-notify-dot]");
  const header = document.querySelector(".header");
  const menuBtn = document.getElementById("menuBtn");
  const siteDrawer = document.getElementById("siteDrawer");
  const drawerOverlay = document.getElementById("drawerOverlay");
  const drawerBody = document.getElementById("drawerBody");
  const drawerClose = document.getElementById("drawerClose");
  const siteFooter = document.getElementById("siteFooter");
  const networkState = document.getElementById("networkState");
  const TOKEN_KEY = "zanbil-token";
  const LEGACY_CART_KEY = "zanbil-cart";
  const DEVICE_KEY = "zanbil-device-id";
  let deviceId = localStorage.getItem(DEVICE_KEY);
  if (!deviceId) {
    deviceId = globalThis.crypto?.randomUUID?.() || `device-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    localStorage.setItem(DEVICE_KEY, deviceId);
  }
  const GUEST_CART_KEY = `zanbil-cart-guest:${deviceId}`;
  const legacyCart = localStorage.getItem(LEGACY_CART_KEY);
  if (legacyCart && !localStorage.getItem(TOKEN_KEY) && !localStorage.getItem(GUEST_CART_KEY)) {
    localStorage.setItem(GUEST_CART_KEY, legacyCart);
  }
  localStorage.removeItem(LEGACY_CART_KEY);
  let me = null;
  let internalRouteDepth = 0;
  let routeBackPending = false;

  const fa = (n) => String(n).replace(/\d/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[d]);
  const money = (n) => fa(Number(n).toLocaleString("en-US"));
  const off = (p) =>
    p.oldPrice ? Math.round((1 - p.price / p.oldPrice) * 100) : 0;
  const byId = (id) => products.find((p) => p.id === Number(id));
  const catName = (id) => categories.find((c) => c.id === id)?.name || "همه";
  const lineName = (id) => (lines || []).find((l) => l.id === id)?.name || "لاین فروشگاه";
  const lineList = (id) => products.filter((p) => p.line === id);
  function brandList() {
    const map = new Map();
    for (const p of products) {
      const name = String(p.brand || "").trim();
      if (name) map.set(name, (map.get(name) || 0) + 1);
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "fa"));
  }

  function applyCatalog(data) {
    if (!data) return;
    store = data.store || store;
    categories = data.categories || categories;
    banners = data.banners || banners;
    products = data.products || products;
    lines = data.lines || lines || [];
    window.ZANBIL = { store, categories, banners, products, lines };
    syncStoreShell();
    fillSiteDrawer();
  }

  function syncStoreShell() {
    document.querySelectorAll("[data-footer-name]").forEach((el) => (el.textContent = store.name || "زنبیل"));
    document.querySelectorAll("[data-footer-tagline]").forEach((el) => (el.textContent = store.tagline || ""));
    document.querySelectorAll("[data-footer-address]").forEach((el) => (el.textContent = store.address || store.city || ""));
    document.querySelectorAll("[data-footer-hours]").forEach((el) => (el.textContent = store.hours || ""));
    document.querySelectorAll("[data-footer-map]").forEach((el) => (el.href = store.mapsUrl || "#"));
    document.querySelectorAll("[data-footer-instagram]").forEach(
      (el) => (el.href = store.instagramUrl || `https://www.instagram.com/${store.instagram || "zanbil.original"}/`)
    );
  }

  async function bootCatalog() {
    try {
      applyCatalog(await api("/api/catalog"));
    } catch {
      /* keep local catalog */
    }
  }

  const escapeHtml = (s) =>
    String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const toEn = (s) =>
    String(s || "").replace(/[۰-۹]/g, (d) => "0123456789"["۰۱۲۳۴۵۶۷۸۹".indexOf(d)]);

  async function api(path, { method = "GET", body, signal } = {}) {
    const token = localStorage.getItem(TOKEN_KEY);
    const res = await fetch(path, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal,
    });
    let data = {};
    try {
      data = await res.json();
    } catch {
      data = {};
    }
    if (!res.ok) throw new Error(data.error || "ارتباط با سرور برقرار نشد. سایت را با npm start باز کنید.");
    return data;
  }

  const auth = {
    current() {
      return me;
    },
    async boot() {
      if (!localStorage.getItem(TOKEN_KEY)) {
        me = null;
        return;
      }
      try {
        me = await api("/api/me");
        await cart.claimGuest();
      } catch {
        localStorage.removeItem(TOKEN_KEY);
        me = null;
      }
      renderAccountBtn();
    },
    async login(phone, pass) {
      try {
        const data = await api("/api/login", { method: "POST", body: { phone, pass } });
        localStorage.setItem(TOKEN_KEY, data.token);
        me = data.user;
        await cart.claimGuest();
        renderAccountBtn();
        return "";
      } catch (err) {
        return err.message;
      }
    },
    async logout() {
      await cart.settle();
      cart.pending = null;
      try {
        await api("/api/logout", { method: "POST" });
      } catch {
        /* ignore */
      }
      localStorage.removeItem(TOKEN_KEY);
      me = null;
      renderAccountBtn();
      renderCounts();
    },
    async register(payload) {
      try {
        const data = await api("/api/register", { method: "POST", body: payload });
        localStorage.setItem(TOKEN_KEY, data.token);
        me = data.user;
        await cart.claimGuest();
        renderAccountBtn();
        return "";
      } catch (err) {
        return err.message;
      }
    },
    async update(data) {
      me = await api("/api/me", { method: "PATCH", body: data });
      renderAccountBtn();
    },
    async changePassword(currentPassword, newPassword) {
      const data = await api("/api/me/password", {
        method: "POST",
        body: { currentPassword, newPassword },
      });
      localStorage.setItem(TOKEN_KEY, data.token);
      me = data.user;
      renderAccountBtn();
    },
    async addOrder(order) {
      me = await api("/api/me/orders", { method: "POST", body: order });
      renderNotificationBadge();
    },
    async payInquiry(orderId, choices) {
      me = await api(`/api/me/orders/${orderId}/pay`, { method: "POST", body: { choices } });
      renderNotificationBadge();
    },
    isFav(id) {
      return (me?.favorites || []).includes(Number(id));
    },
    async toggleFavorite(id) {
      const data = await api("/api/me/favorites", { method: "POST", body: { id: Number(id) } });
      me = data.user;
      return data.on;
    },
    async addReview(body) {
      me = await api("/api/me/reviews", { method: "POST", body });
    },
    async addQuestion(body) {
      me = await api("/api/me/questions", { method: "POST", body });
    },
    async delReview(id) {
      me = await api(`/api/me/reviews/${id}`, { method: "DELETE" });
    },
    async delQuestion(id) {
      me = await api(`/api/me/questions/${id}`, { method: "DELETE" });
    },
  };

  function renderAccountBtn() {
    const user = auth.current();
    if (user) {
      accountBtn.innerHTML = `<span class="avatar">${escapeHtml(user.name.trim().charAt(0) || "ز")}</span>`;
      accountBtn.setAttribute("aria-label", `حساب ${user.name}`);
    } else {
      accountBtn.innerHTML = `
        <svg width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24">
          <circle cx="12" cy="8" r="3.2" />
          <path d="M5 20a7 7 0 0 1 14 0" />
        </svg>`;
      accountBtn.setAttribute("aria-label", "حساب کاربری");
    }
    renderNotificationBadge();
  }

  function notificationSignature(user = auth.current()) {
    return (user?.orders || [])
      .map((order) => `${order.id}:${order.phase || ""}:${order.status || ""}:${order.inquiryResultAt || 0}:${order.payUntil || 0}`)
      .join("|");
  }

  function renderNotificationBadge() {
    if (!notifyDot) return;
    const signature = notificationSignature();
    const seen = localStorage.getItem("zanbil-notifications-seen") || "";
    notifyDot.hidden = !signature || signature === seen;
  }

  const PUSH_SEEN_KEY = "zanbil-inquiry-push-seen";
  const PUSH_SESSION_KEY = "zanbil-inquiry-push-session";
  const phonePush = document.getElementById("phonePush");
  const phonePushCard = document.getElementById("phonePushCard");
  const phonePushTitle = document.getElementById("phonePushTitle");
  const phonePushText = document.getElementById("phonePushText");

  function inquiryAlertOrder(user = auth.current()) {
    const now = Date.now();
    return (user?.orders || [])
      .filter((order) => {
        if (!order.inquiryResultAt) return false;
        if (order.phase === "awaiting_customer" && Number(order.payUntil || 0) > now) return true;
        return order.phase === "unavailable";
      })
      .sort((a, b) => Number(b.inquiryResultAt || 0) - Number(a.inquiryResultAt || 0))[0] || null;
  }

  function inquiryPushId(order) {
    return `${order.id}:${order.inquiryResultAt}:${order.phase}`;
  }

  function markInquiryPushSeen(order = inquiryAlertOrder()) {
    if (!order) return;
    localStorage.setItem(PUSH_SEEN_KEY, inquiryPushId(order));
    sessionStorage.setItem(PUSH_SESSION_KEY, inquiryPushId(order));
  }

  function hidePhonePush() {
    if (phonePush) phonePush.hidden = true;
  }

  function maybeShowInquiryPush({ force = false } = {}) {
    if (!phonePush) return;
    const route = (location.hash || "#/").split("?")[0];
    if (route === "#/notifications") {
      markInquiryPushSeen();
      hidePhonePush();
      return;
    }
    const order = inquiryAlertOrder();
    if (!order) {
      hidePhonePush();
      return;
    }
    const id = inquiryPushId(order);
    if (localStorage.getItem(PUSH_SEEN_KEY) === id) {
      hidePhonePush();
      return;
    }
    if (!force && sessionStorage.getItem(PUSH_SESSION_KEY) === id) return;
    const approved = order.phase === "awaiting_customer";
    if (phonePushTitle) phonePushTitle.textContent = approved ? "نتیجه استعلام آماده‌ست" : "جواب سفارش شما آمد";
    if (phonePushText) {
      phonePushText.textContent = approved
        ? "فروشگاه جهانشهر موجودی سفارشتان را بررسی کرد. برای دیدن جزئیات و تکمیل پرداخت، اینجا را بزنید."
        : "نتیجه استعلام سفارشتان آماده است. جزئیات را در اعلان‌ها ببینید.";
    }
    phonePush.hidden = false;
    sessionStorage.setItem(PUSH_SESSION_KEY, id);
    if (globalThis.Notification?.permission === "granted") {
      try {
        new Notification(phonePushTitle?.textContent || "زنبیل", { body: phonePushText?.textContent || "", tag: id });
      } catch {
        /* ignore */
      }
    }
  }

  async function refreshMeQuiet() {
    if (!localStorage.getItem(TOKEN_KEY)) return;
    try {
      const next = await api("/api/me");
      const before = inquiryAlertOrder(me);
      me = next;
      renderNotificationBadge();
      const after = inquiryAlertOrder(me);
      const changed = after && inquiryPushId(after) !== (before ? inquiryPushId(before) : "");
      maybeShowInquiryPush({ force: changed });
    } catch {
      /* stay on cached user */
    }
  }

  const cart = {
    pending: null,
    syncPromise: null,
    normalize(items) {
      const merged = new Map();
      for (const item of Array.isArray(items) ? items : []) {
        const id = Number(item.id);
        const qty = Math.min(99, Math.max(0, Number(item.qty) || 0));
        if (id > 0 && qty > 0) merged.set(id, Math.max(merged.get(id) || 0, qty));
      }
      return [...merged].map(([id, qty]) => ({ id, qty }));
    },
    readGuest() {
      try {
        return this.normalize(JSON.parse(localStorage.getItem(GUEST_CART_KEY)) || []);
      } catch {
        return [];
      }
    },
    read() {
      return auth.current() ? this.normalize(auth.current().cart || []) : this.readGuest();
    },
    write(items) {
      const clean = this.normalize(items);
      if (auth.current()) {
        me.cart = clean;
        this.queueSync(clean);
      } else {
        localStorage.setItem(GUEST_CART_KEY, JSON.stringify(clean));
      }
      renderCounts();
    },
    queueSync(items) {
      this.pending = this.normalize(items);
      if (this.syncPromise) return;
      this.syncPromise = (async () => {
        while (this.pending) {
          const latest = this.pending;
          this.pending = null;
          try {
            await api("/api/me/cart", { method: "PUT", body: { items: latest } });
          } catch (err) {
            this.pending = latest;
            toast("ذخیره سبد روی حساب انجام نشد؛ اتصال را بررسی کنید");
            break;
          }
        }
      })().finally(() => {
        this.syncPromise = null;
      });
    },
    async settle() {
      if (this.syncPromise) await this.syncPromise;
    },
    async claimGuest() {
      if (!auth.current()) return;
      const guest = this.readGuest();
      me.cart = this.normalize(me.cart || []);
      if (!guest.length) {
        renderCounts();
        return;
      }
      const combined = this.normalize([...me.cart, ...guest]);
      try {
        me = await api("/api/me/cart", { method: "PUT", body: { items: combined } });
        localStorage.removeItem(GUEST_CART_KEY);
      } catch {
        me.cart = combined;
      }
      renderCounts();
    },
    count() {
      return this.read().reduce((s, i) => s + i.qty, 0);
    },
    add(id, qty = 1) {
      const items = this.read();
      const found = items.find((i) => i.id === id);
      if (found) found.qty += qty;
      else items.push({ id, qty });
      this.write(items);
      taste.hitProduct(id, 5);
      toast("به سبد خرید اضافه شد");
    },
    set(id, qty) {
      let items = this.read();
      if (qty <= 0) items = items.filter((i) => i.id !== id);
      else {
        const found = items.find((i) => i.id === id);
        if (found) found.qty = qty;
      }
      this.write(items);
    },
  };

  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add("show");
    setTimeout(() => toastEl.classList.remove("show"), 1800);
  }

  function renderCounts() {
    const n = cart.count();
    cartCountEls.forEach((el) => {
      el.textContent = fa(n);
      el.hidden = n === 0;
    });
  }

  function icon(name) {
    const paths = {
      pot: '<path d="M4 10h16l-1 10H5L4 10z"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
      plate: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/>',
      mop: '<path d="M8 3h8M12 3v10"/><path d="M7 21h10l-1-8H8l-1 8z"/>',
      bath: '<path d="M4 12h16v4a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4v-4z"/><path d="M7 12V6a2 2 0 0 1 2-2h1"/>',
      cup: '<path d="M6 5h10v7a4 4 0 0 1-8 0V5z"/><path d="M16 7h2a2 2 0 0 1 0 4h-2"/>',
      wood: '<path d="M4 7h16v10H4z"/><path d="M4 11h16M8 7v10"/>',
      hamper: '<path d="M6 8h12l-1 12H7L6 8z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/>',
      rack: '<path d="M5 6h14M5 12h14M5 18h14"/><path d="M7 4v16M17 4v16"/>',
      acrylic: '<rect x="6" y="4" width="12" height="16" rx="1.6"/><path d="M8.5 8h7M8.5 12h5"/>',
      jar: '<path d="M9 7h6v13H9z"/><path d="M10 7V5h4v2M10 13h4"/>',
      plastic: '<ellipse cx="12" cy="8" rx="7" ry="2.6"/><path d="M5 8v6.5c0 1.6 3.1 2.8 7 2.8s7-1.2 7-2.8V8"/>',
      tray: '<rect x="3.5" y="8" width="17" height="8" rx="2.2"/><path d="M6.5 8V7h11v1"/>',
      ig: '<rect x="4" y="4" width="16" height="16" rx="5"/><circle cx="12" cy="12" r="3.4"/><circle cx="16.4" cy="7.6" r="0.9" fill="currentColor" stroke="none"/>',
    };
    return `<svg width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24">${paths[name] || paths.pot}</svg>`;
  }

  function priceBlock(p, compact) {
    const discount = off(p);
    return `
      <div class="price-row">
        ${discount ? `<span class="off">${fa(discount)}٪</span>` : "<span></span>"}
        <div>
          ${p.oldPrice ? `<div class="old">${money(p.oldPrice)}</div>` : ""}
          <div class="now">${money(p.price)} <span class="unit">تومان</span></div>
        </div>
      </div>
    `;
  }

  function thumb(p) {
    const cat = categories.find((c) => c.id === p.cat);
    return `<div class="thumb t-${p.cat}" aria-hidden="true">${icon(cat?.icon || "pot")}</div>`;
  }

  function heartSvg() {
    const d =
      "M16 26.85c-.22 0-.43-.07-.6-.22C9.72 21.55 4.4 16.55 4.4 11.45A6.55 6.55 0 0 1 11 4.9c2.05 0 3.88 1 5 2.58 1.12-1.58 2.95-2.58 5-2.58a6.55 6.55 0 0 1 6.6 6.55c0 5.1-5.32 10.1-11 15.18-.17.15-.38.22-.6.22z";
    return `<svg class="heart-ico" viewBox="0 0 32 32" aria-hidden="true"><path class="heart-bloom" d="${d}"/><path class="heart-shape" d="${d}"/><path class="heart-shine" d="M10.2 8.1c-1.5-.45-3.15.02-4 1.32-.16.24.06.55.35.47 1.45-.38 2.82.12 3.78 1.2.16.18.46.1.5-.16.22-1.12 0-2.3-.63-2.83z"/></svg>`;
  }

  function trashSvg() {
    return `<svg class="trash-ico" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 7h14" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M10 7V5.6A1.6 1.6 0 0 1 11.6 4h.8A1.6 1.6 0 0 1 14 5.6V7" stroke="currentColor" stroke-width="1.8"/><path d="M8.2 7l.7 12.2A1.6 1.6 0 0 0 10.5 20.8h3A1.6 1.6 0 0 0 15.1 19.2L15.8 7" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M10.2 11v5.2M13.8 11v5.2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`;
  }

  function cartQty(id) {
    return (cart.read().find((i) => i.id === Number(id)) || {}).qty || 0;
  }

  function productBuyActions(id, qty) {
    if (!qty) {
      return `<button class="btn wide" data-add="${id}" data-n="1">افزودن به سبد</button>`;
    }
    const max = 99;
    const left =
      qty <= 1
        ? `<button type="button" class="qty-del" data-pdel aria-label="حذف از سبد">${trashSvg()}</button>`
        : `<button type="button" data-pqty="-1" aria-label="کم">−</button>`;
    return `
      <div class="p-qty-wrap">
        <div class="p-qty" role="group" aria-label="تعداد در سبد">
          ${left}
          <b data-pqty-n>${fa(qty)}</b>
          <button type="button" data-pqty="1" aria-label="زیاد" ${qty >= max ? "disabled" : ""}>+</button>
        </div>
        <span class="p-incart">در سبد شما</span>
      </div>`;
  }

  function paintProductBuy(page) {
    if (!page) return;
    const id = Number(page.dataset.product);
    const qty = cartQty(id);
    const max = 99;
    page.querySelectorAll(".p-buy-actions").forEach((box) => {
      const hasQty = Boolean(box.querySelector(".p-qty"));
      if (hasQty && qty) {
        const num = box.querySelector("[data-pqty-n]");
        if (num) num.textContent = fa(qty);
        const plus = box.querySelector('[data-pqty="1"]');
        if (plus) plus.disabled = qty >= max;
        const left = box.querySelector("[data-pdel], [data-pqty='-1']");
        if (left) {
          if (qty <= 1 && !left.hasAttribute("data-pdel")) {
            left.outerHTML = `<button type="button" class="qty-del" data-pdel aria-label="حذف از سبد">${trashSvg()}</button>`;
          } else if (qty > 1 && left.hasAttribute("data-pdel")) {
            left.outerHTML = `<button type="button" data-pqty="-1" aria-label="کم">−</button>`;
          }
        }
        return;
      }
      box.innerHTML = productBuyActions(id, qty);
    });
  }

  const SEEN_KEY = "zanbil-seen";
  function seenTrack(id) {
    const n = Number(id);
    let ids = [];
    try {
      ids = JSON.parse(localStorage.getItem(SEEN_KEY)) || [];
    } catch {
      ids = [];
    }
    localStorage.setItem(SEEN_KEY, JSON.stringify([n, ...ids.filter((x) => Number(x) !== n)].slice(0, 12)));
  }
  function seenProducts(exceptId) {
    let ids = [];
    try {
      ids = JSON.parse(localStorage.getItem(SEEN_KEY)) || [];
    } catch {
      ids = [];
    }
    return ids.map((sid) => byId(sid)).filter((p) => p && p.id !== Number(exceptId)).slice(0, 8);
  }

  function productSku(p) {
    return `ZN-${String(p.cat || "ZB").slice(0, 4).toUpperCase()}-${String(p.id).padStart(3, "0")}`;
  }

  function specHighlights(p) {
    const specs = p.specs || [];
    if (!specs.length) return "";
    return `<ul class="p-points">${specs
      .slice(0, 4)
      .map(([k, v]) => `<li><i></i><span>${escapeHtml(k)}: <b>${escapeHtml(v)}</b></span></li>`)
      .join("")}</ul>`;
  }

  function productFaq() {
    const items = [
      ["این همان کالای فروشگاه جهانشهر است؟", "بله؛ همان کالای فروشگاه است. موجودی قطعی بعد از استعلام از مغازه اعلام می‌شود."],
      ["ارسال چقدر طول می‌کشد؟", "داخل کرج معمولاً امروز یا فردا. شهرستان حدود ۲ تا ۴ روز کاری."],
      ["تحویل حضوری دارید؟", `بله، ${store.address}. ساعت کار: ${store.hours}.`],
      ["چند قلم جهیزیه را با هم می‌خرم؟", "سبد را پر کنید؛ در سفارش می‌توانید بخواهید با هم بسته‌بندی و ارسال شود."],
    ];
    return `<div class="p-faq"><h3>قبل از خرید، این‌ها را بدانید</h3>${items
      .map(
        ([q, a], i) => `
      <div class="p-acc ${i === 0 ? "on" : ""}">
        <button type="button" data-acc>${escapeHtml(q)}<span></span></button>
        <p>${escapeHtml(a)}</p>
      </div>`
      )
      .join("")}</div>`;
  }

  function productBuyBox(p, inCart) {
    const sku = productSku(p);
    return `
      <div class="p-buybox">
        <div class="buy-price">
          <small>قیمت فروشگاه</small>
          <div class="now">${money(p.price)} <span class="unit">تومان</span></div>
        </div>
        <div class="p-buy-tags">
          <span class="stock-ok">موجودی با استعلام از مغازه</span>
          <button type="button" class="p-sku" data-copy-sku="${sku}">کد ${sku}</button>
        </div>
        <div class="p-buy-actions">${productBuyActions(p.id, inCart)}</div>
        <p class="p-buy-note">بعد از سبد، آدرس را می‌گذارید و موجودی از مغازه جهانشهر استعلام می‌شود</p>
      </div>`;
  }

  function productCard(p, compact, badge) {
    const fav = auth.isFav(p.id);
    return `
      <article class="${compact ? "pick-card" : "pcard"}">
        ${badge ? `<span class="new-tag">${badge}</span>` : ""}
        <button type="button" class="fav-btn ${fav ? "on" : ""}" data-fav="${p.id}" aria-label="افزودن به علاقه‌مندی">${heartSvg()}</button>
        <a href="#/product/${p.id}">
          ${thumb(p)}
          ${compact ? "" : `<div class="meta"><span>${p.brand}</span><span class="stars">★ ${fa(0)}</span></div>`}
          <div class="title">${p.title}</div>
          ${priceBlock(p)}
        </a>
      </article>
    `;
  }

  function normFa(s) {
    return String(s || "")
      .replace(/[يى]/g, "ی")
      .replace(/[ك]/g, "ک")
      .replace(/[أإآٱ]/g, "ا")
      .replace(/ة/g, "ه")
      .replace(/ؤ/g, "و")
      .replace(/ئ/g, "ی")
      .replace(/[ًٌٍَُِّْـ\u200c\u200d]/g, "")
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  }

  function findBrand(raw) {
    let name = "";
    try {
      name = decodeURIComponent(raw || "");
    } catch {
      name = raw || "";
    }
    const n = normFa(name);
    return brandList().find(([b]) => b === name || normFa(b) === n)?.[0] || "";
  }

  function faWords(s) {
    return normFa(s).split(" ").filter(Boolean);
  }

  function wordsStartWith(text, needle) {
    if (!needle) return false;
    return faWords(text).some((word) => word.startsWith(needle));
  }

  function productSearchWords(p) {
    return [p.title, p.brand, ...(p.colors || [])].join(" ");
  }

  function searchProducts(query) {
    const nq = normFa(query);
    if (!nq) return [];
    const tokens = nq.split(" ").filter(Boolean);
    return products
      .map((p, order) => {
        const hay = productSearchWords(p);
        const titleWords = faWords(p.title);
        const allWords = faWords(hay);
        if (!tokens.every((token) => allWords.some((word) => word.startsWith(token)))) return null;

        let score = 0;
        if (normFa(p.title) === nq) score += 500;
        if (titleWords.some((word) => word === nq)) score += 360;
        if (titleWords.some((word) => word.startsWith(nq))) score += 280;
        if (wordsStartWith(p.brand, nq)) score += 120;
        for (const token of tokens) {
          if (titleWords.some((word) => word.startsWith(token))) score += 40;
          else score += 10;
        }
        return { p, score, order };
      })
      .filter(Boolean)
      .sort((a, b) => b.score - a.score || a.order - b.order)
      .map((item) => item.p);
  }

  function catsFromQuery(q) {
    const nq = normFa(q);
    if (!nq) return [];
    const hints = {
      bath: ["حمام", "سرویس", "روشویی", "شامپو", "جامایع"],
      clean: ["نظافت", "جارو", "طی", "تی", "زمین‌شوی"],
      china: ["چینی", "سرامیک", "بشقاب", "ظروف"],
      cook: ["قابلمه", "تابه", "پخت", "پز"],
      cups: ["لیوان", "فنجان", "ماگ"],
      wood: ["چوب", "چوبی", "بامبو", "گردو"],
      hamper: ["جارختی", "جا رختی", "رخت", "سبد لباس"],
      rack: ["راف", "شلف", "طبقه"],
    };
    const lineHints = {
      wood: ["چوب", "چوبی", "بامبو"],
      acrylic: ["اکرولیک", "اکریلیک", "شفاف"],
      jar: ["بانکه", "شیشه", "حبوبات"],
      plastic: ["پلاستیک", "پلاستیکی", "نشکن"],
      cups: ["لیوان", "استکان", "فنجان", "ماگ"],
      tray: ["سینی"],
    };
    const found = new Set();
    for (const c of categories) {
      if (normFa(c.name).includes(nq) || nq.includes(normFa(c.name))) found.add(c.id);
      for (const word of hints[c.id] || []) {
        if (nq.includes(word) || word.includes(nq)) found.add(c.id);
      }
    }
    for (const p of products) {
      if (normFa(p.title).includes(nq) || normFa(p.brand).includes(nq)) found.add(p.cat);
    }
    for (const line of lines || []) {
      if (normFa(line.name).includes(nq) || nq.includes(normFa(line.name))) {
        lineList(line.id).forEach((p) => found.add(p.cat));
      }
      for (const word of lineHints[line.id] || []) {
        if (nq.includes(word) || word.includes(nq)) lineList(line.id).forEach((p) => found.add(p.cat));
      }
    }
    return [...found];
  }

  const taste = {
    KEY: "zanbil-taste",
    read() {
      try {
        const data = JSON.parse(localStorage.getItem(this.KEY)) || {};
        return {
          cats: data.cats && typeof data.cats === "object" ? data.cats : {},
          lines: data.lines && typeof data.lines === "object" ? data.lines : {},
          searches: Array.isArray(data.searches) ? data.searches : [],
          seen: data.seen && typeof data.seen === "object" ? data.seen : {},
        };
      } catch {
        return { cats: {}, lines: {}, searches: [], seen: {} };
      }
    },
    write(data) {
      localStorage.setItem(this.KEY, JSON.stringify(data));
    },
    hitCat(id, n = 1) {
      if (!id || id === "all") return;
      const data = this.read();
      data.cats[id] = Math.min(48, (Number(data.cats[id]) || 0) + n);
      this.write(data);
    },
    hitLine(id, n = 3) {
      if (!id) return;
      const data = this.read();
      data.lines[id] = Math.min(48, (Number(data.lines[id]) || 0) + n);
      this.write(data);
    },
    hitProduct(id, n = 2) {
      const p = byId(id);
      if (!p) return;
      this.hitCat(p.cat, n);
      if (p.line) this.hitLine(p.line, n);
      const data = this.read();
      data.seen[p.id] = (Number(data.seen[p.id]) || 0) + 1;
      this.write(data);
    },
    hitSearch(q) {
      const raw = String(q || "").trim();
      if (raw.length < 2) return;
      const data = this.read();
      data.searches = [raw, ...data.searches.filter((s) => normFa(s) !== normFa(raw))].slice(0, 8);
      this.write(data);
      catsFromQuery(raw).forEach((cat) => this.hitCat(cat, 4));
    },
    topCat() {
      return Object.entries(this.read().cats).sort((a, b) => b[1] - a[1])[0]?.[0] || "";
    },
    topLine() {
      return Object.entries(this.read().lines).sort((a, b) => b[1] - a[1])[0]?.[0] || "";
    },
    hasSignal() {
      const data = this.read();
      return (
        data.searches.length > 0 ||
        Object.values(data.cats).some((n) => n > 0) ||
        Object.values(data.lines).some((n) => n > 0)
      );
    },
  };

  function mulberry32(seed) {
    let a = seed;
    return () => {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function sessionSeed() {
    let seed = sessionStorage.getItem("zanbil-seed");
    if (!seed) {
      seed = String(Date.now());
      sessionStorage.setItem("zanbil-seed", seed);
    }
    return Number(seed) || 1;
  }

  function shuffleSeeded(list, seed) {
    const rng = mulberry32(seed);
    const copy = [...list];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }

  function scorePick(p, data) {
    let score = (data.cats[p.cat] || 0) * 8 + (p.line ? (data.lines[p.line] || 0) * 10 : 0);
    for (const q of data.searches) {
      const nq = normFa(q);
      if (!nq) continue;
      if (normFa(p.title).includes(nq)) score += 14;
      if (normFa(p.brand).includes(nq)) score += 6;
      if (normFa(p.desc).includes(nq)) score += 3;
      if (normFa(catName(p.cat)).includes(nq)) score += 10;
      nq.split(/\s+/).forEach((token) => {
        if (token.length >= 2 && normFa(p.title).includes(token)) score += 4;
      });
      if (catsFromQuery(q).includes(p.cat)) score += 6;
    }
    if (data.seen[p.id]) score -= 5;
    return score + (p.rating || 0);
  }

  function recommend(limit = 8) {
    if (!products.length) return [];
    if (!taste.hasSignal()) return shuffleSeeded(products, sessionSeed()).slice(0, limit);
    const data = taste.read();
    const ranked = [...products].sort((a, b) => scorePick(b, data) - scorePick(a, data));
    const out = [];
    const used = {};
    for (const p of ranked) {
      const n = used[p.cat] || 0;
      if (n >= 5) continue;
      out.push(p);
      used[p.cat] = n + 1;
      if (out.length >= limit) break;
    }
    return out;
  }

  function pickHint() {
    const data = taste.read();
    const top = taste.topCat();
    const q = data.searches[0];
    if (q && top && catsFromQuery(q).includes(top)) return `چون «${escapeHtml(q)}» را جستجو کردید`;
    if (q) return `بر اساس جستجوی «${escapeHtml(q)}»`;
    const topLine = taste.topLine();
    if (topLine && (data.lines[topLine] || 0) >= 3) return `چون بیشتر در ${lineName(topLine)} بودید`;
    if (top && (data.cats[top] || 0) >= 3) return `چون بیشتر در ${catName(top)} بودید`;
    return "چند کالای منتخب برای شروع خرید";
  }

  function lineImg(id) {
    return `img/ig/ig-${id}.png`;
  }

  function instagramHref() {
    return store.instagramUrl || `https://www.instagram.com/${store.instagram || "zanbil.original"}/`;
  }

  function igBanner() {
    const href = instagramHref();
    const handle = store.instagram || "zanbil.original";
    const slides = (lines || []).map((l) => ({
      ...l,
      image: lineImg(l.id),
    }));
    return `
      <section class="ig-banner">
        <a class="ig-head" href="${href}" target="_blank" rel="noreferrer">
          <i>${icon("ig")}</i>
          <div>
            <h3>در اینستاگرام ما چه می‌گذرد</h3>
            <small>@${escapeHtml(handle)}</small>
          </div>
        </a>
        <div class="ig-slider" id="igSlider">
          ${slides
            .map(
              (s, i) => `
            <a class="ig-slide ${i === 0 ? "active" : ""}" href="${href}" target="_blank" rel="noreferrer">
              <img src="${s.image}" alt="${s.name}" />
              <div class="ig-cap">
                <b>${s.name}</b>
                <span>در پیج ببینید</span>
              </div>
            </a>`
            )
            .join("")}
          <div class="dots">
            ${slides
              .map((_, i) => `<button type="button" data-ig-dot="${i}" class="${i === 0 ? "on" : ""}"></button>`)
              .join("")}
          </div>
        </div>
      </section>
    `;
  }

  function freshList() {
    return products.filter((p) => p.fresh);
  }

  function freshRow() {
    const list = freshList();
    if (!list.length) return "";
    return `
      <section class="fresh">
        ${sectionHead("موجودی‌های جدید زنبیل", "#/fresh", "مشاهده همه", "spark", "تازه‌واردهای فروشگاه و کالاهایی که دوباره موجود شدند")}
        <div class="hscroll">
          ${list.map((p) => productCard(p, true, "جدید")).join("")}
        </div>
      </section>
    `;
  }

  function freshPage() {
    const list = freshList();
    return `
      <section class="page">
        ${pageHero({ ico: "spark", title: "موجودی‌های جدید زنبیل", sub: "تازه‌واردها و کالاهایی که دوباره موجود شدند", tone: "gold" })}
        ${
          list.length
            ? `<div class="grid">${list.map((p) => productCard(p, false, "جدید")).join("")}</div>`
            : emptyBox("spark", "هنوز موجودی جدیدی ثبت نشده", "به‌زودی کالاهای تازه همین‌جا می‌آیند", "#/", "بازگشت به فروشگاه")
        }
      </section>
    `;
  }

  function slideArt(tone) {
    const arts = {
      rose: ["assets/banners/sweet-home.svg", "تصویرسازی خانه نو و جهیزیه"],
      teal: ["assets/banners/delivery-address.svg", "تصویرسازی ارسال در کرج"],
      gold: ["assets/banners/iran-delivery.svg", "تصویرسازی ارسال بسته"],
      navy: ["assets/banners/safe-shopping.svg", "تصویرسازی خرید مطمئن"],
    };
    const art = arts[tone];
    return art ? `<div class="slide-art" aria-hidden="true"><img src="${art[0]}" alt="${art[1]}" /></div>` : "";
  }

  function home() {
    const picks = recommend(8);
    const top = taste.topCat();
    const selected = products.slice(0, 12);
    return `
      <section class="page">
        <div class="loc-bar">
          <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11z"/><circle cx="12" cy="10" r="2.4"/></svg>
          ارسال از <b>${store.city}</b> — تحویل حضوری یا پیک
        </div>
        <div class="slider" id="slider">
          ${banners
            .map(
              (b, i) => `
            <article class="slide ${b.tone} ${i === 0 ? "active" : ""}">
              ${slideArt(b.tone)}
              <div class="slide-copy">
                <h2>${b.title}</h2>
                <p>${b.text}</p>
              </div>
            </article>`
            )
            .join("")}
          <div class="dots">
            ${banners.map((_, i) => `<button data-dot="${i}" class="${i === 0 ? "on" : ""}"></button>`).join("")}
          </div>
        </div>
        <div class="cats-wrap">
          <button type="button" class="cats-arrow" data-cats-dir="-1" aria-label="دسته‌های قبلی">‹</button>
          <nav class="cats" data-cats aria-label="دسته‌بندی">
            ${categories
              .map((c) => `<a class="cat" href="#/category/${c.id}">${c.name}</a>`)
              .join("")}
          </nav>
          <button type="button" class="cats-arrow" data-cats-dir="1" aria-label="دسته‌های بعدی">›</button>
        </div>
        <section class="picks">
          ${sectionHead("پیشنهاد زنبیل به شما", top ? `#/category/${top}` : "#/category/all", "مشاهده همه", "spark", pickHint())}
          <div class="hscroll">
            ${picks.map((p) => productCard(p, true)).join("")}
          </div>
        </section>
        ${freshRow()}
        ${igBanner()}
        <section class="store-lines">
          <div class="lines-intro">
            ${dashIco("store")}
            <div>
              <h3>لاین‌های فروشگاه جهانشهر</h3>
              <p>اگر مغازه را حضوری دیده‌اید، همان لاینی که در فروشگاه چرخیدید را از اینجا باز کنید</p>
            </div>
          </div>
          <div class="line-nav">
            ${(lines || [])
              .map(
                (l) => `
              <a class="line-chip ln-${l.id}" href="#/line/${l.id}">
                <img src="${lineImg(l.id)}" alt="${l.name}" />
                <span>${l.name.replace("لاین ", "")}</span>
              </a>`
              )
              .join("")}
          </div>
        </section>
        ${sectionHead("پرفروش‌های جهیزیه", "#/category/all", "مشاهده همه", "star")}
        <div class="grid">
          ${selected.map((p) => productCard(p)).join("")}
        </div>
      </section>
    `;
  }

  function linePage(id) {
    const line = (lines || []).find((l) => l.id === id);
    const list = lineList(id);
    if (!line) return emptyBox("store", "این لاین پیدا نشد", "یکی از لاین‌های فروشگاه جهانشهر را انتخاب کنید", "#/", "بازگشت به فروشگاه");
    return `
      <section class="page">
        ${pageHero({ ico: "store", title: line.name, sub: "همان قفسه‌ای که در فروشگاه جهانشهر دیدید", tone: "rose" })}
        <div class="line-page-cover">
          <img src="${lineImg(id)}" alt="${line.name}" />
        </div>
        <div class="filters">
          ${(lines || [])
            .map(
              (l) =>
                `<a class="chip ${l.id === id ? "on" : ""}" href="#/line/${l.id}">${l.name.replace("لاین ", "")}</a>`
            )
            .join("")}
        </div>
        ${
          list.length
            ? `<div class="grid">${list.map((p) => productCard(p)).join("")}</div>`
            : emptyBox("store", "این لاین فعلاً خالی است", "موجودی‌های جدید به‌زودی اضافه می‌شوند", "#/", "بازگشت به فروشگاه")
        }
      </section>
    `;
  }

  function brandPage(raw) {
    const name = findBrand(raw);
    const list = name ? products.filter((p) => p.brand === name) : [];
    if (!name) return emptyBox("bag", "این برند پیدا نشد", "یکی از برندهای فروشگاه زنبیل را انتخاب کنید", "#/", "بازگشت به فروشگاه");
    return `
      <section class="page">
        ${pageHero({ ico: "bag", title: name, sub: `${fa(list.length)} کالا از این برند`, tone: "gold" })}
        <div class="filters">
          ${brandList()
            .map(
              ([b]) =>
                `<a class="chip ${b === name ? "on" : ""}" href="#/brand/${encodeURIComponent(b)}">${escapeHtml(b)}</a>`
            )
            .join("")}
        </div>
        ${
          list.length
            ? `<div class="grid">${list.map((p) => productCard(p)).join("")}</div>`
            : emptyBox("bag", "کالایی از این برند نیست", "برندهای دیگر زنبیل را ببینید", "#/", "بازگشت به فروشگاه")
        }
      </section>
    `;
  }

  function categoryPage(id) {
    const list = id === "all" ? products : products.filter((p) => p.cat === id);
    return `
      <section class="page">
        ${pageHero({ ico: "bag", title: catName(id), sub: `${fa(list.length)} کالا در این دسته`, tone: "rose" })}
        <div class="filters">
          <a class="chip ${id === "all" ? "on" : ""}" href="#/category/all">همه</a>
          ${categories
            .map(
              (c) =>
                `<a class="chip ${c.id === id ? "on" : ""}" href="#/category/${c.id}">${c.name}</a>`
            )
            .join("")}
        </div>
        ${
          list.length
            ? `<div class="grid">${list.map((p) => productCard(p)).join("")}</div>`
            : emptyBox("bag", "کالایی در این دسته نیست", "دسته‌های دیگر زنبیل را ببینید", "#/category/all", "مشاهده همه کالاها")
        }
      </section>
    `;
  }

  function productPage(id) {
    const p = byId(id);
    if (!p) return emptyBox("bag", "کالا پیدا نشد", "این محصول در فروشگاه موجود نیست", "#/", "بازگشت به فروشگاه");
    seenTrack(p.id);
    const similar = products
      .filter((x) => x.id !== p.id && (p.line ? x.line === p.line : x.cat === p.cat))
      .slice(0, 6);
    const also = products.filter((x) => x.id !== p.id && x.cat === p.cat).slice(0, 4);
    const setItems = p.line ? products.filter((x) => x.id !== p.id && x.line === p.line).slice(0, 4) : [];
    const colors = p.colors || [];
    const specs = p.specs || [];
    const inCart = cartQty(p.id);
    const seen = seenProducts(p.id);
    const shareUrl = encodeURIComponent(`${location.origin}${location.pathname}#/product/${p.id}`);
    const shareText = encodeURIComponent(`${p.title} | فروشگاه زنبیل`);
    return `
      <section class="page p-page" data-product="${p.id}">
        <nav class="crumbs">
          <a href="#/">خانه</a>
          <span>‹</span>
          <a href="#/category/${p.cat}">${catName(p.cat)}</a>
          ${p.line ? `<span>‹</span><a href="#/line/${p.line}">${lineName(p.line)}</a>` : ""}
          <span>‹</span>
          <b>${escapeHtml(p.title)}</b>
        </nav>
        <div class="product-layout">
          <div class="p-gallery">
            <div class="p-stage" data-zoom-open>
              <button type="button" class="fav-btn ${auth.isFav(p.id) ? "on" : ""}" data-fav="${p.id}" aria-label="افزودن به علاقه‌مندی">${heartSvg()}</button>
              <div class="p-tools">
                <button type="button" class="share-btn" data-share aria-label="اشتراک‌گذاری">${dashIco("spark")}</button>
                <div class="share-pop" data-share-pop hidden>
                  <button type="button" data-share-copy>کپی لینک</button>
                  <a href="https://t.me/share/url?url=${shareUrl}&text=${shareText}" target="_blank" rel="noreferrer">تلگرام</a>
                  <a href="https://wa.me/?text=${shareText}%20${shareUrl}" target="_blank" rel="noreferrer">واتساپ</a>
                </div>
              </div>
              <div class="hero-img">${thumb(p)}</div>
              <span class="p-zoom-hint">برای بزرگ‌نمایی لمس کنید</span>
            </div>
            <div class="p-badges">
              <span>موجود در جهانشهر</span>
              <span>ارسال سراسر ایران</span>
              <span>مناسب جهیزیه</span>
            </div>
          </div>
          <div class="p-body">
            <div class="p-brandrow">
              <a class="brand" href="#/category/${p.cat}">${escapeHtml(p.brand)}</a>
              ${p.line ? `<a class="p-linechip" href="#/line/${p.line}">${lineName(p.line)}</a>` : ""}
            </div>
            <h1>${escapeHtml(p.title)}</h1>
            <div class="rate-line">
              <span class="stars">★ ${fa(0)}</span>
              <button type="button" class="link" data-ptab="reviews"><span data-review-count>${fa(0)}</span> دیدگاه</button>
              <button type="button" class="link" data-ptab="ask"><span data-ask-count>${fa(0)}</span> پرسش</button>
              <span class="stock-ok">موجودی با استعلام از مغازه</span>
            </div>
            ${
              colors.length
                ? `<div class="p-opt"><small>رنگ‌بندی</small><div class="colors">${colors
                    .map((c, i) => `<button type="button" class="color ${i === 0 ? "on" : ""}" data-color>${escapeHtml(c)}</button>`)
                    .join("")}</div></div>`
                : ""
            }
            ${specHighlights(p)}
            <p class="desc desc-lead">${escapeHtml(p.desc)}</p>
            <div class="p-ship">
              <div>${dashIco("truck")}<div><b>کرج و اطراف</b><span>معمولاً امروز یا فردا</span></div></div>
              <div>${dashIco("box")}<div><b>سراسر ایران</b><span>۲ تا ۴ روز کاری</span></div></div>
              <div>${dashIco("store")}<div><b>تحویل حضوری</b><span>جهانشهر، ${escapeHtml(store.hours)}</span></div></div>
            </div>
            <div class="p-services">
              <div>${dashIco("truck")}<span>ارسال به سراسر ایران</span></div>
              <div>${dashIco("store")}<span>تحویل حضوری جهانشهر</span></div>
              <div>${dashIco("shield")}<span>ضمانت اصالت کالا</span></div>
              <div>${dashIco("chat")}<span>پشتیبانی فروشگاه</span></div>
            </div>
            <div class="seller">
              ${dashIco("store")}
              <div>
                <small>فروشنده رسمی</small>
                <b>فروشگاه زنبیل — ${escapeHtml(store.city)}</b>
                <p>${escapeHtml(store.address)}</p>
                <p class="seller-meta">${escapeHtml(store.hours)} · ${escapeHtml(store.phone)}</p>
              </div>
              <div class="seller-links">
                <a class="link" href="${store.mapsUrl}" target="_blank" rel="noreferrer">مسیریابی</a>
                <a class="link" href="${store.instagramUrl}" target="_blank" rel="noreferrer">اینستاگرام</a>
              </div>
            </div>
            <div class="p-buy-inline">${productBuyBox(p, inCart)}</div>
          </div>
          <aside class="p-buy-side">${productBuyBox(p, inCart)}</aside>
        </div>
        <div class="p-tabs" role="tablist">
          <button type="button" class="on" data-ptab="intro">معرفی کالا</button>
          <button type="button" data-ptab="specs">مشخصات</button>
          <button type="button" data-ptab="reviews">دیدگاه‌ها <em data-review-count>${fa(0)}</em></button>
          <button type="button" data-ptab="ask">پرسش و پاسخ <em data-ask-count>${fa(0)}</em></button>
        </div>
        <div class="p-panel on" data-panel="intro">
          <div class="card">
            <div class="info-head">${dashIco("bag")}<div><h3>معرفی ${escapeHtml(p.title)}</h3><p>همان کالایی که در فروشگاه جهانشهر می‌بینید</p></div></div>
            <p class="desc">${escapeHtml(p.desc)}</p>
            ${productFaq()}
          </div>
        </div>
        <div class="p-panel" data-panel="specs" hidden>
          <div class="card">
            <div class="info-head">${dashIco("spark")}<div><h3>مشخصات فنی</h3><p>جزئیات کالا برای خرید مطمئن</p></div></div>
            <ul class="specs">
              <li><span>برند</span><b>${escapeHtml(p.brand)}</b></li>
              <li><span>دسته‌بندی</span><b>${catName(p.cat)}</b></li>
              ${p.line ? `<li><span>لاین فروشگاه</span><b>${lineName(p.line)}</b></li>` : ""}
              <li><span>کد کالا</span><b>${productSku(p)}</b></li>
              ${specs.map(([k, v]) => `<li><span>${escapeHtml(k)}</span><b>${escapeHtml(v)}</b></li>`).join("")}
            </ul>
          </div>
        </div>
        <div class="p-panel" data-panel="reviews" hidden>
          ${productReviewsBlock(p)}
        </div>
        <div class="p-panel" data-panel="ask" hidden>
          ${productAskBlock(p)}
        </div>
        ${
          setItems.length
            ? `${sectionHead("ست جهیزیه این لاین", `#/line/${p.line}`, "لاین فروشگاه", "spark", "با هم بخرید، چیدمان کامل‌تر می‌شود")}
               <div class="hscroll">${setItems.map((x) => productCard(x, true)).join("")}</div>`
            : ""
        }
        ${
          also.length
            ? `${sectionHead("خریداران این کالا، این‌ها را هم دیدند", `#/category/${p.cat}`, "مشاهده دسته", "bag")}
               <div class="hscroll">${also.map((x) => productCard(x, true)).join("")}</div>`
            : ""
        }
        ${sectionHead("کالاهای مشابه", p.line ? `#/line/${p.line}` : `#/category/${p.cat}`, "مشاهده همه", "star")}
        <div class="grid">${similar.map((x) => productCard(x)).join("")}</div>
        ${
          seen.length
            ? `${sectionHead("اخیراً دیده‌اید", "", "", "bag", "بر اساس بازدید همین دستگاه")}
               <div class="hscroll">${seen.map((x) => productCard(x, true)).join("")}</div>`
            : ""
        }
        <div class="p-lightbox" data-zoom hidden>
          <button type="button" class="p-zoom-x" data-zoom-close aria-label="بستن">×</button>
          <div class="p-zoom-stage">${thumb(p)}</div>
        </div>
      </section>
    `;
  }

  function ratingBars() {
    return [5, 4, 3, 2, 1]
      .map((star) => `<div class="rate-bar"><span>★ ${fa(star)}</span><i><b style="width:0%"></b></i><em>${fa(0)}</em></div>`)
      .join("");
  }

  function opinionCard(item, kind) {
    return `
      <article class="card op-card">
        <div class="info-head">
          ${dashIco(kind === "ask" ? "chat" : "star")}
          <div>
            <h3>${escapeHtml(item.name || "خریدار زنبیل")}</h3>
            <p>${faDate(item.createdAt)} · ${escapeHtml(item.status || "")}</p>
          </div>
        </div>
        ${kind === "ask" ? "" : reviewStars(item.rating)}
        <p class="op-text">${escapeHtml(item.text)}</p>
        ${item.answer ? `<div class="op-answer"><small>پاسخ فروشگاه زنبیل</small><p>${escapeHtml(item.answer)}</p></div>` : ""}
      </article>`;
  }

  function productReviewsBlock(p) {
    const mine = ((auth.current() || {}).reviews || []).filter((r) => Number(r.productId) === Number(p.id));
    const list = mine.map((r) => ({ ...r, name: auth.current().name }));
    const n = list.length;
    return `
      <div class="card p-ratebox">
        <div class="p-score">
          <b data-score-n>${n ? fa((list.reduce((s, r) => s + Number(r.rating || 0), 0) / n).toFixed(1).replace(".0", "")) : fa(0)}</b>
          <span>از ۵</span>
          <small><span data-review-count>${fa(n)}</span> دیدگاه ثبت‌شده</small>
        </div>
        <div class="p-bars">${ratingBars()}</div>
      </div>
      <div data-live-reviews>
        ${
          list.length
            ? list.map((r) => opinionCard(r, "review")).join("")
            : `<div class="card" data-empty-reviews><div class="info-head">${dashIco("star")}<div><h3>هنوز دیدگاهی نیست</h3><p>اولین نظر را شما بنویسید.</p></div></div></div>`
        }
      </div>
      <form class="card" data-review>
        <div class="info-head">${dashIco("star")}<div><h3>دیدگاه شما</h3><p>تجربه خرید این کالا را بنویسید</p></div></div>
        <input type="hidden" name="productId" value="${p.id}" />
        <div class="field">
          <label>امتیاز</label>
          <div class="star-pick">
            ${[5, 4, 3, 2, 1].map((n) => `<label><input type="radio" name="rating" value="${n}" ${n === 5 ? "checked" : ""} /><span>${"★".repeat(n)}</span></label>`).join("")}
          </div>
        </div>
        <div class="field">
          <label for="pRevText">متن دیدگاه</label>
          <textarea id="pRevText" name="text" placeholder="کیفیت، بسته‌بندی و تجربه خرید را بنویسید" required></textarea>
        </div>
        <p class="form-error" data-error></p>
        <button class="btn wide" type="submit">ثبت دیدگاه</button>
      </form>
    `;
  }

  function productAskBlock(p) {
    const mine = ((auth.current() || {}).questions || []).filter((q) => Number(q.productId) === Number(p.id));
    const list = mine.map((q) => ({ ...q, name: auth.current().name }));
    return `
      <div data-live-ask>
        ${
          list.length
            ? list.map((q) => opinionCard(q, "ask")).join("")
            : `<div class="card" data-empty-ask><div class="info-head">${dashIco("chat")}<div><h3>هنوز پرسشی نیست</h3><p>اولین سؤال را شما بپرسید.</p></div></div></div>`
        }
      </div>
      <form class="card" data-question>
        <div class="info-head">${dashIco("chat")}<div><h3>پرسش شما</h3><p>قبل از خرید از فروشگاه بپرسید</p></div></div>
        <input type="hidden" name="productId" value="${p.id}" />
        <div class="field">
          <label for="pAskText">متن پرسش</label>
          <textarea id="pAskText" name="text" placeholder="مثلاً این مدل برای جهیزیه چهارنفره مناسب است؟" required></textarea>
        </div>
        <p class="form-error" data-error></p>
        <button class="btn wide" type="submit">ثبت پرسش</button>
      </form>
    `;
  }

  function cartPage() {
    const items = cart.read().map((i) => ({ ...i, p: byId(i.id) })).filter((i) => i.p);
    if (!items.length) {
      return `
        <section class="account-page cart-page page">
          <div class="account-hero">
            <div class="account-stickers" aria-hidden="true">
              <span class="acc-sticker st-bag">${dashIco("bag")}</span>
              <span class="acc-sticker st-box">${dashIco("box")}</span>
              <span class="acc-sticker st-heart">${dashIco("heart")}</span>
            </div>
            <div class="profile-top">
              <div>
                <p class="account-hi">سبد خرید زنبیل</p>
                <h3>سبد خالی است</h3>
                <p class="account-phone">از پیشنهادهای جهیزیه شروع کنید</p>
              </div>
            </div>
          </div>
          ${emptyBox("bag", "هنوز کالایی نگذاشته‌اید", "همان قفسه‌های فروشگاه جهانشهر اینجاست", "#/", "مشاهده کالاها")}
        </section>
      `;
    }
    const sum = items.reduce((s, i) => s + i.p.price * i.qty, 0);
    const old = items.reduce((s, i) => s + (i.p.oldPrice || i.p.price) * i.qty, 0);
    const count = items.reduce((s, i) => s + i.qty, 0);
    return `
      <section class="account-page cart-page page">
        <div class="account-hero">
          <div class="account-stickers" aria-hidden="true">
            <span class="acc-sticker st-bag">${dashIco("bag")}</span>
            <span class="acc-sticker st-box">${dashIco("box")}</span>
            <span class="acc-sticker st-heart">${dashIco("heart")}</span>
          </div>
          <div class="profile-top">
            <span class="cart-mark" aria-hidden="true">
              <svg viewBox="0 0 32 32" fill="none"><path d="M9 12h14l-1 12.4a2 2 0 0 1-2 1.8h-8a2 2 0 0 1-2-1.8L9 12z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M12.2 12.1V9.6a3.8 3.8 0 0 1 7.6 0v2.5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>
              <i>${fa(count)}</i>
            </span>
            <div>
              <p class="account-hi">سبد خرید زنبیل</p>
              <h3>${fa(items.length)} کالا آماده سفارش</h3>
              <p class="account-phone">همان موجودی فروشگاه جهانشهر</p>
            </div>
          </div>
          <div class="dash-stats">
            <div>${dashIco("box")}<b>${fa(count)}</b><span>تعداد</span></div>
            <div>${dashIco("spark")}<b>${money(old - sum)}</b><span>سود شما</span></div>
            <div>${dashIco("pay")}<b>${money(sum)}</b><span>قابل پرداخت</span></div>
          </div>
        </div>
        <div class="dash-grid dash-stack pro-list">
          ${items
            .map(
              (i, n) => `
            <article class="dash-item cart-row" style="--i:${n + 1}">
              <a class="cart-thumb" href="#/product/${i.p.id}">${thumb(i.p)}</a>
              <a class="dash-copy" href="#/product/${i.p.id}">
                <span>${escapeHtml(i.p.title)}</span>
                <small>${escapeHtml(i.p.brand || "")} · ${money(i.p.price)} تومان</small>
              </a>
              <div class="qty">
                <button type="button" data-qty="${i.id}" data-d="1">+</button>
                <b>${fa(i.qty)}</b>
                <button type="button" data-qty="${i.id}" data-d="-1">−</button>
              </div>
            </article>`
            )
            .join("")}
        </div>
        <div class="card cart-foot">
          <div class="info-head">${dashIco("pay")}<div><h3>جمع سبد</h3><p>مرور مبلغ قبل از ثبت سفارش</p></div></div>
          <div class="row"><span>قیمت کالاها</span><b>${money(old)}</b></div>
          <div class="row"><span>سود شما از خرید</span><b class="money-save">${money(old - sum)}</b></div>
          <div class="row"><span>قابل پرداخت</span><b>${money(sum)} تومان</b></div>
          ${
            auth.current()
              ? `<a class="btn wide" href="#/checkout/address">ادامه و انتخاب آدرس</a>`
              : `<a class="btn wide" href="#/account?next=checkout">برای ثبت سفارش وارد حساب شوید</a>`
          }
        </div>
      </section>
    `;
  }

  function cartLines() {
    return cart
      .read()
      .map((i) => ({ ...i, p: byId(i.id) }))
      .filter((i) => i.p);
  }

  function cartTotals(items) {
    const sum = items.reduce((s, i) => s + i.p.price * i.qty, 0);
    const old = items.reduce((s, i) => s + (i.p.oldPrice || i.p.price) * i.qty, 0);
    return { sum, old, discount: old - sum, count: items.reduce((s, i) => s + i.qty, 0) };
  }

  const DRAFT_KEY = "zanbil-checkout";
  function draftGet() {
    try {
      return JSON.parse(sessionStorage.getItem(DRAFT_KEY)) || null;
    } catch {
      return null;
    }
  }
  function draftSet(data) {
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify(data));
  }
  function draftClear() {
    sessionStorage.removeItem(DRAFT_KEY);
  }

  function fullAddressText(address = {}) {
    return [
      address.text,
      address.plaque ? `پلاک ${address.plaque}` : "",
      address.unit ? `واحد ${address.unit}` : "",
      address.postalCode ? `کد پستی ${fa(address.postalCode)}` : "",
    ]
      .filter(Boolean)
      .join("، ");
  }

  function remainText(until) {
    const ms = Number(until) - Date.now();
    if (ms <= 0) return "";
    const hours = Math.floor(ms / 3600000);
    const minutes = Math.floor((ms % 3600000) / 60000);
    if (hours > 0) return `${fa(hours)} ساعت و ${fa(Math.max(minutes, 1))} دقیقه`;
    return `${fa(Math.max(minutes, 1))} دقیقه`;
  }

  function inquiryItemLabel(kind) {
    return { ok: "موجود در مغازه", out: "ناموجود", alt: "موجود با رنگ یا مدل دیگر" }[kind] || "در انتظار بررسی";
  }

  function checkoutSteps(active) {
    const labels = ["آدرس ارسال", "صورت‌حساب", "استعلام"];
    return `
      <ol class="steps">
        ${labels
          .map(
            (label, i) =>
              `<li class="${i + 1 <= active ? "on" : ""} ${i + 1 === active ? "now" : ""}"><b>${fa(i + 1)}</b>${label}</li>`
          )
          .join("")}
      </ol>
    `;
  }

  function checkoutPage(step, params) {
    if (!auth.current()) {
      return guestAccount("login", "checkout");
    }
    if (step === "success") return checkoutSuccessPage(params?.get("order") || "");
    const items = cartLines();
    if (!items.length) {
      return `
        ${emptyBox("bag", "سبد خرید خالی است", "برای ثبت سفارش اول کالا اضافه کنید", "#/", "بازگشت به فروشگاه")}
      `;
    }
    if (step === "invoice") {
      if (!draftGet()) return checkoutAddressPage(items);
      return checkoutInvoicePage(items);
    }
    if (step !== "address") return notFoundPage();
    return checkoutAddressPage(items);
  }

  function checkoutAddressPage(items) {
    const user = auth.current();
    const draft = draftGet() || {};
    const list = user.addresses || [];
    const selected = draft.addressId || (list[0] && list[0].id);
    const selectedAddress = list.find((address) => String(address.id) === String(selected)) || {};
    const fieldValue = (name) => escapeHtml(draft[name] ?? selectedAddress[name] ?? "");
    return `
      <section class="about page">
        ${pageHero({ ico: "pin", title: "آدرس ارسال", sub: "گیرنده و محل تحویل سفارش", tone: "teal" })}
        ${checkoutSteps(1)}
        <form class="card" data-checkout-addr>
          <div class="info-head">${dashIco("truck")}<div><h3>گیرنده سفارش</h3><p>نام و شماره کسی که بسته را می‌گیرد</p></div></div>
          <div class="field">
            <label for="shipName">نام گیرنده</label>
            <input id="shipName" name="receiver" type="text" value="${escapeHtml(draft.receiver || user.name)}" required />
          </div>
          <div class="field">
            <label for="shipPhone">موبایل گیرنده</label>
            <input id="shipPhone" name="phone" type="tel" inputmode="numeric" maxlength="11" autocomplete="tel" data-phone-input value="${escapeHtml(draft.phone || user.phone)}" required />
          </div>
          ${
            list.length
              ? `<h3>آدرس‌های ذخیره‌شده</h3>${list
                  .map(
                    (a) => `
                <label class="addr-pick ${String(selected) === String(a.id) ? "on" : ""}">
                  <input type="radio" name="addressId" value="${a.id}" data-title="${escapeHtml(a.title)}" data-text="${escapeHtml(a.text)}" data-postal-code="${escapeHtml(a.postalCode || "")}" data-plaque="${escapeHtml(a.plaque || "")}" data-unit="${escapeHtml(a.unit || "")}" ${String(selected) === String(a.id) ? "checked" : ""} />
                  <span><b>${escapeHtml(a.title)}</b><small>${escapeHtml(fullAddressText(a))}</small></span>
                </label>`
                  )
                  .join("")}
                <label class="addr-pick">
                  <input type="radio" name="addressId" value="new" data-title="" data-text="" data-postal-code="" data-plaque="" data-unit="" ${!list.length ? "checked" : ""} />
                  <span><b>ثبت آدرس جدید</b></span>
                </label>`
              : `<input type="hidden" name="addressId" value="new" /><p>آدرس ذخیره‌شده ندارید؛ پایین فرم را پر کنید.</p>`
          }
          <div class="field">
            <label for="shipTitle">عنوان نشانی</label>
            <input id="shipTitle" name="title" type="text" placeholder="خانه، محل کار" value="${fieldValue("title")}" required />
          </div>
          <div class="field">
            <label for="shipText">نشانی کامل</label>
            <textarea id="shipText" name="text" placeholder="استان، شهر، خیابان، کوچه" required>${fieldValue("text")}</textarea>
          </div>
          <div class="address-details-grid">
            <div class="field postal-field">
              <label for="shipPostalCode">کد پستی</label>
              <input id="shipPostalCode" name="postalCode" type="text" inputmode="numeric" maxlength="10" placeholder="۱۰ رقم بدون خط تیره" value="${fieldValue("postalCode")}" required />
            </div>
            <div class="field">
              <label for="shipPlaque">پلاک</label>
              <input id="shipPlaque" name="plaque" type="text" inputmode="numeric" maxlength="10" placeholder="مثلاً ۱۲" value="${fieldValue("plaque")}" required />
            </div>
            <div class="field">
              <label for="shipUnit">واحد</label>
              <input id="shipUnit" name="unit" type="text" inputmode="numeric" maxlength="10" placeholder="اختیاری" value="${fieldValue("unit")}" />
            </div>
          </div>
          <p class="form-error" data-error></p>
          <button class="btn wide" type="submit">ثبت آدرس و رفتن به صورت‌حساب</button>
        </form>
      </section>
    `;
  }

  function invoiceCoupon(draft, sum) {
    const coupon = draft?.coupon;
    if (!coupon) return null;
    if (coupon.subtotal !== sum) {
      delete draft.coupon;
      draftSet(draft);
      return null;
    }
    return coupon;
  }

  function checkoutInvoicePage(items) {
    const user = auth.current();
    const draft = draftGet();
    const { sum, old, discount, count } = cartTotals(items);
    const factor = draft.factor || String(140500000 + (Date.now() % 100000));
    if (!draft.factor) {
      draft.factor = factor;
      draftSet(draft);
    }
    const date = faDate(Date.now());
    const coupon = invoiceCoupon(draft, sum);
    const payable = sum - (coupon?.discount || 0);
    return `
      <section class="about page">
        ${pageHero({ ico: "sheba", title: "صورت‌حساب و فاکتور", sub: "مرور سفارش و ثبت درخواست استعلام", tone: "navy" })}
        ${checkoutSteps(2)}
        <article class="invoice card">
          <div class="invoice-top">
            <div>
              <b>فروشگاه زنبیل</b>
              <p>جهانشهر، کرج</p>
            </div>
            <div>
              <p>فاکتور ${fa(factor)}</p>
              <p>${date}</p>
            </div>
          </div>
          <div class="invoice-who">
            <p><span>خریدار</span> ${escapeHtml(draft.receiver || user.name)}</p>
            <p><span>موبایل</span> ${fa(draft.phone || user.phone)}</p>
            <p><span>آدرس ارسال</span> ${escapeHtml(draft.addressText || "")}</p>
          </div>
          <table class="invoice-table">
            <thead>
              <tr><th>کالا</th><th>تعداد</th><th>مبلغ</th></tr>
            </thead>
            <tbody>
              ${items
                .map(
                  (i) => `
                <tr>
                  <td>${escapeHtml(i.p.title)}</td>
                  <td>${fa(i.qty)}</td>
                  <td>${money(i.p.price * i.qty)}</td>
                </tr>`
                )
                .join("")}
            </tbody>
          </table>
          <div class="cart-foot invoice-totals">
            <div class="row"><span>جمع کالاها (${fa(count)} عدد)</span><b>${money(old)}</b></div>
            <div class="row"><span>تخفیف کالاها</span><b class="money-save">${money(discount)}</b></div>
            ${
              coupon
                ? `<div class="row"><span>کد تخفیف <bdi class="coupon-chip">${escapeHtml(coupon.code)}</bdi></span><b class="money-save">${money(coupon.discount)}</b></div>`
                : ""
            }
            <div class="row"><span>هزینه ارسال کرج</span><b>رایگان</b></div>
            <div class="row"><span>جمع سفارش</span><b>${money(payable)} تومان</b></div>
          </div>
        </article>
        <div class="card coupon-box">
          <div class="info-head">${dashIco("tag")}<div><h3>کد تخفیف</h3><p>اگر کد تخفیف دارید، اینجا وارد کنید</p></div></div>
          ${
            coupon
              ? `<div class="coupon-applied">
                  <div><b dir="ltr">${escapeHtml(coupon.code)}</b><span>${money(coupon.discount)} تومان از مبلغ فاکتور کم شد</span></div>
                  <button type="button" class="link" data-coupon-remove>حذف کد</button>
                </div>`
              : `<form class="coupon-form" data-coupon novalidate>
                  <input name="code" dir="ltr" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="20" placeholder="مثلاً ZANBIL10" aria-label="کد تخفیف" required />
                  <button class="btn" type="submit">اعمال</button>
                </form>
                <p class="form-error" data-error></p>`
          }
        </div>
        <div class="card pay-box inquiry-box">
          <div class="info-head">${dashIco("box")}<div><h3>استعلام موجودی</h3><p>موجودی مغازه جهانشهر بعد از ثبت درخواست بررسی می‌شود</p></div></div>
          ${checkoutSteps(3)}
          <p>با زدن دکمه استعلام، سفارش شما ثبت می‌شود. فروشگاه موجودی را بررسی می‌کند و نتیجه را در بخش اعلان‌ها می‌فرستد. پس از اعلام نتیجه، ۲۴ ساعت برای تأیید نهایی و پرداخت فرصت دارید.</p>
          <button class="btn wide" data-inquire>استعلام موجودی · ${money(payable)} تومان</button>
        </div>
      </section>
    `;
  }

  function searchPage(q) {
    const query = (q || "").trim();
    const list = searchProducts(query);
    return `
      <section class="page">
        ${pageHero({ ico: "search", title: query ? `جستجو برای «${escapeHtml(query)}»` : "جستجو", sub: list.length ? `${fa(list.length)} کالا پیدا شد` : "کالای موردنظر را بنویسید", tone: "gold" })}
        ${
          list.length
            ? `<div class="grid">${list.map((p) => productCard(p)).join("")}</div>`
            : emptyBox("search", "کالایی پیدا نشد", "مثلاً بنویسید قابلمه، چینی یا راف", "#/", "بازگشت به فروشگاه")
        }
      </section>
    `;
  }

  function notFoundPage() {
    return `
      <section class="page state-page">
        ${pageHero({ ico: "search", title: "این صفحه پیدا نشد", sub: "ممکن است آدرس تغییر کرده باشد", tone: "navy" })}
        ${emptyBox("search", "مسیر اشتباه است", "از صفحه اصلی دوباره مسیرتان را انتخاب کنید", "#/", "بازگشت به خانه")}
      </section>`;
  }

  function checkoutSuccessPage(orderId) {
    return `
      <section class="page state-page order-success inquiry-success">
        <div class="success-mark warn-mark" aria-hidden="true">
          <svg viewBox="0 0 64 64" fill="none"><circle cx="32" cy="32" r="27" stroke="currentColor" stroke-width="3"/><path d="M32 20v16M32 44.5h.1" stroke="currentColor" stroke-width="4" stroke-linecap="round"/></svg>
        </div>
        <p class="state-kicker warn-kicker">درخواست استعلام ثبت شد</p>
        <h1>سفارش شما با موفقیت ثبت شد</h1>
        <div class="inquiry-note">
          <b>لطفاً چند دقیقه صبر کنید</b>
          <p>برای اطمینان از موجودی مغازه جهانشهر، به کمی زمان نیاز داریم. نتیجه را در بخش اعلان‌های سایت برایتان می‌فرستیم.</p>
          <p>پس از اعلام نتیجه استعلام، ۲۴ ساعت برای تأیید نهایی و پرداخت فرصت دارید.</p>
        </div>
        <p>شماره پیگیری سفارش <b>${fa(orderId || "")}</b> است.</p>
        <div class="state-actions">
          <a class="btn" href="#/notifications">رفتن به اعلان‌ها</a>
          <a class="btn ghost" href="#/account/orders">پیگیری سفارش</a>
        </div>
      </section>`;
  }

  function orderNotificationMeta(order) {
    const status = String(order.status || "");
    const phase = String(order.phase || "");
    if (phase === "inquiry") return { title: "در حال استعلام موجودی", tone: "progress" };
    if (phase === "awaiting_customer") return { title: "نتیجه استعلام آماده است", tone: "progress" };
    if (phase === "expired") return { title: "مهلت تأیید استعلام تمام شد", tone: "danger" };
    if (phase === "unavailable") return { title: "کالاهای این سفارش موجود نبود", tone: "danger" };
    if (status.includes("تحویل شده")) return { title: "سفارشتان تحویل شد", tone: "success" };
    if (status.includes("لغو")) return { title: "سفارش لغو شد", tone: "danger" };
    if (status.includes("ارسال")) return { title: "سفارشتان در راه است", tone: "shipping" };
    if (status.includes("آماده") || status.includes("پرداخت")) return { title: "سفارش در حال آماده‌سازی است", tone: "progress" };
    return { title: "وضعیت سفارش به‌روزرسانی شد", tone: "default" };
  }

  function inquiryPayAmount(order, form) {
    const chosen = {};
    (order.items || []).forEach((item) => {
      if (item.inquiry === "alt") {
        const value = form?.querySelector(`[name="choice-${item.id}"]`)?.value || item.chosenColor || "";
        if (value) chosen[item.id] = value;
      }
    });
    const items = (order.items || []).filter((item) => item.inquiry === "ok" || (item.inquiry === "alt" && chosen[item.id]));
    const subtotal = items.reduce((s, item) => s + Number(item.price || 0) * Number(item.qty || 0), 0);
    return { count: items.length, total: Math.max(0, subtotal - Math.min(Number(order.couponDiscount || 0), subtotal)) };
  }

  function inquiryNotificationCard(order, unread) {
    const meta = orderNotificationMeta(order);
    const left = remainText(order.payUntil);
    const canPay = order.phase === "awaiting_customer" && Number(order.payUntil) > Date.now();
    const preview = inquiryPayAmount(order);
    return `
      <article class="notification-item notification-inquiry ${unread ? "is-unread" : ""}">
        <span class="notification-avatar tone-${meta.tone}">${dashIco("box")}</span>
        <div class="notification-copy">
          <b>${meta.title}</b>
          <span>سفارش شماره ${fa(order.id)} · ${escapeHtml(order.status || "")}</span>
          <small>${order.inquiryResultAt ? faDate(order.inquiryResultAt) : order.inquiredAt ? faDate(order.inquiredAt) : "ثبت شده"}</small>
          ${
            order.phase === "inquiry"
              ? `<div class="inquiry-wait">فروشگاه جهانشهر در حال بررسی موجودی این سفارش است. به‌محض آماده شدن نتیجه، همین‌جا خبرتان می‌کنیم.</div>`
              : ""
          }
          ${
            order.phase === "awaiting_customer" && canPay
              ? `<div class="inquiry-deadline">فقط ${left} برای تأیید نهایی و پرداخت فرصت دارید. بعد از این زمان، نتیجه استعلام باطل می‌شود.</div>`
              : ""
          }
          ${order.phase === "expired" ? `<div class="inquiry-expired">مهلت ۲۴ ساعته تمام شد و دیگر نمی‌توان این استعلام را تأیید کرد.</div>` : ""}
          <${canPay ? `form data-inquiry-pay="${order.id}"` : "div"}>
          <ul class="inquiry-items">
            ${(order.items || [])
              .map((item) => {
                const mark = item.inquiry || "pending";
                return `
                  <li class="inquiry-item is-${escapeHtml(mark)}">
                    <span class="inquiry-flag" aria-hidden="true"></span>
                    <span>
                      <b>${escapeHtml(item.title)}</b>
                      <small>${fa(item.qty)} عدد · ${inquiryItemLabel(mark)}</small>
                      ${
                        mark === "alt" && canPay
                          ? `<label class="inquiry-alt-pick">رنگ یا مدل موجود
                              <select name="choice-${item.id}" data-inquiry-choice="${order.id}">
                                <option value="">انتخاب کنید</option>
                                ${(item.altOptions || []).map((opt) => `<option value="${escapeHtml(opt)}" ${item.chosenColor === opt ? "selected" : ""}>${escapeHtml(opt)}</option>`).join("")}
                              </select>
                            </label>`
                          : mark === "alt" && item.chosenColor
                            ? `<small>انتخاب شما: ${escapeHtml(item.chosenColor)}</small>`
                            : mark === "alt"
                              ? `<small>پیشنهاد فروشگاه: ${(item.altOptions || []).map((opt) => escapeHtml(opt)).join("، ")}</small>`
                              : ""
                      }
                    </span>
                  </li>`;
              })
              .join("")}
          </ul>
          ${canPay ? `<button class="btn wide" type="submit" data-pay-amount>پرداخت ${money(preview.total)} تومان</button>` : ""}
          </${canPay ? "form" : "div"}>
        </div>
        ${unread ? `<i class="notification-unread" aria-label="خوانده‌نشده"></i>` : ""}
      </article>`;
  }

  function notificationsPage() {
    const user = auth.current();
    if (!user) return guestAccount("login", "notifications");
    const signature = notificationSignature(user);
    const wasUnread = !!signature && localStorage.getItem("zanbil-notifications-seen") !== signature;
    const orders = [...(user.orders || [])].sort(
      (a, b) => Number(b.inquiryResultAt || b.inquiredAt || b.paidAt || b.id || 0) - Number(a.inquiryResultAt || a.inquiredAt || a.paidAt || a.id || 0)
    );
    const orderItems = orders
      .map((order, index) => {
        const unread = index === 0 && wasUnread;
        if (["inquiry", "awaiting_customer", "expired", "unavailable"].includes(order.phase)) {
          return inquiryNotificationCard(order, unread);
        }
        const meta = orderNotificationMeta(order);
        return `
          <a class="notification-item ${unread ? "is-unread" : ""}" href="#/account/orders">
            <span class="notification-avatar tone-${meta.tone}">${dashIco("box")}</span>
            <span class="notification-copy">
              <b>${meta.title}</b>
              <span>سفارش شماره ${fa(order.id)} · ${escapeHtml(order.status || "ثبت شده")}</span>
              <small>${order.paidAt ? faDate(order.paidAt) : "سفارش ثبت‌شده"}</small>
            </span>
            ${unread ? `<i class="notification-unread" aria-label="خوانده‌نشده"></i>` : ""}
          </a>`;
      })
      .join("");
    localStorage.setItem("zanbil-notifications-seen", signature);
    markInquiryPushSeen();
    hidePhonePush();
    queueMicrotask(renderNotificationBadge);
    return `
      <section class="page notifications-page">
        ${pageHero({ ico: "chat", title: "اعلان‌های شما", sub: "نتیجه استعلام، سفارش و پیام‌های زنبیل", tone: "navy" })}
        <div class="notification-inbox">
          <header class="notification-inbox-head">
            <div><h3>پیام‌ها</h3><p>همه اتفاق‌های مهم خریدتان اینجا ثبت می‌شود.</p></div>
            <span>${fa(orders.length + 1)} پیام</span>
          </header>
          <div class="notification-list">
            ${orderItems}
            <article class="notification-item notification-system">
              <span class="notification-avatar tone-promo">${dashIco("spark")}</span>
              <span class="notification-copy">
                <b>زنبیل همیشه خبرتان می‌کند</b>
                <span>کدهای تخفیف، پیشنهادهای ویژه و خبرهای فروشگاه از این بخش برایتان ارسال می‌شوند.</span>
                <small>پیام فروشگاه</small>
              </span>
            </article>
          </div>
        </div>
      </section>`;
  }

  function loginForm(next, phone = "") {
    return `
      <form class="card" data-login data-next="${escapeHtml(next || "")}">
        <div class="info-head">${dashIco("user")}<div><h3>ورود به حساب</h3><p>با شماره موبایل فروشگاه وارد شوید</p></div></div>
        <div class="field">
          <label for="loginPhone">شماره موبایل</label>
          <input id="loginPhone" name="phone" type="tel" inputmode="numeric" maxlength="11" autocomplete="tel" data-phone-input placeholder="۰۹۱۲۳۴۵۶۷۸۹" value="${escapeHtml(phone)}" required />
        </div>
        <div class="field">
          <label for="loginPass">رمز عبور</label>
          <input id="loginPass" name="pass" type="password" placeholder="رمز حساب" required />
        </div>
        <button class="forgot-link" type="button" data-password-help>رمز عبور را فراموش کرده‌اید؟</button>
        <p class="form-error" data-error></p>
        <button class="btn wide" type="submit">ورود</button>
      </form>
    `;
  }

  function registerForm(next) {
    return `
      <form class="card" data-register data-next="${escapeHtml(next || "")}">
        <div class="info-head">${dashIco("spark")}<div><h3>ساخت حساب کاربری</h3><p>برای سفارش آنلاین زنبیل</p></div></div>
        <div class="field">
          <label for="regPhone">شماره موبایل</label>
          <input id="regPhone" name="phone" type="tel" inputmode="numeric" maxlength="11" autocomplete="tel" data-phone-input placeholder="۰۹۱۲۳۴۵۶۷۸۹" required />
          <small class="field-help">بعد از واردکردن ۱۱ رقم، شماره را بررسی می‌کنیم.</small>
        </div>
        <div class="phone-check" data-phone-check hidden aria-live="polite"></div>
        <div class="register-details" data-register-details hidden>
          <div class="register-details-head"><b>تکمیل مشخصات حساب</b><span>شماره برای ثبت‌نام آماده است</span></div>
          <div class="field">
            <label for="regFirstName">نام</label>
            <input id="regFirstName" name="firstName" type="text" autocomplete="given-name" placeholder="مثلاً سارا" required />
          </div>
          <div class="field">
            <label for="regLastName">نام خانوادگی</label>
            <input id="regLastName" name="lastName" type="text" autocomplete="family-name" placeholder="مثلاً محمدی" required />
          </div>
          <div class="field">
            <label for="regPass">رمز عبور</label>
            <input id="regPass" name="pass" type="password" minlength="8" autocomplete="new-password" data-password-input placeholder="حداقل ۸ کاراکتر انگلیسی" required />
            <ul class="password-rules" data-password-rules>
              <li data-password-rule="length">حداقل ۸ کاراکتر</li>
              <li data-password-rule="upper">حداقل یک حرف بزرگ انگلیسی</li>
              <li data-password-rule="lower">حداقل یک حرف کوچک انگلیسی</li>
              <li data-password-rule="number">حداقل یک عدد</li>
              <li data-password-rule="english">فقط حروف و علائم صفحه‌کلید انگلیسی</li>
            </ul>
          </div>
          <div class="field">
            <label for="regPass2">تکرار رمز عبور</label>
            <input id="regPass2" name="pass2" type="password" minlength="8" autocomplete="new-password" placeholder="دوباره رمز را بنویسید" required />
          </div>
          <div class="field">
            <label for="regAddress">آدرس ارسال (اختیاری)</label>
            <textarea id="regAddress" name="address" placeholder="کرج، جهانشهر، ..."></textarea>
          </div>
          <p class="form-error" data-error></p>
          <button class="btn wide" type="submit">ساخت حساب</button>
        </div>
      </form>
    `;
  }

  function accountPage(params, section) {
    const user = auth.current();
    const next = params.get("next") || section || "";
    if (!user) return guestAccount(params.get("tab") === "register" ? "register" : "login", next, params.get("phone") || "");
    if (section === "info") return infoPage(user);
    if (section === "sheba" || section === "finance") return financePage(user);
    if (section === "favorites") return favoritesPage(user);
    if (section === "orders") return ordersPage(user);
    if (section === "addresses") return addressesPage(user);
    if (section === "opinions") return opinionsPage(user, params.get("tab") === "questions" ? "questions" : "reviews");
    if (!section) return dashboardPage(user);
    return notFoundPage();
  }

  function guestAccount(tab, next, phone = "") {
    const q = next ? `&next=${encodeURIComponent(next)}` : "";
    const phoneQuery = phone ? `&phone=${encodeURIComponent(phone)}` : "";
    return `
      <section class="auth page">
        ${pageHero({ ico: "user", title: "حساب کاربری", sub: next ? "برای ادامه این بخش وارد شوید" : "ورود یا ساخت حساب زنبیل", tone: "rose" })}
        ${
          next
            ? `<div class="card"><div class="info-head">${dashIco("shield")}<div><h3>ورود لازم است</h3><p>برای دیدن این بخش باید وارد حساب کاربری شوید.</p></div></div></div>`
            : ""
        }
        <div class="auth-tabs">
          <a class="${tab === "login" ? "on" : ""}" href="#/account?tab=login${q}${phoneQuery}">ورود</a>
          <a class="${tab === "register" ? "on" : ""}" href="#/account?tab=register${q}">ثبت‌نام</a>
        </div>
        ${tab === "register" ? registerForm(next) : loginForm(next, phone)}
        <p class="auth-switch">
          ${
            tab === "register"
              ? `حساب دارید؟ <a class="link" href="#/account?tab=login${q}${phoneQuery}">وارد شوید</a>`
              : `حساب ندارید؟ <a class="link" href="#/account?tab=register${q}">حساب بسازید</a>`
          }
        </p>
      </section>
    `;
  }

  function panelHead(title, opts = {}) {
    return pageHero({
      ico: opts.ico || "user",
      title,
      sub: opts.sub || "",
      tone: opts.tone || "navy",
    });
  }

  function dashIco(name) {
    const icons = {
      bag: `<svg viewBox="0 0 32 32" fill="none"><path d="M8.5 11.2h15l-1.1 13.1a2.2 2.2 0 0 1-2.2 2H11.8a2.2 2.2 0 0 1-2.2-2L8.5 11.2z" fill="currentColor" opacity=".18"/><path d="M9 12h14l-1 12.4a2 2 0 0 1-2 1.8h-8a2 2 0 0 1-2-1.8L9 12z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M12.2 12.1V9.6a3.8 3.8 0 0 1 7.6 0v2.5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>`,
      box: `<svg viewBox="0 0 32 32" fill="none"><path d="M6.5 12.2 16 7.4l9.5 4.8L16 16.8 6.5 12.2z" fill="currentColor" opacity=".18"/><path d="M7 12.4 16 8l9 4.4v10.2L16 27l-9-4.4V12.4z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M16 16.8V27M7 12.4l9 4.4 9-4.4" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>`,
      heart: `<svg viewBox="0 0 32 32" fill="none"><path d="M16 26s-8.4-5.4-10.6-10.2A5.7 5.7 0 0 1 16 9.4a5.7 5.7 0 0 1 10.6 6.4C24.4 20.6 16 26 16 26z" fill="currentColor" opacity=".2"/><path d="M16 24.8s-7.6-4.9-9.6-9.3A5.1 5.1 0 0 1 16 10.2a5.1 5.1 0 0 1 9.6 5.3c-2 4.4-9.6 9.3-9.6 9.3z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>`,
      user: `<svg viewBox="0 0 32 32" fill="none"><circle cx="16" cy="12" r="4.4" fill="currentColor" opacity=".18"/><circle cx="16" cy="12" r="4.2" stroke="currentColor" stroke-width="1.7"/><path d="M7.6 24.6c1.4-4 4.6-6 8.4-6s7 2 8.4 6" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>`,
      sheba: `<svg viewBox="0 0 32 32" fill="none"><rect x="5.5" y="9" width="21" height="14.5" rx="3" fill="currentColor" opacity=".16"/><rect x="6.2" y="9.6" width="19.6" height="13.2" rx="2.4" stroke="currentColor" stroke-width="1.7"/><path d="M6.2 14.4h19.6M10 20.2h6" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>`,
      pin: `<svg viewBox="0 0 32 32" fill="none"><path d="M16 26.4s-7.2-7-7.2-12.1a7.2 7.2 0 1 1 14.4 0C23.2 19.4 16 26.4 16 26.4z" fill="currentColor" opacity=".16"/><path d="M16 25.2s-6.5-6.3-6.5-11a6.5 6.5 0 1 1 13 0c0 4.7-6.5 11-6.5 11z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><circle cx="16" cy="14" r="2.3" fill="currentColor"/></svg>`,
      store: `<svg viewBox="0 0 32 32" fill="none"><path d="M7 13.2 8.4 8h15.2L25 13.2a3.3 3.3 0 0 1-3.4 2.8 3.2 3.2 0 0 1-3.1-2.2 3.2 3.2 0 0 1-6 0A3.2 3.2 0 0 1 9.4 16 3.3 3.3 0 0 1 7 13.2z" fill="currentColor" opacity=".16"/><path d="M8 14.2 9.2 8.6h13.6L24 14.2a2.6 2.6 0 0 1-2.8 2.2 2.6 2.6 0 0 1-2.6-2 2.6 2.6 0 0 1-5.2 0 2.6 2.6 0 0 1-2.6 2A2.6 2.6 0 0 1 8 14.2z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M9.4 16.2V24h13.2v-7.8M14.2 24v-5.2h3.6V24" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>`,
      shield: `<svg viewBox="0 0 32 32" fill="none"><path d="M16 6.6 25 10v7.4c0 5.6-3.8 8.8-9 10.6-5.2-1.8-9-5-9-10.6V10l9-3.4z" fill="currentColor" opacity=".16"/><path d="M16 7.4 24.2 10.6v6.8c0 5-3.4 7.9-8.2 9.6-4.8-1.7-8.2-4.6-8.2-9.6V10.6L16 7.4z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="m12.4 16.1 2.6 2.6 4.8-5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
      out: `<svg viewBox="0 0 32 32" fill="none"><path d="M7 8.6h10.4A2.6 2.6 0 0 1 20 11.2v9.6a2.6 2.6 0 0 1-2.6 2.6H7" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><path d="M13.2 16H26M22.4 12.4 26 16l-3.6 3.6" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
      search: `<svg viewBox="0 0 32 32" fill="none"><circle cx="14.2" cy="14.2" r="6.4" fill="currentColor" opacity=".16"/><circle cx="14.2" cy="14.2" r="6.2" stroke="currentColor" stroke-width="1.7"/><path d="m19 19 6 6" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>`,
      spark: `<svg viewBox="0 0 32 32" fill="none"><path d="M16 5.5 18.2 13 26 16l-7.8 3L16 26.5 13.8 19 6 16l7.8-3L16 5.5z" fill="currentColor" opacity=".16"/><path d="M16 6.4 18 13.2 25.2 16 18 18.8 16 25.6 14 18.8 6.8 16 14 13.2 16 6.4z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M24 6.5v4M26 8.5h-4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`,
      truck: `<svg viewBox="0 0 32 32" fill="none"><path d="M5 11h14v10H5V11z" fill="currentColor" opacity=".16"/><path d="M5.6 12h13.2v9.2H5.6V12z" stroke="currentColor" stroke-width="1.7"/><path d="M18.8 15.2h5.2L27 18.6v2.6h-8.2" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><circle cx="10.2" cy="23.2" r="2" stroke="currentColor" stroke-width="1.7"/><circle cx="22.4" cy="23.2" r="2" stroke="currentColor" stroke-width="1.7"/></svg>`,
      star: `<svg viewBox="0 0 32 32" fill="none"><path d="m16 6.4 2.7 6.3 6.9.7-5.2 4.6 1.5 6.7L16 21.2 10.1 24.7l1.5-6.7-5.2-4.6 6.9-.7L16 6.4z" fill="currentColor" opacity=".16"/><path d="m16 7.2 2.4 5.6 6.1.6-4.6 4.1 1.3 6-5.2-3.1-5.2 3.1 1.3-6-4.6-4.1 6.1-.6L16 7.2z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>`,
      chat: `<svg viewBox="0 0 32 32" fill="none"><path d="M7 8.6h18v12.2H13.2L7 24.6V8.6z" fill="currentColor" opacity=".16"/><path d="M8 9.4h16v10.6h-9.4L8 23.2V9.4z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M12 13.6h8M12 16.8h5.4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>`,
      pay: `<svg viewBox="0 0 32 32" fill="none"><circle cx="16" cy="16" r="9" fill="currentColor" opacity=".16"/><circle cx="16" cy="16" r="8.4" stroke="currentColor" stroke-width="1.7"/><path d="M16 11.2v9.6M13.2 13.6c.6-1 1.6-1.6 2.8-1.6 1.6 0 2.8 1 2.8 2.4 0 3.2-5.6 1.8-5.6 4.8 0 1.4 1.3 2.4 2.8 2.4 1.2 0 2.2-.6 2.8-1.6" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>`,
      tag: `<svg viewBox="0 0 32 32" fill="none"><path d="M6 10.5A2.5 2.5 0 0 1 8.5 8h15A2.5 2.5 0 0 1 26 10.5V13a3 3 0 0 0 0 6v2.5a2.5 2.5 0 0 1-2.5 2.5h-15A2.5 2.5 0 0 1 6 21.5V19a3 3 0 0 0 0-6v-2.5z" fill="currentColor" opacity=".16"/><path d="M6.8 10.6c0-.9.7-1.7 1.7-1.7h15c1 0 1.7.8 1.7 1.7v2.1a3.4 3.4 0 0 0 0 6.6v2.1c0 .9-.7 1.7-1.7 1.7h-15c-1 0-1.7-.8-1.7-1.7v-2.1a3.4 3.4 0 0 0 0-6.6v-2.1z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="m13 19 6-6" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><circle cx="13.4" cy="13.4" r="1.2" fill="currentColor"/><circle cx="18.6" cy="18.6" r="1.2" fill="currentColor"/></svg>`,
    };
    return `<span class="dash-ico i-${name}" aria-hidden="true">${icons[name] || icons.bag}</span>`;
  }

  function pageHero({ ico = "bag", title, sub = "", tone = "rose" } = {}) {
    return `
      <header class="page-hero tone-${tone}">
        <div class="account-stickers" aria-hidden="true">
          <span class="acc-sticker st-bag">${dashIco("bag")}</span>
          <span class="acc-sticker st-box">${dashIco("box")}</span>
          <span class="acc-sticker st-heart">${dashIco("heart")}</span>
        </div>
        <div class="page-hero-row">
          ${dashIco(ico)}
          <div>
            <h2>${title}</h2>
            ${sub ? `<p>${sub}</p>` : ""}
          </div>
        </div>
      </header>
    `;
  }

  function emptyBox(ico, title, text, href, btn) {
    return `
      <section class="empty empty-pro">
        <div class="empty-sticker">${dashIco(ico)}</div>
        <h3>${title}</h3>
        ${text ? `<p>${text}</p>` : ""}
        ${href ? `<p class="empty-act"><a class="btn" href="${href}">${btn || "بازگشت"}</a></p>` : ""}
      </section>
    `;
  }

  function sectionHead(title, href, linkText, ico, sub) {
    return `
      <div class="section-head">
        <div class="section-title">
          ${ico ? dashIco(ico) : ""}
          <div>
            <h3>${title}</h3>
            ${sub ? `<small class="picks-why">${sub}</small>` : ""}
          </div>
        </div>
        ${href ? `<a href="${href}">${linkText || "مشاهده همه"}</a>` : ""}
      </div>
    `;
  }

  function dashRow(href, ico, title, sub, i) {
    return `<a class="dash-item" href="${href}" style="--i:${i}">${dashIco(ico)}<span class="dash-copy"><span>${title}</span><small>${sub}</small></span><span class="dash-go" aria-hidden="true">‹</span></a>`;
  }

  function dashboardPage(user) {
    const orders = user.orders || [];
    const favs = user.favorites || [];
    return `
      <section class="account-page page">
        <div class="account-hero">
          <div class="account-stickers" aria-hidden="true">
            <span class="acc-sticker st-bag">${dashIco("bag")}</span>
            <span class="acc-sticker st-box">${dashIco("box")}</span>
            <span class="acc-sticker st-heart">${dashIco("heart")}</span>
          </div>
          <div class="profile-top">
            <span class="avatar account-ava">${escapeHtml(user.name.trim().charAt(0) || "ز")}</span>
            <div>
              <p class="account-hi">خوش آمدید به زنبیل</p>
              <h3>${escapeHtml(user.name)}</h3>
              <p class="account-phone">${fa(user.phone)}</p>
              <p class="ok-tag">حساب فعال است</p>
            </div>
          </div>
          <div class="dash-stats">
            <a href="#/account/orders">${dashIco("box")}<b>${fa(orders.length)}</b><span>سفارش</span></a>
            <a href="#/account/favorites">${dashIco("heart")}<b>${fa(favs.length)}</b><span>علاقه‌مندی</span></a>
            <a href="#/account/sheba">${dashIco("sheba")}<b>${user.sheba ? "۱" : "۰"}</b><span>مالی</span></a>
          </div>
        </div>
        ${
          user.mustChangePassword
            ? `<a class="password-alert" href="#/account/info">${dashIco("shield")}<div><b>هنوز از رمز موقت استفاده می‌کنید</b><p>برای امنیت حساب، رمز شخصی خودتان را ثبت کنید.</p></div></a>`
            : ""
        }
        ${
          user.admin
            ? `<a class="dash-item dash-admin" href="#/admin" style="--i:0">${dashIco("shield")}<span class="dash-copy"><em class="admin-badge">دسترسی مدیر</em><span>پنل مدیریت</span><small>محصولات، سفارش‌ها و پشتیبانی فروشگاه</small></span><span class="dash-go" aria-hidden="true">‹</span></a>`
            : ""
        }
        <div class="dash-grid dash-stack">
          ${dashRow("#/account/orders", "box", "سفارش‌های من", "پیگیری خریدها", 1)}
          ${dashRow("#/account/favorites", "heart", "علاقه‌مندی‌ها", "کالاهای ذخیره‌شده", 2)}
          ${dashRow("#/account/opinions", "chat", "دیدگاه و پرسش‌ها", "نظر و سؤال درباره کالاها", 3)}
          ${dashRow("#/account/info", "user", "اطلاعات حساب", "ویرایش مشخصات", 4)}
          ${dashRow("#/account/sheba", "sheba", "مالی", "شماره شبا و مرجوعی وجه", 5)}
          ${dashRow("#/account/addresses", "pin", "آدرس‌ها", "محل ارسال سفارش", 6)}
          ${dashRow("#/about", "store", "فروشگاه زنبیل", "آدرس جهانشهر و مسیریابی", 7)}
        </div>
        <button class="dash-item dash-out" type="button" data-logout style="--i:7">
          ${dashIco("out")}
          <span class="dash-copy"><span>خروج از حساب</span><small>نشست فعلی بسته می‌شود</small></span>
          <span class="dash-go" aria-hidden="true">‹</span>
        </button>
      </section>
    `;
  }

  function infoPage(user) {
    return `
      <section class="about page">
        ${panelHead("اطلاعات حساب", { ico: "user", sub: "نام، تماس و اطلاعات هویتی", tone: "navy" })}
        ${
          user.mustChangePassword
            ? `<div class="password-alert">${dashIco("shield")}<div><b>رمز موقت را تغییر دهید</b><p>برای امنیت حساب، یک رمز شخصی و قوی انتخاب کنید.</p></div></div>`
            : ""
        }
        <form class="card" data-profile>
          <div class="info-head">
            ${dashIco("user")}
            <div>
              <h3>مشخصات فردی</h3>
              <p>نام، تماس و اطلاعات هویتی حساب</p>
            </div>
          </div>
          <div class="field">
            <label for="profName">نام و نام خانوادگی</label>
            <input id="profName" name="name" type="text" value="${escapeHtml(user.name)}" required />
          </div>
          <div class="field">
            <label>شماره موبایل</label>
            <input type="tel" value="${fa(user.phone)}" disabled />
          </div>
          <div class="field">
            <label for="profEmail">ایمیل</label>
            <input id="profEmail" name="email" type="email" placeholder="name@email.com" value="${escapeHtml(user.email || "")}" />
          </div>
          <div class="field">
            <label for="profNid">کد ملی</label>
            <input id="profNid" name="nationalId" inputmode="numeric" maxlength="10" placeholder="۱۰ رقم" value="${escapeHtml(user.nationalId || "")}" />
          </div>
          <div class="field">
            <label for="profBirth">تاریخ تولد</label>
            <input id="profBirth" name="birthday" type="text" placeholder="۱۳۷۸/۰۱/۱۵" value="${escapeHtml(user.birthday || "")}" />
          </div>
          <div class="field">
            <label for="profJob">شغل</label>
            <input id="profJob" name="job" type="text" placeholder="اختیاری" value="${escapeHtml(user.job || "")}" />
          </div>
          <p class="form-error" data-error></p>
          <button class="btn wide" type="submit">ذخیره اطلاعات</button>
        </form>
        <form class="card" data-password-change>
          <div class="info-head">${dashIco("shield")}<div><h3>تغییر رمز عبور</h3><p>رمز جدید فقط با حروف و علائم انگلیسی</p></div></div>
          <div class="field">
            <label for="currentPassword">رمز عبور فعلی</label>
            <input id="currentPassword" name="currentPassword" type="password" autocomplete="current-password" required />
          </div>
          <div class="field">
            <label for="newPassword">رمز عبور جدید</label>
            <input id="newPassword" name="newPassword" type="password" minlength="8" autocomplete="new-password" data-password-input required />
            <ul class="password-rules" data-password-rules>
              <li data-password-rule="length">حداقل ۸ کاراکتر</li>
              <li data-password-rule="upper">حداقل یک حرف بزرگ انگلیسی</li>
              <li data-password-rule="lower">حداقل یک حرف کوچک انگلیسی</li>
              <li data-password-rule="number">حداقل یک عدد</li>
              <li data-password-rule="english">فقط حروف و علائم انگلیسی</li>
            </ul>
          </div>
          <div class="field">
            <label for="newPasswordRepeat">تکرار رمز عبور جدید</label>
            <input id="newPasswordRepeat" name="newPasswordRepeat" type="password" minlength="8" autocomplete="new-password" required />
          </div>
          <p class="form-error" data-error></p>
          <button class="btn wide" type="submit">ثبت رمز جدید</button>
        </form>
      </section>
    `;
  }

  function formatSheba(s) {
    return String(s || "").replace(/(.{4})/g, "$1 ").trim();
  }

  const jalaliFormat = new Intl.DateTimeFormat("en-US-u-ca-persian-nu-latn", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  function faDate(ts) {
    const parts = Object.fromEntries(
      jalaliFormat.formatToParts(new Date(ts || Date.now())).map((p) => [p.type, p.value])
    );
    return fa(`${parts.year}/${parts.month}/${parts.day}`);
  }

  function productPickRow(p) {
    return `
      <button type="button" class="pick-opt" data-pick-id="${p.id}">
        <span class="pick-thumb">${thumb(p)}</span>
        <span class="pick-meta">
          <b>${escapeHtml(p.title)}</b>
          <small>${escapeHtml(p.brand || "")} · ${escapeHtml(catName(p.cat))}</small>
        </span>
      </button>
    `;
  }

  function productPicker() {
    return `
      <div class="product-picker" data-picker>
        <input type="hidden" name="productId" value="" />
        <button type="button" class="pick-face" data-pick-open>
          <span class="pick-placeholder">
            ${dashIco("search")}
            <span>نام کالا را جستجو و انتخاب کنید</span>
          </span>
        </button>
        <div class="pick-drop" hidden>
          <div class="pick-search">
            <input type="search" data-pick-q placeholder="مثلاً قابلمه، سینی، بانکه..." autocomplete="off" />
          </div>
          <div class="pick-list" data-pick-list>
            ${products.slice(0, 8).map(productPickRow).join("")}
          </div>
        </div>
      </div>
    `;
  }

  function opinionsPage(user, tab) {
    const reviews = user.reviews || [];
    const questions = user.questions || [];
    const isQ = tab === "questions";
    return `
      <section class="about page">
        ${panelHead("دیدگاه و پرسش‌ها", { ico: "chat", sub: "نظر و سؤال شما درباره کالاهای زنبیل", tone: "navy" })}
        <div class="auth-tabs">
          <a class="${!isQ ? "on" : ""}" href="#/account/opinions?tab=reviews">دیدگاه‌ها (${fa(reviews.length)})</a>
          <a class="${isQ ? "on" : ""}" href="#/account/opinions?tab=questions">پرسش‌ها (${fa(questions.length)})</a>
        </div>
        ${isQ ? questionsBlock(questions) : reviewsBlock(reviews)}
      </section>
    `;
  }

  function reviewStars(n) {
    const r = Math.min(5, Math.max(1, Number(n) || 5));
    return `<span class="op-stars">${"★".repeat(r)}<span>${"★".repeat(5 - r)}</span></span>`;
  }

  function reviewsBlock(list) {
    return `
      ${
        list.length
          ? list
              .map((r) => {
                const p = byId(r.productId);
                return `
            <article class="card op-card">
              <div class="info-head">
                ${p ? `<span class="pick-thumb">${thumb(p)}</span>` : dashIco("star")}
                <div>
                  <h3>${p ? escapeHtml(p.title) : "کالا"}</h3>
                  <p>${faDate(r.createdAt)} · ${escapeHtml(r.status || "در انتظار بررسی")}</p>
                </div>
              </div>
              ${reviewStars(r.rating)}
              <p class="op-text">${escapeHtml(r.text)}</p>
              <button type="button" class="link" data-del-review="${r.id}">حذف دیدگاه</button>
            </article>`;
              })
              .join("")
          : `<div class="card"><div class="info-head">${dashIco("star")}<div><h3>دیدگاهی نیست</h3><p>هنوز دیدگاهی برای کالاها ثبت نکرده‌اید.</p></div></div></div>`
      }
      <form class="card" data-review>
        <div class="info-head">${dashIco("star")}<div><h3>ثبت دیدگاه</h3><p>امتیاز و نظرتان را درباره یک کالا بنویسید</p></div></div>
        <div class="field">
          <label>انتخاب کالا</label>
          ${productPicker()}
        </div>
        <div class="field">
          <label>امتیاز</label>
          <div class="star-pick">
            ${[5, 4, 3, 2, 1].map((n) => `<label><input type="radio" name="rating" value="${n}" ${n === 5 ? "checked" : ""} /><span>${"★".repeat(n)}</span></label>`).join("")}
          </div>
        </div>
        <div class="field">
          <label for="revText">متن دیدگاه</label>
          <textarea id="revText" name="text" placeholder="کیفیت، بسته‌بندی و تجربه خرید را بنویسید" required></textarea>
        </div>
        <p class="form-error" data-error></p>
        <button class="btn wide" type="submit">ثبت دیدگاه</button>
      </form>
    `;
  }

  function questionsBlock(list) {
    return `
      ${
        list.length
          ? list
              .map((q) => {
                const p = byId(q.productId);
                return `
            <article class="card op-card">
              <div class="info-head">
                ${p ? `<span class="pick-thumb">${thumb(p)}</span>` : dashIco("chat")}
                <div>
                  <h3>${p ? escapeHtml(p.title) : "کالا"}</h3>
                  <p>${faDate(q.createdAt)} · ${escapeHtml(q.status || "در انتظار پاسخ")}</p>
                </div>
              </div>
              <p class="op-text">${escapeHtml(q.text)}</p>
              ${q.answer ? `<div class="op-answer"><small>پاسخ فروشگاه</small><p>${escapeHtml(q.answer)}</p></div>` : ""}
              <button type="button" class="link" data-del-question="${q.id}">حذف پرسش</button>
            </article>`;
              })
              .join("")
          : `<div class="card"><div class="info-head">${dashIco("chat")}<div><h3>پرسشی نیست</h3><p>هنوز پرسشی درباره کالاها نپرسیده‌اید.</p></div></div></div>`
      }
      <form class="card" data-question>
        <div class="info-head">${dashIco("chat")}<div><h3>ثبت پرسش</h3><p>قبل از خرید، از فروشگاه بپرسید</p></div></div>
        <div class="field">
          <label>انتخاب کالا</label>
          ${productPicker()}
        </div>
        <div class="field">
          <label for="askText">پرسش شما</label>
          <textarea id="askText" name="text" placeholder="مثلاً این مدل برای جهیزیه چهارنفره مناسب است؟" required></textarea>
        </div>
        <p class="form-error" data-error></p>
        <button class="btn wide" type="submit">ثبت پرسش</button>
      </form>
    `;
  }

  function financePage(user) {
    return `
      <section class="about page">
        ${panelHead("مالی", { ico: "sheba", sub: "شماره شبا برای واریز وجه مرجوعی", tone: "gold" })}
        <form class="card" data-sheba>
          <div class="info-head">
            ${dashIco("sheba")}
            <div>
              <h3>شماره شبا</h3>
              <p>برای واریز وجه مرجوعی یا لغو سفارش</p>
            </div>
          </div>
          ${
            user.sheba
              ? `<div class="sheba-box"><small>شبای ثبت‌شده</small><b>${formatSheba(user.sheba)}</b><span>${escapeHtml(user.shebaOwner || user.name)}</span></div>`
              : `<p class="info-hint">هنوز شماره‌ای ثبت نکرده‌اید.</p>`
          }
          <div class="field">
            <label for="shebaOwner">نام صاحب حساب</label>
            <input id="shebaOwner" name="shebaOwner" type="text" value="${escapeHtml(user.shebaOwner || user.name)}" required />
          </div>
          <div class="field">
            <label for="shebaNum">شماره شبا</label>
            <input id="shebaNum" name="sheba" type="text" inputmode="text" placeholder="IR۰۰xxxxxxxxxxxxxxxxxxxxxx" value="${escapeHtml(user.sheba || "")}" required />
          </div>
          <p class="form-error" data-error></p>
          <button class="btn wide" type="submit">${user.sheba ? "ویرایش شماره شبا" : "افزودن شماره شبا"}</button>
        </form>
      </section>
    `;
  }

  function favoritesPage(user) {
    const list = (user.favorites || []).map((id) => byId(id)).filter(Boolean);
    return `
      <section class="page">
        ${panelHead("علاقه‌مندی‌ها", { ico: "heart", sub: "کالاهایی که برای بعد ذخیره کردید", tone: "rose" })}
        ${
          list.length
            ? `<div class="grid">${list.map((p) => productCard(p)).join("")}</div>`
            : emptyBox("heart", "لیست علاقه‌مندی خالی است", "روی قلب کالاها بزنید تا اینجا ذخیره شوند", "#/", "مشاهده کالاها")
        }
      </section>
    `;
  }

  function ordersPage(user) {
    const orders = user.orders || [];
    return `
      <section class="about page">
        ${panelHead("سفارش‌های من", { ico: "box", sub: "پیگیری خریدهای ثبت‌شده", tone: "navy" })}
        <div class="card">
          ${
            orders.length
              ? orders
                  .map(
                    (o) => `
                <div class="order-item">
                  <div class="row row-tight">
                    <b>فاکتور ${fa(o.id)}</b>
                    <span class="ok-tag">${escapeHtml(o.status)}</span>
                  </div>
                  <div class="row row-sub">
                    <span>${fa(o.count)} کالا</span>
                    <span>${money(o.total)} تومان</span>
                  </div>
                  ${o.address ? `<p class="order-address">${escapeHtml(o.receiver || "")} — ${escapeHtml(o.address)}</p>` : ""}
                  ${o.phase === "awaiting_customer" ? `<a class="link" href="#/notifications">دیدن نتیجه استعلام و پرداخت</a>` : ""}
                </div>`
                  )
                  .join("")
              : `<div class="info-head">${dashIco("box")}<div><h3>سفارشی نیست</h3><p>هنوز سفارشی ثبت نشده است.</p></div></div>`
          }
        </div>
      </section>
    `;
  }

  function addressesPage(user) {
    const list = user.addresses || [];
    return `
      <section class="about page">
        ${panelHead("آدرس‌ها", { ico: "pin", sub: "محل‌های ارسال سفارش", tone: "teal" })}
        ${
          list.length
            ? list
                .map(
                  (a) => `
              <div class="card">
                <div class="info-head">${dashIco("pin")}<div><h3>${escapeHtml(a.title)}</h3><p>${escapeHtml(fullAddressText(a))}</p></div></div>
                <button type="button" class="link" data-del-address="${a.id}">حذف آدرس</button>
              </div>`
                )
                .join("")
            : `<div class="card"><div class="info-head">${dashIco("pin")}<div><h3>آدرسی نیست</h3><p>آدرسی ثبت نشده است.</p></div></div></div>`
        }
        <form class="card" data-address>
          <div class="info-head">${dashIco("pin")}<div><h3>افزودن آدرس</h3><p>خانه، محل کار یا هر نشانی دیگر</p></div></div>
          <div class="field">
            <label for="addrTitle">عنوان</label>
            <input id="addrTitle" name="title" type="text" placeholder="خانه، محل کار" required />
          </div>
          <div class="field">
            <label for="addrText">آدرس کامل</label>
            <textarea id="addrText" name="text" placeholder="استان، شهر، خیابان، کوچه" required></textarea>
          </div>
          <div class="address-details-grid">
            <div class="field postal-field">
              <label for="addrPostalCode">کد پستی</label>
              <input id="addrPostalCode" name="postalCode" type="text" inputmode="numeric" maxlength="10" placeholder="۱۰ رقم بدون خط تیره" required />
            </div>
            <div class="field">
              <label for="addrPlaque">پلاک</label>
              <input id="addrPlaque" name="plaque" type="text" inputmode="numeric" maxlength="10" placeholder="مثلاً ۱۲" required />
            </div>
            <div class="field">
              <label for="addrUnit">واحد</label>
              <input id="addrUnit" name="unit" type="text" inputmode="numeric" maxlength="10" placeholder="اختیاری" />
            </div>
          </div>
          <p class="form-error" data-error></p>
          <button class="btn wide" type="submit">ذخیره آدرس</button>
        </form>
      </section>
    `;
  }

  function aboutPage() {
    return `
      <section class="about page">
        ${pageHero({ ico: "store", title: store.name, sub: store.tagline, tone: "rose" })}
        <div class="card">
          <div class="info-head">${dashIco("bag")}<div><h3>فروشگاه جهانشهر</h3><p>همین کالاها را حضوری و آنلاین می‌توانید ببینید</p></div></div>
          <p>${store.tagline}. فروشگاه حضوری ما در ${store.city} است و همین کالاها را می‌توانید آنلاین هم انتخاب کنید.</p>
        </div>
        <div class="card">
          <div class="info-head">${dashIco("pin")}<div><h3>آدرس و ساعت</h3><p>برای خرید حضوری یا تحویل از مغازه</p></div></div>
          <p>${store.address}</p>
          <p>${store.hours}</p>
          <p>تلفن: ${store.phone}</p>
          <p class="store-actions">
            <a class="btn" href="${store.mapsUrl}" target="_blank" rel="noreferrer">مسیریابی</a>
            <a class="btn ghost" href="${store.instagramUrl}" target="_blank" rel="noreferrer">اینستاگرام</a>
          </p>
        </div>
        <div class="card">
          <div class="info-head">${dashIco("spark")}<div><h3>چرا سایت زنبیل؟</h3><p>همان گرمی مغازه، با آسودگی خرید آنلاین</p></div></div>
          <p>پیج شما دیده می‌شود؛ سایت کمک می‌کند مشتری قیمت و سبد خرید داشته باشد و بعد از استعلام موجودی سفارش بدهد.</p>
        </div>
      </section>
    `;
  }

  function setNav(hash) {
    document.querySelectorAll(".nav a").forEach((a) => {
      const target = a.getAttribute("href");
      const on =
        hash === target ||
          (target === "#/" && hash === "#") ||
          (target === "#/category/all" && hash.startsWith("#/category")) ||
          (target === "#/account" && hash.startsWith("#/account")) ||
          (target === "#/cart" && hash.startsWith("#/checkout"));
      a.classList.toggle("on", on);
      if (on) a.setAttribute("aria-current", "page");
      else a.removeAttribute("aria-current");
    });
  }

  const ORDER_STATUSES = [
    "در انتظار استعلام موجودی",
    "منتظر تأیید و پرداخت مشتری",
    "مهلت پرداخت تمام شد",
    "ناموجود — لغو شد",
    "پرداخت شده — در حال آماده‌سازی",
    "در حال ارسال",
    "تحویل شده",
    "لغو شده",
  ];

  function adminBar(title) {
    const user = auth.current() || {};
    const name = user.name || "مدیر";
    return `
      <div class="account-hero">
        <div class="account-stickers" aria-hidden="true">
          <span class="acc-sticker st-bag">${dashIco("shield")}</span>
          <span class="acc-sticker st-box">${dashIco("box")}</span>
          <span class="acc-sticker st-heart">${dashIco("bag")}</span>
        </div>
        <div class="profile-top">
          <span class="avatar account-ava">${escapeHtml(name.trim().charAt(0) || "م")}</span>
          <div>
            <p class="account-hi">پنل مدیریت زنبیل</p>
            <h3>${escapeHtml(name)}</h3>
            <p class="account-phone">${escapeHtml(store.name)} · ${escapeHtml(store.city)}</p>
            <p class="ok-tag">مدیر فروشگاه</p>
          </div>
        </div>
      </div>
      <div class="admin-mini">
        <span class="admin-now">${title}</span>
        ${title !== "داشبورد" ? `<a href="#/admin">داشبورد</a>` : ""}
        <a href="#/">مشاهده فروشگاه</a>
      </div>
    `;
  }

  function adminDenied() {
    return emptyBox("shield", "دسترسی مدیریت ندارید", "این بخش فقط برای حساب مدیر فروشگاه است.", "#/account", "بازگشت به حساب");
  }

  function adminLoading() {
    return `<section class="about page"><div class="card">در حال بارگذاری پنل مدیریت...</div></section>`;
  }

  function adminDashboard(stats) {
    return `
      <section class="about page admin-page">
        ${adminBar("داشبورد")}
        <div class="dash-stats admin-stats">
          <div>${dashIco("bag")}<b>${fa(stats.products)}</b><span>کالا</span></div>
          <div>${dashIco("box")}<b>${fa(stats.orders)}</b><span>سفارش</span></div>
          <div>${dashIco("user")}<b>${fa(stats.users)}</b><span>کاربر</span></div>
        </div>
        <div class="card">
          <div class="info-head">${dashIco("spark")}<div><h3>وضعیت فروشگاه</h3><p>خلاصه امروز زنبیل</p></div></div>
          <div class="row"><span>فروش پرداخت‌شده</span><b>${money(stats.revenue)} تومان</b></div>
          <div class="row"><span>سفارش در انتظار</span><b>${fa(stats.pending)}</b></div>
          <div class="row"><span>پیام خوانده‌نشده پشتیبانی</span><b>${fa(stats.supportUnread || 0)}</b></div>
        </div>
        <div class="dash-grid dash-stack pro-list">
          ${dashRow("#/admin/products", "bag", "محصولات", "افزودن و ویرایش کالا", 1)}
          ${dashRow("#/admin/orders", "box", "سفارش‌های مشتری", "تأیید و تغییر وضعیت", 2)}
          ${dashRow("#/admin/support", "chat", "پشتیبانی مشتریان", `${fa(stats.supportUnread || 0)} پیام جدید · پاسخ در همین پنل`, 3)}
          ${dashRow("#/admin/customers", "user", "مشتری‌ها", "حساب‌های ثبت‌شده", 4)}
          ${dashRow("#/admin/discounts", "tag", "کدهای تخفیف", "ساخت، فعال و غیرفعال کردن کد", 5)}
          ${dashRow("#/admin/settings", "store", "تنظیمات فروشگاه", "آدرس، تلفن، ساعت", 6)}
        </div>
      </section>
    `;
  }

  function discountValueText(d) {
    const base = d.type === "percent" ? `${fa(d.value)}٪` : `${money(d.value)} تومان`;
    return d.type === "percent" && d.maxDiscount ? `${base} (سقف ${money(d.maxDiscount)})` : base;
  }

  function discountStateText(d) {
    if (!d.active) return "غیرفعال";
    if (d.expiresAt && Date.now() > d.expiresAt) return "منقضی";
    if (d.usageLimit && (d.usedCount || 0) >= d.usageLimit) return "تمام‌شده";
    return "فعال";
  }

  function adminDiscountsPage(list) {
    return `
      <section class="about page admin-page">
        ${adminBar("کدهای تخفیف")}
        <form class="card discount-admin-form" data-admin-discount novalidate>
          <div class="info-head">${dashIco("tag")}<div><h3>ساخت کد تخفیف</h3><p>کد را بسازید و برای مشتری بفرستید</p></div></div>
          <fieldset class="discount-type-picker">
            <legend>نوع تخفیف</legend>
            <div class="discount-type-options">
              <label class="discount-type-option">
                <input type="radio" name="type" value="percent" checked />
                <span class="discount-type-icon">٪</span>
                <span><b>درصدی</b><small>درصدی از مبلغ خرید کم می‌شود</small></span>
                <i aria-hidden="true"></i>
              </label>
              <label class="discount-type-option">
                <input type="radio" name="type" value="amount" />
                <span class="discount-type-icon">${dashIco("pay")}</span>
                <span><b>مقداری</b><small>مبلغ ثابتی به تومان کم می‌شود</small></span>
                <i aria-hidden="true"></i>
              </label>
            </div>
          </fieldset>
          <div class="address-details-grid">
            <div class="field"><label>کد</label><input name="code" dir="ltr" maxlength="20" autocomplete="off" placeholder="ZANBIL10" required /></div>
            <div class="field discount-value-field">
              <label data-discount-value-label>مقدار تخفیف (درصد)</label>
              <div class="discount-input-wrap">
                <input name="value" inputmode="numeric" placeholder="مثلاً ۱۰" required />
                <span data-discount-value-unit>٪</span>
              </div>
            </div>
            <div class="field"><label>حداقل مبلغ خرید (تومان)</label><input name="minTotal" inputmode="numeric" placeholder="اختیاری" /></div>
            <div class="field" data-max-discount-field><label>سقف تخفیف (تومان)</label><input name="maxDiscount" inputmode="numeric" placeholder="اختیاری" /></div>
            <div class="field"><label>تعداد دفعات استفاده</label><input name="usageLimit" inputmode="numeric" placeholder="خالی = نامحدود" /></div>
            <div class="field"><label>مدت اعتبار (روز)</label><input name="days" inputmode="numeric" placeholder="خالی = بدون انقضا" /></div>
          </div>
          <label class="check-row"><input type="checkbox" name="onePerCustomer" checked /> هر مشتری فقط یک بار استفاده کند</label>
          <p class="form-error" data-error></p>
          <button class="btn wide" type="submit">ساخت کد تخفیف</button>
        </form>
        <div class="table-wrap card">
          ${
            list.length
              ? `<table class="admin-table">
            <thead><tr><th>کد</th><th>تخفیف</th><th>استفاده</th><th>اعتبار</th><th>وضعیت</th><th></th></tr></thead>
            <tbody>
              ${list
                .map(
                  (d) => `
                <tr>
                  <td><b dir="ltr">${escapeHtml(d.code)}</b>${d.minTotal ? `<small>خرید بالای ${money(d.minTotal)}</small>` : ""}</td>
                  <td>${discountValueText(d)}</td>
                  <td>${fa(d.usedCount || 0)}${d.usageLimit ? ` از ${fa(d.usageLimit)}` : ""}</td>
                  <td>${d.expiresAt ? `تا ${faDate(d.expiresAt)}` : "بدون انقضا"}</td>
                  <td>${discountStateText(d)}</td>
                  <td>
                    <button type="button" class="link" data-toggle-discount="${escapeHtml(d.code)}" data-active="${d.active ? "1" : ""}">${d.active ? "غیرفعال کن" : "فعال کن"}</button>
                    <button type="button" class="link" data-del-discount="${escapeHtml(d.code)}">حذف</button>
                  </td>
                </tr>`
                )
                .join("")}
            </tbody>
          </table>`
              : `<div class="info-head">${dashIco("tag")}<div><h3>هنوز کدی ساخته نشده</h3><p>با فرم بالا اولین کد تخفیف را بسازید.</p></div></div>`
          }
        </div>
      </section>
    `;
  }

  function adminProductsPage(list) {
    return `
      <section class="about page admin-page">
        ${adminBar("محصولات")}
        <a class="btn wide admin-add" href="#/admin/product">افزودن کالای جدید</a>
        <div class="table-wrap card">
          <table class="admin-table">
            <thead><tr><th>کالا</th><th>قیمت</th><th></th></tr></thead>
            <tbody>
              ${list
                .map(
                  (p) => `
                <tr>
                  <td><b>${escapeHtml(p.title)}</b><small>${escapeHtml(p.brand)}</small></td>
                  <td>${money(p.price)}</td>
                  <td>
                    <a class="link" href="#/admin/product/${p.id}">ویرایش</a>
                    <button type="button" class="link" data-del-product="${p.id}">حذف</button>
                  </td>
                </tr>`
                )
                .join("")}
            </tbody>
          </table>
        </div>
      </section>
    `;
  }

  function adminProductForm(p) {
    const item = p || {
      title: "",
      brand: "",
      cat: "kitchen",
      price: "",
      oldPrice: "",
      amazing: false,
      colors: [],
      specs: [],
      desc: "",
    };
    const specsText = (item.specs || []).map((s) => (Array.isArray(s) ? s.join(":") : s)).join("\n");
    return `
      <section class="about page admin-page">
        ${adminBar(p ? "ویرایش کالا" : "کالای جدید")}
        <form class="card" data-admin-product data-id="${p ? p.id : ""}">
          <div class="field"><label>عنوان</label><input name="title" required value="${escapeHtml(item.title)}" /></div>
          <div class="field"><label>برند</label><input name="brand" value="${escapeHtml(item.brand)}" /></div>
          <div class="field">
            <label>دسته‌بندی</label>
            <select name="cat">${categories
              .map((c) => `<option value="${c.id}" ${c.id === item.cat ? "selected" : ""}>${c.name}</option>`)
              .join("")}</select>
          </div>
          <div class="field">
            <label>لاین فروشگاه حضوری</label>
            <select name="line">
              <option value="">بدون لاین</option>
              ${(lines || [])
                .map((l) => `<option value="${l.id}" ${l.id === item.line ? "selected" : ""}>${l.name}</option>`)
                .join("")}
            </select>
          </div>
          <div class="field"><label>قیمت (تومان)</label><input name="price" type="number" required value="${item.price || ""}" /></div>
          <div class="field"><label>قیمت قبلی</label><input name="oldPrice" type="number" value="${item.oldPrice || ""}" /></div>
          <div class="field"><label>رنگ‌ها (با ویرگول)</label><input name="colors" value="${escapeHtml((item.colors || []).join("، "))}" /></div>
          <div class="field"><label>مشخصات (هر خط: کلید:مقدار)</label><textarea name="specs">${escapeHtml(specsText)}</textarea></div>
          <div class="field"><label>توضیح</label><textarea name="desc">${escapeHtml(item.desc || "")}</textarea></div>
          <label class="addr-pick">
            <input type="checkbox" name="fresh" ${item.fresh || !p ? "checked" : ""} />
            <span>موجودی جدید — نمایش در ردیف موجودی‌های جدید</span>
          </label>
          <p class="form-error" data-error></p>
          <button class="btn wide" type="submit">ذخیره کالا</button>
        </form>
      </section>
    `;
  }

  function adminOrdersPage(list) {
    return `
      <section class="about page admin-page">
        ${adminBar("سفارش‌های مشتری")}
        ${
          list.length
            ? list
                .map((o) => {
                  const pendingInquiry = o.phase === "inquiry";
                  return `
            <article class="card inquiry-admin-card">
              <div class="row"><b>فاکتور ${fa(o.id)}</b><span class="ok-tag">${escapeHtml(o.status || "")}</span></div>
              <p>${escapeHtml(o.userName || "")} — ${fa(o.userPhone || "")}</p>
              <p>${escapeHtml(o.address || "آدرس ثبت نشده")}</p>
              <p>${fa(o.count || 0)} کالا — ${money(o.total || 0)} تومان</p>
              ${
                pendingInquiry
                  ? `<form data-inquiry-review data-user="${o.userId}" data-order="${o.id}">
                      ${(o.items || [])
                        .map((item) => {
                          const colors = item.colors && item.colors.length ? item.colors : byId(item.id)?.colors || [];
                          return `
                            <fieldset class="inquiry-review-item" data-item="${item.id}">
                              <legend>${escapeHtml(item.title)} · ${fa(item.qty)} عدد</legend>
                              <div class="inquiry-review-flags">
                                <label class="inquiry-flag-opt is-ok"><input type="radio" name="inquiry-${item.id}" value="ok" required /> موجود</label>
                                <label class="inquiry-flag-opt is-out"><input type="radio" name="inquiry-${item.id}" value="out" /> ناموجود</label>
                                <label class="inquiry-flag-opt is-alt"><input type="radio" name="inquiry-${item.id}" value="alt" /> رنگ یا مدل دیگر</label>
                              </div>
                              <div class="inquiry-alt-box" hidden>
                                ${
                                  colors.length
                                    ? `<div class="inquiry-alt-colors">${colors
                                        .map((c) => `<label class="inquiry-color-chip"><input type="checkbox" name="alt-${item.id}" value="${escapeHtml(c)}" />${escapeHtml(c)}</label>`)
                                        .join("")}</div>`
                                    : ""
                                }
                                <input name="alttext-${item.id}" type="text" placeholder="رنگ یا مدل جایگزین، با ویرگول جدا کنید" />
                              </div>
                            </fieldset>`;
                        })
                        .join("")}
                      <p class="form-error" data-error></p>
                      <button class="btn wide" type="submit">ارسال نتیجه استعلام برای مشتری</button>
                    </form>`
                  : `<ul class="inquiry-items">${(o.items || [])
                      .map(
                        (item) =>
                          `<li class="inquiry-item is-${escapeHtml(item.inquiry || "ok")}"><span class="inquiry-flag"></span><span><b>${escapeHtml(item.title)}</b><small>${inquiryItemLabel(item.inquiry || "ok")}${item.chosenColor ? ` · ${escapeHtml(item.chosenColor)}` : item.altOptions?.length ? ` · ${(item.altOptions || []).map((x) => escapeHtml(x)).join("، ")}` : ""}</small></span></li>`
                      )
                      .join("")}</ul>`
              }
              ${
                o.phase === "paid" || !o.phase
                  ? `<label class="field">
                <span>وضعیت سفارش</span>
                <select data-order-status data-user="${o.userId}" data-order="${o.id}">
                  ${ORDER_STATUSES.map((s) => `<option ${s === o.status ? "selected" : ""}>${s}</option>`).join("")}
                </select>
              </label>`
                  : ""
              }
            </article>`;
                })
                .join("")
            : `<div class="card"><p>هنوز سفارشی ثبت نشده.</p></div>`
        }
      </section>
    `;
  }

  function adminCustomersPage(list) {
    return `
      <section class="about page admin-page">
        ${adminBar("مشتری‌ها")}
        <div class="table-wrap card">
          <table class="admin-table">
            <thead><tr><th>نام</th><th>موبایل</th><th>سفارش</th><th>نقش</th></tr></thead>
            <tbody>
              ${list
                .map(
                  (u) => `
                <tr>
                  <td>${escapeHtml(u.name)}</td>
                  <td>${fa(u.phone)}</td>
                  <td>${fa(u.orders)}</td>
                  <td>${u.admin ? "مدیر" : "مشتری"}</td>
                </tr>`
                )
                .join("")}
            </tbody>
          </table>
        </div>
      </section>
    `;
  }

  function adminSettingsPage(current) {
    const s = current || store;
    return `
      <section class="about page admin-page">
        ${adminBar("تنظیمات فروشگاه")}
        <form class="card" data-admin-settings>
          <div class="info-head">${dashIco("store")}<div><h3>مشخصات فروشگاه</h3><p>آدرس، تلفن و ساعت جهانشهر</p></div></div>
          <div class="field"><label>نام فروشگاه</label><input name="name" value="${escapeHtml(s.name || "")}" required /></div>
          <div class="field"><label>شعار</label><input name="tagline" value="${escapeHtml(s.tagline || "")}" /></div>
          <div class="field"><label>شهر</label><input name="city" value="${escapeHtml(s.city || "")}" /></div>
          <div class="field"><label>آدرس</label><textarea name="address">${escapeHtml(s.address || "")}</textarea></div>
          <div class="field"><label>ساعت کاری</label><input name="hours" value="${escapeHtml(s.hours || "")}" /></div>
          <div class="field"><label>تلفن</label><input name="phone" value="${escapeHtml(s.phone || "")}" /></div>
          <p class="form-error" data-error></p>
          <button class="btn wide" type="submit">ذخیره تنظیمات</button>
        </form>
      </section>
    `;
  }

  function adminSupportList(list) {
    return `
      <section class="about page admin-page">
        ${adminBar("پشتیبانی مشتریان")}
        <div class="card">
          ${
            list.length
              ? list
                  .map(
                    (c) => `
              <a class="chat-item" href="#/admin/support/${c.id}">
                <div class="row row-tight">
                  <b>${escapeHtml(c.name || "مشتری")}</b>
                  ${c.unreadAdmin ? `<span class="unread-pill">${fa(c.unreadAdmin)} جدید</span>` : ""}
                </div>
                <p>${escapeHtml(c.last)}</p>
                <small>${escapeHtml(c.phone || "")}</small>
              </a>`
                  )
                  .join("")
              : `<div class="info-head">${dashIco("chat")}<div><h3>پیامی نیست</h3><p>وقتی مشتری از دکمه پشتیبانی بنویسد، اینجا می‌آید.</p></div></div>`
          }
        </div>
      </section>
    `;
  }

  function adminSupportThread(chat) {
    const msgs = chat.messages || [];
    return `
      <section class="about page admin-page">
        ${adminBar("پاسخ به مشتری")}
        <div class="card">
          <h3>${escapeHtml(chat.name || "مشتری")}</h3>
          <p>${escapeHtml(chat.phone || "شماره ثبت نشده")}</p>
        </div>
        ${
          chat.accountId
            ? `<div class="card password-reset-admin">
                <div class="info-head">${dashIco("shield")}<div><h3>بازنشانی رمز حساب</h3><p>حساب ${escapeHtml(chat.accountName || chat.phone)} به این گفتگو متصل است.</p></div></div>
                <p>پس از احراز هویت مشتری، یک رمز موقت امن ساخته و خودکار در همین گفتگو ارسال می‌شود.</p>
                <button class="btn ghost wide" type="button" data-reset-password="${chat.id}">ساخت و ارسال رمز موقت</button>
              </div>`
            : `<div class="card password-reset-admin is-disabled"><div class="info-head">${dashIco("shield")}<div><h3>حساب متصل پیدا نشد</h3><p>شماره گفتگو با هیچ حسابی مطابقت ندارد.</p></div></div></div>`
        }
        <div class="card support-log support-log-panel">
          ${
            msgs.length
              ? msgs
                  .map(
                    (m) =>
                      `<div class="support-msg ${m.from}">${escapeHtml(m.text)}</div>`
                  )
                  .join("")
              : "<p>هنوز پیامی در این گفتگو نیست.</p>"
          }
        </div>
        <form class="card" data-admin-support data-id="${chat.id}">
          <div class="field">
            <label>پاسخ شما</label>
            <textarea name="text" required placeholder="جواب مشتری را بنویسید"></textarea>
          </div>
          <p class="form-error" data-error></p>
          <button class="btn wide" type="submit">ارسال پاسخ</button>
        </form>
      </section>
    `;
  }

  async function renderAdmin(section, id) {
    if (!auth.current()?.admin) {
      app.innerHTML = adminDenied();
      decoratePage(["admin"]);
      mountRouteBack();
      requestAnimationFrame(() => app.focus({ preventScroll: true }));
      return;
    }
    app.innerHTML = adminLoading();
    try {
      if (!section) {
        app.innerHTML = adminDashboard(await api("/api/admin/stats"));
      } else if (section === "products") {
        app.innerHTML = adminProductsPage(await api("/api/admin/products"));
      } else if (section === "product") {
        if (id) {
          const list = await api("/api/admin/products");
          const item = list.find((p) => String(p.id) === String(id));
          app.innerHTML = item ? adminProductForm(item) : emptyBox("bag", "کالا پیدا نشد", "این محصول در کاتالوگ نیست", "#/admin/products", "بازگشت به محصولات");
        } else {
          app.innerHTML = adminProductForm(null);
        }
      } else if (section === "orders") {
        app.innerHTML = adminOrdersPage(await api("/api/admin/orders"));
      } else if (section === "support") {
        if (id) app.innerHTML = adminSupportThread(await api(`/api/admin/support/${id}`));
        else app.innerHTML = adminSupportList(await api("/api/admin/support"));
      } else if (section === "customers") {
        app.innerHTML = adminCustomersPage(await api("/api/admin/customers"));
      } else if (section === "discounts") {
        app.innerHTML = adminDiscountsPage(await api("/api/admin/discounts"));
      } else if (section === "settings") {
        const cat = await api("/api/catalog");
        app.innerHTML = adminSettingsPage(cat.store);
      } else {
        app.innerHTML = adminDenied();
      }
    } catch (err) {
      app.innerHTML = `<section class="page state-page">${emptyBox("shield", "ارتباط با پنل برقرار نشد", escapeHtml(err.message), "#/admin", "بازگشت به داشبورد")}</section>`;
    }
    decoratePage(["admin"]);
    mountRouteBack();
    requestAnimationFrame(() => app.focus({ preventScroll: true }));
  }

  function parse() {
    const raw = location.hash || "#/";
    const [path, query] = raw.replace(/^#/, "").split("?");
    const parts = path.split("/").filter(Boolean);
    const params = new URLSearchParams(query || "");
    return { parts, params, raw: raw.startsWith("#") ? raw : "#/" };
  }

  function mountRouteBack() {
    const route = (location.hash || "#/").split("?")[0];
    app.querySelector(".route-back-row")?.remove();
    if (route === "#/" || route === "#") return;
    const root = app.querySelector(":scope > .page, :scope > .empty") || app;
    root.insertAdjacentHTML(
      "afterbegin",
      `<div class="route-back-row">
        <button type="button" class="route-back" data-route-back aria-label="بازگشت به صفحه قبل">
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="m9 5 7 7-7 7" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          <span>بازگشت</span>
        </button>
      </div>`
    );
  }

  function goToPreviousRoute() {
    if (["category", "brand", "line"].includes(parse().parts[0])) {
      routeBackPending = false;
      location.hash = "#/";
      return;
    }
    routeBackPending = true;
    if (internalRouteDepth > 0) {
      history.back();
      return;
    }
    if ((location.hash || "#/") !== "#/") location.hash = "#/";
    else routeBackPending = false;
  }

  function decoratePage(parts) {
    const root = app.querySelector(":scope > .page, :scope > .empty");
    if (!root) return;
    root.classList.add("page-shell");
    if (["account", "cart", "checkout", "notifications"].includes(parts[0])) root.classList.add("page-shell-narrow");
    if (parts[0] === "admin") root.classList.add("page-shell-admin");
    if (parts[0] === "product") root.classList.add("page-shell-product");
    if (!parts.length) root.classList.add("page-shell-home");
  }

  function setRouteTitle(parts) {
    if (parts[0] === "product") {
      const p = products.find((item) => item.id === Number(parts[1]));
      document.title = p ? `${p.title} | زنبیل` : "کالا پیدا نشد | زنبیل";
      return;
    }
    if (parts[0] === "brand") {
      document.title = `${findBrand(parts[1]) || "برند"} | زنبیل`;
      return;
    }
    const titles = {
      fresh: "تازه‌های زنبیل",
      line: "لاین‌های پیشنهادی",
      category: "محصولات زنبیل",
      cart: "سبد خرید",
      checkout: "تکمیل سفارش",
      search: "جستجو",
      notifications: "اعلان‌ها",
      account: "حساب کاربری",
      about: "درباره زنبیل",
      admin: "مدیریت فروشگاه",
    };
    document.title = !parts.length ? "فروشگاه زنبیل" : `${titles[parts[0]] || "صفحه پیدا نشد"} | زنبیل`;
  }

  function render() {
    const { parts, params, raw } = parse();
    let html = "";
    if (!parts.length) html = home();
    else if (parts[0] === "product") html = productPage(parts[1]);
    else if (parts[0] === "fresh") html = freshPage();
    else if (parts[0] === "line") html = linePage(parts[1]);
    else if (parts[0] === "category") html = categoryPage(parts[1] || "all");
    else if (parts[0] === "brand") html = brandPage(parts[1] || "");
    else if (parts[0] === "cart") html = cartPage();
    else if (parts[0] === "search") html = searchPage(params.get("q"));
    else if (parts[0] === "notifications") html = notificationsPage();
    else if (parts[0] === "account") html = accountPage(params, parts[1]);
    else if (parts[0] === "checkout") html = checkoutPage(parts[1] || "address", params);
    else if (parts[0] === "about") html = aboutPage();
    else if (parts[0] === "admin") {
      setNav(raw.split("?")[0] || "#/");
      if (accountBtn) accountBtn.classList.add("on");
      if (siteFooter) siteFooter.hidden = true;
      document.body.classList.add("admin-route");
      setRouteTitle(parts);
      window.scrollTo(0, 0);
      renderAdmin(parts[1], parts[2]);
      return;
    } else html = notFoundPage();
    app.innerHTML = html;
    decoratePage(parts);
    mountRouteBack();
    if (siteFooter) siteFooter.hidden = false;
    document.body.classList.remove("admin-route");
    setRouteTitle(parts);
    setNav(raw.split("?")[0] || "#/");
    if (accountBtn) accountBtn.classList.toggle("on", (raw.split("?")[0] || "").startsWith("#/account"));
    window.scrollTo(0, 0);
    bindPage();
    trackInterest(parts, params);
    requestAnimationFrame(() => app.focus({ preventScroll: true }));
  }

  let lastInterestKey = "";
  function trackInterest(parts, params) {
    const key = location.hash || "#/";
    if (key === lastInterestKey) return;
    lastInterestKey = key;
    if (parts[0] === "category" && parts[1] && parts[1] !== "all") taste.hitCat(parts[1], 3);
    if (parts[0] === "line" && parts[1]) taste.hitLine(parts[1], 4);
    if (parts[0] === "product" && parts[1]) taste.hitProduct(parts[1], 2);
    if (parts[0] === "search") taste.hitSearch(params.get("q") || "");
  }

  let slideTimer;
  let igTimer;
  let catsResizeObserver;
  function bindCarousel(root, slideSel, dotSel, delay) {
    if (!root) return null;
    const slides = [...root.querySelectorAll(slideSel)];
    const dots = [...root.querySelectorAll(dotSel)];
    if (!slides.length) return null;
    let i = 0;
    const go = (n) => {
      i = (n + slides.length) % slides.length;
      slides.forEach((s, idx) => s.classList.toggle("active", idx === i));
      dots.forEach((d, idx) => d.classList.toggle("on", idx === i));
    };
    dots.forEach((d) =>
      d.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        go(Number(d.dataset.dot ?? d.dataset.igDot));
      })
    );
    return setInterval(() => go(i + 1), delay);
  }

  function bindPage() {
    clearInterval(slideTimer);
    clearInterval(igTimer);
    slideTimer = bindCarousel(document.getElementById("slider"), ".slide", "[data-dot]", 4200);
    igTimer = bindCarousel(document.getElementById("igSlider"), ".ig-slide", "[data-ig-dot]", 3600);

    document.querySelectorAll("[data-color]").forEach((btn) => {
      btn.addEventListener("click", () => {
        document.querySelectorAll("[data-color]").forEach((b) => b.classList.remove("on"));
        btn.classList.add("on");
      });
    });
    bindProductPickers();
    bindProductPage();
    bindCatsScroll();
    const registerPhone = document.getElementById("regPhone");
    if (registerPhone?.value) scheduleRegisterPhoneCheck(registerPhone);
  }

  function bindCatsScroll() {
    catsResizeObserver?.disconnect();
    const wrap = document.querySelector(".cats-wrap");
    const track = wrap?.querySelector("[data-cats]");
    if (!wrap || !track) return;
    const prev = wrap.querySelector('[data-cats-dir="-1"]');
    const next = wrap.querySelector('[data-cats-dir="1"]');
    const paint = () => {
      const max = track.scrollWidth - track.clientWidth;
      wrap.classList.toggle("is-scroll", max > 8);
      const x = Math.abs(track.scrollLeft);
      if (prev) prev.disabled = x < 6;
      if (next) next.disabled = x > max - 6;
    };
    wrap.querySelectorAll("[data-cats-dir]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const rtl = getComputedStyle(track).direction === "rtl";
        const step = Number(btn.dataset.catsDir) * (rtl ? -1 : 1) * Math.min(280, track.clientWidth * 0.7);
        track.scrollBy({ left: step, behavior: "smooth" });
      });
    });
    track.addEventListener("scroll", paint, { passive: true });
    if ("ResizeObserver" in window) {
      catsResizeObserver = new ResizeObserver(paint);
      catsResizeObserver.observe(track);
    }
    paint();
  }

  function activatePtab(name, scroll) {
    app.querySelectorAll(".p-tabs [data-ptab]").forEach((b) => b.classList.toggle("on", b.dataset.ptab === name));
    app.querySelectorAll("[data-panel]").forEach((p) => {
      const on = p.dataset.panel === name;
      p.classList.toggle("on", on);
      p.toggleAttribute("hidden", !on);
    });
    if (scroll) app.querySelector(".p-tabs")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function bindProductPage() {
    const page = app.querySelector(".p-page");
    if (!page) return;
    const pid = page.dataset.product;
    const title = page.querySelector("h1");
    if (title) document.title = `${title.textContent} | زنبیل`;
    page.querySelectorAll("[data-ptab]").forEach((btn) => {
      btn.addEventListener("click", () => activatePtab(btn.dataset.ptab, !btn.closest(".p-tabs")));
    });
    const share = page.querySelector("[data-share]");
    const pop = page.querySelector("[data-share-pop]");
    if (share && pop) {
      share.addEventListener("click", (e) => {
        e.stopPropagation();
        pop.toggleAttribute("hidden");
      });
      page.querySelector("[data-share-copy]")?.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(location.href);
        } catch {
          /* ignore */
        }
        toast("لینک کالا کپی شد");
        pop.setAttribute("hidden", "");
      });
      page.addEventListener("click", (e) => {
        if (!e.target.closest("[data-share], [data-share-pop]")) pop.setAttribute("hidden", "");
      });
    }
    const zoom = page.querySelector("[data-zoom]");
    page.querySelector("[data-zoom-open]")?.addEventListener("click", (e) => {
      if (e.target.closest("button, a, .share-pop")) return;
      zoom?.removeAttribute("hidden");
    });
    zoom?.addEventListener("click", (e) => {
      if (e.target === zoom || e.target.closest("[data-zoom-close]")) zoom.setAttribute("hidden", "");
    });
    page.querySelectorAll("[data-acc]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const box = btn.closest(".p-acc");
        const on = box.classList.contains("on");
        page.querySelectorAll(".p-acc").forEach((a) => a.classList.remove("on"));
        if (!on) box.classList.add("on");
      });
    });
    page.querySelectorAll("[data-copy-sku]").forEach((el) => {
      el.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(el.dataset.copySku || "");
          toast("کد کالا کپی شد");
        } catch {
          toast("کد کالا: " + (el.dataset.copySku || ""));
        }
      });
    });
    fillProductOpinions(pid);
  }

  async function fillProductOpinions(id) {
    try {
      const data = await api(`/api/products/${id}/opinions`);
      const liveR = app.querySelector("[data-live-reviews]");
      const liveQ = app.querySelector("[data-live-ask]");
      const meName = (auth.current() || {}).name;
      const reviews = (data.reviews || []).filter((r) => r.name !== meName);
      const questions = (data.questions || []).filter((q) => q.name !== meName);
      if (liveR && reviews.length) {
        liveR.querySelector("[data-empty-reviews]")?.remove();
        liveR.insertAdjacentHTML("afterbegin", reviews.map((r) => opinionCard(r, "review")).join(""));
      }
      if (liveQ && questions.length) {
        liveQ.querySelector("[data-empty-ask]")?.remove();
        liveQ.insertAdjacentHTML("afterbegin", questions.map((q) => opinionCard(q, "ask")).join(""));
      }
      const rCount = (liveR ? liveR.querySelectorAll(".op-card").length : 0);
      const qCount = (liveQ ? liveQ.querySelectorAll(".op-card").length : 0);
      app.querySelectorAll("[data-review-count]").forEach((el) => {
        el.textContent = fa(rCount);
      });
      app.querySelectorAll("[data-ask-count]").forEach((el) => {
        el.textContent = fa(qCount);
      });
    } catch {
      /* keep empty zeros */
    }
  }

  function bindProductPickers() {
    app.querySelectorAll("[data-picker]").forEach((box) => {
      const hidden = box.querySelector('input[name="productId"]');
      const face = box.querySelector("[data-pick-open]");
      const drop = box.querySelector(".pick-drop");
      const q = box.querySelector("[data-pick-q]");
      const list = box.querySelector("[data-pick-list]");
      const paint = (items) => {
        list.innerHTML = items.length
          ? items.map(productPickRow).join("")
          : `<p class="pick-empty">کالایی با این نام پیدا نشد</p>`;
      };
      const filter = () => {
        const nq = normFa((q.value || "").trim());
        const items = nq
          ? products.filter((p) => wordsStartWith([p.title, p.brand].join(" "), nq))
          : products.slice(0, 8);
        paint(items.slice(0, 12));
      };
      face.addEventListener("click", () => {
        const open = drop.hasAttribute("hidden");
        drop.toggleAttribute("hidden", !open);
        if (open) {
          filter();
          q.focus();
        }
      });
      q.addEventListener("input", filter);
      list.addEventListener("click", (e) => {
        const opt = e.target.closest("[data-pick-id]");
        if (!opt) return;
        const p = byId(opt.dataset.pickId);
        if (!p) return;
        hidden.value = String(p.id);
        face.classList.add("on");
        face.innerHTML = `
          <span class="pick-thumb">${thumb(p)}</span>
          <span class="pick-meta"><b>${escapeHtml(p.title)}</b><small>${escapeHtml(p.brand || "")}</small></span>
          <span class="pick-change">تغییر</span>
        `;
        drop.setAttribute("hidden", "");
        q.value = "";
      });
    });
  }

  function normalizePhone(value) {
    const phone = toEn(value).replace(/\D/g, "");
    return phone;
  }

  function validPhone(phone) {
    return /^09\d{9}$/.test(phone);
  }

  function passwordChecks(pass) {
    return {
      length: pass.length >= 8,
      upper: /[A-Z]/.test(pass),
      lower: /[a-z]/.test(pass),
      number: /\d/.test(pass),
      english: /^[\x21-\x7E]*$/.test(pass),
    };
  }

  function passwordValidationError(pass) {
    const checks = passwordChecks(pass);
    if (!checks.length) return "رمز عبور باید حداقل ۸ کاراکتر باشد";
    if (!checks.english) return "برای رمز عبور فقط از حروف و علائم انگلیسی استفاده کنید";
    if (!checks.upper) return "رمز عبور باید حداقل یک حرف بزرگ انگلیسی داشته باشد";
    if (!checks.lower) return "رمز عبور باید حداقل یک حرف کوچک انگلیسی داشته باشد";
    if (!checks.number) return "رمز عبور باید حداقل یک عدد داشته باشد";
    return "";
  }

  function afterAuth(next) {
    const map = {
      cart: "#/cart",
      favorites: "#/account/favorites",
      info: "#/account/info",
      sheba: "#/account/sheba",
      finance: "#/account/sheba",
      orders: "#/account/orders",
      addresses: "#/account/addresses",
      opinions: "#/account/opinions",
      notifications: "#/notifications",
      checkout: "#/checkout/address",
    };
    const target = map[next] || (/^product\/\d+/.test(next || "") ? `#/${next}` : "#/account");
    if (location.hash !== target) location.hash = target;
    else render();
    maybeShowInquiryPush({ force: true });
  }

  function normalizeSheba(value) {
    let v = toEn(value).replace(/\s/g, "").toUpperCase();
    if (v && !v.startsWith("IR")) v = `IR${v.replace(/\D/g, "")}`;
    else v = `IR${v.replace(/^IR/, "").replace(/\D/g, "")}`;
    return v;
  }

  app.addEventListener("click", async (e) => {
    const routeBack = e.target.closest("[data-route-back]");
    if (routeBack) {
      goToPreviousRoute();
      return;
    }
    const passwordHelp = e.target.closest("[data-password-help]");
    if (passwordHelp) {
      const phone = normalizePhone(passwordHelp.closest("[data-login]")?.querySelector('[name="phone"]')?.value || "");
      support.openPasswordReset(validPhone(phone) ? phone : "");
      return;
    }
    const resetPassword = e.target.closest("[data-reset-password]");
    if (resetPassword) {
      if (!auth.current()?.admin) return;
      if (!confirm("هویت مشتری را بررسی کرده‌اید؟ رمز فعلی باطل و همه نشست‌های او بسته می‌شوند.")) return;
      resetPassword.disabled = true;
      try {
        await api(`/api/admin/support/${resetPassword.dataset.resetPassword}/reset-password`, { method: "POST" });
        toast("رمز موقت ساخته و برای مشتری ارسال شد");
        await renderAdmin("support", resetPassword.dataset.resetPassword);
      } catch (err) {
        toast(err.message);
        resetPassword.disabled = false;
      }
      return;
    }
    const fav = e.target.closest("[data-fav]");
    if (fav) {
      e.preventDefault();
      e.stopPropagation();
      if (!auth.current()) {
        toast("برای علاقه‌مندی وارد حساب شوید");
        location.hash = "#/account?next=favorites";
        return;
      }
      const id = Number(fav.dataset.fav);
      try {
        const on = await auth.toggleFavorite(id);
        if (on) taste.hitProduct(id, 4);
        document.querySelectorAll(`[data-fav="${id}"]`).forEach((btn) => {
          btn.classList.toggle("on", on);
          btn.classList.remove("pop");
          void btn.offsetWidth;
          btn.classList.add("pop");
        });
        toast(on ? "به علاقه‌مندی‌ها اضافه شد" : "از علاقه‌مندی‌ها حذف شد");
        if (location.hash.includes("/favorites")) render();
      } catch (err) {
        toast(err.message);
      }
      return;
    }
    const add = e.target.closest("[data-add]");
    if (add) {
      cart.add(Number(add.dataset.add), Number(add.dataset.n || 1));
      const page = add.closest(".p-page");
      if (page) paintProductBuy(page);
      return;
    }
    const pdel = e.target.closest("[data-pdel]");
    if (pdel) {
      const page = pdel.closest(".p-page");
      const pid = Number(page?.dataset.product);
      if (!pid) return;
      cart.set(pid, 0);
      toast("از سبد حذف شد");
      paintProductBuy(page);
      return;
    }
    const pqty = e.target.closest("[data-pqty]");
    if (pqty) {
      const page = pqty.closest(".p-page");
      if (!page) return;
      const pid = Number(page.dataset.product);
      const next = Math.min(99, cartQty(pid) + Number(pqty.dataset.pqty));
      if (next < 1) {
        cart.set(pid, 0);
        toast("از سبد حذف شد");
      } else {
        cart.set(pid, next);
      }
      paintProductBuy(page);
      return;
    }
    const qty = e.target.closest("[data-qty]");
    if (qty) {
      const id = Number(qty.dataset.qty);
      const item = cart.read().find((i) => i.id === id);
      cart.set(id, (item?.qty || 1) + Number(qty.dataset.d));
      render();
      return;
    }
    const delReview = e.target.closest("[data-del-review]");
    if (delReview) {
      try {
        await auth.delReview(delReview.dataset.delReview);
        toast("دیدگاه حذف شد");
        render();
      } catch (err) {
        toast(err.message);
      }
      return;
    }
    const delQuestion = e.target.closest("[data-del-question]");
    if (delQuestion) {
      try {
        await auth.delQuestion(delQuestion.dataset.delQuestion);
        toast("پرسش حذف شد");
        render();
      } catch (err) {
        toast(err.message);
      }
      return;
    }
    const delAddr = e.target.closest("[data-del-address]");
    if (delAddr) {
      const user = auth.current();
      if (!user) return;
      const id = Number(delAddr.dataset.delAddress);
      try {
        await auth.update({ addresses: user.addresses.filter((a) => a.id !== id) });
        toast("آدرس حذف شد");
        render();
      } catch (err) {
        toast(err.message);
      }
      return;
    }
    if (e.target.closest("[data-logout]")) {
      await auth.logout();
      toast("از حساب خارج شدید");
      if (location.hash !== "#/account") location.hash = "#/account";
      else render();
      return;
    }
    const toggleDiscount = e.target.closest("[data-toggle-discount]");
    const delDiscount = e.target.closest("[data-del-discount]");
    if (toggleDiscount || delDiscount) {
      if (!auth.current()?.admin) return;
      const code = (toggleDiscount || delDiscount).dataset[toggleDiscount ? "toggleDiscount" : "delDiscount"];
      if (delDiscount && !confirm(`کد ${code} حذف شود؟`)) return;
      try {
        const list = await api(`/api/admin/discounts/${encodeURIComponent(code)}`, {
          method: toggleDiscount ? "PATCH" : "DELETE",
          body: toggleDiscount ? { active: !toggleDiscount.dataset.active } : undefined,
        });
        app.innerHTML = adminDiscountsPage(list);
        decoratePage(["admin"]);
        mountRouteBack();
        toast(toggleDiscount ? "وضعیت کد تغییر کرد" : "کد تخفیف حذف شد");
      } catch (err) {
        toast(err.message);
      }
      return;
    }
    const delProduct = e.target.closest("[data-del-product]");
    if (delProduct) {
      if (!auth.current()?.admin) return;
      if (!confirm("این کالا حذف شود؟")) return;
      try {
        await api(`/api/admin/products/${delProduct.dataset.delProduct}`, { method: "DELETE" });
        await bootCatalog();
        toast("کالا حذف شد");
        render();
      } catch (err) {
        toast(err.message);
      }
      return;
    }
    if (e.target.closest("[data-inquire]")) {
      const user = auth.current();
      const draft = draftGet();
      const items = cartLines();
      if (!user) {
        location.hash = "#/account?next=checkout";
        return;
      }
      if (!draft || !items.length) {
        location.hash = "#/checkout/address";
        return;
      }
      const orderId = Number(draft.factor) || Date.now() % 100000;
      const inquireBtn = e.target.closest("[data-inquire]");
      try {
        inquireBtn.disabled = true;
        await auth.addOrder({
          id: orderId,
          discountCode: draft.coupon?.code || "",
          receiver: draft.receiver,
          phone: draft.phone,
          address: draft.addressText,
          postalCode: draft.postalCode,
          plaque: draft.plaque,
          unit: draft.unit,
          items: items.map((i) => ({ id: i.p.id, qty: i.qty })),
        });
        draftClear();
        cart.write([]);
        toast("درخواست استعلام ثبت شد");
        location.hash = `#/checkout/success?order=${encodeURIComponent(orderId)}`;
      } catch (err) {
        inquireBtn.disabled = false;
        toast(err.message);
      }
      return;
    }
    if (e.target.closest("[data-coupon-remove]")) {
      const draft = draftGet();
      if (draft) {
        delete draft.coupon;
        draftSet(draft);
      }
      toast("کد تخفیف حذف شد");
      render();
    }
  });

  app.addEventListener("submit", async (e) => {
    const login = e.target.closest("[data-login]");
    const register = e.target.closest("[data-register]");
    const profile = e.target.closest("[data-profile]");
    const passwordChange = e.target.closest("[data-password-change]");
    const sheba = e.target.closest("[data-sheba]");
    const address = e.target.closest("[data-address]");
    const checkoutAddr = e.target.closest("[data-checkout-addr]");
    const adminProduct = e.target.closest("[data-admin-product]");
    const adminSettings = e.target.closest("[data-admin-settings]");
    const adminSupport = e.target.closest("[data-admin-support]");
    const review = e.target.closest("[data-review]");
    const question = e.target.closest("[data-question]");
    const coupon = e.target.closest("[data-coupon]");
    const adminDiscount = e.target.closest("[data-admin-discount]");
    const inquiryReview = e.target.closest("[data-inquiry-review]");
    const inquiryPay = e.target.closest("[data-inquiry-pay]");
    if (!login && !register && !profile && !passwordChange && !sheba && !address && !checkoutAddr && !adminProduct && !adminSettings && !adminSupport && !review && !question && !coupon && !adminDiscount && !inquiryReview && !inquiryPay) return;
    e.preventDefault();
    const form = e.target;
    const err = form.querySelector("[data-error]") || form.parentElement.querySelector("[data-error]");
    const data = new FormData(form);

    if (inquiryPay) {
      const orderId = inquiryPay.getAttribute("data-inquiry-pay");
      const choices = {};
      for (const [key, value] of data.entries()) {
        if (key.startsWith("choice-") && String(value || "").trim()) choices[key.slice(7)] = String(value).trim();
      }
      const btn = form.querySelector("button[type=submit]");
      if (btn) btn.disabled = true;
      try {
        await auth.payInquiry(orderId, choices);
        toast("پرداخت انجام شد و سفارش نهایی شد");
        location.hash = "#/account/orders";
      } catch (ex) {
        if (btn) btn.disabled = false;
        toast(ex.message);
      }
      return;
    }

    if (inquiryReview) {
      if (!auth.current()?.admin) return;
      const items = [...form.querySelectorAll(".inquiry-review-item")].map((box) => {
        const id = Number(box.dataset.item);
        const inquiry = data.get(`inquiry-${id}`);
        const checked = [...box.querySelectorAll(`input[name="alt-${id}"]:checked`)].map((el) => el.value);
        const typed = String(data.get(`alttext-${id}`) || "")
          .split(/[،,]/)
          .map((x) => x.trim())
          .filter(Boolean);
        return { id, inquiry, altOptions: [...new Set([...checked, ...typed])] };
      });
      try {
        await api(`/api/admin/orders/${inquiryReview.dataset.user}/${inquiryReview.dataset.order}/inquiry`, {
          method: "PATCH",
          body: { items },
        });
        toast("نتیجه استعلام برای مشتری ارسال شد");
        render();
      } catch (ex) {
        err.textContent = ex.message;
      }
      return;
    }

    if (coupon) {
      const code = toEn(String(data.get("code") || "")).trim().toUpperCase();
      const draft = draftGet();
      const items = cartLines();
      if (!code) {
        err.textContent = "کد تخفیف را وارد کنید";
        return;
      }
      if (!draft || !items.length) {
        location.hash = "#/checkout/address";
        return;
      }
      const btn = form.querySelector("button");
      btn.disabled = true;
      err.textContent = "";
      try {
        const quote = await api("/api/me/discount", {
          method: "POST",
          body: { code, items: items.map((i) => ({ id: i.p.id, qty: i.qty })) },
        });
        draft.coupon = { code: quote.code, discount: quote.discount, subtotal: cartTotals(items).sum };
        draftSet(draft);
        toast("کد تخفیف اعمال شد");
        render();
      } catch (ex) {
        btn.disabled = false;
        err.textContent = ex.message;
      }
      return;
    }

    if (adminDiscount) {
      if (!auth.current()?.admin) return;
      try {
        const list = await api("/api/admin/discounts", {
          method: "POST",
          body: {
            code: toEn(String(data.get("code") || "")).trim().toUpperCase(),
            type: data.get("type"),
            value: Number(toEn(String(data.get("value") || "")).replace(/\D/g, "")),
            minTotal: Number(toEn(String(data.get("minTotal") || "")).replace(/\D/g, "")),
            maxDiscount: Number(toEn(String(data.get("maxDiscount") || "")).replace(/\D/g, "")),
            usageLimit: Number(toEn(String(data.get("usageLimit") || "")).replace(/\D/g, "")),
            days: Number(toEn(String(data.get("days") || "")).replace(/\D/g, "")),
            onePerCustomer: data.get("onePerCustomer") === "on",
          },
        });
        app.innerHTML = adminDiscountsPage(list);
        decoratePage(["admin"]);
        mountRouteBack();
        toast("کد تخفیف ساخته شد");
      } catch (ex) {
        err.textContent = ex.message;
      }
      return;
    }

    if (login) {
      const phone = normalizePhone(data.get("phone"));
      const pass = String(data.get("pass") || "");
      if (!validPhone(phone)) {
        err.textContent = "شماره موبایل را درست وارد کنید";
        return;
      }
      const message = await auth.login(phone, pass);
      if (message) {
        err.textContent = message;
        return;
      }
      toast("خوش آمدید");
      afterAuth(form.dataset.next);
      return;
    }

    if (register) {
      const firstName = String(data.get("firstName") || "").trim();
      const lastName = String(data.get("lastName") || "").trim();
      const name = `${firstName} ${lastName}`.trim();
      const phone = normalizePhone(data.get("phone"));
      const pass = String(data.get("pass") || "");
      const pass2 = String(data.get("pass2") || "");
      const address = String(data.get("address") || "").trim();
      if (firstName.length < 2) {
        err.textContent = "نام را کامل وارد کنید";
        return;
      }
      if (lastName.length < 2) {
        err.textContent = "نام خانوادگی را کامل وارد کنید";
        return;
      }
      if (!validPhone(phone)) {
        err.textContent = "شماره باید ۱۱ رقم و با ۰۹ شروع شود";
        return;
      }
      const passwordError = passwordValidationError(pass);
      if (passwordError) {
        err.textContent = passwordError;
        return;
      }
      if (pass !== pass2) {
        err.textContent = "تکرار رمز با رمز عبور یکی نیست";
        return;
      }
      const message = await auth.register({ firstName, lastName, name, phone, pass, address });
      if (message) {
        err.textContent = message;
        return;
      }
      toast("حساب شما ساخته شد");
      afterAuth(form.dataset.next);
      return;
    }

    if (profile) {
      if (!auth.current()) {
        location.hash = "#/account?next=info";
        return;
      }
      const name = String(data.get("name") || "").trim();
      const email = String(data.get("email") || "").trim();
      const nationalId = toEn(data.get("nationalId") || "").replace(/\D/g, "");
      const birthday = String(data.get("birthday") || "").trim();
      const job = String(data.get("job") || "").trim();
      if (name.length < 3) {
        err.textContent = "نام را کامل بنویسید";
        return;
      }
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        err.textContent = "ایمیل را درست وارد کنید";
        return;
      }
      if (nationalId && !/^\d{10}$/.test(nationalId)) {
        err.textContent = "کد ملی باید ۱۰ رقم باشد";
        return;
      }
      try {
        await auth.update({ name, email, nationalId, birthday, job });
        toast("اطلاعات حساب ذخیره شد");
        render();
      } catch (ex) {
        err.textContent = ex.message;
      }
      return;
    }

    if (passwordChange) {
      if (!auth.current()) {
        location.hash = "#/account";
        return;
      }
      const currentPassword = String(data.get("currentPassword") || "");
      const newPassword = String(data.get("newPassword") || "");
      const newPasswordRepeat = String(data.get("newPasswordRepeat") || "");
      const passwordError = passwordValidationError(newPassword);
      if (!currentPassword) {
        err.textContent = "رمز عبور فعلی را وارد کنید";
        return;
      }
      if (passwordError) {
        err.textContent = passwordError;
        return;
      }
      if (newPassword !== newPasswordRepeat) {
        err.textContent = "تکرار رمز جدید یکسان نیست";
        return;
      }
      try {
        await auth.changePassword(currentPassword, newPassword);
        toast("رمز عبور با موفقیت تغییر کرد");
        render();
      } catch (ex) {
        err.textContent = ex.message;
      }
      return;
    }

    if (sheba) {
      if (!auth.current()) {
        location.hash = "#/account?next=sheba";
        return;
      }
      const owner = String(data.get("shebaOwner") || "").trim();
      const num = normalizeSheba(data.get("sheba"));
      if (owner.length < 3) {
        err.textContent = "نام صاحب حساب را بنویسید";
        return;
      }
      if (!/^IR\d{24}$/.test(num)) {
        err.textContent = "شبا باید IR و ۲۴ رقم باشد";
        return;
      }
      try {
        await auth.update({ sheba: num, shebaOwner: owner });
        toast("شماره شبا ذخیره شد");
        render();
      } catch (ex) {
        err.textContent = ex.message;
      }
      return;
    }

    if (review) {
      const productId = Number(data.get("productId"));
      if (!auth.current()) {
        location.hash = productId ? `#/account?next=product/${productId}` : "#/account?next=opinions";
        return;
      }
      const rating = Number(data.get("rating") || 5);
      const text = String(data.get("text") || "").trim();
      if (!productId) {
        err.textContent = "کالا را انتخاب کنید";
        return;
      }
      if (text.length < 8) {
        err.textContent = "دیدگاه را کامل‌تر بنویسید";
        return;
      }
      try {
        await auth.addReview({ productId, rating, text });
        toast("دیدگاه ثبت شد");
        if (location.hash.startsWith("#/product/")) {
          render();
          requestAnimationFrame(() => activatePtab("reviews", true));
        } else {
          location.hash = "#/account/opinions?tab=reviews";
          render();
        }
      } catch (ex) {
        err.textContent = ex.message;
      }
      return;
    }

    if (question) {
      const productId = Number(data.get("productId"));
      if (!auth.current()) {
        location.hash = productId ? `#/account?next=product/${productId}` : "#/account?next=opinions";
        return;
      }
      const text = String(data.get("text") || "").trim();
      if (!productId) {
        err.textContent = "کالا را انتخاب کنید";
        return;
      }
      if (text.length < 8) {
        err.textContent = "پرسش را واضح‌تر بنویسید";
        return;
      }
      try {
        await auth.addQuestion({ productId, text });
        toast("پرسش ثبت شد");
        if (location.hash.startsWith("#/product/")) {
          render();
          requestAnimationFrame(() => activatePtab("ask", true));
        } else {
          location.hash = "#/account/opinions?tab=questions";
          render();
        }
      } catch (ex) {
        err.textContent = ex.message;
      }
      return;
    }

    if (address) {
      const user = auth.current();
      if (!user) {
        location.hash = "#/account?next=addresses";
        return;
      }
      const title = String(data.get("title") || "").trim();
      const text = String(data.get("text") || "").trim();
      const postalCode = toEn(data.get("postalCode") || "").replace(/\D/g, "");
      const plaque = toEn(data.get("plaque") || "").trim();
      const unit = toEn(data.get("unit") || "").trim();
      if (title.length < 2 || text.length < 8) {
        err.textContent = "عنوان و نشانی خیابان و کوچه را کامل بنویسید";
        return;
      }
      if (!/^\d{10}$/.test(postalCode)) {
        err.textContent = "کد پستی باید دقیقاً ۱۰ رقم باشد";
        return;
      }
      if (!plaque) {
        err.textContent = "پلاک را وارد کنید";
        return;
      }
      try {
        await auth.update({
          address: user.address || text,
          addresses: [...(user.addresses || []), { id: Date.now(), title, text, postalCode, plaque, unit }],
        });
        toast("آدرس ذخیره شد");
        render();
      } catch (ex) {
        err.textContent = ex.message;
      }
      return;
    }

    if (checkoutAddr) {
      const user = auth.current();
      if (!user) {
        location.hash = "#/account?next=checkout";
        return;
      }
      const receiver = String(data.get("receiver") || "").trim();
      const phone = normalizePhone(data.get("phone"));
      const addressId = String(data.get("addressId") || "new");
      const title = String(data.get("title") || "").trim();
      const text = String(data.get("text") || "").trim();
      const postalCode = toEn(data.get("postalCode") || "").replace(/\D/g, "");
      const plaque = toEn(data.get("plaque") || "").trim();
      const unit = toEn(data.get("unit") || "").trim();
      if (receiver.length < 3) {
        err.textContent = "نام گیرنده را کامل بنویسید";
        return;
      }
      if (!validPhone(phone)) {
        err.textContent = "موبایل گیرنده را درست وارد کنید";
        return;
      }
      if (title.length < 2 || text.length < 8) {
        err.textContent = "عنوان و نشانی خیابان و کوچه را کامل بنویسید";
        return;
      }
      if (!/^\d{10}$/.test(postalCode)) {
        err.textContent = "کد پستی باید دقیقاً ۱۰ رقم باشد";
        return;
      }
      if (!plaque) {
        err.textContent = "پلاک را وارد کنید";
        return;
      }
      const found = addressId !== "new" ? (user.addresses || []).find((a) => String(a.id) === addressId) : null;
      if (addressId !== "new" && !found) {
        err.textContent = "آدرس انتخاب‌شده معتبر نیست";
        return;
      }
      const savedId = found?.id || Date.now();
      const savedAddress = { id: savedId, title, text, postalCode, plaque, unit };
      const addresses = found
        ? (user.addresses || []).map((address) => (String(address.id) === String(savedId) ? savedAddress : address))
        : [...(user.addresses || []), savedAddress];
      const addressText = fullAddressText(savedAddress);
      try {
        await auth.update({
          address: user.address || text,
          addresses,
        });
      } catch (ex) {
        err.textContent = ex.message;
        return;
      }
      draftSet({
        addressId: savedId,
        receiver,
        phone,
        addressText,
        title: title || "آدرس ارسال",
        text,
        postalCode,
        plaque,
        unit,
        factor: String(140500000 + (Date.now() % 100000)),
      });
      location.hash = "#/checkout/invoice";
      return;
    }

    if (adminProduct) {
      if (!auth.current()?.admin) return;
      const id = form.dataset.id;
      const payload = {
        title: String(data.get("title") || "").trim(),
        brand: String(data.get("brand") || "").trim(),
        cat: String(data.get("cat") || "kitchen"),
        line: String(data.get("line") || ""),
        price: Number(data.get("price")),
        oldPrice: Number(data.get("oldPrice")) || 0,
        colors: String(data.get("colors") || ""),
        specs: String(data.get("specs") || ""),
        desc: String(data.get("desc") || ""),
        amazing: false,
        fresh: form.querySelector("[name=fresh]")?.checked || false,
      };
      if (payload.title.length < 3 || !payload.price) {
        err.textContent = "عنوان و قیمت را کامل وارد کنید";
        return;
      }
      try {
        if (id) await api(`/api/admin/products/${id}`, { method: "PATCH", body: payload });
        else await api("/api/admin/products", { method: "POST", body: payload });
        await bootCatalog();
        toast("کالا ذخیره شد");
        location.hash = "#/admin/products";
      } catch (ex) {
        err.textContent = ex.message;
      }
      return;
    }

    if (adminSupport) {
      if (!auth.current()?.admin) return;
      try {
        await api(`/api/admin/support/${form.dataset.id}`, {
          method: "POST",
          body: { text: String(data.get("text") || "").trim() },
        });
        toast("پاسخ ارسال شد");
        render();
      } catch (ex) {
        err.textContent = ex.message;
      }
      return;
    }

    if (adminSettings) {
      if (!auth.current()?.admin) return;
      try {
        const saved = await api("/api/admin/settings", {
          method: "PATCH",
          body: {
            name: String(data.get("name") || "").trim(),
            tagline: String(data.get("tagline") || "").trim(),
            city: String(data.get("city") || "").trim(),
            address: String(data.get("address") || "").trim(),
            hours: String(data.get("hours") || "").trim(),
            phone: String(data.get("phone") || "").trim(),
          },
        });
        applyCatalog(saved);
        toast("تنظیمات فروشگاه ذخیره شد");
        render();
      } catch (ex) {
        err.textContent = ex.message;
      }
    }
  });

  app.addEventListener("change", async (e) => {
    const inquiryFlag = e.target.closest(".inquiry-review-item input[type=radio]");
    if (inquiryFlag) {
      const box = inquiryFlag.closest(".inquiry-review-item");
      const altBox = box?.querySelector(".inquiry-alt-box");
      if (altBox) altBox.hidden = inquiryFlag.value !== "alt";
      return;
    }
    const inquiryChoice = e.target.closest("[data-inquiry-choice]");
    if (inquiryChoice) {
      const form = inquiryChoice.closest("[data-inquiry-pay]");
      const orderId = form?.getAttribute("data-inquiry-pay");
      const order = (auth.current()?.orders || []).find((o) => String(o.id) === String(orderId));
      const amountBtn = form?.querySelector("[data-pay-amount]");
      if (order && amountBtn) {
        const preview = inquiryPayAmount(order, form);
        amountBtn.textContent = `پرداخت ${money(preview.total)} تومان`;
      }
      return;
    }
    const discountType = e.target.closest('[data-admin-discount] input[name="type"]');
    if (discountType) {
      const form = discountType.closest("[data-admin-discount]");
      const isPercent = discountType.value === "percent";
      form.querySelector("[data-discount-value-label]").textContent = isPercent
        ? "مقدار تخفیف (درصد)"
        : "مبلغ تخفیف (تومان)";
      form.querySelector("[data-discount-value-unit]").textContent = isPercent ? "٪" : "تومان";
      const valueInput = form.elements.value;
      valueInput.placeholder = isPercent ? "مثلاً ۱۰" : "مثلاً ۵۰٬۰۰۰";
      valueInput.value = "";
      const maxField = form.querySelector("[data-max-discount-field]");
      maxField.hidden = !isPercent;
      if (!isPercent) form.elements.maxDiscount.value = "";
      return;
    }
    const addressChoice = e.target.closest('input[name="addressId"]');
    if (addressChoice) {
      const form = addressChoice.closest("[data-checkout-addr]");
      form?.querySelectorAll(".addr-pick").forEach((label) => label.classList.toggle("on", label.contains(addressChoice)));
      if (form) {
        form.elements.title.value = addressChoice.dataset.title || "";
        form.elements.text.value = addressChoice.dataset.text || "";
        form.elements.postalCode.value = addressChoice.dataset.postalCode || "";
        form.elements.plaque.value = addressChoice.dataset.plaque || "";
        form.elements.unit.value = addressChoice.dataset.unit || "";
      }
      return;
    }
    const sel = e.target.closest("[data-order-status]");
    if (!sel || !auth.current()?.admin) return;
    try {
      await api(`/api/admin/orders/${sel.dataset.user}/${sel.dataset.order}`, {
        method: "PATCH",
        body: { status: sel.value },
      });
      toast("وضعیت سفارش به‌روز شد");
    } catch (err) {
      toast(err.message);
    }
  });

  function closeSearchSuggest() {
    searchSuggest.hidden = true;
    searchInput.setAttribute("aria-expanded", "false");
  }

  function renderSearchSuggest() {
    const query = searchInput.value.trim();
    if (!query) {
      closeSearchSuggest();
      return;
    }
    const list = searchProducts(query);
    searchSuggest.innerHTML = list.length
      ? `
        <div class="search-suggest-head">
          <b>نتیجه‌های مرتبط</b>
          <span>${fa(list.length)} کالا</span>
        </div>
        <div class="search-suggest-list">
          ${list
            .slice(0, 6)
            .map(
              (p) => `
            <a class="search-suggest-item" href="#/product/${p.id}">
              <span class="search-suggest-thumb">${thumb(p)}</span>
              <span class="search-suggest-copy">
                <b>${escapeHtml(p.title)}</b>
                <small>${escapeHtml(p.brand)} · ${escapeHtml(catName(p.cat))}</small>
              </span>
              <strong>${money(p.price)} <small>تومان</small></strong>
            </a>`
            )
            .join("")}
        </div>
        <a class="search-suggest-all" href="#/search?q=${encodeURIComponent(query)}">
          مشاهده همه ${fa(list.length)} نتیجه
          <span aria-hidden="true">←</span>
        </a>`
      : `
        <div class="search-suggest-empty">
          ${dashIco("search")}
          <div><b>کالایی پیدا نشد</b><small>نام یا بخشی از مشخصات کالا را بنویسید</small></div>
        </div>`;
    searchSuggest.hidden = false;
    searchInput.setAttribute("aria-expanded", "true");
  }

  let searchFrame;
  let registerPhoneTimer;
  let registerPhoneController;

  function scheduleRegisterPhoneCheck(input) {
    const form = input.closest("[data-register]");
    const status = form?.querySelector("[data-phone-check]");
    const details = form?.querySelector("[data-register-details]");
    if (!form || !status || !details) return;
    clearTimeout(registerPhoneTimer);
    registerPhoneController?.abort();
    form.dataset.phoneAvailable = "";
    details.hidden = true;
    const phone = normalizePhone(input.value);
    if (phone.length < 11) {
      status.hidden = true;
      status.innerHTML = "";
      return;
    }
    status.hidden = false;
    if (!validPhone(phone)) {
      status.className = "phone-check is-error";
      status.innerHTML = `${dashIco("user")}<div><b>شماره موبایل معتبر نیست</b><span>شماره باید با ۰۹ شروع شود.</span></div>`;
      return;
    }
    status.className = "phone-check is-checking";
    status.innerHTML = `<span class="phone-check-spinner" aria-hidden="true"></span><div><b>در حال بررسی شماره</b><span>فقط یک لحظه...</span></div>`;
    registerPhoneTimer = setTimeout(async () => {
      registerPhoneController = new AbortController();
      try {
        const result = await api("/api/account/lookup", { method: "POST", body: { phone }, signal: registerPhoneController.signal });
        if (normalizePhone(input.value) !== phone) return;
        if (result.exists) {
          const next = form.dataset.next ? `&next=${encodeURIComponent(form.dataset.next)}` : "";
          status.className = "phone-check is-existing";
          status.innerHTML = `
            ${dashIco("user")}
            <div><b>با این شماره حساب دارید</b><span>نیازی به ساخت حساب جدید نیست؛ مستقیم وارد شوید.</span></div>
            <a class="btn ghost" href="#/account?tab=login&phone=${encodeURIComponent(phone)}${next}">ورود به حساب</a>`;
        } else {
          form.dataset.phoneAvailable = "1";
          status.className = "phone-check is-available";
          status.innerHTML = `${dashIco("shield")}<div><b>شماره برای ثبت‌نام آماده است</b><span>حالا مشخصات حساب را کامل کنید.</span></div>`;
          details.hidden = false;
        }
      } catch (err) {
        if (err.name === "AbortError") return;
        status.className = "phone-check is-error";
        status.innerHTML = `${dashIco("user")}<div><b>بررسی شماره انجام نشد</b><span>${escapeHtml(err.message)}</span></div>`;
      }
    }, 280);
  }

  searchInput.addEventListener("input", () => {
    cancelAnimationFrame(searchFrame);
    searchFrame = requestAnimationFrame(renderSearchSuggest);
  });
  searchInput.addEventListener("focus", renderSearchSuggest);
  searchInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const q = searchInput.value.trim();
      closeSearchSuggest();
      location.hash = q ? `#/search?q=${encodeURIComponent(q)}` : "#/";
    } else if (e.key === "Escape") {
      closeSearchSuggest();
      searchInput.blur();
    }
  });
  searchSuggest.addEventListener("click", closeSearchSuggest);
  document.addEventListener("input", (e) => {
    const passwordInput = e.target.closest?.("[data-password-input]");
    if (passwordInput) {
      const checks = passwordChecks(passwordInput.value);
      passwordInput.closest("[data-register], [data-password-change]")?.querySelectorAll("[data-password-rule]").forEach((item) => {
        item.classList.toggle("ok", Boolean(checks[item.dataset.passwordRule]));
      });
    }
    const phoneInput = e.target.closest?.("[data-phone-input]");
    if (!phoneInput) return;
    const digits = toEn(phoneInput.value).replace(/\D/g, "").slice(0, 11);
    if (phoneInput.value !== digits) phoneInput.value = digits;
    if (phoneInput.id === "regPhone") scheduleRegisterPhoneCheck(phoneInput);
  });
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".search-wrap")) closeSearchSuggest();
  });

  function syncNetworkState() {
    if (!networkState) return;
    networkState.hidden = navigator.onLine;
    document.body.classList.toggle("is-offline", !navigator.onLine);
  }

  window.addEventListener("online", syncNetworkState);
  window.addEventListener("offline", syncNetworkState);
  window.addEventListener(
    "scroll",
    () => {
      header?.classList.toggle("is-compact", window.scrollY > 28);
    },
    { passive: true }
  );

  function setDrawerOpen(on) {
    siteDrawer?.classList.toggle("is-open", on);
    drawerOverlay?.classList.toggle("is-open", on);
    if (drawerOverlay) drawerOverlay.hidden = !on;
    document.body.classList.toggle("drawer-open", on);
    if (siteDrawer) siteDrawer.setAttribute("aria-hidden", on ? "false" : "true");
    if (menuBtn) menuBtn.setAttribute("aria-expanded", on ? "true" : "false");
  }

  function fillSiteDrawer() {
    if (!drawerBody) return;
    const { parts } = parse();
    const currentCat = parts[0] === "category" ? parts[1] : "";
    const currentLine = parts[0] === "line" ? parts[1] : "";
    const currentBrand = parts[0] === "brand" ? findBrand(parts[1]) : "";
    drawerBody.innerHTML = `
      <a class="drawer-all" href="#/category/all"><span>همه محصولات</span><span aria-hidden="true">‹</span></a>
      <section class="drawer-sec">
        <h3>دسته‌بندی‌ها</h3>
        <p>حمام، نظافت، ظروف و بقیه قفسه‌ها</p>
        ${categories
          .map(
            (c) => `
          <a class="drawer-link ${c.id === currentCat ? "on" : ""}" href="#/category/${c.id}">
            <span>${escapeHtml(c.name)}</span>
            <small>${fa(products.filter((p) => p.cat === c.id).length)}</small>
          </a>`
          )
          .join("")}
      </section>
      <section class="drawer-sec">
        <h3>لاین‌های فروشگاه</h3>
        <p>همان لاین‌هایی که در مغازه جهانشهر دیده‌اید</p>
        ${(lines || [])
          .map(
            (l) => `
          <a class="drawer-link ${l.id === currentLine ? "on" : ""}" href="#/line/${l.id}">
            <span>${escapeHtml(l.name.replace("لاین ", ""))}</span>
            <small>${fa(lineList(l.id).length)}</small>
          </a>`
          )
          .join("")}
      </section>
      <section class="drawer-sec">
        <h3>برندها</h3>
        <p>اگر دنبال یک برند خاص هستید، از اینجا همه کالاهایش را ببینید</p>
        ${brandList()
          .map(
            ([b, count]) => `
          <a class="drawer-link ${b === currentBrand ? "on" : ""}" href="#/brand/${encodeURIComponent(b)}">
            <span>${escapeHtml(b)}</span>
            <small>${fa(count)}</small>
          </a>`
          )
          .join("")}
      </section>
    `;
  }

  menuBtn?.addEventListener("click", () => {
    const open = !siteDrawer?.classList.contains("is-open");
    if (open) fillSiteDrawer();
    setDrawerOpen(open);
  });
  drawerClose?.addEventListener("click", () => setDrawerOpen(false));
  drawerOverlay?.addEventListener("click", () => setDrawerOpen(false));
  siteDrawer?.addEventListener("click", (e) => {
    if (e.target.closest("a")) setDrawerOpen(false);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && siteDrawer?.classList.contains("is-open")) setDrawerOpen(false);
  });

  window.addEventListener("hashchange", () => {
    if (routeBackPending) {
      internalRouteDepth = Math.max(0, internalRouteDepth - 1);
      routeBackPending = false;
    } else {
      internalRouteDepth += 1;
    }
    render();
    support.sync();
    setDrawerOpen(false);
    maybeShowInquiryPush();
  });
  function bindScrollRail() {
    const rail = document.getElementById("scrollRail");
    const thumb = document.getElementById("scrollThumb");
    if (!rail || !thumb) return;
    let dragging = false;
    let dragOffset = 0;

    const metrics = () => {
      const view = window.innerHeight;
      const total = Math.max(document.documentElement.scrollHeight, document.body.scrollHeight);
      const max = Math.max(1, total - view);
      const pad = 18;
      const track = Math.max(64, view - pad * 2);
      const thumbH = Math.max(52, Math.min(track * 0.45, (view / total) * track));
      return { view, total, max, pad, track, thumbH };
    };

    const paint = () => {
      const m = metrics();
      const y = window.scrollY || document.documentElement.scrollTop || 0;
      const ratio = y / m.max;
      const top = m.pad + ratio * (m.track - m.thumbH);
      thumb.style.height = `${m.thumbH}px`;
      thumb.style.transform = `translate3d(0, ${top}px, 0)`;
      rail.classList.toggle("is-short", m.total <= m.view + 4);
    };

    const jumpTo = (clientY) => {
      const m = metrics();
      const rect = rail.getBoundingClientRect();
      const y = clientY - rect.top - dragOffset - m.pad;
      const span = Math.max(1, m.track - m.thumbH);
      const ratio = Math.min(1, Math.max(0, y / span));
      window.scrollTo(0, ratio * m.max);
    };

    window.addEventListener("scroll", paint, { passive: true });
    window.addEventListener("resize", paint);
    window.addEventListener("hashchange", () => setTimeout(paint, 80));
    paint();
    setTimeout(paint, 400);
    setTimeout(paint, 1200);

    thumb.addEventListener("pointerdown", (e) => {
      dragging = true;
      const rect = thumb.getBoundingClientRect();
      dragOffset = e.clientY - rect.top;
      rail.classList.add("is-dragging");
      thumb.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    thumb.addEventListener("pointermove", (e) => {
      if (dragging) jumpTo(e.clientY);
    });
    const endDrag = () => {
      dragging = false;
      rail.classList.remove("is-dragging");
    };
    thumb.addEventListener("pointerup", endDrag);
    thumb.addEventListener("pointercancel", endDrag);
    rail.addEventListener("pointerdown", (e) => {
      if (e.target === thumb) return;
      const m = metrics();
      dragOffset = m.thumbH / 2;
      jumpTo(e.clientY);
    });
  }

  bindScrollRail();
  syncStoreShell();
  fillSiteDrawer();
  syncNetworkState();
  renderCounts();
  renderAccountBtn();
  auth.boot().then(bootCatalog).then(() => {
    render();
    support.bind();
    setTimeout(() => maybeShowInquiryPush({ force: true }), 3600);
  });

  phonePushCard?.addEventListener("click", () => {
    markInquiryPushSeen();
    hidePhonePush();
    location.hash = "#/notifications";
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") refreshMeQuiet();
  });
  setInterval(() => {
    if (document.visibilityState === "visible") refreshMeQuiet();
  }, 20000);

  const support = {
    KEY: "zanbil-support-id",
    timer: null,
    mode: "",
    fp: "",
    open: false,
    prefill: null,
    guestId() {
      let id = localStorage.getItem(this.KEY);
      if (!id) {
        id = `g-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
        localStorage.setItem(this.KEY, id);
      }
      return id;
    },
    clock(ts) {
      const d = new Date(ts || Date.now());
      const pad = (n) => fa(String(n).padStart(2, "0"));
      return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    },
    els() {
      return {
        fab: document.getElementById("supportFab"),
        box: document.getElementById("supportBox"),
        body: document.getElementById("supportBody"),
        form: document.getElementById("supportForm"),
        input: document.getElementById("supportInput"),
        dot: document.getElementById("supportDot"),
      };
    },
    setOpen(on) {
      const { fab, box } = this.els();
      this.open = !!on;
      fab.classList.toggle("is-open", this.open);
      box.classList.toggle("is-open", this.open);
      fab.setAttribute("aria-expanded", this.open ? "true" : "false");
      box.setAttribute("aria-hidden", this.open ? "false" : "true");
      if (this.open) this.load(true);
    },
    sync() {
      const { fab, box } = this.els();
      if (!fab) return;
      const hide = (location.hash || "").startsWith("#/admin");
      fab.classList.toggle("is-hidden", hide);
      if (hide) this.setOpen(false);
    },
    openPasswordReset(phone) {
      this.prefill = {
        name: "درخواست بازیابی رمز",
        phone,
        text: "سلام، برای حساب این شماره درخواست رمز عبور موقت دارم.",
      };
      this.setOpen(true);
    },
    fingerprint(chat) {
      const msgs = chat?.messages || [];
      const last = msgs[msgs.length - 1];
      return `${msgs.length}:${last?.id || 0}:${chat?.unreadCustomer || 0}`;
    },
    renderStart(user) {
      const { body, box } = this.els();
      const prefill = this.prefill || {};
      this.mode = "start";
      box.classList.remove("is-thread");
      body.innerHTML = `
        <form class="support-start" data-support-start>
          <h4>${this.prefill ? "درخواست بازیابی رمز عبور" : "سلام، چطور کمک کنیم؟"}</h4>
          <p>${this.prefill ? "شماره حساب را بررسی کنید و درخواست را برای پشتیبانی بفرستید." : "نام و شماره را بگذارید تا فروشگاه جهانشهر همین‌جا جواب بدهد."}</p>
          <div class="field">
            <label>نام</label>
            <input name="name" required value="${escapeHtml(user?.name || prefill.name || "")}" />
          </div>
          <div class="field">
            <label>موبایل</label>
            <input name="phone" type="tel" inputmode="numeric" maxlength="11" autocomplete="tel" data-phone-input required value="${escapeHtml(user?.phone || prefill.phone || "")}" />
          </div>
          <div class="field">
            <label>پیام</label>
            <textarea name="text" required placeholder="سؤالتان را بنویسید">${escapeHtml(prefill.text || "")}</textarea>
          </div>
          <p class="form-error" data-error></p>
          <button class="btn wide" type="submit">ارسال پیام</button>
        </form>`;
    },
    renderChat(chat) {
      const { body, box, input, dot } = this.els();
      const typing = document.activeElement === input && input.value;
      const top = body.scrollTop;
      const nearBottom = body.scrollHeight - body.scrollTop - body.clientHeight < 48;
      this.mode = "chat";
      box.classList.add("is-thread");
      const msgs = chat.messages || [];
      body.innerHTML = `
        <div class="support-log">
          ${
            msgs.length
              ? msgs
                  .map(
                    (m) =>
                      `<div class="support-msg ${m.from}"><span>${escapeHtml(m.text)}</span><time>${this.clock(m.at)}</time></div>`
                  )
                  .join("")
              : `<p>سلام! هر سؤالی دارید همین‌جا بپرسید.</p>`
          }
        </div>`;
      if (nearBottom || !typing) body.scrollTop = body.scrollHeight;
      else body.scrollTop = top;
      if (this.prefill?.text && input && !input.value) input.value = this.prefill.text;
      this.prefill = null;
      if (dot) dot.hidden = !(chat.unreadCustomer > 0);
    },
    async load(force) {
      if (!this.open && !force) return;
      try {
        const data = await api(`/api/support?guest=${encodeURIComponent(this.guestId())}`);
        if (data.chat) {
          const fp = this.fingerprint(data.chat);
          if (!force && fp === this.fp && this.mode === "chat") return;
          this.fp = fp;
          this.renderChat(data.chat);
        } else if (this.mode !== "start") {
          this.renderStart(auth.current());
        }
      } catch (err) {
        if (this.els().body) this.els().body.innerHTML = `<p>${escapeHtml(err.message)}</p>`;
      }
    },
    bind() {
      const { fab, box, form, body } = this.els();
      if (!fab || fab.dataset.bound) return;
      fab.dataset.bound = "1";
      fab.addEventListener("click", (e) => {
        e.stopPropagation();
        this.setOpen(!this.open);
      });
      document.querySelectorAll("[data-open-support]").forEach((btn) => {
        btn.addEventListener("click", (e) => {
          e.stopPropagation();
          this.setOpen(true);
        });
      });
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const text = this.els().input.value.trim();
        if (!text) return;
        try {
          await api("/api/support", {
            method: "POST",
            body: { guestId: this.guestId(), text, name: auth.current()?.name, phone: auth.current()?.phone },
          });
          this.els().input.value = "";
          await this.load(true);
        } catch (err) {
          toast(err.message);
        }
      });
      body.addEventListener("submit", async (e) => {
        const start = e.target.closest("[data-support-start]");
        if (!start) return;
        e.preventDefault();
        const fd = new FormData(start);
        const err = start.querySelector("[data-error]");
        const btn = start.querySelector("button[type=submit]");
        try {
          if (btn) btn.disabled = true;
          await api("/api/support", {
            method: "POST",
            body: {
              guestId: this.guestId(),
              name: String(fd.get("name") || "").trim(),
              phone: String(fd.get("phone") || "").trim(),
              text: String(fd.get("text") || "").trim(),
            },
          });
          await this.load(true);
        } catch (ex) {
          if (err) err.textContent = ex.message;
          else toast(ex.message);
        } finally {
          if (btn) btn.disabled = false;
        }
      });
      document.addEventListener("click", (e) => {
        if (!this.open) return;
        if (e.target.closest("#supportBox") || e.target.closest("#supportFab")) return;
        this.setOpen(false);
      });
      document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && this.open) this.setOpen(false);
      });
      this.timer = setInterval(() => {
        if (this.open && this.mode === "chat") this.load(false);
      }, 5000);
      this.sync();
    },
  };

  window.addEventListener("load", () => {
    const splash = document.getElementById("splash");
    if (!splash) return;
    setTimeout(() => splash.classList.add("hide"), 2800);
    setTimeout(() => {
      splash.remove();
      maybeShowInquiryPush({ force: true });
    }, 3400);
  });
})();
