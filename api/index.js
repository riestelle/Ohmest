import { Redis } from "@upstash/redis";
import crypto from "crypto";

const r = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN,
});
const SECRET = process.env.ADMIN_PASSWORD || "";
const GRACE = 1500;
const err = (m, s = 400) => Object.assign(new Error(m), { status: s });
const sign = (e) =>
  crypto.createHmac("sha256", SECRET).update(String(e)).digest("hex");
const mkToken = () => {
  const e = Date.now() + 12 * 3600e3;
  return e + "." + sign(e);
};
const isAdmin = (t) => {
  try {
    const [e, s] = String(t || "").split(".");
    return (
      !!SECRET &&
      Number(e) > Date.now() &&
      crypto.timingSafeEqual(Buffer.from(s), Buffer.from(sign(e)))
    );
  } catch {
    return false;
  }
};
const needAdmin = (b) => {
  if (!isAdmin(b.token)) throw err("Not authorised", 401);
};

function perm(n, seed) {
  let h = 2166136261;
  for (const c of seed) {
    h ^= c.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  h = h || 1;
  const rnd = () => {
    h ^= h << 13;
    h ^= h >>> 17;
    h ^= h << 5;
    return (h >>> 0) / 4294967296;
  };
  const a = [...Array(n).keys()];
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
const norm = (s) =>
  String(s || "")
    .toLowerCase()
    .replace(/\s+/g, "");
const opt = (ex) => ({
  shuffleQ: true,
  shuffleC: true,
  copyBlock: true,
  fsTrack: true,
  showScore: false,
  calc: false,
  units: false,
  multi: true,
  neg: 0,
  sheet: "",
  opens: 0,
  closes: 0,
  roster: [],
  ...(ex.set || {}),
});
const isOpen = (ex) => {
  const o = opt(ex),
    n = Date.now();
  return (
    ex.status === "open" &&
    (!o.opens || n >= o.opens) &&
    (!o.closes || n <= o.closes)
  );
};
const mkSet = (s) => {
  s = s || {};
  return {
    shuffleQ: !!s.shuffleQ,
    shuffleC: !!s.shuffleC,
    copyBlock: !!s.copyBlock,
    fsTrack: !!s.fsTrack,
    showScore: !!s.showScore,
    calc: !!s.calc,
    units: !!s.units,
    multi: !!s.multi,
    neg: Math.min(100, Math.max(0, +s.neg || 0)),
    sheet: String(s.sheet || "").slice(0, 3000),
    opens: +s.opens || 0,
    closes: +s.closes || 0,
    roster: (Array.isArray(s.roster) ? s.roster : [])
      .map(norm)
      .filter(Boolean)
      .slice(0, 2000),
  };
};
const aKey = (sid) => "att:" + norm(sid);

/* advance past questions whose time ran out (server clock is the authority) */
function adv(a, ex) {
  const now = Date.now();
  while (a.status === "in_progress") {
    const qi = a.order[a.cur],
      t = ex.questions[qi].t * 1000;
    if (now - a.qStart <= t + GRACE) break;
    a.ans[qi] = { s: -1, ms: t };
    a.cur++;
    a.qStart += t;
    if (a.cur >= a.order.length) {
      a.status = "done";
      a.finished = now;
    }
  }
}
function view(a, ex) {
  if (a.status !== "in_progress") return { status: a.status, title: ex.title };
  const qi = a.order[a.cur],
    q = ex.questions[qi],
    cp = opt(ex).shuffleC ? perm(q.c.length, a.sid + qi) : [...q.c.keys()];
  return {
    status: "in_progress",
    title: ex.title,
    type: q.type || "mc",
    qi,
    cur: a.cur,
    total: a.order.length,
    t: q.t,
    left: q.t * 1000 - (Date.now() - a.qStart),
    q: q.q,
    choices: cp.map((j) => ({ i: j, t: q.c[j] })),
  };
}
async function V(a, ex) {
  const v = view(a, ex);
  if (v.status !== "in_progress") {
    v.receipt = rc(a);
    if (opt(ex).showScore) {
      v.score = score(a, (await r.get("key")) || [], ex);
      v.of = maxPts(ex);
    }
  } else v.ann = await r.get("ann");
  return v;
}
const lockIf = (a, ex) => {
  if (a.status === "in_progress" && a.leaves > ex.maxLeaves) {
    a.status = "locked";
    a.finished = Date.now();
  }
};
async function loadAtt(b) {
  const ex = await r.get("exam");
  if (!ex) throw err("No exam");
  const a = await r.get(aKey(b.sid));
  if (!a || a.token !== b.token)
    throw err("Session not found. Ask your professor to reset you.", 403);
  return { a, ex };
}
const nu = (u) => String(u || "").replace(/\s+/g, "");
const pf = (v) => parseFloat(String(v ?? "").replace(",", "."));
const corr = (q, k, a, o) => {
  if (!a) return false;
  if (q.type === "num") {
    const x = pf(a.v);
    if (!isFinite(x)) return false;
    const L = o.multi ? k.v || [] : [(k.v || [])[0]],
      t = k.tol || 0;
    return (
      L.some((n) => Math.abs(x - n) <= (Math.abs(n) * t) / 100 + 1e-9) &&
      (!o.units || !k.u || nu(a.u) === nu(k.u))
    );
  }
  return a.s >= 0 && a.s === k.a;
};
const att = (q, a) => !!a && (q.type === "num" ? isFinite(pf(a.v)) : a.s >= 0);
const earn = (q, k, a, o) => {
  const p = q.pts ?? 1;
  return corr(q, k, a, o) ? p : att(q, a) ? (-p * (o.neg || 0)) / 100 : 0;
};
const score = (a, key, ex) => {
  const o = opt(ex);
  let s = 0;
  ex.questions.forEach((q, i) => {
    s += earn(q, key[i] || {}, a.ans && a.ans[i], o);
  });
  return Math.max(0, Math.round(s * 100) / 100);
};
const maxPts = (ex) => ex.questions.reduce((s, q) => s + (q.pts ?? 1), 0);
const rc = (a) =>
  a.token.slice(0, 8).toUpperCase() +
  "-" +
  (a.finished ? a.finished.toString(36).toUpperCase().slice(-4) : "");

async function route(b) {
  switch (b.action) {
    /* ---------- admin ---------- */
    case "login":
      if (!SECRET) throw err("ADMIN_PASSWORD is not set on the server", 500);
      if (String(b.password || "") !== SECRET) throw err("Wrong password", 401);
      return { token: mkToken() };
    case "load": {
      needAdmin(b);
      return { exam: await r.get("exam"), key: (await r.get("key")) || [] };
    }
    case "save": {
      needAdmin(b);
      const old = await r.get("exam");
      const qs = (b.questions || [])
        .slice(0, 200)
        .map((q) => ({
          q: String(q.q),
          type: q.type === "num" ? "num" : "mc",
          c: q.type === "num" ? [] : q.c.map(String),
          t: Math.max(5, +q.t || 30),
          pts: Math.max(0, +q.pts >= 0 ? +q.pts : 1),
        }));
      await r.set("exam", {
        title: String(b.title || "Exam"),
        maxLeaves: Math.max(0, +b.maxLeaves || 0),
        status: old?.status || "closed",
        set: mkSet(b.settings),
        questions: qs,
      });
      await r.set(
        "key",
        (b.questions || []).map((q) =>
          q.type === "num"
            ? {
                v: String(q.v).split(",").map(parseFloat).filter(isFinite),
                tol: Math.max(0, +q.tol || 0),
                u: String(q.u || "").trim(),
              }
            : { a: +q.a || 0 }
        )
      );
      return { ok: 1 };
    }
    case "status": {
      needAdmin(b);
      const ex = await r.get("exam");
      if (!ex) throw err("Save the exam first");
      ex.status = b.open ? "open" : "closed";
      await r.set("exam", ex);
      return { ok: 1 };
    }
    case "results": {
      needAdmin(b);
      const ids = (await r.smembers("atts")) || [];
      const atts = ids.length
        ? (await r.mget(...ids.map((i) => "att:" + i))).filter(Boolean)
        : [];
      atts.forEach((a) => {
        a.receipt = rc(a);
        delete a.token;
      });
      return {
        exam: await r.get("exam"),
        key: (await r.get("key")) || [],
        atts,
      };
    }
    case "reset": {
      needAdmin(b);
      await r.del(aKey(b.sid));
      await r.srem("atts", norm(b.sid));
      return { ok: 1 };
    }
    case "announce": {
      needAdmin(b);
      const t = String(b.text || "")
        .trim()
        .slice(0, 300);
      if (t) await r.set("ann", { text: t, at: Date.now() });
      else await r.del("ann");
      return { ok: 1 };
    }
    /* ---------- student ---------- */
    case "info": {
      const ex = await r.get("exam");
      return ex
        ? {
            open: isOpen(ex),
            opens: opt(ex).opens,
            closes: opt(ex).closes,
            s: {
              copyBlock: opt(ex).copyBlock,
              fsTrack: opt(ex).fsTrack,
              calc: opt(ex).calc,
              units: opt(ex).units,
              sheet: opt(ex).sheet,
            },
            title: ex.title,
            n: ex.questions.length,
            sec: ex.questions.reduce((s, q) => s + q.t, 0),
            maxLeaves: ex.maxLeaves,
          }
        : { open: false };
    }
    case "start": {
      const ex = await r.get("exam");
      if (!ex) throw err("The exam is not open");
      const name = String(b.name || "")
          .trim()
          .slice(0, 80),
        sid = String(b.sid || "")
          .trim()
          .slice(0, 40);
      if (!name || !sid) throw err("Enter your name and student ID");
      let a = await r.get(aKey(sid));
      if (a) {
        if (a.status !== "in_progress") return { view: await V(a, ex) };
        if (a.token !== b.token)
          throw err(
            "This ID already started the exam on another device. Ask your professor to reset it.",
            403
          );
        adv(a, ex);
        if (a.status === "in_progress") {
          a.leaves++;
          a.ev.push({ t: Date.now(), k: "resumed", qi: a.order[a.cur] });
          lockIf(a, ex);
        }
      } else {
        if (!isOpen(ex)) throw err("The exam is not open");
        const rs = opt(ex).roster;
        if (rs.length && !rs.includes(norm(sid)))
          throw err("Your ID is not on the class list");
        a = {
          name,
          sid,
          token: crypto.randomBytes(16).toString("hex"),
          order: opt(ex).shuffleQ
            ? perm(ex.questions.length, sid)
            : [...ex.questions.keys()],
          cur: 0,
          qStart: Date.now(),
          started: Date.now(),
          ans: {},
          ev: [],
          leaves: 0,
          away: 0,
          awayAt: 0,
          status: "in_progress",
        };
        await r.sadd("atts", norm(sid));
      }
      await r.set(aKey(sid), a);
      return { token: a.token, view: await V(a, ex) };
    }
    case "state": {
      const { a, ex } = await loadAtt(b);
      adv(a, ex);
      await r.set(aKey(b.sid), a);
      return { view: await V(a, ex) };
    }
    case "answer": {
      const { a, ex } = await loadAtt(b);
      adv(a, ex);
      if (a.status === "in_progress" && a.order[a.cur] === b.qi) {
        const q = ex.questions[b.qi],
          sel =
            Number.isInteger(b.sel) && b.sel >= 0 && b.sel < q.c.length
              ? b.sel
              : -1;
        const ms = Math.min(Date.now() - a.qStart, q.t * 1000);
        a.ans[b.qi] =
          q.type === "num"
            ? {
                v: String(b.v ?? "").slice(0, 40),
                u: String(b.u ?? "").slice(0, 20),
                ms,
              }
            : { s: sel, ms };
        a.cur++;
        a.qStart = Date.now();
        if (a.cur >= a.order.length) {
          a.status = "done";
          a.finished = Date.now();
        }
      }
      await r.set(aKey(b.sid), a);
      return { view: await V(a, ex) };
    }
    case "event": {
      const { a, ex } = await loadAtt(b);
      adv(a, ex);
      if (a.status === "in_progress") {
        const now = Date.now(),
          qi = a.order[a.cur];
        if (["tab_hidden", "window_blur", "fullscreen_exit"].includes(b.k)) {
          if (!a.awayAt) {
            a.awayAt = now;
            a.leaves++;
            a.ev.push({ t: now, k: b.k, qi });
            lockIf(a, ex);
          }
        } else if (b.k === "back") {
          if (a.awayAt) {
            const d = now - a.awayAt;
            a.away += d;
            a.awayAt = 0;
            a.ev.push({ t: now, k: "back", d });
          }
        } else if (b.k === "paste" || b.k === "keys" || b.k === "flag") {
          if (a.ev.length < 300) a.ev.push({ t: now, k: b.k, qi });
        }
      }
      await r.set(aKey(b.sid), a);
      return { view: await V(a, ex) };
    }
    default:
      throw err("Unknown action");
  }
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST")
    return res.status(405).json({ error: "POST only" });
  try {
    res.json(await route(req.body || {}));
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message || "Server error" });
  }
}