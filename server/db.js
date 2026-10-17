const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const DB_PATH = path.join(__dirname, "..", "data", "zanbil.json");

function hashPass(pass, salt) {
  return crypto.scryptSync(String(pass), salt, 32).toString("hex");
}

function emptyDb() {
  return { users: [], sessions: [], products: [], categories: [], banners: [], lines: [], chats: [], store: {} };
}

function read() {
  try {
    return JSON.parse(fs.readFileSync(DB_PATH, "utf8"));
  } catch {
    return emptyDb();
  }
}

function write(db) {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), "utf8");
}

function publicUser(user) {
  if (!user) return null;
  const { passHash, salt, ...safe } = user;
  return { ...safe, cart: Array.isArray(safe.cart) ? safe.cart : [] };
}

function seed() {
  const db = read();
  const phone = "09370966862";
  if (!db.users.some((u) => u.phone === phone)) {
    const salt = crypto.randomBytes(16).toString("hex");
    db.users.push({
      id: 1,
      name: "آرمان",
      phone,
      admin: true,
      salt,
      passHash: hashPass("Aa1386418", salt),
      email: "",
      nationalId: "",
      birthday: "",
      job: "",
      sheba: "",
      shebaOwner: "",
      address: "کرج، جهانشهر",
      favorites: [],
      reviews: [],
      questions: [],
      addresses: [{ id: 1, title: "آدرس اصلی", text: "کرج، جهانشهر" }],
      cart: [],
      orders: [],
      createdAt: Date.now(),
    });
  }
  const admin = db.users.find((u) => u.phone === phone);
  if (admin) admin.admin = true;
  const catalog = require("../js/data.js");
  if (!db.products || !db.products.length) {
    db.store = catalog.store;
    db.categories = catalog.categories;
    db.banners = catalog.banners;
    db.products = catalog.products;
  } else {
    const have = new Set((db.products || []).map((p) => Number(p.id)));
    for (const p of catalog.products) {
      if (!have.has(Number(p.id))) db.products.push(p);
      else {
        const cur = db.products.find((x) => Number(x.id) === Number(p.id));
        if (cur && !cur.line && p.line) cur.line = p.line;
        if (cur && cur.fresh == null && p.fresh) cur.fresh = true;
      }
    }
  }
  db.lines = catalog.lines || [];
  if (!Array.isArray(db.chats)) db.chats = [];
  write(db);
  return read();
}

function findUserByPhone(phone) {
  return read().users.find((u) => u.phone === phone) || null;
}

function findUserById(id) {
  return read().users.find((u) => u.id === id) || null;
}

function findUserByToken(token) {
  if (!token) return null;
  const db = read();
  const session = db.sessions.find((s) => s.token === token);
  if (!session) return null;
  return db.users.find((u) => u.id === session.userId) || null;
}

function saveUser(next) {
  const db = read();
  const idx = db.users.findIndex((u) => u.id === next.id);
  if (idx === -1) db.users.push(next);
  else db.users[idx] = next;
  write(db);
  return next;
}

function createUser(data) {
  const db = read();
  const salt = crypto.randomBytes(16).toString("hex");
  const user = {
    id: Date.now(),
    name: data.name,
    firstName: data.firstName,
    lastName: data.lastName,
    phone: data.phone,
    admin: false,
    salt,
    passHash: hashPass(data.pass, salt),
    email: "",
    nationalId: "",
    birthday: "",
    job: "",
    sheba: "",
    shebaOwner: "",
    address: data.address || "",
    favorites: [],
    reviews: [],
    questions: [],
    addresses: data.address
      ? [{ id: Date.now(), title: "آدرس اصلی", text: data.address }]
      : [],
    cart: [],
    orders: [],
    createdAt: Date.now(),
  };
  db.users.push(user);
  write(db);
  return user;
}

function checkPass(user, pass) {
  return user && user.passHash === hashPass(pass, user.salt);
}

function setUserPassword(userId, pass, { mustChange = false, invalidateSessions = false } = {}) {
  const db = read();
  const user = db.users.find((item) => Number(item.id) === Number(userId));
  if (!user) return null;
  const salt = crypto.randomBytes(16).toString("hex");
  user.salt = salt;
  user.passHash = hashPass(pass, salt);
  user.mustChangePassword = Boolean(mustChange);
  user.passwordChangedAt = Date.now();
  if (invalidateSessions) db.sessions = (db.sessions || []).filter((session) => Number(session.userId) !== Number(userId));
  write(db);
  return user;
}

function createSession(userId) {
  const db = read();
  const token = crypto.randomBytes(24).toString("hex");
  db.sessions.push({ token, userId, createdAt: Date.now() });
  write(db);
  return token;
}

function removeSession(token) {
  const db = read();
  db.sessions = db.sessions.filter((s) => s.token !== token);
  write(db);
}

function catalog() {
  const db = read();
  return {
    store: db.store || {},
    categories: db.categories || [],
    banners: db.banners || [],
    lines: db.lines || [],
    products: db.products || [],
  };
}

function saveCatalog(part) {
  const db = read();
  if (part.store) db.store = { ...db.store, ...part.store };
  if (part.categories) db.categories = part.categories;
  if (part.banners) db.banners = part.banners;
  if (part.lines) db.lines = part.lines;
  if (part.products) db.products = part.products;
  write(db);
  return catalog();
}

function upsertProduct(product) {
  const db = read();
  const list = db.products || [];
  const idx = list.findIndex((p) => p.id === product.id);
  if (idx === -1) list.push(product);
  else list[idx] = { ...list[idx], ...product };
  db.products = list;
  write(db);
  return list.find((p) => p.id === product.id);
}

function removeProduct(id) {
  const db = read();
  db.products = (db.products || []).filter((p) => p.id !== Number(id));
  write(db);
}

function normalizeDiscountCode(code) {
  return String(code || "").trim().toUpperCase();
}

function listDiscounts() {
  return (read().discounts || []).slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

function saveDiscount(discount) {
  const db = read();
  db.discounts = db.discounts || [];
  if (db.discounts.some((d) => d.code === discount.code)) return null;
  db.discounts.push(discount);
  write(db);
  return discount;
}

function updateDiscount(code, patch) {
  const db = read();
  const found = (db.discounts || []).find((d) => d.code === normalizeDiscountCode(code));
  if (!found) return null;
  Object.assign(found, patch);
  write(db);
  return found;
}

function removeDiscount(code) {
  const db = read();
  db.discounts = (db.discounts || []).filter((d) => d.code !== normalizeDiscountCode(code));
  write(db);
}

function quoteDiscount(code, subtotal, userId) {
  const clean = normalizeDiscountCode(code);
  const found = (read().discounts || []).find((d) => d.code === clean);
  if (!found || !found.active) return { error: "کد تخفیف معتبر نیست" };
  if (found.expiresAt && Date.now() > found.expiresAt) return { error: "مهلت استفاده از این کد تمام شده است" };
  if (found.usageLimit && (found.usedCount || 0) >= found.usageLimit) return { error: "ظرفیت استفاده از این کد تکمیل شده است" };
  if (found.onePerCustomer && (found.usedBy || []).includes(Number(userId))) return { error: "شما قبلاً از این کد استفاده کرده‌اید" };
  if (found.minTotal && subtotal < found.minTotal) {
    return { error: `این کد برای خرید بالای ${Number(found.minTotal).toLocaleString("fa-IR")} تومان است` };
  }
  let discount = found.type === "percent" ? Math.floor((subtotal * found.value) / 100) : Number(found.value);
  if (found.type === "percent" && found.maxDiscount) discount = Math.min(discount, found.maxDiscount);
  discount = Math.max(0, Math.min(discount, subtotal));
  return { code: found.code, discount };
}

function redeemDiscount(code, userId) {
  const db = read();
  const found = (db.discounts || []).find((d) => d.code === normalizeDiscountCode(code));
  if (!found) return;
  found.usedCount = (found.usedCount || 0) + 1;
  found.usedBy = [...new Set([...(found.usedBy || []), Number(userId)])];
  write(db);
}

const INQUIRY_TTL = 24 * 60 * 60 * 1000;

function expireOrder(order) {
  if (!order) return order;
  if (order.phase === "awaiting_customer" && order.payUntil && Date.now() > Number(order.payUntil)) {
    return { ...order, phase: "expired", status: "مهلت پرداخت تمام شد" };
  }
  return order;
}

function persistExpiredOrders(user) {
  if (!user) return user;
  let changed = false;
  user.orders = (user.orders || []).map((order) => {
    const next = expireOrder(order);
    if (next !== order && (next.phase !== order.phase || next.status !== order.status)) changed = true;
    return next;
  });
  if (changed) saveUser(user);
  return user;
}

function allOrders() {
  return read()
    .users.flatMap((u) => {
      persistExpiredOrders(u);
      return (u.orders || []).map((o) => ({
        ...expireOrder(o),
        userId: u.id,
        userName: u.name,
        userPhone: u.phone,
      }));
    })
    .sort((a, b) => (b.inquiredAt || b.paidAt || b.id || 0) - (a.inquiredAt || a.paidAt || a.id || 0));
}

function updateOrder(userId, orderId, patch) {
  const user = persistExpiredOrders(findUserById(Number(userId)));
  if (!user) return null;
  let found = null;
  user.orders = (user.orders || []).map((o) => {
    if (String(o.id) !== String(orderId)) return o;
    found = { ...expireOrder(o), ...(typeof patch === "string" ? { status: patch } : patch) };
    return found;
  });
  if (!found) return null;
  saveUser(user);
  return found;
}

function productOpinions(productId) {
  const id = Number(productId);
  const db = read();
  const reviews = [];
  const questions = [];
  for (const u of db.users || []) {
    for (const r of u.reviews || []) {
      if (Number(r.productId) === id) {
        reviews.push({
          id: r.id,
          productId: r.productId,
          rating: r.rating,
          text: r.text,
          status: r.status || "در انتظار بررسی",
          createdAt: r.createdAt,
          name: u.name,
        });
      }
    }
    for (const q of u.questions || []) {
      if (Number(q.productId) === id) {
        questions.push({
          id: q.id,
          productId: q.productId,
          text: q.text,
          answer: q.answer || "",
          status: q.status || "در انتظار پاسخ",
          createdAt: q.createdAt,
          name: u.name,
        });
      }
    }
  }
  reviews.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  questions.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  return { reviews, questions };
}

function customers() {
  return read().users.map((u) => ({
    id: u.id,
    name: u.name,
    phone: u.phone,
    address: u.address || "",
    admin: !!u.admin,
    orders: (u.orders || []).length,
    createdAt: u.createdAt,
  }));
}

function stats() {
  const db = read();
  const orders = allOrders();
  const paid = orders.filter((o) => String(o.status || "").includes("پرداخت") || String(o.status || "").includes("ارسال") || String(o.status || "").includes("تحویل"));
  return {
    products: (db.products || []).length,
    customers: db.users.filter((u) => !u.admin).length,
    users: db.users.length,
    orders: orders.length,
    revenue: paid.reduce((s, o) => s + Number(o.total || 0), 0),
    lowStock: (db.products || []).filter((p) => Number(p.stock) <= 3).length,
    pending: orders.filter((o) => /آماده‌سازی|هماهنگی|انتظار|استعلام/.test(o.status || "")).length,
    supportUnread: (db.chats || []).reduce((s, c) => s + Number(c.unreadAdmin || 0), 0),
    supportChats: (db.chats || []).length,
  };
}

function publicChat(chat) {
  if (!chat) return null;
  return {
    id: chat.id,
    name: chat.name,
    phone: chat.phone,
    userId: chat.userId || null,
    messages: chat.messages || [],
    updatedAt: chat.updatedAt,
    unreadAdmin: chat.unreadAdmin || 0,
    unreadCustomer: chat.unreadCustomer || 0,
  };
}

function findChat({ id, userId, guestId } = {}) {
  const list = read().chats || [];
  if (id) return list.find((c) => Number(c.id) === Number(id)) || null;
  if (userId) return list.find((c) => Number(c.userId) === Number(userId)) || null;
  if (guestId) return list.find((c) => c.guestId === guestId) || null;
  return null;
}

function startChat({ userId, guestId, name, phone }) {
  const db = read();
  if (!db.chats) db.chats = [];
  let chat = userId
    ? db.chats.find((c) => Number(c.userId) === Number(userId))
    : db.chats.find((c) => c.guestId === guestId);
  if (!chat) {
    chat = {
      id: (db.chats.reduce((m, c) => Math.max(m, Number(c.id) || 0), 0) || 0) + 1,
      userId: userId || null,
      guestId: guestId || "",
      name: String(name || "مهمان").trim() || "مهمان",
      phone: String(phone || "").trim(),
      messages: [],
      unreadAdmin: 0,
      unreadCustomer: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    db.chats.push(chat);
  } else {
    if (name) chat.name = String(name).trim();
    if (phone) chat.phone = String(phone).trim();
    if (userId) chat.userId = userId;
  }
  write(db);
  return chat;
}

function addChatMessage(id, from, text) {
  const db = read();
  const chat = (db.chats || []).find((c) => Number(c.id) === Number(id));
  if (!chat) return null;
  const clean = String(text || "").trim().slice(0, 600);
  if (!clean) return chat;
  chat.messages = chat.messages || [];
  chat.messages.push({ id: Date.now(), from, text: clean, at: Date.now() });
  chat.updatedAt = Date.now();
  if (from === "customer") chat.unreadAdmin = (chat.unreadAdmin || 0) + 1;
  else chat.unreadCustomer = (chat.unreadCustomer || 0) + 1;
  write(db);
  return chat;
}

function markChatRead(id, who) {
  const db = read();
  const chat = (db.chats || []).find((c) => Number(c.id) === Number(id));
  if (!chat) return null;
  if (who === "admin") chat.unreadAdmin = 0;
  if (who === "customer") chat.unreadCustomer = 0;
  write(db);
  return chat;
}

function listChats() {
  return (read().chats || [])
    .slice()
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
    .map((c) => ({
      id: c.id,
      name: c.name,
      phone: c.phone,
      updatedAt: c.updatedAt,
      unreadAdmin: c.unreadAdmin || 0,
      last: (c.messages || []).slice(-1)[0]?.text || "بدون پیام",
      count: (c.messages || []).length,
    }));
}

module.exports = {
  seed,
  publicUser,
  findUserByPhone,
  findUserById,
  findUserByToken,
  saveUser,
  createUser,
  checkPass,
  setUserPassword,
  createSession,
  removeSession,
  catalog,
  saveCatalog,
  upsertProduct,
  removeProduct,
  listChats,
  findChat,
  startChat,
  addChatMessage,
  markChatRead,
  publicChat,
  INQUIRY_TTL,
  expireOrder,
  persistExpiredOrders,
  allOrders,
  updateOrder,
  normalizeDiscountCode,
  listDiscounts,
  saveDiscount,
  updateDiscount,
  removeDiscount,
  quoteDiscount,
  redeemDiscount,
  productOpinions,
  customers,
  stats,
};
