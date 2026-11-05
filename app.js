/* دليل الجامعة – تطبيق الويب.
   نفس منطق البوت (bot.py) بدون ذكاء اصطناعي: البحث يعمل داخل الهاتف على نسخة من بيانات ملف الإكسل (data.json). */
"use strict";

const ARRIVE_METERS = 30, NEAR_METERS = 100, OUTSIDE_METERS = 250, WALK_METERS_PER_MIN = 70;
const LOCATION_VALID_MS = 20 * 60 * 1000, MIN_SCORE = 0.65, MAX_CHOICES = 15;
const FLOOR_NAMES = ["الأرضي", "الأول", "الثاني", "الثالث", "الرابع", "الخامس", "السادس", "السابع", "الثامن", "التاسع", "العاشر"];
const DIRECTIONS_AR = ["الشمال", "الشمال الشرقي", "الشرق", "الجنوب الشرقي", "الجنوب", "الجنوب الغربي", "الغرب", "الشمال الغربي"];
const ROOM_WORDS = new Set(["قاعة", "قاعة اجتماعات", "مدرج", "مختبر", "مشغل", "مكتب", "مكتب إداري"]);
const JOB_WORDS = ["عميد", "رئيس", "مدير", "سكرتير", "سكرتيره", "نائب", "مساعد", "مهندس", "موظف", "مشرف", "محاضر", "دكتور", "استاذ"];
const NEAREST_WORDS = ["اقرب", "قريب", "nearest"];
const TYPE_WORDS = {
  "حمامات": ["حمام", "حمامات", "دوره مياه", "دورات مياه", "تواليت", "wc"],
  "موقف سيارات": ["كراج", "كراجات", "موقف سيارات", "مواقف", "باركينج", "parking"],
  "كافتيريا": ["كافتيريا", "كافيتريا", "كفتيريا", "مطعم", "قهوه", "اكل"],
  "مصلى": ["مصلي", "مسجد", "جامع"],
};
const FILLER = new Set(("وين فين اين أين وينه وينها كيف بدي بدّي اروح أروح اوصل أوصل بوصل بوصله بوصلها على عن الى إلى لـ ل " +
  "مكان موقع لو سمحت من فضلك ممكن تدلني دلني مكتب الدكتور الدكتورة دكتور دكتورة د. الاستاذ الأستاذ استاذ أستاذ هو هي في ال يا " +
  "رح بدنا بنروح موجود موجوده الغرفة غرفة الغرفه غرفه رقم").split(" "));
const INTERNAL_MARKERS = ["تحقق", "تأكد", "أكمل", "مثال", "داخلي"];

let DATA = { places: [] }, PLACES = [], BUILDINGS = {};
let LOC = null;            // {lat, lng, acc, t}
let WATCH = null;          // معرّف متابعة الموقع
let CURRENT = null;        // المكان المعروض الآن
let TRACK = null;          // {id, near, arrived}
let PENDING = [];          // آخر قائمة خيارات مرقمة
let NEAREST_Q = "";        // آخر سؤال «أقرب …» ينتظر الموقع

// ---------------------------------------------------------------- أدوات عامة
const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const DIGITS = { "٠": 0, "١": 1, "٢": 2, "٣": 3, "٤": 4, "٥": 5, "٦": 6, "٧": 7, "٨": 8, "٩": 9, "۰": 0, "۱": 1, "۲": 2, "۳": 3, "۴": 4, "۵": 5, "۶": 6, "۷": 7, "۸": 8, "۹": 9 };
const latin = s => String(s).replace(/[٠-٩۰-۹]/g, d => DIGITS[d]);
function store(k, v) { try { v === undefined ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)); } catch (e) { } }
function load(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } }

function km(a, b) {
  const R = 6371, rad = Math.PI / 180, dLat = (b[0] - a[0]) * rad, dLng = (b[1] - a[1]) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// difflib.SequenceMatcher(None, a, b).ratio() كما في بايثون
function ratio(a, b) {
  if (!a.length && !b.length) return 1;
  const b2j = {};
  for (let j = 0; j < b.length; j++) (b2j[b[j]] = b2j[b[j]] || []).push(j);
  function longest(alo, ahi, blo, bhi) {
    let bi = alo, bj = blo, bk = 0, j2len = {};
    for (let i = alo; i < ahi; i++) {
      const nl = {};
      for (const j of b2j[a[i]] || []) {
        if (j < blo) continue;
        if (j >= bhi) break;
        const k = (nl[j] = (j2len[j - 1] || 0) + 1);
        if (k > bk) { bi = i - k + 1; bj = j - k + 1; bk = k; }
      }
      j2len = nl;
    }
    return [bi, bj, bk];
  }
  let matches = 0;
  const queue = [[0, a.length, 0, b.length]];
  while (queue.length) {
    const [alo, ahi, blo, bhi] = queue.pop();
    const [i, j, k] = longest(alo, ahi, blo, bhi);
    if (k) {
      matches += k;
      if (alo < i && blo < j) queue.push([alo, i, blo, j]);
      if (i + k < ahi && j + k < bhi) queue.push([i + k, ahi, j + k, bhi]);
    }
  }
  return 2 * matches / (a.length + b.length);
}

// ---------------------------------------------------------------- توحيد الكتابة والبحث (منقول من bot.py)
const TITLES = /^(ا\.د\.?|د|دكتور|الدكتور|دكتوره|الدكتوره|ا|استاذ|الاستاذ|استاذه|الاستاذه|م|مهندس|المهندس)\.?\s+/;
const NORM_CACHE = new Map();
function norm(s) {
  s = s || "";
  if (NORM_CACHE.has(s)) return NORM_CACHE.get(s);
  let t = latin(s).toLowerCase().replace(/[ً-ْـ]/g, "");
  t = t.replace(/[إأآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي").trim();
  for (; ;) { const n = t.replace(TITLES, ""); if (n === t) break; t = n; }
  const words = t.split(/[\s\-_/،,.()[\]]+/)
    .map(w => (w.startsWith("ال") && w.length > 3 ? w.slice(2) : w))
    .map(w => (w.endsWith("يه") && w.length > 3 ? w.slice(0, -1) : w))
    .filter(Boolean);
  const out = words.join(" ");
  NORM_CACHE.set(s, out);
  return out;
}

function parseRoom(room) {
  const m = /^\s*([A-Za-z]{1,2})\s*[-_ ]?\s*(\d{2,4})\s*([A-Za-z])?\s*$/.exec(latin(room || ""));
  if (!m) return null;
  const L = m[1].toUpperCase();
  return [L, Math.floor(parseInt(m[2], 10) / 100), L + m[2] + (m[3] || "").toLowerCase()];
}

function roomInText(text) {
  const m = /(^|[^A-Za-z])([A-Za-z])\s*-?\s*(\d{3,4})([A-Za-z])?(?![A-Za-z0-9])/.exec(latin(text || ""));
  return m ? parseRoom(m[2] + m[3] + (m[4] || "")) : null;
}

function floorName(f) {
  const n = parseInt(f, 10);
  if (isNaN(n)) return String(f ?? "");
  if (n < 0) return n === -1 ? "طابق التسوية" : `التسوية ${-n}`;
  return n < FLOOR_NAMES.length ? `الطابق ${FLOOR_NAMES[n]}` : `الطابق ${n}`;
}

const has = (v) => v !== undefined && v !== null && v !== "";

function score(query, p) {
  const q = norm(query);
  if (!q) return 0;
  const qc = q.replace(/ /g, "");
  const fields = [p.name || ""].concat((p.aliases || "").split("|"), (p.jobs || "").split("|"));
  let best = 0;
  if (p.surname && q === norm(p.surname)) best = 0.93;
  if (p.code && qc === norm(p.code).replace(/ /g, "")) return 1;
  const room = roomInText(query);
  if (room && p.room === room[2]) return 1;
  for (const weak of [p.college, p.department]) {
    const w = norm(weak);
    if (w && (q === w || q.includes(w))) best = Math.max(best, 0.6);
  }
  const qw = new Set(q.split(" "));
  for (const field of fields) {
    const f = norm(field);
    if (!f) continue;
    if (q === f) return 1;
    if (` ${f} `.includes(` ${q} `) || ` ${q} `.includes(` ${f} `)) best = Math.max(best, 0.9);
    if (best < 1) best = Math.max(best, ratio(q, f));
    const fw = new Set(f.split(" "));
    let common = 0;
    qw.forEach(w => { if (fw.has(w)) common++; });
    best = Math.max(best, 0.85 * common / qw.size);
  }
  return best;
}

function asksForPerson(query) {
  const words = new Set(norm(query).split(" "));
  return JOB_WORDS.some(w => words.has(norm(w)));
}

function rankedPlaces(query, type) {
  if (!type && asksForPerson(query) && PLACES.some(p => p.type === "شخص")) {
    const people = rankedPlaces(query, "شخص");
    if (people.length && people[0][0] >= 0.65) return people;
  }
  return PLACES.filter(p => !type || p.type === type)
    .map(p => [score(query, p), p])
    .sort((x, y) => y[0] - x[0] || x[1].name.length - y[1].name.length);
}

function searchPlace(query, type, limit = 50) {
  const parsed = roomInText(query);
  if (parsed) {
    const ok = p => !type || p.type === type;
    const exact = PLACES.filter(p => p.room === parsed[2] && ok(p));
    if (exact.length) return exact;
    if (!/[a-z]$/i.test(parsed[2]))  // E330 بلا حرف وعندنا E330a و E330b
      return PLACES.filter(p => ok(p) && p.room && p.room.slice(0, -1) === parsed[2] && /[a-z]$/.test(p.room));
    return [];
  }
  const ranked = rankedPlaces(query, type);
  if (!ranked.length || ranked[0][0] < MIN_SCORE) return [];
  const cutoff = ranked[0][0] >= 1 ? 1 : Math.max(MIN_SCORE, ranked[0][0] - 0.15);
  return ranked.slice(0, limit).filter(([s]) => s >= cutoff).map(([, p]) => p);
}

function roomGroup(room) {
  const members = PLACES.filter(p => p.room === room);
  if (!members.length) return null;
  const place = members.find(m => m.type !== "شخص");
  const base = Object.assign({}, place || members[0], { id: `RM-${room}`, group: true, members: members.map(m => m.id) });
  if (!place) Object.assign(base, { type: "مكتب مشترك", name: `المكتب ${room}` });
  return base;
}

function collapseRooms(results) {
  const out = [], seen = new Set();
  for (const p of results) {
    if (!p.room) { out.push(p); continue; }
    if (seen.has(p.room)) continue;
    seen.add(p.room);
    out.push(results.filter(q => q.room === p.room).length > 1 ? roomGroup(p.room) : p);
  }
  return out;
}

function getPlace(id) {
  if (id && id.startsWith("RM-")) return roomGroup(id.slice(3));
  return PLACES.find(p => p.id === id) || null;
}

function cleanQuery(text) {
  return latin(text).split(/\s+/).filter(Boolean)
    .filter(w => !FILLER.has(w))
    .map(w => w.replace(/[؟?!.،,]/g, ""))
    .filter(w => w && !FILLER.has(w))
    .join(" ");
}

function wantedType(t) {
  for (const [typ, words] of Object.entries(TYPE_WORDS))
    if (words.some(w => ` ${t} `.includes(` ${norm(w)} `))) return typ;
  return null;
}

function buildingInText(text) {
  const m = /(?:مبنى|المبنى|بناية|البناية|مبنا)\s*([A-Za-z]{1,2})(?![A-Za-z])/.exec(text || "");
  return m && BUILDINGS[m[1].toUpperCase()] ? BUILDINGS[m[1].toUpperCase()] : null;
}

// ---------------------------------------------------------------- الموقع والطريق
const buildingOf = p => (p.type === "مبنى" ? p : BUILDINGS[p.building || ""] || null);
const here = () => (LOC && Date.now() - LOC.t < LOCATION_VALID_MS ? [LOC.lat, LOC.lng] : null);

function targetPoint(p, origin) {
  if (p.type !== "مبنى" && has(p.lat) && has(p.lng)) return { lat: p.lat, lng: p.lng, label: p.name, desc: "" };
  const b = buildingOf(p);
  if (!b) return null;
  const ents = (b.entrances || []).filter(e => has(e.lat));
  if (!ents.length) return null;
  const e = origin ? ents.reduce((x, y) => (km(origin, [x.lat, x.lng]) <= km(origin, [y.lat, y.lng]) ? x : y)) : ents[0];
  return { lat: e.lat, lng: e.lng, label: `${e.name} لمبنى ${b.code}`, desc: e.desc || "", building: b.code };
}

function campusPoints() {
  const pts = [];
  Object.values(BUILDINGS).forEach(b => (b.entrances || []).forEach(e => has(e.lat) && pts.push([e.lat, e.lng])));
  PLACES.forEach(g => g.type === "بوابة" && has(g.lat) && pts.push([g.lat, g.lng]));
  return pts;
}

function gateFor(origin, target) {
  const pts = campusPoints();
  if (!pts.length || Math.min(...pts.map(p => km(origin, p))) * 1000 <= OUTSIDE_METERS) return null;
  const gates = PLACES.filter(g => g.type === "بوابة" && has(g.lat));
  if (!gates.length) return null;
  const t = [target.lat, target.lng];
  const cost = g => km(origin, [g.lat, g.lng]) + km([g.lat, g.lng], t);
  return gates.reduce((x, y) => (cost(x) <= cost(y) ? x : y));
}

function mapsLink(target, origin, via) {
  const far = origin && km(origin, [target.lat, target.lng]) > 2;
  let url = `https://www.google.com/maps/dir/?api=1&travelmode=${far ? "driving" : "walking"}` +
    `&destination=${target.lat.toFixed(6)},${target.lng.toFixed(6)}`;
  if (origin) url += `&origin=${origin[0].toFixed(6)},${origin[1].toFixed(6)}`;
  if (via) url += `&waypoints=${via.lat.toFixed(6)},${via.lng.toFixed(6)}`;
  return url;
}

function bearingAr(a, b) {
  const rad = Math.PI / 180, l1 = a[0] * rad, l2 = b[0] * rad, d = (b[1] - a[1]) * rad;
  const x = Math.sin(d) * Math.cos(l2), y = Math.cos(l1) * Math.sin(l2) - Math.sin(l1) * Math.cos(l2) * Math.cos(d);
  const deg = (Math.atan2(x, y) / rad + 360) % 360;
  return DIRECTIONS_AR[Math.floor((deg + 22.5) / 45) % 8];
}

function walkText(m, dir) {
  const mins = Math.max(1, Math.ceil(m * 1.3 / WALK_METERS_PER_MIN));
  const walk = { 1: "دقيقة واحدة", 2: "دقيقتان" }[mins] || (mins <= 10 ? `${mins} دقائق` : `${mins} دقيقة`);
  const dist = m < 1000 ? `${Math.round(m / 10) * 10} متر` : `${(m / 1000).toFixed(1)} كم`;
  return `حوالي ${dist}` + (dir ? ` باتجاه ${dir}` : "") + ` (${walk} مشي تقريباً)`;
}

/* كتلة الطريق: نفس منطق route_block في البوت. ترجع {lines:[[icon, html]], url, urlLabel} */
function route(p) {
  const origin = here(), t = targetPoint(p, origin), lines = [];
  if (!t) {
    const b = buildingOf(p);
    if (b && p.type !== "مبنى" && (b.entrances || []).length)
      lines.push(["🚪", `ادخل مبنى ${esc(b.code)} من: ` + b.entrances.map(e => esc(e.name) + (e.desc ? ` <small>(${esc(e.desc)})</small>` : "")).join(" أو ")]);
    const dest = DATA.campus_destination || DATA.university;
    let url = `https://www.google.com/maps/dir/?api=1&travelmode=driving&destination=${encodeURIComponent(dest)}`;
    if (origin) url += `&origin=${origin[0].toFixed(6)},${origin[1].toFixed(6)}`;
    return { lines, url, urlLabel: "الطريق إلى الجامعة في Google Maps" };
  }
  const entrance = ["🎯", `توجّه إلى: <b>${esc(t.label)}</b>` + (t.desc ? ` <small>(${esc(t.desc)})</small>` : "")];
  if (origin) {
    const d = km(origin, [t.lat, t.lng]) * 1000;
    if (d <= ARRIVE_METERS) return { lines: [["🎯", `أنت عند <b>${esc(t.label)}</b> تقريباً!`]], target: t };
    const gate = gateFor(origin, t);
    lines.push(["🧭", d > 2000 ? `أنت على بعد حوالي ${Math.round(d / 1000)} كم من الجامعة` : `من موقعك: ${walkText(d, bearingAr(origin, [t.lat, t.lng]))}`]);
    if (gate) lines.push(["🚧", `ادخل الجامعة من: <b>${esc(gate.name)}</b>` + (gate.directions ? ` <small>(${esc(gate.directions)})</small>` : "")]);
    lines.push(entrance);
    return { lines, url: mapsLink(t, origin, gate), urlLabel: "الطريق من مكانك في Google Maps", target: t };
  }
  lines.push(entrance);
  return { lines, url: mapsLink(t), urlLabel: "افتح الطريق في Google Maps", target: t };
}

// ---------------------------------------------------------------- صياغة البطاقة (منقول من describe)
const isInternal = n => INTERNAL_MARKERS.some(m => (n || "").includes(m));
const buildingTitle = b => `مبنى ${b.code}` + ((b.name === `مبنى ${b.code}` || !b.name) ? "" : ` – ${b.name}`);
const roomLabel = p => (p.type === "شخص" || p.type === "مكتب إداري" ? "مكتب" : ROOM_WORDS.has(p.type) ? p.type : "غرفة");
const roomMates = p => (p.room ? PLACES.filter(q => q.room === p.room && q.id !== p.id) : []);

function elevatorLine(b, floor) {
  const f = parseInt(floor, 10);
  if (isNaN(f) || f < 1) return null;
  if (b.elevator === true) return ["🛗", "يوجد مصعد في المبنى"];
  if (b.elevator === false) return ["🪜", `لا يوجد مصعد في مبنى ${esc(b.code)}، الصعود بالدرج`];
  return null;
}

function describe(p) {
  const t = p.type, L = [];
  let title, sub = "";
  if (t === "مبنى") {
    title = buildingTitle(p);
    const units = (p.units || []).filter(u => u !== p.name);
    if (units.length) L.push(["🎓", "فيه: " + units.map(esc).join("، ")]);
    const ents = p.entrances || [];
    if (ents.length) L.push(["🚪", (ents.length > 1 ? "المداخل: " : "") + ents.map(e => esc(e.name) + (e.desc ? ` <small>(${esc(e.desc)})</small>` : "")).join("، ")]);
    if (p.elevator === true || p.elevator === false) L.push(p.elevator ? ["🛗", "فيه مصعد"] : ["🪜", "لا يوجد مصعد"]);
  } else if (t === "بوابة") {
    title = p.name;
    if (p.directions) L.push(["ℹ️", esc(p.directions)]);
  } else {
    const b = buildingOf(p);
    if (t === "شخص") {
      title = p.name;
      if (p.job) sub = p.job;
      const unit = [p.college, p.department].filter(Boolean).join(" – ");
      if (unit) L.push(["🎓", esc(unit)]);
    } else if (t === "مكتب مشترك") title = `المكتب ${p.room}`;
    else title = p.name;
    if (b) L.push(["🏛️", esc(buildingTitle(b))]);
    const where = [];
    if (has(p.floor)) where.push(floorName(p.floor));
    if (p.room) {
      const host = t === "شخص" ? roomMates(p).find(m => m.type !== "شخص") : null;
      if (host) {
        const lbl = `${roomLabel(host)} ${p.room}`;
        where.push(`<b>${esc(lbl)}</b>` + (host.name !== lbl && host.name !== p.room ? ` (${esc(host.name)})` : ""));
      } else where.push(`<b>${esc((t !== "مكتب مشترك" ? roomLabel(p) : "مكتب") + " " + p.room)}</b>`);
    }
    if (where.length) L.push(["🏢", where.join(" – ")]);
    else if (t === "شخص") L.push(["🏢", "رقم المكتب غير مُدخل في الدليل بعد" + (b ? `، اسأل في مبنى ${esc(b.code)}` : "")]);
    if (t !== "شخص" && t !== "مكتب مشترك" && p.college) {
      const c = p.college.trim();
      L.push(["🎓", "تابع " + esc(c.startsWith("ال") ? "ل" + c.slice(1) : "ل" + c)]);
    }
    if (p.hours) L.push(["🕒", (t === "شخص" ? "الساعات المكتبية: " : "") + esc(p.hours)]);
    const mates = p.group ? p.members.map(getPlace) : roomMates(p);
    const people = mates.filter(m => m && m.type === "شخص" && m.id !== p.id);
    if (people.length) {
      const head = p.group && t === "مكتب مشترك" ? "في هذا المكتب:" : t === "شخص" ? "يشاركه المكتب:" : "فيه:";
      L.push(["👥", head + "<ul>" + people.slice(0, 8).map(m => {
        const extra = [m.job, m.hours && `🕒 ${m.hours}`].filter(Boolean).join(" – ");
        return `<li><a href="#p=${encodeURIComponent(m.id)}">${esc(m.name)}</a>${extra ? ` <small>(${esc(extra)})</small>` : ""}</li>`;
      }).join("") + "</ul>"]);
    }
    if (b) { const el = elevatorLine(b, p.floor); if (el) L.push(el); }
  }
  if (p.notes && !isInternal(p.notes)) L.push(["📝", esc(p.notes)]);
  return { title, sub, lines: L };
}

const TYPE_ICON = { "مبنى": "🏛️", "بوابة": "🚧", "شخص": "👤", "مكتب مشترك": "🚪", "قاعة": "🏫", "مدرج": "🎭", "مختبر": "💻", "مشغل": "🛠️",
  "كافتيريا": "☕", "حمامات": "🚻", "مصلى": "🕌", "مكتبة": "📚", "موقف سيارات": "🅿️", "ملعب": "⚽", "قاعة اجتماعات": "👥" };
const icon = p => TYPE_ICON[p.type] || "📍";

function choiceExtra(p) {
  const b = buildingOf(p);
  return [p.job || p.department || p.college, p.room && !p.name.includes(p.room) ? p.room : "",
    b && p.type !== "مبنى" ? `مبنى ${b.code}` : ""].filter(Boolean).join(" – ");
}

// ---------------------------------------------------------------- الواجهة
const view = $("#view");

function setView(html, cls = "") {
  view.className = cls;
  view.innerHTML = html;
  view.scrollTop = 0;
  window.scrollTo(0, 0);
}

function listHtml(places, head, note = "") {
  const total = places.length, shown = places.slice(0, MAX_CHOICES);
  PENDING = shown.map(p => p.id);
  const more = total > shown.length ? `<p class="muted">… وهناك نتائج أخرى (عددها ${total - shown.length}). للتضييق اكتب الاسم الكامل أو أضف القسم أو الكلية.</p>` : "";
  return `${head ? `<h2 class="list-head">${head}</h2>` : ""}${note}
    <ol class="results">${shown.map((p, i) => `<li><a href="#p=${encodeURIComponent(p.id)}">
      <span class="num">${i + 1}</span><span class="ico" aria-hidden="true">${icon(p)}</span>
      <span class="txt"><b>${esc(p.name)}</b>${choiceExtra(p) ? `<small>${esc(choiceExtra(p))}</small>` : ""}</span></a></li>`).join("")}</ol>${more}`;
}

function message(html, kind = "") {
  setView(`<div class="msg ${kind}">${html}</div>`);
}

function showPlace(p, push = true) {
  if (!p) return message("عذراً، هذا المكان غير موجود في الدليل 🙏", "warn");
  CURRENT = p;
  PENDING = [];
  if (push) history.pushState({}, "", `#p=${encodeURIComponent(p.id)}`);
  const d = describe(p), r = route(p), b = buildingOf(p);
  const photo = b && b.photo ? `<img class="photo" src="${esc(b.photo)}" alt="صورة مدخل ${esc(buildingTitle(b))}" loading="lazy">` : "";
  const row = ([i, h]) => `<div class="row"><span class="i" aria-hidden="true">${i}</span><div>${h}</div></div>`;
  const tracking = r.target && WATCH !== null;
  setView(`
    <article class="card">
      <header><span class="badge">${esc(p.type === "مكتب مشترك" ? "مكتب" : p.type)}</span>
        <h2>${esc(d.title)}</h2>${d.sub ? `<p class="job">💼 ${esc(d.sub)}</p>` : ""}</header>
      ${d.lines.map(row).join("")}
    </article>
    ${photo}
    <section class="card route">
      <h3>الطريق</h3>
      ${r.lines.map(row).join("")}
      ${r.url ? `<a class="btn primary" href="${esc(r.url)}" target="_blank" rel="noopener">🗺️ ${esc(r.urlLabel)}</a>` : ""}
      ${r.target ? (tracking
        ? `<p class="live">🔴 أتابع موقعك، وسأنبهك عند وصولك إلى المدخل.</p>`
        : `<button class="btn" data-act="track">📍 ${here() ? "تابعني حتى المدخل" : "استخدم موقعي لحساب الطريق"}</button>`)
      : (here() ? "" : `<button class="btn" data-act="locate">📍 استخدم موقعي</button>`)}
      ${r.target || b ? `<button class="btn ghost" data-act="onmap">🗺️ عرض على خريطة الجامعة</button>` : ""}
      <button class="btn ghost" data-act="share">↗️ مشاركة</button>
    </section>`);
  if (r.target && WATCH !== null) TRACK = { id: p.id, near: false, arrived: false };
  document.title = `${d.title} – ${appName()}`;
}

function notFound(text) {
  const room = roomInText(text);
  const what = room ? room[2] : (cleanQuery(text) || text);
  message(`<p>عذراً، «<b>${esc(what)}</b>» غير موجود في دليل الجامعة 🙏</p>
    <p class="muted">تأكد من الكتابة، أو تواصل مع ${esc(DATA.contact || "عمادة شؤون الطلبة")}.</p>`, "warn");
}

/* السؤال كاملاً (زر بحث / Enter): نفس ترتيب run_agent في البوت بدون ذكاء اصطناعي */
function ask(text, push = true) {
  text = (text || "").trim();
  if (!text) return home();
  const num = (() => { const m = /^(?:رقم|الرقم|الخيار|خيار)?\s*(\d{1,2})\s*[-–.)]?$/.exec(latin(text)); return m ? +m[1] : null; })();
  if (push && num === null) history.pushState({}, "", `#q=${encodeURIComponent(text)}`);
  if (num !== null && PENDING.length) {
    if (num >= 1 && num <= PENDING.length) { $("#q").value = ""; return showPlace(getPlace(PENDING[num - 1])); }
    return message(`اكتب رقماً من 1 إلى ${PENDING.length} 🙂`);
  }
  if (num !== null) return message("✍️ اكتب اسم الشخص أو المكان، أو حرف المبنى (مثل: مبنى E)، أو رقم الغرفة (مثل: E213).");
  const t = norm(text), wanted = wantedType(t);
  if (wanted) return nearest(wanted, text);
  const query = cleanQuery(text);
  if (!query && !roomInText(text))
    return message("مين أو شو بتدوّر عليه؟ اكتب الاسم، مثل: «الدكتور محمد …»، أو حرف المبنى، أو رقم الغرفة (E213) 🙂");
  const exactFast = fastMatch(text, query);
  if (exactFast) return showPlace(exactFast, false);
  const results = collapseRooms(searchPlace(query || text));
  if (!results.length) return notFound(text);
  if (results.length === 1) return showPlace(results[0], false);
  setView(listHtml(results, "لقيت أكثر من نتيجة، أي واحد تقصد؟"));
}

function fastMatch(text, query) {
  if (NEAREST_WORDS.some(w => norm(text).includes(w))) return null;
  if (!query || query.split(" ").length > 4) return null;
  if (roomInText(text)) { const f = collapseRooms(searchPlace(text)); return f.length === 1 ? f[0] : null; }
  const r = rankedPlaces(query);
  if (r.length && r[0][0] >= 0.9 && !(r.length > 1 && r[1][0] >= r[0][0] - 0.05)) return r[0][1];
  return null;
}

/* «أقرب حمام / كافتيريا / موقف / مصلى» */
function nearest(type, text) {
  const cands = PLACES.filter(p => p.type === type);
  if (!cands.length) return message(`لم تُضف أماكن من هذا النوع إلى الدليل بعد. تواصل مع ${esc(DATA.contact || "عمادة شؤون الطلبة")}.`, "warn");
  if (cands.length === 1) return showPlace(cands[0], false);
  let origin = here(), from = "موقعك";
  const inB = buildingInText(text);
  if (!origin && inB) { const t = targetPoint(inB); if (t) { origin = [t.lat, t.lng]; from = `مبنى ${inB.code}`; } }
  if (!origin) {
    NEAREST_Q = text;
    const chips = Object.keys(BUILDINGS).sort().map(c => `<button class="chip" data-q="${esc(text + " أنا في مبنى " + c)}">${esc(c)}</button>`).join("");
    return setView(`<div class="msg"><p>حتى أدلك على الأقرب إليك، استخدم موقعك أو اختر المبنى الذي أنت فيه.</p>
      <button class="btn primary" data-act="locate-nearest">📍 استخدم موقعي</button>
      <p class="muted">أنا في مبنى:</p><div class="chips">${chips}</div></div>` + listHtml(cands.slice(0, 6), "أو اختر من القائمة"));
  }
  const scored = cands.map(p => { const t = targetPoint(p, origin); return t ? [km(origin, [t.lat, t.lng]), p] : null; })
    .filter(Boolean).sort((a, b) => a[0] - b[0]);
  if (!scored.length) return setView(listHtml(cands, "لم تُدخل مواقع هذه الأماكن بعد، اختر من القائمة"));
  showPlace(scored[0][1], false);
  const note = document.createElement("p");
  note.className = "muted center";
  note.textContent = `الأقرب إلى ${from}` + (scored.length > 1 ? `. وأيضاً قريب: ${scored.slice(1, 3).map(x => x[1].name).join("، ")}` : "");
  view.prepend(note);
}

// ---------------------------------------------------------------- الصفحات
function appName() { return "دليل " + (DATA.university || "الجامعة"); }

function home() {
  CURRENT = null; TRACK = null;
  document.title = appName();
  const examples = [];
  const person = PLACES.find(p => p.type === "شخص" && p.room);
  if (person) examples.push(person.name);
  const lab = PLACES.find(p => p.type === "مختبر");
  examples.push("مبنى E", lab ? lab.room || lab.name : "E213", "أقرب حمام");
  const recent = load("recent") || [];
  setView(`
    <section class="hello">
      <h2>إلى أين تريد الذهاب؟</h2>
      <p>اكتب اسم المحاضر أو الموظف، أو صفته (عميد، رئيس قسم، سكرتير…)، أو حرف المبنى، أو رقم الغرفة مثل E213.</p>
    </section>
    <div class="chips">${examples.map(e => `<button class="chip" data-q="${esc(e)}">${esc(e)}</button>`).join("")}</div>
    <h3 class="sec">مرافق</h3>
    <div class="grid facilities">
      ${[["☕", "الكافتيريا", "كافتيريا"], ["🚻", "أقرب حمام", "أقرب حمام"], ["🕌", "المسجد", "مسجد"], ["🅿️", "المواقف", "أقرب موقف سيارات"], ["📚", "المكتبة", "المكتبة"], ["⚽", "الملاعب", "الملاعب"]]
      .map(([i, l, q]) => `<button class="tile" data-q="${esc(q)}"><span aria-hidden="true">${i}</span>${l}</button>`).join("")}
    </div>
    ${recent.length ? `<h3 class="sec">بحثت مؤخراً</h3><div class="chips">${recent.map(r => `<button class="chip" data-q="${esc(r)}">${esc(r)}</button>`).join("")}</div>` : ""}
  `, "home");
}

function buildingsPage() {
  const codes = Object.keys(BUILDINGS).sort();
  setView(`<h2 class="list-head">المباني</h2><div class="buildings">${codes.map(c => {
    const b = BUILDINGS[c];
    return `<a class="bcard" href="#p=${encodeURIComponent(b.id)}"><span class="letter">${esc(c)}</span>
      <span class="txt"><b>${esc(b.name || "مبنى " + c)}</b><small>${esc((b.units || []).join("، "))}</small></span></a>`;
  }).join("")}</div>`);
}

// ---------------------------------------------------------------- الخريطة
let MAP = null, MAP_LAYER = null, ME_MARKER = null;
function loadLeaflet() {
  if (window.L) return Promise.resolve();
  return new Promise((ok, fail) => {
    const css = document.createElement("link");
    css.rel = "stylesheet"; css.href = "vendor/leaflet/leaflet.css";
    document.head.appendChild(css);
    const s = document.createElement("script");
    s.src = "vendor/leaflet/leaflet.js";
    s.onload = ok; s.onerror = fail;
    document.head.appendChild(s);
  });
}

function mapPage(focus) {
  const pts = campusPoints();
  const img = DATA.map ? `<figure class="campus-img"><img src="${esc(DATA.map)}" alt="خريطة مباني الجامعة"><figcaption>خريطة المباني ومداخلها</figcaption></figure>` : "";
  if (!pts.length) {
    return setView(`<h2 class="list-head">خريطة الجامعة</h2>${img || `<div class="msg">لم تُضف خريطة الجامعة ولا إحداثيات المداخل بعد.</div>`}
      <p class="muted">بعد إدخال إحداثيات المداخل في ملف الإكسل تظهر هنا خريطة تفاعلية بالمداخل والبوابات وموقعك.</p>`);
  }
  ME_MARKER = null;
  setView(`<div id="map" role="application" aria-label="الخريطة التفاعلية"></div>${img}`, "map-view");
  loadLeaflet().then(() => {
    MAP = L.map("map", { zoomControl: true }).setView(pts[0], 17);
    // خرائط OpenStreetMap ترفض الطلبات من صفحة مفتوحة من الجهاز؛ نستخدم CARTO (شوارع) و Esri (صور جوية)
    const streets = L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png",
      { maxZoom: 20, subdomains: "abcd", attribution: "© OpenStreetMap © CARTO" });
    const satellite = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      { maxZoom: 19, attribution: "صور جوية © Esri" });
    satellite.addTo(MAP);
    L.control.layers({ "صور جوية": satellite, "شوارع": streets }, null, { position: "topleft" }).addTo(MAP);
    MAP_LAYER = L.featureGroup().addTo(MAP);
    const pin = (cls, txt) => L.divIcon({ className: "pin " + cls, html: `<span>${esc(txt)}</span>`, iconSize: [30, 30], iconAnchor: [15, 15] });
    let focusMarker = null;
    Object.values(BUILDINGS).forEach(b => (b.entrances || []).forEach(e => {
      if (!has(e.lat)) return;
      const m = L.marker([e.lat, e.lng], { icon: pin("b", b.code) }).addTo(MAP_LAYER)
        .bindPopup(`<b>${esc(buildingTitle(b))}</b><br>${esc(e.name)}${e.desc ? "<br><small>" + esc(e.desc) + "</small>" : ""}<br><a href="#p=${encodeURIComponent(b.id)}">التفاصيل</a>`);
      if (focus && focus.lat === e.lat && focus.lng === e.lng) focusMarker = m;
    }));
    PLACES.forEach(p => {
      if (p.type === "مبنى" || !has(p.lat)) return;
      const m = L.marker([p.lat, p.lng], { icon: pin(p.type === "بوابة" ? "g" : "o", icon(p)) }).addTo(MAP_LAYER)
        .bindPopup(`<b>${esc(p.name)}</b>${p.directions ? "<br><small>" + esc(p.directions) + "</small>" : ""}<br><a href="#p=${encodeURIComponent(p.id)}">التفاصيل</a>`);
      if (focus && focus.lat === p.lat && focus.lng === p.lng) focusMarker = m;
    });
    // نُكبّر على الحرم فقط: نقطة إحداثياتها خاطئة (بعيدة كيلومترات) لا تصغّر الخريطة كلها
    const lats = pts.map(x => x[0]).sort((a, b) => a - b), lngs = pts.map(x => x[1]).sort((a, b) => a - b);
    const mid = [lats[lats.length >> 1], lngs[lngs.length >> 1]];
    const core = pts.filter(x => km(mid, x) <= 1.5);
    MAP.fitBounds(L.latLngBounds(core.length ? core : pts).pad(0.1), { maxZoom: 18 });
    if (focusMarker) { MAP.setView(focusMarker.getLatLng(), 18); focusMarker.openPopup(); }
    drawMe();
  }).catch(() => { const m = $("#map"); if (m) m.outerHTML = `<div class="msg warn">تعذّر فتح الخريطة التفاعلية.</div>`; });
}

function drawMe() {
  if (!MAP || !window.L || !document.getElementById("map")) return;
  const o = here();
  if (!o) return;
  if (!ME_MARKER) ME_MARKER = L.circleMarker(o, { radius: 8, color: "#fff", weight: 3, fillColor: "#1a73e8", fillOpacity: 1 }).addTo(MAP);
  else ME_MARKER.setLatLng(o);
}

// ---------------------------------------------------------------- الموقع (GPS)
function toast(html, ms = 4000) {
  const t = $("#toast");
  t.innerHTML = html;
  t.hidden = false;
  clearTimeout(toast._t);
  if (ms) toast._t = setTimeout(() => (t.hidden = true), ms);
}

function startLocation(then) {
  if (!("geolocation" in navigator)) return toast("المتصفح لا يدعم تحديد الموقع.");
  if (WATCH !== null) { then && then(); return; }
  toast("📍 جارٍ تحديد موقعك…", 0);
  let first = true;
  WATCH = navigator.geolocation.watchPosition(pos => {
    LOC = { lat: pos.coords.latitude, lng: pos.coords.longitude, acc: pos.coords.accuracy, t: Date.now() };
    $("#gps").classList.add("on");
    if (first) { first = false; $("#toast").hidden = true; then && then(); }
    onMove();
  }, err => {
    WATCH = null;
    $("#gps").classList.remove("on");
    toast(err.code === 1
      ? "لم يُسمح بالوصول إلى موقعك. فعّل الموقع (GPS) واسمح للمتصفح باستخدامه من الإعدادات، ثم حاول مرة أخرى."
      : "تعذّر تحديد موقعك الآن. تأكد أن الموقع (GPS) مفعّل، ثم حاول مرة أخرى.", 7000);
  }, { enableHighAccuracy: true, maximumAge: 10000, timeout: 20000 });
}

function onMove() {
  drawMe();
  if (!TRACK || TRACK.arrived) return;
  const p = getPlace(TRACK.id), o = here();
  if (!p || !o) return;
  const tp = targetPoint(p, o);
  if (!tp) return;
  const d = km(o, [tp.lat, tp.lng]) * 1000;
  if (d <= ARRIVE_METERS) {
    TRACK.arrived = true;
    const b = buildingOf(p), lines = [`🎉 <b>وصلت إلى ${esc(tp.label)}!</b>`];
    if (p.type !== "مبنى" && p.type !== "بوابة" && has(p.floor)) {
      let step = `توجّه إلى ${floorName(p.floor)}`;
      if (p.room) step += `، ${p.type !== "مكتب مشترك" ? roomLabel(p) : "مكتب"} ${esc(p.room)}`;
      lines.push("🏢 " + step);
      const el = b && elevatorLine(b, p.floor);
      if (el) lines.push(el.join(" "));
    }
    toast(lines.join("<br>"), 15000);
    if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
  } else if (d <= NEAR_METERS && !TRACK.near) {
    TRACK.near = true;
    toast(`👍 قربت! باقي حوالي ${Math.round(d / 10) * 10} متر باتجاه ${bearingAr(o, [tp.lat, tp.lng])} إلى ${esc(tp.label)}.`, 8000);
    if (navigator.vibrate) navigator.vibrate(150);
  }
}

// ---------------------------------------------------------------- التنقل والأحداث
function route_from_hash() {
  const h = decodeURIComponent(location.hash.slice(1));
  document.querySelectorAll("nav.tabs a").forEach(a => a.removeAttribute("aria-current"));
  const tab = n => { const a = document.querySelector(`nav.tabs a[href="#${n}"]`); if (a) a.setAttribute("aria-current", "page"); };
  if (h.startsWith("p=")) { tab("home"); return showPlace(getPlace(h.slice(2)), false); }
  if (h.startsWith("q=")) { tab("home"); $("#q").value = h.slice(2); return ask(h.slice(2), false); }
  if (h === "buildings") { tab("buildings"); $("#q").value = ""; return buildingsPage(); }
  if (h.startsWith("map")) { tab("map"); $("#q").value = ""; return mapPage(CURRENT && targetPoint(CURRENT, here())); }
  tab("home");
  $("#q").value = "";
  home();
}

function remember(q) {
  const r = (load("recent") || []).filter(x => x !== q);
  r.unshift(q);
  store("recent", r.slice(0, 6));
}

function submit(text) {
  text = (text || "").trim();
  if (!text) return;
  $("#q").blur();
  $("#suggest").hidden = true;
  if (!/^\s*\d{1,2}\s*$/.test(latin(text))) remember(text);
  ask(text);
}

let suggestTimer = null;
function suggest() {
  clearTimeout(suggestTimer);
  suggestTimer = setTimeout(() => {
    const text = $("#q").value.trim(), box = $("#suggest");
    const query = cleanQuery(text);
    if (text.length < 2 || wantedType(norm(text)) || (!query && !roomInText(text))) { box.hidden = true; return; }
    const res = collapseRooms(searchPlace(query || text, null, 8)).slice(0, 6);
    if (!res.length) { box.hidden = true; return; }
    box.innerHTML = res.map(p => `<li><a href="#p=${encodeURIComponent(p.id)}"><span aria-hidden="true">${icon(p)}</span>
      <span><b>${esc(p.name)}</b>${choiceExtra(p) ? `<small>${esc(choiceExtra(p))}</small>` : ""}</span></a></li>`).join("");
    box.hidden = false;
  }, 120);
}

document.addEventListener("click", e => {
  const q = e.target.closest("[data-q]");
  if (q) { $("#q").value = q.dataset.q; return submit(q.dataset.q); }
  const a = e.target.closest("[data-act]");
  if (a) {
    const act = a.dataset.act;
    if (act === "track" || act === "locate") startLocation(() => CURRENT && showPlace(CURRENT, false));
    if (act === "locate-nearest") startLocation(() => NEAREST_Q && ask(NEAREST_Q, false));
    if (act === "gps") WATCH !== null ? toast(here() ? `📍 موقعك محدد (دقة حوالي ${Math.round(LOC.acc)} متر)` : "📍 جارٍ تحديد موقعك…") : startLocation(() => toast("✅ تم تحديد موقعك"));
    if (act === "onmap") location.hash = "map";
    if (act === "share" && CURRENT) {
      const url = location.href.split("#")[0] + `#p=${encodeURIComponent(CURRENT.id)}`, d = describe(CURRENT);
      if (navigator.share) navigator.share({ title: d.title, text: `${d.title} – ${appName()}`, url }).catch(() => { });
      else navigator.clipboard && navigator.clipboard.writeText(url).then(() => toast("✅ تم نسخ الرابط"));
    }
    if (act === "install") installApp();
    if (act === "close-toast") $("#toast").hidden = true;
  }
  if (!e.target.closest(".search")) $("#suggest").hidden = true;
});

$("#search").addEventListener("submit", e => { e.preventDefault(); submit($("#q").value); });
$("#q").addEventListener("input", suggest);
$("#q").addEventListener("focus", suggest);
$("#suggest").addEventListener("click", e => {
  if (e.target.closest("a")) { remember($("#q").value.trim()); $("#suggest").hidden = true; }
});
window.addEventListener("hashchange", route_from_hash);
$("#toast").addEventListener("click", () => ($("#toast").hidden = true));

// ---------------------------------------------------------------- التثبيت على الشاشة الرئيسية
let INSTALL = null;
window.addEventListener("beforeinstallprompt", e => { e.preventDefault(); INSTALL = e; $("#install").hidden = false; });
function installApp() {
  if (INSTALL) { INSTALL.prompt(); INSTALL.userChoice.finally(() => { INSTALL = null; $("#install").hidden = true; }); return; }
  toast("على آيفون: اضغط زر المشاركة <b>⬆️</b> في Safari، ثم «إضافة إلى الشاشة الرئيسية».", 10000);
}
const standalone = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone;
if (!standalone && /iphone|ipad|ipod/i.test(navigator.userAgent)) $("#install").hidden = false;

// ---------------------------------------------------------------- تحميل البيانات (من الشبكة، أو آخر نسخة محفوظة بدون إنترنت)
function setData(d) {
  DATA = d;
  PLACES = d.places || [];
  BUILDINGS = {};
  PLACES.forEach(p => { if (p.type === "مبنى") BUILDINGS[p.code] = p; });
  NORM_CACHE.clear();
  $("#brand").textContent = appName();
  $("#version").textContent = d.version ? `البيانات: ${d.version}` : "";
}

/* data.js نسخة من نفس البيانات تُحمَّل كسكربت: تعمل حتى عند فتح index.html مباشرة من الجهاز (بدون خادم) */
function loadDataScript() {
  return new Promise(ok => {
    const s = document.createElement("script");
    s.src = "data.js?" + Date.now();
    s.onload = () => ok(window.GUIDE_DATA || null);
    s.onerror = () => ok(null);
    document.head.appendChild(s);
  });
}

async function boot() {
  let cached = null;
  try { cached = JSON.parse(localStorage.getItem("data")); } catch (e) { }
  if (cached) { setData(cached); route_from_hash(); }
  let d = null;
  try {
    const r = await fetch("data.json", { cache: "no-cache" });
    if (r.ok) d = await r.json();
  } catch (e) { }
  if (!d) d = await loadDataScript();
  if (d) {
    if (!cached || d.version !== cached.version) {
      try { localStorage.setItem("data", JSON.stringify(d)); } catch (e) { }
      setData(d);
      route_from_hash();
      if (cached) toast("✅ تم تحديث بيانات الدليل");
    }
  } else if (!cached) {
    message(`<p>تعذّر تحميل بيانات الدليل.</p>
      <p class="muted">التطبيق يقرأ البيانات من الملفين <b>data.json</b> و<b>data.js</b> في نفس مجلد التطبيق، وليس من ملف الإكسل مباشرة.
      يصنعهما البوت من ملف الإكسل عند تشغيله، أو بالأمر: <code>python web_publish.py</code></p>`, "warn");
  } else $("#version").textContent += " (بدون إنترنت)";
}

if ("serviceWorker" in navigator) window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => { }));
boot();
