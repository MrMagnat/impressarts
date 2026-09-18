import Fastify from "fastify";
import cookie from "@fastify/cookie";
import multipart from "@fastify/multipart";
import fstatic from "@fastify/static";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { pipeline } from "node:stream/promises";

import { db, initSchema, DATA_DIR, getSetting, setSetting, currentDate } from "./db.js";
import {
  meta,
  treeChildren,
  positionCard,
  searchPositions,
  dashboard,
  breakdown,
} from "./analytics.js";
import {
  weeklyReport,
  monthlyReport,
  monthEnds,
  competitive,
  scopeReport,
  expiryReport,
  type ExpiryBucketKey,
} from "./reports.js";
import {
  reportHtml,
  scopeReportHtml,
  positionReportHtml,
  expiryReportHtml,
} from "./report-html.js";
import { htmlToPdf, PdfUnavailable } from "./pdf.js";
import {
  checkPassword,
  setSession,
  clearSession,
  isAuthed,
  requireAuth,
  ensurePassword,
  defaultPassword,
} from "./auth.js";
import { importExcel } from "./etl/import-excel.js";
import { ingestSnapshot } from "./etl/ingest.js";
import { startLicense, licenseStatus, isLocked } from "./license.js";
import { sourceConfig, saveSourceConfig, fetchSource, parseSource, buildUrl } from "./source.js";
import {
  runSync,
  recentLog,
  logEntry,
  scheduleState,
  startSync,
  backfillRange,
  today,
} from "./sync.js";
import {
  writeAggregate,
  writeAggregateAll,
  repriceAggregate,
  trimDetail,
  storageStats,
} from "./history.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIST = path.resolve(__dirname, "../../web/dist");
const PORT = parseInt(process.env.PORT ?? "3000", 10);
const HOST = process.env.HOST ?? "0.0.0.0";

initSchema();
ensurePassword();

// Разовая досборка агрегата для баз, созданных до его появления.
{
  const aggEmpty = !(db().prepare("SELECT 1 AS x FROM fact_agg LIMIT 1").get() as any);
  const hasFacts = !!(db().prepare("SELECT 1 AS x FROM fact LIMIT 1").get() as any);
  if (aggEmpty && hasFacts) {
    const n = writeAggregateAll();
    console.log(`[storage] собран агрегат истории: ${n} строк`);
  }
}

const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? "info" } });

await app.register(cookie, {
  secret: process.env.COOKIE_SECRET ?? "sklad-demo-secret-change-me",
});
await app.register(multipart, { limits: { fileSize: 100 * 1024 * 1024 } });

// ---------- LICENSE KILL-SWITCH ----------
app.get("/api/license/status", async () => licenseStatus());
app.addHook("onRequest", async (req, reply) => {
  if (!req.url.startsWith("/api/")) return;
  if (req.url.startsWith("/api/license/status")) return;
  if (isLocked()) {
    reply.code(503).send({
      locked: true,
      error: "Доступ приостановлен поставщиком ПО. Обратитесь к поставщику.",
      reason: licenseStatus().reason,
    });
  }
});

// ---------- AUTH ----------
app.post("/api/auth/login", async (req, reply) => {
  const body = (req.body ?? {}) as { password?: string };
  if (!body.password || !checkPassword(body.password)) {
    return reply.code(401).send({ error: "Неверный пароль" });
  }
  setSession(reply);
  return { ok: true };
});

app.post("/api/auth/logout", async (_req, reply) => {
  clearSession(reply);
  return { ok: true };
});

app.get("/api/auth/me", async (req) => ({ authenticated: isAuthed(req) }));

// ---------- PROTECTED API ----------
const api = async (app: any) => {
  app.addHook("preHandler", requireAuth);

  app.get("/meta", async () => meta());

  app.get("/catalog/tree", async (req: any) => {
    const { tip, vid, grp } = req.query as Record<string, string>;
    return treeChildren({ tip, vid, grp });
  });

  app.get("/catalog/position/:id", async (req: any, reply: any) => {
    const card = positionCard(req.params.id);
    if (!card) return reply.code(404).send({ error: "Позиция не найдена" });
    return card;
  });

  app.get("/catalog/search", async (req: any) => {
    const q = (req.query.q ?? "").toString();
    if (q.trim().length < 2) return [];
    return searchPositions(q, 30);
  });

  app.get("/dashboard", async () => dashboard());

  /** Текущие разрезы (сроки годности, менеджеры, заказчики) с фильтром по типу. */
  app.get("/dashboard/breakdown", async (req: any) => {
    const tip = (req.query.tip ?? "").toString().trim();
    return breakdown(tip || undefined);
  });

  // reports
  app.get("/reports/weeks", async () => {
    const dates = (db().prepare("SELECT date FROM snapshot ORDER BY date DESC").all() as {
      date: string;
    }[]).map((r) => r.date);
    return dates;
  });
  app.get("/reports/months", async () => monthEnds().reverse());

  app.get("/reports/weekly", async (req: any) => weeklyReport(req.query.date));
  app.get("/reports/monthly", async (req: any) => monthlyReport(req.query.month));

  app.get("/reports/scope", async (req: any) => {
    const q = req.query as Record<string, string>;
    return scopeReport(
      { tip: q.tip, vid: q.vid, grp: q.grp },
      (q.kind as any) === "monthly" ? "monthly" : "weekly",
      q.period,
    );
  });

  const expiryParams = (q: Record<string, string>) => {
    const within = parseInt(q.withinDays ?? "", 10);
    return {
      tip: q.tip || undefined,
      bucket: (q.bucket as ExpiryBucketKey) || undefined,
      withinDays: Number.isFinite(within) ? within : undefined,
      limit: parseInt(q.limit ?? "", 10) || undefined,
    };
  };

  app.get("/reports/expiry", async (req: any) =>
    expiryReport(expiryParams(req.query as Record<string, string>)),
  );

  app.get("/reports/competitive", async (req: any) => {
    const q = req.query as Record<string, string>;
    return competitive({
      type: (q.type as any) ?? "category",
      id: q.id,
      tip: q.tip,
      vid: q.vid,
      grp: q.grp,
      dim: (q.dim as any) ?? "counterparty",
    });
  });

  const pdfRoute = (kind: "weekly" | "monthly") => async (req: any, reply: any) => {
    const key = kind === "weekly" ? req.query.date : req.query.month;
    const html = reportHtml(kind, key);
    try {
      const pdf = await htmlToPdf(html);
      reply
        .header("Content-Type", "application/pdf")
        .header(
          "Content-Disposition",
          `inline; filename="report-${kind}-${key ?? currentDate()}.pdf"`,
        )
        .send(pdf);
    } catch (e) {
      if (e instanceof PdfUnavailable) {
        // graceful fallback: return the printable HTML instead
        reply.header("Content-Type", "text/html; charset=utf-8").send(html);
        return;
      }
      throw e;
    }
  };
  app.get("/reports/weekly.pdf", pdfRoute("weekly"));
  app.get("/reports/monthly.pdf", pdfRoute("monthly"));

  // custom-scope PDF: category / subcategory / position
  const sendHtmlOrPdf = async (reply: any, html: string, filename: string) => {
    // HTTP headers must be ASCII: strip non-ASCII, keep a UTF-8 filename* fallback
    const ascii = filename.replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "_");
    const disposition =
      `inline; filename="${ascii}.pdf"; ` +
      `filename*=UTF-8''${encodeURIComponent(filename)}.pdf`;
    try {
      const pdf = await htmlToPdf(html);
      reply
        .header("Content-Type", "application/pdf")
        .header("Content-Disposition", disposition)
        .send(pdf);
    } catch (e) {
      if (e instanceof PdfUnavailable) {
        reply.header("Content-Type", "text/html; charset=utf-8").send(html);
        return;
      }
      throw e;
    }
  };
  app.get("/reports/scope.pdf", async (req: any, reply: any) => {
    const q = req.query as Record<string, string>;
    const html = scopeReportHtml({ tip: q.tip, vid: q.vid, grp: q.grp });
    await sendHtmlOrPdf(reply, html, `scope-${q.grp ?? q.vid ?? q.tip ?? "all"}`);
  });
  app.get("/reports/expiry.pdf", async (req: any, reply: any) => {
    const q = req.query as Record<string, string>;
    const html = expiryReportHtml(expiryParams(q));
    await sendHtmlOrPdf(reply, html, `expiry-${q.tip ?? "all"}-${q.bucket ?? "all"}`);
  });
  app.get("/reports/position.pdf", async (req: any, reply: any) => {
    const id = (req.query as any).id as string;
    const html = positionReportHtml(id);
    await sendHtmlOrPdf(reply, html, `position-${id}`);
  });
  app.get("/reports/weekly.html", async (req: any, reply: any) =>
    reply.type("text/html").send(reportHtml("weekly", req.query.date)),
  );
  app.get("/reports/monthly.html", async (req: any, reply: any) =>
    reply.type("text/html").send(reportHtml("monthly", req.query.month)),
  );

  // settings
  app.get("/settings/prices", async () => {
    const cur = currentDate();
    return db()
      .prepare(
        `SELECT pr.vid, pr.price_per_kg AS price,
                COALESCE(t.kg,0) kg, COALESCE(t.kg,0)*pr.price_per_kg AS money,
                COALESCE(t.tip,'') tip
         FROM price pr
         LEFT JOIN (
           SELECT p.vid, p.tip, SUM(f.kg) kg FROM fact f JOIN position p ON p.position_id=f.position_id
           WHERE f.date=@cur GROUP BY p.vid, p.tip
         ) t ON t.vid = pr.vid
         ORDER BY money DESC`,
      )
      .all({ cur });
  });

  app.put("/settings/prices", async (req: any) => {
    const items = (req.body?.prices ?? []) as { vid: string; price: number }[];
    const d = db();
    const updPrice = d.prepare("UPDATE price SET price_per_kg=? WHERE vid=?");
    const updFact = d.prepare(
      "UPDATE fact SET money = ROUND(kg * ?) WHERE position_id IN (SELECT position_id FROM position WHERE vid=?)",
    );
    const updBatch = d.prepare(
      "UPDATE batch SET price_per_kg=?, money = ROUND(kg * ?) WHERE position_id IN (SELECT position_id FROM position WHERE vid=?)",
    );
    d.exec("BEGIN");
    try {
      for (const it of items) {
        const price = Number(it.price);
        if (!Number.isFinite(price) || price < 0) continue;
        updPrice.run(price, it.vid);
        updFact.run(price, it.vid);
        updBatch.run(price, price, it.vid);
        repriceAggregate(it.vid, price);
      }
      d.exec("COMMIT");
    } catch (e) {
      d.exec("ROLLBACK");
      throw e;
    }
    return { ok: true, updated: items.length };
  });

  app.get("/settings/general", async () => ({
    currency: getSetting("currency", "₽"),
    expiryWarnDays: parseInt(getSetting("expiry_warn_days", "60"), 10),
    currentDate: currentDate(),
    passwordSet: true,
    uploads: fs
      .readdirSync(path.join(DATA_DIR, "uploads"))
      .filter((f) => f.endsWith(".xlsx"))
      .sort()
      .reverse(),
  }));

  app.put("/settings/general", async (req: any) => {
    const b = req.body ?? {};
    if (b.currency) setSetting("currency", String(b.currency));
    if (b.expiryWarnDays != null) setSetting("expiry_warn_days", String(parseInt(b.expiryWarnDays, 10)));
    if (b.password) setSetting("password", String(b.password));
    return { ok: true };
  });

  // ---------- ИСТОЧНИК 1С ----------

  app.get("/source/config", async () => {
    const c = sourceConfig();
    return {
      url: c.url,
      login: c.login,
      passwordSet: c.password.length > 0,
      enabled: c.enabled,
      mode: c.mode,
      hour: c.hour,
      timeoutSec: c.timeoutSec,
      retentionDays: c.retentionDays,
      schedule: scheduleState(),
      exampleUrl: buildUrl(c.url, today()),
    };
  });

  app.put("/source/config", async (req: any) => {
    const b = req.body ?? {};
    saveSourceConfig({
      url: b.url,
      login: b.login,
      // пустая строка = «не менять», null = «стереть»
      password: b.password === undefined ? undefined : b.password === null ? "" : b.password,
      enabled: b.enabled,
      mode: b.mode,
      hour: b.hour,
      timeoutSec: b.timeoutSec,
      retentionDays: b.retentionDays,
    });
    const c = sourceConfig();
    return { ok: true, exampleUrl: buildUrl(c.url, today()), schedule: scheduleState() };
  });

  /** Ручной прогон: та же логика, что у ежедневного расписания. */
  app.post("/source/check", async (req: any) => {
    const b = req.body ?? {};
    return runSync({
      date: b.date || undefined,
      mode: b.mode === "compare" || b.mode === "import" ? b.mode : undefined,
      trigger: "manual",
    });
  });

  /**
   * Сырой ответ источника без разбора и без записи — для диагностики формата.
   * Тело обрезается, чтобы не тащить в браузер многомегабайтную выгрузку.
   */
  app.get("/source/probe", async (req: any) => {
    const date = (req.query.date as string) || today();
    const limit = Math.min(parseInt((req.query.limit as string) ?? "8000", 10) || 8000, 200000);
    const r = await fetchSource(date, sourceConfig());
    let parsed: any = null;
    let parseError: string | null = null;
    if (r.ok && r.bytes > 0) {
      try {
        const p = await parseSource(r.body, r.contentType, date);
        parsed = {
          snapshotDate: p.snapshotDate,
          rows: p.rows.length,
          diag: p.diag,
          firstRows: p.rows.slice(0, 3),
        };
      } catch (e: any) {
        parseError = e?.message ?? String(e);
      }
    }
    return {
      url: r.url,
      ok: r.ok,
      httpStatus: r.httpStatus,
      contentType: r.contentType,
      bytes: r.bytes,
      durationMs: r.durationMs,
      error: r.error ?? null,
      bodyHead: r.body.length ? r.sample.slice(0, limit) : "",
      parsed,
      parseError,
    };
  });

  app.get("/source/log", async (req: any) =>
    recentLog(parseInt((req.query.limit as string) ?? "50", 10) || 50),
  );
  app.get("/source/log/:id", async (req: any, reply: any) => {
    const e = logEntry(parseInt(req.params.id, 10));
    if (!e) return reply.code(404).send({ error: "Запись журнала не найдена" });
    return e;
  });

  // ---------- ХРАНЕНИЕ И ГЛУБИНА ИСТОРИИ ----------

  app.get("/storage/stats", async () => ({
    ...storageStats(),
    retentionDays: sourceConfig().retentionDays,
  }));

  /** Сжать старую детализацию в агрегат прямо сейчас. */
  app.post("/storage/compact", async (req: any) => {
    const days = parseInt(req.body?.retentionDays ?? "", 10);
    const r = trimDetail(Number.isFinite(days) ? days : sourceConfig().retentionDays);
    db().exec("VACUUM");
    return { ok: true, ...r, stats: storageStats() };
  });

  /** Догрузить точки истории из 1С (сохраняются агрегатом, без детализации). */
  app.post("/storage/backfill", async (req: any, reply: any) => {
    const b = req.body ?? {};
    if (!b.from || !b.to) return reply.code(400).send({ error: "Укажите период from и to" });
    const step = b.step === "day" || b.step === "week" ? b.step : "month";
    const max = Math.min(parseInt(b.maxPoints ?? "24", 10) || 24, 120);
    return backfillRange(String(b.from), String(b.to), step, max);
  });

  app.post("/settings/import", async (req: any, reply: any) => {
    const file = await req.file();
    if (!file) return reply.code(400).send({ error: "Файл не получен" });
    const safe = file.filename.replace(/[^\w.\-]/g, "_");
    const dest = path.join(DATA_DIR, "uploads", `${Date.now()}_${safe}`);
    await pipeline(file.file, fs.createWriteStream(dest));
    try {
      const res = await importExcel(dest);
      const ing = ingestSnapshot(res);
      writeAggregate(ing.date);
      const trimmed = trimDetail(sourceConfig().retentionDays);
      return {
        ok: true,
        date: ing.date,
        positions: ing.positions,
        rows: res.rows.length,
        compacted: trimmed.aggregated.length,
      };
    } catch (e: any) {
      return reply.code(400).send({ error: e?.message ?? "Ошибка импорта" });
    }
  });
};

await app.register(api, { prefix: "/api" });

// ---------- STATIC SPA ----------
if (fs.existsSync(WEB_DIST)) {
  await app.register(fstatic, { root: WEB_DIST, wildcard: true });
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith("/api/")) return reply.code(404).send({ error: "not found" });
    return reply.sendFile("index.html");
  });
} else {
  app.get("/", async (_req, reply) =>
    reply
      .type("text/html")
      .send(
        `<h2>Складской дашборд — API запущен</h2><p>Фронтенд не собран. Выполните <code>npm run build</code> или запустите dev-режим (<code>npm run dev</code>).</p><p>Пароль по умолчанию: <b>${defaultPassword()}</b></p>`,
      ),
  );
}

await startLicense((m) => app.log.info(m));
startSync((m) => app.log.info(m));

app
  .listen({ port: PORT, host: HOST })
  .then(() => app.log.info(`Складской дашборд на http://${HOST}:${PORT}`))
  .catch((e) => {
    app.log.error(e);
    process.exit(1);
  });
