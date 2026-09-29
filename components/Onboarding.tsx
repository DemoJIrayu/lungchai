"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Liff } from "@line/liff";
import { ROLES, registrationSchema, fieldErrors, type ErrCode, type RoleId } from "@/lib/schema";
import { T, type Lang } from "@/lib/i18n";
import Turnstile from "./Turnstile";

const LIFF_ID = process.env.NEXT_PUBLIC_LIFF_ID ?? "";
const OA = process.env.NEXT_PUBLIC_LINE_OA_ID || "@379iftpg";
const TURNSTILE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? "";
const PRIVACY_URL = process.env.NEXT_PUBLIC_PRIVACY_URL || "#";

const OA_BASIC = OA.replace(/^@/, "");
const ADD_FRIEND_URL = `https://line.me/R/ti/p/@${OA_BASIC}`;
const QR_URL = `https://qr-official.line.me/gs/M_${OA_BASIC}_GW.png?oat_content=qr`;

type Phase = "boot" | "outside" | "bootError" | "notFriend" | "form" | "done";
type Company = { id: string; name: string };
type CompanyState = { status: "loading" } | { status: "error" } | { status: "ok"; list: Company[] };

type Form = {
  companyId: string; nameTh: string; nameEn: string; phone: string; email: string;
  role: RoleId; pdpa: boolean;
};
const EMPTY: Form = { companyId: "", nameTh: "", nameEn: "", phone: "", email: "", role: "user", pdpa: false };
const ORDER = ["companyId", "nameTh", "nameEn", "phone", "email", "role", "pdpa"] as const;

const fmtPhone = (d: string) => [d.slice(0, 3), d.slice(3, 6), d.slice(6, 10)].filter(Boolean).join("-");

function toPayload(f: Form, lang: Lang) {
  return { ...f, pdpa: f.pdpa ? (true as const) : undefined, lang };
}

export default function Onboarding() {
  const [lang, setLang] = useState<Lang>("th");
  const t = T[lang];
  const [phase, setPhase] = useState<Phase>("boot");
  const [displayName, setDisplayName] = useState("");
  const [f, setF] = useState<Form>(EMPTY);
  const [tried, setTried] = useState(false);
  const [sending, setSending] = useState(false);
  const [srvMsg, setSrvMsg] = useState("");
  const [srvFieldErr, setSrvFieldErr] = useState<Record<string, ErrCode>>({});
  const [captcha, setCaptcha] = useState<string | null>(null);
  const [captchaReset, setCaptchaReset] = useState(0);
  const [requestNo, setRequestNo] = useState("");
  const [checkingFriend, setCheckingFriend] = useState(false);
  const [companies, setCompanies] = useState<CompanyState>({ status: "loading" });
  const liffRef = useRef<Liff | null>(null);
  const preview = useRef(false);
  const alertRef = useRef<HTMLDivElement>(null);

  const idToken = () => (preview.current ? "preview-token" : liffRef.current?.getIDToken() ?? null);

  // ---------- LIFF boot ----------
  const checkFriend = useCallback(async () => {
    const liff = liffRef.current;
    if (!liff) return;
    setCheckingFriend(true);
    try {
      const { friendFlag } = await liff.getFriendship();
      setPhase(friendFlag ? "form" : "notFriend");
    } catch {
      // If the friendship check itself fails, don't block registration.
      setPhase("form");
    } finally {
      setCheckingFriend(false);
    }
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("lang") === "en") setLang("en");

    // Local browser test without LINE (never in production builds).
    if (process.env.NODE_ENV !== "production" && params.get("preview") === "1") {
      preview.current = true;
      setDisplayName("Test");
      setPhase("form");
      return;
    }

    let alive = true;
    (async () => {
      try {
        const liff = (await import("@line/liff")).default;
        await liff.init({ liffId: LIFF_ID });
        if (!alive) return;
        liffRef.current = liff;

        if (!liff.isInClient()) { setPhase("outside"); return; }
        if (!liff.isLoggedIn()) { liff.login(); return; }

        if (!params.get("lang") && liff.getLanguage()?.toLowerCase().startsWith("en")) setLang("en");
        try {
          const p = await liff.getProfile();
          if (alive) setDisplayName(p.displayName);
        } catch { /* name is only cosmetic */ }
        await checkFriend();
      } catch {
        if (alive) setPhase("bootError");
      }
    })();
    return () => { alive = false; };
  }, [checkFriend]);

  // ---------- Company list (from Companies_DB, via the server) ----------
  const loadCompanies = useCallback(async () => {
    const token = idToken();
    if (!token) { setCompanies({ status: "error" }); return; }
    setCompanies({ status: "loading" });
    try {
      const res = await fetch("/api/companies", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
      const body = await res.json();
      if (!res.ok || !Array.isArray(body.companies)) throw new Error();
      setCompanies({ status: "ok", list: body.companies });
    } catch {
      setCompanies({ status: "error" });
    }
  }, []);

  useEffect(() => {
    if (phase === "form" && companies.status === "loading") loadCompanies();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  const companyName = companies.status === "ok"
    ? companies.list.find((c) => c.id === f.companyId)?.name ?? ""
    : "";

  // ---------- Validation (same schema as the server) ----------
  const errors = useMemo<Record<string, ErrCode>>(() => {
    if (!tried) return {};
    const r = registrationSchema.safeParse(toPayload(f, lang));
    return { ...srvFieldErr, ...(r.success ? {} : fieldErrors(r.error)) };
  }, [f, lang, tried, srvFieldErr]);
  const errCount = Object.keys(errors).length;
  const errText = (k: string) => (errors[k] ? t.e[errors[k]] : "");

  const set = <K extends keyof Form>(k: K, v: Form[K]) => {
    setF((s) => ({ ...s, [k]: v }));
    if (srvFieldErr[k]) setSrvFieldErr(({ [k]: _drop, ...rest }) => rest);
  };

  // ---------- Submit ----------
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setTried(true);
    setSrvMsg("");

    const parsed = registrationSchema.safeParse(toPayload(f, lang));
    if (!parsed.success) {
      const first = ORDER.find((k) => fieldErrors(parsed.error)[k]);
      document.getElementById(first === "role" ? "role-group" : first ?? "")?.focus();
      alertRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    if (TURNSTILE_KEY && !captcha) { setSrvMsg(t.captchaWait); return; }

    const token = idToken();
    if (!token) { setSrvMsg(t.srv.line_auth); return; }

    setSending(true);
    try {
      const res = await fetch("/api/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...parsed.data, idToken: token, turnstileToken: captcha ?? "missing" }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok && body.requestNo) {
        setRequestNo(body.requestNo);
        setPhase("done");
        window.scrollTo({ top: 0 });
        return;
      }
      switch (body.error) {
        case "invalid":
          // e.g. the company was removed from Companies_DB after the page loaded
          setSrvFieldErr(body.fields ?? {});
          if (body.fields?.companyId) loadCompanies();
          break;
        case "captcha": setSrvMsg(t.srv.captcha); break;
        case "line_auth": setSrvMsg(t.srv.line_auth); break;
        case "duplicate": setSrvMsg(t.srv.duplicate(body.requestNo ?? "")); break;
        default: setSrvMsg(t.srv.server);
      }
    } catch {
      setSrvMsg(t.srv.network);
    } finally {
      setSending(false);
      setCaptchaReset((n) => n + 1); // Turnstile tokens are single-use
    }
  }

  // ---------- Render ----------
  const header = (
    <header className="top">
      <div className="top-inner">
        <div className="brand">
          <div className="brand-left">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.png" alt="" />
            <span>ลุงชัย Fleet</span>
          </div>
          <div className="lang" role="group" aria-label="Language">
            <button type="button" aria-pressed={lang === "th"} onClick={() => setLang("th")}>TH</button>
            <button type="button" aria-pressed={lang === "en"} onClick={() => setLang("en")}>EN</button>
          </div>
        </div>
        {phase === "done" ? (
          <>
            <span className="kicker">{t.doneKicker}</span>
            <h1>{t.doneTitle(f.nameTh || displayName)}</h1>
          </>
        ) : (
          <>
            <span className="kicker">{t.kicker}</span>
            <h1>{t.heroTitle}</h1>
            <p>{t.heroBody}</p>
          </>
        )}
      </div>
    </header>
  );

  if (phase === "boot") {
    return (<>{header}<main className="wrap"><div className="card center"><div className="spinner" aria-hidden /><p>{t.loading}</p></div></main></>);
  }

  if (phase === "outside" || phase === "bootError") {
    return (
      <>{header}
        <main className="wrap">
          <div className="card center">
            <h2>{phase === "outside" ? t.outsideTitle : t.bootError}</h2>
            {phase === "outside" && (
              <>
                <p>{t.outsideBody(OA)}</p>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img className="qr" src={QR_URL} alt={`QR ${OA}`} />
                <a className="btn line" href={ADD_FRIEND_URL}>{t.friendBtn(OA)}</a>
              </>
            )}
          </div>
        </main>
      </>
    );
  }

  if (phase === "notFriend") {
    return (
      <>{header}
        <main className="wrap">
          <div className="card center">
            <h2>{t.friendTitle}</h2>
            <p>{t.friendBody(OA)}</p>
            <a className="btn line block" href={ADD_FRIEND_URL}>{t.friendBtn(OA)}</a>
            <span className="small">{t.qr}</span>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="qr" src={QR_URL} alt={`QR ${OA}`} />
            <button type="button" className="btn ghost block" onClick={checkFriend} disabled={checkingFriend}>
              {checkingFriend ? "…" : t.friendRecheck}
            </button>
          </div>
        </main>
      </>
    );
  }

  if (phase === "done") {
    const role = ROLES.find((r) => r.id === f.role)!;
    return (
      <>{header}
        <main className="wrap">
          <div className="card">
            <p>{t.doneBody}</p>
            <div>
              <div className="small">{t.refLbl}</div>
              <div className="ref">{requestNo}</div>
            </div>
            <ol className="steps">
              {t.steps.map((s, i) => <li key={s} className={i === 0 ? "on" : ""}>{s}</li>)}
            </ol>
            <div>
              <h3 style={{ fontSize: 16, marginBottom: 10 }}>{t.summary}</h3>
              <dl className="sum">
                <dt>{t.k.company}</dt><dd>{companyName}</dd>
                <dt>{t.k.name}</dt><dd>{f.nameTh}<br />{f.nameEn}</dd>
                <dt>{t.k.phone}</dt><dd>{fmtPhone(f.phone)}</dd>
                <dt>{t.k.email}</dt><dd>{f.email}</dd>
                <dt>{t.k.role}</dt><dd>{role[lang]}</dd>
              </dl>
            </div>
            {liffRef.current?.isInClient() && (
              <button type="button" className="btn ghost block" onClick={() => liffRef.current?.closeWindow()}>{t.close}</button>
            )}
          </div>
        </main>
      </>
    );
  }

  // phase === "form"
  const companyErr = errText("companyId");
  return (
    <>{header}
      <main className="wrap">
        {preview.current && (
          <div className="alert" role="note">
            TEST MODE (localhost only): LINE is skipped and a fake TEST- user is used. Nothing is sent to LINE.
          </div>
        )}
        {displayName && !preview.current && <div className="note">{t.hello(displayName)}</div>}
        <form className="card" onSubmit={submit} noValidate>
          <div className="card-head">
            <h2>{t.formTitle}</h2>
            <span className="small"><span className="req">*</span> {t.reqNote}</span>
          </div>

          <div ref={alertRef} aria-live="polite">
            {errCount > 0 && <div className="alert" role="alert">{t.errSummary(errCount)}</div>}
          </div>

          <fieldset>
            <legend><span className="num">01</span><span className="ttl">{t.sec1}</span></legend>
            <div className="field">
              <label htmlFor="companyId">{t.company} <span className="req">*</span></label>
              {companies.status === "error" ? (
                <div className="row">
                  <span className="err">{t.companyLoadErr}</span>
                  <button type="button" className="btn ghost" onClick={loadCompanies}>{t.retry}</button>
                </div>
              ) : (
                <select
                  id="companyId" className="input select"
                  value={f.companyId}
                  onChange={(e) => set("companyId", e.target.value)}
                  disabled={companies.status === "loading"}
                  aria-invalid={!!companyErr} aria-describedby={companyErr ? "companyId-err" : "companyId-hint"}
                >
                  <option value="">{companies.status === "loading" ? t.companyLoading : t.companyPh}</option>
                  {companies.status === "ok" && companies.list.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              )}
              {companyErr && <span id="companyId-err" className="err">{companyErr}</span>}
              <span id="companyId-hint" className="small">{t.companyMissing(OA)}</span>
            </div>
          </fieldset>

          <fieldset>
            <legend><span className="num">02</span><span className="ttl">{t.sec2}</span></legend>
            <div className="grid2">
              <TextField id="nameTh" label={t.nameTh} ph={t.nameThPh} value={f.nameTh} err={errText("nameTh")} onChange={(v) => set("nameTh", v)} autoComplete="name" required />
              <TextField id="nameEn" label={t.nameEn} ph={t.nameEnPh} value={f.nameEn} err={errText("nameEn")} onChange={(v) => set("nameEn", v)} required />
            </div>
          </fieldset>

          <fieldset>
            <legend><span className="num">03</span><span className="ttl">{t.sec3}</span></legend>
            <div className="grid2">
              <TextField id="phone" label={t.phone} ph="08X-XXX-XXXX" value={fmtPhone(f.phone)} err={errText("phone")}
                onChange={(v) => set("phone", v.replace(/\D/g, "").slice(0, 10))} type="tel" inputMode="numeric" autoComplete="tel" required />
              <TextField id="email" label={t.email} ph="name@company.co.th" value={f.email} err={errText("email")}
                onChange={(v) => set("email", v)} type="email" autoComplete="email" required />
            </div>
          </fieldset>

          <fieldset>
            <legend><span className="num">04</span><span className="ttl">{t.sec4}</span></legend>
            <div className="choices" role="radiogroup" id="role-group" tabIndex={-1} aria-label={t.sec4}>
              {ROLES.map((r) => (
                <button key={r.id} type="button" role="radio" aria-checked={f.role === r.id} className="choice" onClick={() => set("role", r.id)}>
                  <span className="dot" aria-hidden />
                  <span className="choice-body">
                    <span className="choice-title">{r[lang]}</span>
                    <span className="choice-sub">{lang === "th" ? r.dth : r.den}</span>
                  </span>
                </button>
              ))}
            </div>
            <span className="small">{t.roleNote}</span>
          </fieldset>

          <fieldset>
            <legend><span className="num">05</span><span className="ttl">{t.sec5}</span></legend>
            <label className="consent">
              <input id="pdpa" type="checkbox" checked={f.pdpa} onChange={(e) => set("pdpa", e.target.checked)} aria-invalid={!!errors.pdpa} />
              <span>{t.pdpa} <a href={PRIVACY_URL} target="_blank" rel="noreferrer">{t.pdpaLink}</a> <span className="req">*</span></span>
            </label>
            {errors.pdpa && <span className="err">{errText("pdpa")}</span>}

            {TURNSTILE_KEY && <Turnstile siteKey={TURNSTILE_KEY} lang={lang} onToken={setCaptcha} resetKey={captchaReset} />}

            {srvMsg && <div className="alert" role="alert">{srvMsg}</div>}

            <button type="submit" className="btn block" disabled={sending}>{sending ? t.sending : t.submit}</button>
            <span className="small">{t.afterNote}</span>
          </fieldset>
        </form>
      </main>
    </>
  );
}

function TextField(props: {
  id: string; label: string; ph: string; value: string; err: string; onChange: (v: string) => void;
  required?: boolean; optional?: string; type?: string; inputMode?: "numeric" | "text"; autoComplete?: string;
}) {
  const errId = `${props.id}-err`;
  return (
    <div className="field">
      <label htmlFor={props.id}>
        {props.label} {props.required && <span className="req">*</span>}
        {props.optional && <span className="small"> ({props.optional})</span>}
      </label>
      <input
        id={props.id} className="input" type={props.type ?? "text"} inputMode={props.inputMode}
        autoComplete={props.autoComplete} placeholder={props.ph} value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        aria-invalid={!!props.err} aria-describedby={props.err ? errId : undefined}
      />
      {props.err && <span id={errId} className="err">{props.err}</span>}
    </div>
  );
}
