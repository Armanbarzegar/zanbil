const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const db = require("./db");

const PORT = Number(process.env.PORT) || 3000;
const ROOT = path.join(__dirname, "..");
const accountLookupAttempts = new Map();

db.seed();

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".woff2": "font/woff2",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".png": "image/png",
};

function send(res, status, data, headers = {}) {
  const body = typeof data === "string" ? data : JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": typeof data === "string" ? "text/plain; charset=utf-8" : "application/json; charset=utf-8",
    ...headers,
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error("داده نامعتبر است"));
      }
    });
    req.on("error", reject);
  });
}

function normalizeProduct(body, id) {
  const colors = Array.isArray(body.colors)
    ? body.colors
    : String(body.colors || "")
        .split(/[،,]/)
        .map((s) => s.trim())
        .filter(Boolean);
  let specs = body.specs;
  if (typeof specs === "string") {
    specs = specs
      .split("\n")
      .map((line) => line.split(":").map((s) => s.trim()))
      .filter((p) => p[0] && p[1]);
  }
  if (!Array.isArray(specs)) specs = [];
  return {
    id,
    cat: String(body.cat || "kitchen"),
    line: String(body.line || ""),
    title: String(body.title || "").trim(),
    brand: String(body.brand || "زنبیل").trim(),
    price: Number(body.price) || 0,
    oldPrice: Number(body.oldPrice) || 0,
    rating: Number(body.rating) || 5,
    reviews: Number(body.reviews) || 0,
    stock: Number(body.stock) || 0,
    amazing: Boolean(body.amazing),
    fresh: Boolean(body.fresh),
    image: String(body.image || ""),
    colors,
    specs,
    desc: String(body.desc || "").trim(),
  };
}

function tokenOf(req) {
  const header = req.headers.authorization || "";
  return header.startsWith("Bearer ") ? header.slice(7) : "";
}

function requireUser(req, res) {
  const user = db.findUserByToken(tokenOf(req));
  if (!user) {
    send(res, 401, { error: "وارد حساب نشده‌اید" });
    return null;
  }
  return db.persistExpiredOrders(user);
}

function requireAdmin(req, res) {
  const user = requireUser(req, res);
  if (!user) return null;
  if (!user.admin) {
    send(res, 403, { error: "دسترسی مدیریت ندارید" });
    return null;
  }
  return user;
}

function allowAccountLookup(req) {
  const key = req.socket.remoteAddress || "unknown";
  const now = Date.now();
  const recent = (accountLookupAttempts.get(key) || []).filter((time) => now - time < 60_000);
  if (recent.length >= 20) return false;
  recent.push(now);
  accountLookupAttempts.set(key, recent);
  return true;
}

function passwordRuleError(pass) {
  if (pass.length < 8) return "رمز عبور باید حداقل ۸ کاراکتر باشد";
  if (!/^[\x21-\x7E]+$/.test(pass)) return "رمز عبور باید فقط با حروف و علائم انگلیسی نوشته شود";
  if (!/[A-Z]/.test(pass)) return "رمز عبور باید حداقل یک حرف بزرگ انگلیسی داشته باشد";
  if (!/[a-z]/.test(pass)) return "رمز عبور باید حداقل یک حرف کوچک انگلیسی داشته باشد";
  if (!/\d/.test(pass)) return "رمز عبور باید حداقل یک عدد داشته باشد";
  return "";
}

function priceCartItems(items) {
  const products = db.catalog().products || [];
  const lines = [];
  for (const item of Array.isArray(items) ? items : []) {
    const product = products.find((p) => Number(p.id) === Number(item.id));
    const qty = Math.min(99, Math.max(0, Math.floor(Number(item.qty) || 0)));
    if (!product || !qty) continue;
    lines.push({
      id: product.id,
      title: product.title,
      qty,
      price: Number(product.price) || 0,
      colors: Array.isArray(product.colors) ? product.colors : [],
    });
  }
  return { lines, subtotal: lines.reduce((s, line) => s + line.price * line.qty, 0) };
}

function temporaryPassword() {
  return `Zb${crypto.randomBytes(5).toString("hex")}A7`;
}

async function handleApi(req, res, url) {
  const method = req.method;
  const parts = url.pathname.split("/").filter(Boolean);

  if (method === "POST" && url.pathname === "/api/account/lookup") {
    if (!allowAccountLookup(req)) return send(res, 429, { error: "تعداد بررسی‌ها زیاد است؛ یک دقیقه دیگر تلاش کنید" });
    const body = await readBody(req);
    const phone = String(body.phone || "").replace(/\D/g, "");
    if (!/^09\d{9}$/.test(phone)) return send(res, 400, { error: "شماره موبایل نامعتبر است" });
    return send(res, 200, { exists: Boolean(db.findUserByPhone(phone)) });
  }

  if (method === "POST" && url.pathname === "/api/register") {
    const body = await readBody(req);
    const firstName = String(body.firstName || "").trim();
    const lastName = String(body.lastName || "").trim();
    const name = `${firstName} ${lastName}`.trim();
    const phone = String(body.phone || "").replace(/\D/g, "");
    const pass = String(body.pass || "");
    const address = String(body.address || "").trim();
    if (firstName.length < 2) return send(res, 400, { error: "نام را کامل وارد کنید" });
    if (lastName.length < 2) return send(res, 400, { error: "نام خانوادگی را کامل وارد کنید" });
    if (!/^09\d{9}$/.test(phone)) return send(res, 400, { error: "شماره موبایل نامعتبر است" });
    const passError = passwordRuleError(pass);
    if (passError) return send(res, 400, { error: passError });
    if (db.findUserByPhone(phone)) return send(res, 400, { error: "با این شماره قبلاً حساب ساخته شده" });
    const user = db.createUser({ firstName, lastName, name, phone, pass, address });
    const token = db.createSession(user.id);
    return send(res, 201, { token, user: db.publicUser(user) });
  }

  if (method === "POST" && url.pathname === "/api/login") {
    const body = await readBody(req);
    const phone = String(body.phone || "").replace(/\D/g, "");
    const pass = String(body.pass || "");
    const user = db.findUserByPhone(phone);
    if (!db.checkPass(user, pass)) return send(res, 400, { error: "شماره یا رمز عبور اشتباه است" });
    const token = db.createSession(user.id);
    return send(res, 200, { token, user: db.publicUser(user) });
  }

  if (method === "POST" && url.pathname === "/api/logout") {
    db.removeSession(tokenOf(req));
    return send(res, 200, { ok: true });
  }

  if (method === "GET" && url.pathname === "/api/me") {
    const user = requireUser(req, res);
    if (!user) return;
    return send(res, 200, db.publicUser(user));
  }

  if (method === "PATCH" && url.pathname === "/api/me") {
    const user = requireUser(req, res);
    if (!user) return;
    const body = await readBody(req);
    const allow = [
      "name",
      "email",
      "nationalId",
      "birthday",
      "job",
      "sheba",
      "shebaOwner",
      "address",
      "addresses",
      "favorites",
    ];
    for (const key of allow) {
      if (body[key] !== undefined) user[key] = body[key];
    }
    db.saveUser(user);
    return send(res, 200, db.publicUser(user));
  }

  if (method === "PUT" && url.pathname === "/api/me/cart") {
    const user = requireUser(req, res);
    if (!user) return;
    const body = await readBody(req);
    const available = new Set((db.catalog().products || []).map((product) => Number(product.id)));
    const merged = new Map();
    for (const item of Array.isArray(body.items) ? body.items : []) {
      const id = Number(item.id);
      const qty = Math.min(99, Math.max(0, Number(item.qty) || 0));
      if (available.has(id) && qty > 0) merged.set(id, Math.max(merged.get(id) || 0, qty));
    }
    user.cart = [...merged].map(([id, qty]) => ({ id, qty }));
    db.saveUser(user);
    return send(res, 200, db.publicUser(user));
  }

  if (method === "POST" && url.pathname === "/api/me/password") {
    const user = requireUser(req, res);
    if (!user) return;
    const body = await readBody(req);
    const currentPassword = String(body.currentPassword || "");
    const newPassword = String(body.newPassword || "");
    if (!db.checkPass(user, currentPassword)) return send(res, 400, { error: "رمز عبور فعلی درست نیست" });
    const passError = passwordRuleError(newPassword);
    if (passError) return send(res, 400, { error: passError });
    if (currentPassword === newPassword) return send(res, 400, { error: "رمز جدید باید با رمز فعلی متفاوت باشد" });
    const updated = db.setUserPassword(user.id, newPassword, { mustChange: false, invalidateSessions: true });
    const token = db.createSession(updated.id);
    return send(res, 200, { token, user: db.publicUser(updated) });
  }

  if (method === "POST" && url.pathname === "/api/me/favorites") {
    const user = requireUser(req, res);
    if (!user) return;
    const body = await readBody(req);
    const id = Number(body.id);
    const favs = user.favorites || [];
    const has = favs.includes(id);
    user.favorites = has ? favs.filter((x) => x !== id) : [...favs, id];
    db.saveUser(user);
    return send(res, 200, { on: !has, user: db.publicUser(user) });
  }

  if (method === "POST" && url.pathname === "/api/me/reviews") {
    const user = requireUser(req, res);
    if (!user) return;
    const body = await readBody(req);
    const productId = Number(body.productId);
    const rating = Math.min(5, Math.max(1, Number(body.rating) || 5));
    const text = String(body.text || "").trim();
    if (!productId || text.length < 8) return send(res, 400, { error: "دیدگاه باید حداقل چند کلمه باشد و کالا انتخاب شود." });
    user.reviews = user.reviews || [];
    user.reviews.unshift({
      id: Date.now(),
      productId,
      rating,
      text,
      status: "در انتظار بررسی",
      createdAt: Date.now(),
    });
    db.saveUser(user);
    return send(res, 200, db.publicUser(user));
  }

  if (method === "POST" && url.pathname === "/api/me/questions") {
    const user = requireUser(req, res);
    if (!user) return;
    const body = await readBody(req);
    const productId = Number(body.productId);
    const text = String(body.text || "").trim();
    if (!productId || text.length < 8) return send(res, 400, { error: "پرسش باید واضح باشد و کالا انتخاب شود." });
    user.questions = user.questions || [];
    user.questions.unshift({
      id: Date.now(),
      productId,
      text,
      status: "در انتظار پاسخ",
      createdAt: Date.now(),
    });
    db.saveUser(user);
    return send(res, 200, db.publicUser(user));
  }

  if (method === "DELETE" && parts[0] === "api" && parts[1] === "me" && parts[2] === "reviews" && parts[3]) {
    const user = requireUser(req, res);
    if (!user) return;
    const id = Number(parts[3]);
    user.reviews = (user.reviews || []).filter((x) => x.id !== id);
    db.saveUser(user);
    return send(res, 200, db.publicUser(user));
  }

  if (method === "DELETE" && parts[0] === "api" && parts[1] === "me" && parts[2] === "questions" && parts[3]) {
    const user = requireUser(req, res);
    if (!user) return;
    const id = Number(parts[3]);
    user.questions = (user.questions || []).filter((x) => x.id !== id);
    db.saveUser(user);
    return send(res, 200, db.publicUser(user));
  }

  if (method === "POST" && url.pathname === "/api/me/discount") {
    const user = requireUser(req, res);
    if (!user) return;
    const body = await readBody(req);
    const priced = priceCartItems(body.items);
    if (!priced.lines.length) return send(res, 400, { error: "سبد خرید خالی است" });
    const quote = db.quoteDiscount(body.code, priced.subtotal, user.id);
    if (quote.error) return send(res, 400, { error: quote.error });
    return send(res, 200, { code: quote.code, discount: quote.discount, subtotal: priced.subtotal, total: priced.subtotal - quote.discount });
  }

  if (method === "POST" && url.pathname === "/api/me/orders") {
    const user = requireUser(req, res);
    if (!user) return;
    const body = await readBody(req);
    const priced = priceCartItems(body.items);
    if (!priced.lines.length) return send(res, 400, { error: "سبد خرید خالی است" });
    let couponCode = "";
    let couponDiscount = 0;
    if (body.discountCode) {
      const quote = db.quoteDiscount(body.discountCode, priced.subtotal, user.id);
      if (quote.error) return send(res, 400, { error: quote.error });
      couponCode = quote.code;
      couponDiscount = quote.discount;
    }
    const order = {
      id: Number(body.id) || Date.now() % 100000,
      count: priced.lines.reduce((s, line) => s + line.qty, 0),
      subtotal: priced.subtotal,
      discountCode: couponCode,
      couponDiscount,
      total: priced.subtotal - couponDiscount,
      phase: "inquiry",
      status: "در انتظار استعلام موجودی",
      receiver: String(body.receiver || "").trim(),
      phone: String(body.phone || "").replace(/\D/g, ""),
      address: String(body.address || "").trim(),
      postalCode: String(body.postalCode || "").replace(/\D/g, ""),
      plaque: String(body.plaque || "").trim(),
      unit: String(body.unit || "").trim(),
      items: priced.lines.map((line) => ({ ...line, inquiry: "pending", altOptions: [], chosenColor: "" })),
      inquiredAt: Date.now(),
      inquiryResultAt: 0,
      payUntil: 0,
      paidAt: 0,
    };
    user.orders = [order, ...(user.orders || [])];
    user.cart = [];
    db.saveUser(user);
    return send(res, 200, db.publicUser(user));
  }

  if (method === "POST" && parts[0] === "api" && parts[1] === "me" && parts[2] === "orders" && parts[3] && parts[4] === "pay") {
    const user = requireUser(req, res);
    if (!user) return;
    const body = await readBody(req);
    const order = (user.orders || []).find((o) => String(o.id) === String(parts[3]));
    if (!order) return send(res, 404, { error: "سفارش پیدا نشد" });
    const current = db.expireOrder(order);
    if (current.phase === "expired") {
      db.updateOrder(user.id, current.id, current);
      return send(res, 400, { error: "مهلت ۲۴ ساعته تأیید و پرداخت این استعلام تمام شده است" });
    }
    if (current.phase !== "awaiting_customer") return send(res, 400, { error: "این سفارش هنوز آماده پرداخت نیست" });
    const choices = body.choices && typeof body.choices === "object" ? body.choices : {};
    const payable = [];
    for (const item of current.items || []) {
      if (item.inquiry === "ok") payable.push({ ...item, chosenColor: item.chosenColor || "" });
      else if (item.inquiry === "alt") {
        const pick = String(choices[item.id] || choices[String(item.id)] || "").trim();
        const allowed = (item.altOptions || []).map((x) => String(x).trim()).filter(Boolean);
        if (pick && allowed.includes(pick)) payable.push({ ...item, chosenColor: pick });
      }
    }
    if (!payable.length) return send(res, 400, { error: "کالای قابل پرداختی در این استعلام نمانده است" });
    const subtotal = payable.reduce((s, line) => s + line.price * line.qty, 0);
    let couponCode = current.discountCode || "";
    let couponDiscount = 0;
    if (couponCode) {
      const quote = db.quoteDiscount(couponCode, subtotal, user.id);
      if (!quote.error) {
        couponCode = quote.code;
        couponDiscount = quote.discount;
      } else {
        couponCode = "";
      }
    }
    const updated = db.updateOrder(user.id, current.id, {
      ...current,
      items: (current.items || []).map((item) => {
        const kept = payable.find((p) => p.id === item.id);
        if (item.inquiry === "ok") return { ...item, chosenColor: item.chosenColor || "" };
        if (item.inquiry === "alt") return kept ? { ...item, chosenColor: kept.chosenColor } : { ...item, chosenColor: "" };
        return item;
      }),
      count: payable.reduce((s, line) => s + line.qty, 0),
      subtotal,
      discountCode: couponCode,
      couponDiscount,
      total: subtotal - couponDiscount,
      phase: "paid",
      status: "پرداخت شده — در حال آماده‌سازی",
      paidAt: Date.now(),
    });
    if (couponCode) db.redeemDiscount(couponCode, user.id);
    const fresh = db.findUserById(user.id);
    return send(res, 200, db.publicUser(fresh));
  }

  if (method === "GET" && url.pathname === "/api/catalog") {
    return send(res, 200, db.catalog());
  }

  if (method === "GET" && parts[0] === "api" && parts[1] === "products" && parts[2] && parts[3] === "opinions") {
    return send(res, 200, db.productOpinions(parts[2]));
  }

  function supportIdentity(req, body = {}) {
    const user = db.findUserByToken(tokenOf(req));
    const guestId = String(body.guestId || url.searchParams.get("guest") || "").trim();
    return { user, guestId };
  }

  if (method === "GET" && url.pathname === "/api/support") {
    const { user, guestId } = supportIdentity(req);
    const chat = user ? db.findChat({ userId: user.id }) || db.findChat({ guestId }) : db.findChat({ guestId });
    if (chat) db.markChatRead(chat.id, "customer");
    return send(res, 200, { chat: db.publicChat(chat) });
  }

  if (method === "POST" && url.pathname === "/api/support") {
    const body = await readBody(req);
    const { user, guestId } = supportIdentity(req, body);
    if (!user && !guestId) return send(res, 400, { error: "گفتگو پیدا نشد" });
    const existing = user ? db.findChat({ userId: user.id }) || db.findChat({ guestId }) : db.findChat({ guestId });
    const name = String(body.name || user?.name || "").trim();
    const phone = String(body.phone || user?.phone || "").replace(/\D/g, "");
    if (!existing && !user && name.length < 2) return send(res, 400, { error: "نام را بنویسید" });
    const chat = db.startChat({
      userId: user?.id || null,
      guestId: user ? "" : guestId,
      name: name || user?.name || "مهمان",
      phone: phone || user?.phone || "",
    });
    if (body.text) db.addChatMessage(chat.id, "customer", body.text);
    const fresh = db.findChat({ id: chat.id });
    return send(res, 200, { chat: db.publicChat(fresh) });
  }

  if (url.pathname.startsWith("/api/admin/")) {
    const admin = requireAdmin(req, res);
    if (!admin) return;

    if (method === "GET" && url.pathname === "/api/admin/stats") {
      return send(res, 200, db.stats());
    }
    if (method === "GET" && url.pathname === "/api/admin/products") {
      return send(res, 200, db.catalog().products);
    }
    if (method === "POST" && url.pathname === "/api/admin/products") {
      const body = await readBody(req);
      const products = db.catalog().products;
      const id = (products.reduce((m, p) => Math.max(m, Number(p.id) || 0), 0) || 0) + 1;
      const product = normalizeProduct(body, id);
      return send(res, 201, db.upsertProduct(product));
    }
    if (method === "PATCH" && parts[0] === "api" && parts[1] === "admin" && parts[2] === "products" && parts[3]) {
      const body = await readBody(req);
      const id = Number(parts[3]);
      const current = db.catalog().products.find((p) => p.id === id);
      if (!current) return send(res, 404, { error: "کالا پیدا نشد" });
      return send(res, 200, db.upsertProduct(normalizeProduct({ ...current, ...body }, id)));
    }
    if (method === "DELETE" && parts[0] === "api" && parts[1] === "admin" && parts[2] === "products" && parts[3]) {
      db.removeProduct(parts[3]);
      return send(res, 200, { ok: true });
    }
    if (method === "GET" && url.pathname === "/api/admin/orders") {
      return send(res, 200, db.allOrders());
    }
    if (method === "PATCH" && parts[0] === "api" && parts[1] === "admin" && parts[2] === "orders" && parts[3] && parts[4] && parts[5] === "inquiry") {
      const body = await readBody(req);
      const current = db.allOrders().find((o) => String(o.userId) === String(parts[3]) && String(o.id) === String(parts[4]));
      if (!current) return send(res, 404, { error: "سفارش پیدا نشد" });
      if (current.phase !== "inquiry") return send(res, 400, { error: "این سفارش در مرحله استعلام نیست" });
      const reviewed = Array.isArray(body.items) ? body.items : [];
      const items = (current.items || []).map((item) => {
        const row = reviewed.find((x) => Number(x.id) === Number(item.id)) || {};
        const inquiry = ["ok", "out", "alt"].includes(row.inquiry) ? row.inquiry : "";
        const altOptions = Array.isArray(row.altOptions)
          ? row.altOptions.map((x) => String(x).trim()).filter(Boolean)
          : String(row.altText || "")
              .split(/[،,]/)
              .map((x) => x.trim())
              .filter(Boolean);
        return { ...item, inquiry, altOptions: inquiry === "alt" ? altOptions : [], chosenColor: "" };
      });
      if (items.some((item) => !item.inquiry)) return send(res, 400, { error: "وضعیت همه کالاها را مشخص کنید" });
      if (items.some((item) => item.inquiry === "alt" && !item.altOptions.length)) {
        return send(res, 400, { error: "برای کالای جایگزین، رنگ یا مدل موجود را بنویسید" });
      }
      const allOut = items.every((item) => item.inquiry === "out");
      const patch = allOut
        ? {
            items,
            phase: "unavailable",
            status: "ناموجود — لغو شد",
            inquiryResultAt: Date.now(),
            payUntil: 0,
          }
        : {
            items,
            phase: "awaiting_customer",
            status: "منتظر تأیید و پرداخت مشتری",
            inquiryResultAt: Date.now(),
            payUntil: Date.now() + db.INQUIRY_TTL,
          };
      const updated = db.updateOrder(parts[3], parts[4], patch);
      return send(res, 200, updated);
    }
    if (method === "PATCH" && parts[0] === "api" && parts[1] === "admin" && parts[2] === "orders" && parts[3] && parts[4]) {
      const body = await readBody(req);
      const updated = db.updateOrder(parts[3], parts[4], String(body.status || "").trim());
      if (!updated) return send(res, 404, { error: "سفارش پیدا نشد" });
      return send(res, 200, updated);
    }
    if (method === "GET" && url.pathname === "/api/admin/customers") {
      return send(res, 200, db.customers());
    }
    if (method === "GET" && url.pathname === "/api/admin/support") {
      return send(res, 200, db.listChats());
    }
    if (method === "GET" && parts[0] === "api" && parts[1] === "admin" && parts[2] === "support" && parts[3]) {
      const chat = db.findChat({ id: parts[3] });
      if (!chat) return send(res, 404, { error: "گفتگو پیدا نشد" });
      db.markChatRead(chat.id, "admin");
      const account = db.findUserByPhone(String(chat.phone || "").replace(/\D/g, ""));
      return send(res, 200, {
        ...db.publicChat(db.findChat({ id: chat.id })),
        accountId: account?.id || null,
        accountName: account?.name || "",
      });
    }
    if (method === "POST" && parts[0] === "api" && parts[1] === "admin" && parts[2] === "support" && parts[3] && parts[4] === "reset-password") {
      const chat = db.findChat({ id: parts[3] });
      if (!chat) return send(res, 404, { error: "گفتگو پیدا نشد" });
      const account = db.findUserByPhone(String(chat.phone || "").replace(/\D/g, ""));
      if (!account) return send(res, 404, { error: "حسابی با شماره این گفتگو پیدا نشد" });
      if (account.admin) return send(res, 400, { error: "رمز حساب مدیر از بخش پشتیبانی قابل بازنشانی نیست" });
      const password = temporaryPassword();
      db.setUserPassword(account.id, password, { mustChange: true, invalidateSessions: true });
      db.addChatMessage(
        chat.id,
        "admin",
        `رمز عبور موقت شما: ${password}\nپس از ورود، از بخش اطلاعات حساب رمزتان را تغییر دهید.`
      );
      db.markChatRead(chat.id, "admin");
      return send(res, 200, {
        temporaryPassword: password,
        chat: db.publicChat(db.findChat({ id: chat.id })),
      });
    }
    if (method === "POST" && parts[0] === "api" && parts[1] === "admin" && parts[2] === "support" && parts[3] && !parts[4]) {
      const body = await readBody(req);
      const chat = db.addChatMessage(parts[3], "admin", body.text);
      if (!chat) return send(res, 404, { error: "گفتگو پیدا نشد" });
      db.markChatRead(chat.id, "admin");
      return send(res, 200, db.publicChat(db.findChat({ id: chat.id })));
    }
    if (method === "PATCH" && url.pathname === "/api/admin/settings") {
      const body = await readBody(req);
      return send(res, 200, db.saveCatalog({ store: body }));
    }
    if (method === "GET" && url.pathname === "/api/admin/discounts") {
      return send(res, 200, db.listDiscounts());
    }
    if (method === "POST" && url.pathname === "/api/admin/discounts") {
      const body = await readBody(req);
      const code = db.normalizeDiscountCode(body.code);
      const type = body.type === "amount" ? "amount" : "percent";
      const value = Math.floor(Number(body.value) || 0);
      if (!/^[A-Z0-9_-]{3,20}$/.test(code)) return send(res, 400, { error: "کد باید ۳ تا ۲۰ کاراکتر از حروف انگلیسی و عدد باشد" });
      if (type === "percent" && (value < 1 || value > 100)) return send(res, 400, { error: "درصد تخفیف باید بین ۱ تا ۱۰۰ باشد" });
      if (type === "amount" && value < 1000) return send(res, 400, { error: "مبلغ تخفیف حداقل ۱۰۰۰ تومان است" });
      const days = Math.floor(Number(body.days) || 0);
      const saved = db.saveDiscount({
        code,
        type,
        value,
        minTotal: Math.max(0, Math.floor(Number(body.minTotal) || 0)),
        maxDiscount: type === "percent" ? Math.max(0, Math.floor(Number(body.maxDiscount) || 0)) : 0,
        usageLimit: Math.max(0, Math.floor(Number(body.usageLimit) || 0)),
        onePerCustomer: Boolean(body.onePerCustomer),
        expiresAt: days > 0 ? Date.now() + days * 86400000 : 0,
        active: true,
        usedCount: 0,
        usedBy: [],
        createdAt: Date.now(),
      });
      if (!saved) return send(res, 409, { error: "این کد قبلاً ساخته شده است" });
      return send(res, 200, db.listDiscounts());
    }
    if (method === "PATCH" && parts[2] === "discounts" && parts[3]) {
      const body = await readBody(req);
      if (!db.updateDiscount(decodeURIComponent(parts[3]), { active: Boolean(body.active) })) {
        return send(res, 404, { error: "کد تخفیف پیدا نشد" });
      }
      return send(res, 200, db.listDiscounts());
    }
    if (method === "DELETE" && parts[2] === "discounts" && parts[3]) {
      db.removeDiscount(decodeURIComponent(parts[3]));
      return send(res, 200, db.listDiscounts());
    }
    return send(res, 404, { error: "مسیر مدیریت پیدا نشد" });
  }

  if (method === "DELETE" && parts[0] === "api" && parts[1] === "me" && parts[2] === "addresses" && parts[3]) {
    const user = requireUser(req, res);
    if (!user) return;
    const id = Number(parts[3]);
    user.addresses = (user.addresses || []).filter((a) => a.id !== id);
    db.saveUser(user);
    return send(res, 200, db.publicUser(user));
  }

  return send(res, 404, { error: "مسیر پیدا نشد" });
}

function serveStatic(req, res, url) {
  let file = decodeURIComponent(url.pathname);
  if (file === "/") file = "/index.html";
  const full = path.normalize(path.join(ROOT, file));
  if (!full.startsWith(ROOT)) return send(res, 403, "Forbidden");
  fs.readFile(full, (err, buf) => {
    if (err) return send(res, 404, "Not found");
    const ext = path.extname(full);
    res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
    res.end(buf);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (url.pathname.startsWith("/api/")) return await handleApi(req, res, url);
    return serveStatic(req, res, url);
  } catch (err) {
    send(res, 500, { error: err.message || "خطای سرور" });
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`زنبیل روی http://localhost:${PORT}`);
});
