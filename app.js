// ─── Retra · Roket (web) ────────────────────────────────────────────────────
// Canlı "crash" oyunu: herkes aynı turda. Tur döngüsü, patlama anı, bahis ve
// çekilme **sunucuda** (rocket_state / rocket_bet / rocket_cashout); canlı
// oyuncu listesi ve uzun geçmiş `rocket_live` (supabase_faz82_roket_web.sql).
// Bu sayfa yalnız durumu gösterir, isteği iletir ve 3D sahneyi oynatır.
//
// Uygulama içinde `?app=1` ile açılır: oturum adresin `#` kısmından gelir,
// giriş ekranı çizilmez. `?demo=1` sunucusuz deneme modudur.

const SUPABASE = {
  url: 'https://mwjyppehzqobmcrsmxlj.supabase.co',
  anonKey:
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im13anlwcGVoenFvYm1jcnNteGxqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAxODYxOTksImV4cCI6MjEwNTc2MjE5OX0.OWXeMWkfzwftIJXGR4Pkr66mBq4IB5u6vM9T7I7Nx-0',
};
const SUPABASE_JS = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';

const MIN_BET = 10;
const MAX_BET = 1000000;
const CHIPS = [10, 50, 100, 500, 1000, 5000, 10000, 50000, 100000, 500000, 1000000];
/** Kalkışa bu kadar saniye kala bahisler kapanır ve sahne tam ekrana geçer. */
const LOCK_SECONDS = 3;
/** Patlamadan sonra sonucun tam ekranda kalma süresi (ms). */
const CRASH_HOLD_MS = 1900;

const params = new URLSearchParams(location.search);
const APP_MODE = params.get('app') === '1';
const DEMO = params.get('demo') === '1';

// ─── Yardımcılar ───────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);
const fmt = (n) => Math.max(0, Math.round(Number(n) || 0)).toLocaleString('tr-TR');
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
function short(n) {
  n = Number(n) || 0;
  if (n >= 1e6) return `${+(n / 1e6).toFixed(n % 1e6 ? 1 : 0)}M`;
  if (n >= 1e3) return `${+(n / 1e3).toFixed(n % 1e3 && n < 1e4 ? 1 : 0)}K`;
  return String(n);
}
const fx = (m) => `${(Number(m) || 1).toFixed(2)}x`;
const tierOf = (m) => (m >= 10 ? 'mega' : m >= 3 ? 'hi' : m >= 1.6 ? 'mid' : 'low');
const pillClass = (m) => (m <= 1.0 ? 'c-boom' : `c-${tierOf(m)}`);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function notifyApp(msg) {
  try { window.RetraGame?.postMessage(msg); } catch { /* köprü yok */ }
}

const ERRORS = [
  ['Yetersiz kristal', 'Kristal bakiyen yetersiz.'],
  ['En az 10', 'En az 10 kristal oynamalısın.'],
  ['en fazla 1000000', 'Bahis en fazla 1.000.000 kristal.'],
  ['Bahisler kapandi', 'Bahisler kapandı, roket kalkıyor · bahsin sonraki tura alındı.'],
  ['havalandi', 'Roket havalandı, bahsin sonraki tura alındı.'],
  ['patladi, cekilme', 'Çok geç! Roket patladı.'],
  ['patladi', 'Roket patladı, sonraki turu bekle.'],
  ['henuz havalanmadi', 'Roket henüz havalanmadı.'],
  ['Zaten cekildin', 'Bu turda zaten çekildin.'],
  ['bahsin yok', 'Bu turda bahsin yok.'],
  ['Giris yapmalisiniz', 'Oturum bulunamadı.'],
  ['AUTH_REQUIRED', 'Oturum bulunamadı.'],
];
function errorText(e) {
  const t = `${e?.message ?? ''} ${e?.details ?? ''}`;
  for (const [k, v] of ERRORS) if (t.includes(k)) return v;
  if (t.includes('rocket_live')) return 'Sunucu kurulumu eksik (SQL bölüm FAZ 82).';
  if (/failed to fetch|network|timeout|load failed/i.test(t)) return 'Bağlantı yeniden kuruluyor…';
  return 'İşlem yapılamadı, tekrar dene.';
}

// ─── Ses (dosya yok, tarayıcıda üretilir) ──────────────────────────────────
const Sound = {
  ctx: null, on: true, engine: null,
  init() { try { this.on = localStorage.getItem('roket_sound') !== '0'; } catch { /* yok */ } },
  unlock() {
    try {
      if (!this.ctx) this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      if (this.ctx.state === 'suspended') this.ctx.resume();
    } catch { this.ctx = null; }
  },
  toggle() {
    this.on = !this.on;
    try { localStorage.setItem('roket_sound', this.on ? '1' : '0'); } catch { /* yok */ }
    if (!this.on) this.stopEngine();
    return this.on;
  },
  tone(freq, dur, type = 'sine', vol = 0.08, delay = 0) {
    if (!this.on || !this.ctx) return;
    const t = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.ctx.destination);
    o.start(t); o.stop(t + dur + 0.02);
  },
  noise(dur, vol, freq = 800, q = 0.7, delay = 0) {
    if (!this.on || !this.ctx) return;
    const t = this.ctx.currentTime + delay;
    const len = Math.floor(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = freq; f.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.value = vol;
    src.connect(f).connect(g).connect(this.ctx.destination);
    src.start(t);
  },
  click() { this.tone(880, 0.06, 'triangle', 0.05); },
  tick(last) { this.tone(last ? 1320 : 990, 0.09, 'square', 0.04); },
  bet() { this.tone(660, 0.08, 'triangle', 0.06); this.tone(990, 0.1, 'triangle', 0.05, 0.06); },
  cash() { [784, 988, 1175, 1568].forEach((f, i) => this.tone(f, 0.22, 'triangle', 0.08, i * 0.07)); },
  boom() { this.noise(1.2, 0.5, 600, 0.5); this.tone(70, 0.8, 'sine', 0.25); this.tone(45, 1.1, 'sine', 0.2, 0.05); },
  lose() { this.tone(300, 0.2, 'sine', 0.05, 0.4); this.tone(200, 0.3, 'sine', 0.05, 0.55); },
  startEngine() {
    if (!this.on || !this.ctx || this.engine) return;
    try {
      const len = this.ctx.sampleRate * 2;
      const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      const src = this.ctx.createBufferSource();
      src.buffer = buf; src.loop = true;
      const f = this.ctx.createBiquadFilter();
      f.type = 'lowpass'; f.frequency.value = 220; f.Q.value = 1.2;
      const g = this.ctx.createGain();
      g.gain.value = 0.0001;
      g.gain.exponentialRampToValueAtTime(0.16, this.ctx.currentTime + 0.6);
      src.connect(f).connect(g).connect(this.ctx.destination);
      src.start();
      this.engine = { src, f, g };
    } catch { this.engine = null; }
  },
  engineMult(m) {
    if (!this.engine || !this.ctx) return;
    this.engine.f.frequency.setTargetAtTime(220 + Math.log(Math.max(1, m)) * 420, this.ctx.currentTime, 0.2);
  },
  stopEngine() {
    if (!this.engine || !this.ctx) return;
    const { src, g } = this.engine;
    try { g.gain.setTargetAtTime(0.0001, this.ctx.currentTime, 0.08); src.stop(this.ctx.currentTime + 0.4); } catch { /* yok */ }
    this.engine = null;
  },
};

// ─── Oturum ────────────────────────────────────────────────────────────────
function readInjectedSession() {
  const d = window.__RETRA_SUPABASE_SESSION__;
  if (d?.access_token && d?.refresh_token) return d;
  for (const raw of [location.hash.slice(1), location.search.slice(1)]) {
    if (!raw) continue;
    const p = new URLSearchParams(raw);
    if (p.get('access_token') && p.get('refresh_token')) {
      return { access_token: p.get('access_token'), refresh_token: p.get('refresh_token') };
    }
  }
  return null;
}
function clearTokensFromUrl() {
  try {
    const u = new URL(location.href);
    if (u.hash.includes('access_token')) { u.hash = ''; history.replaceState(null, '', u.toString()); }
  } catch { /* yok */ }
}

// ─── Sunucu motoru ─────────────────────────────────────────────────────────
class LiveEngine {
  constructor(client) { this.client = client; }

  async connect() {
    let session = null;
    const injected = readInjectedSession();
    if (injected) {
      try {
        const { data, error } = await this.client.auth.setSession(injected);
        if (!error) { session = data.session; clearTokensFromUrl(); }
      } catch { /* yok */ }
    }
    if (!session) {
      try { session = (await this.client.auth.getSession()).data.session; } catch { session = null; }
    }
    return !!session;
  }

  async signIn(email, password) {
    const { error } = await this.client.auth.signInWithPassword({ email, password });
    if (error) return false;
    return this.connect();
  }

  async rpc(fn, args) {
    let { data, error } = await this.client.rpc(fn, args);
    if (error && /jwt|token|401|pgrst30/i.test(`${error.message} ${error.code}`)) {
      try { await this.client.auth.refreshSession(); } catch { /* yok */ }
      ({ data, error } = await this.client.rpc(fn, args));
    }
    if (error) throw error;
    return data;
  }

  live() { return this.rpc('rocket_live'); }
  bet(amount) { return this.rpc('rocket_bet', { p_amount: amount }); }
  cashout() { return this.rpc('rocket_cashout'); }
}

// ─── Demo motoru (sunucusuz) ───────────────────────────────────────────────
class DemoEngine {
  constructor() {
    this.growth = 0.09; this.betS = 12; this.gapS = 5;
    this.balance = 250000;
    this.round = 1000;
    this.history = Array.from({ length: 40 }, () => this.#crash());
    this.names = ['Ayşe', 'Mert', 'Zeynep', 'Kaan', 'Elif', 'Deniz', 'Burak', 'Selin', 'Emre', 'Ece', 'Can', 'Derya'];
    this.#newRound(Date.now());
  }
  #crash() {
    const r = Math.random();
    return Math.max(1, Math.min(200, Math.round(((1 - 0.03) / (1 - r)) * 100) / 100));
  }
  #newRound(start) {
    this.round += 1;
    this.start = start;
    this.betEnds = start + this.betS * 1000;
    this.crashMult = this.#crash();
    this.flight = this.crashMult <= 1 ? 0 : Math.log(this.crashMult) / this.growth;
    this.crashAt = this.betEnds + this.flight * 1000;
    this.my = null;
    this.bots = this.names.filter(() => Math.random() < 0.7).map((name) => ({
      name, amount: [50, 100, 500, 1000, 5000, 10000][Math.floor(Math.random() * 6)],
      target: 1.1 + Math.random() * Math.random() * 6, joinAt: start + Math.random() * this.betS * 900,
      cashout: null, payout: 0,
    }));
  }
  #tick() {
    const now = Date.now();
    if (now >= this.crashAt + this.gapS * 1000) {
      this.history.unshift(this.crashMult);
      this.history.length = 40;
      this.#newRound(this.crashAt + this.gapS * 1000);
    }
    return now;
  }
  #mult(now) { return Math.max(1, Math.exp(this.growth * Math.max(0, (now - this.betEnds) / 1000))); }
  async live() {
    await new Promise((r) => setTimeout(r, 60));
    const now = this.#tick();
    const phase = now < this.betEnds ? 'betting' : now < this.crashAt ? 'flying' : 'crashed';
    const m = phase === 'flying' ? this.#mult(now) : 1;
    for (const b of this.bots) {
      if (phase !== 'betting' && !b.cashout && b.target < this.crashMult && (phase === 'crashed' || m >= b.target)) {
        b.cashout = Math.round(b.target * 100) / 100; b.payout = Math.round(b.amount * b.cashout);
      }
    }
    const bots = this.bots.filter((b) => b.joinAt <= now);
    const bets = [
      ...(this.my ? [{ name: 'Demo', avatar: '', amount: this.my.amount, cashout: this.my.cashout, payout: this.my.payout, me: true }] : []),
      ...bots.map((b) => ({ name: b.name, avatar: '', amount: b.amount, cashout: b.cashout, payout: b.payout, me: false }))
        .sort((a, b) => (b.cashout ?? 0) - (a.cashout ?? 0) || b.amount - a.amount),
    ];
    return {
      round_no: this.round, phase,
      seconds_left: phase === 'betting' ? Math.ceil((this.betEnds - now) / 1000) : phase === 'crashed' ? Math.ceil((this.crashAt + this.gapS * 1000 - now) / 1000) : 0,
      phase_ends_at: phase === 'betting' ? new Date(this.betEnds).toISOString() : null,
      elapsed: phase === 'flying' ? (now - this.betEnds) / 1000 : 0,
      server_ms: now, mult: phase === 'crashed' ? this.crashMult : m,
      crash_mult: phase === 'crashed' ? this.crashMult : null,
      bet_seconds: this.betS, gap_seconds: this.gapS, growth: this.growth,
      pot: bets.reduce((s, b) => s + b.amount, 0), players: bets.length, winners: bets.filter((b) => b.cashout).length,
      my_bet: this.my?.amount ?? 0, my_cashout: this.my?.cashout ?? null, my_payout: this.my?.payout ?? 0,
      balance: this.balance, bets,
      history_long: this.history.map((c, i) => ({ round_no: this.round - 1 - i, crash_mult: c })),
    };
  }
  async bet(amount) {
    const now = this.#tick();
    if (now >= this.betEnds) throw new Error(now < this.crashAt ? 'Roket havalandi' : 'Roket patladi');
    if (this.betEnds - now <= LOCK_SECONDS * 1000) throw new Error('Bahisler kapandi');
    if (amount > this.balance) throw new Error('Yetersiz kristal');
    this.balance -= amount;
    this.my = this.my ? { ...this.my, amount: this.my.amount + amount } : { amount, cashout: null, payout: 0 };
    return this.live();
  }
  async cashout() {
    const now = this.#tick();
    if (now < this.betEnds) throw new Error('Roket henuz havalanmadi');
    if (now >= this.crashAt) throw new Error('Roket patladi, cekilme cok gec');
    if (!this.my) throw new Error('Bu turda bahsin yok');
    if (this.my.cashout) throw new Error('Zaten cekildin');
    const m = Math.round(this.#mult(now) * 100) / 100;
    this.my.cashout = m; this.my.payout = Math.round(this.my.amount * m);
    this.balance += this.my.payout;
    return this.live();
  }
}

// ─── Eğri grafiği (sahnenin üstünde yarı saydam) ───────────────────────────
class Graph {
  constructor(canvas) { this.c = canvas; this.g = canvas.getContext('2d'); this.resize(); }
  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.w = this.c.clientWidth; this.h = this.c.clientHeight;
    this.c.width = Math.round(this.w * dpr); this.c.height = Math.round(this.h * dpr);
    this.g.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  clear() { this.g.clearRect(0, 0, this.w, this.h); }
  draw(t, m, growth, crashed) {
    const g = this.g;
    this.clear();
    if (t <= 0) return;
    const L = 34, B = 34, W = this.w * 0.62, H = this.h * 0.38;
    const x0 = L, y0 = this.h - B;
    const maxT = Math.max(6, t * 1.12);
    const maxM = Math.max(2, m * 1.15);
    const X = (tt) => x0 + (tt / maxT) * W;
    const Y = (mm) => y0 - ((mm - 1) / (maxM - 1)) * H;
    // ızgara
    g.font = '700 10px Inter, sans-serif';
    g.fillStyle = 'rgba(255,255,255,.55)';
    g.strokeStyle = 'rgba(255,255,255,.08)';
    g.lineWidth = 1;
    const steps = [1, 1.5, 2, 3, 5, 10, 20, 50, 100, 200, 500];
    let lastY = Infinity;
    for (const s of steps) {
      if (s > maxM) break;
      const y = Y(s);
      if (lastY - y < 16) continue; // etiketler üst üste binmesin
      lastY = y;
      g.beginPath(); g.moveTo(x0, y); g.lineTo(x0 + W, y); g.stroke();
      g.fillText(`${s}x`, 4, y + 3);
    }
    // eğri
    const color = crashed ? '#ff4d6a' : m >= 10 ? '#ffcf5a' : m >= 3 ? '#2fe08a' : m >= 1.6 ? '#4fd6ff' : '#a98bff';
    g.beginPath();
    const N = 60;
    for (let i = 0; i <= N; i++) {
      const tt = (t * i) / N;
      const mm = Math.exp(growth * tt);
      const x = X(tt), y = Y(Math.min(mm, m));
      if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
    }
    const tipX = X(t), tipY = Y(m);
    g.save();
    g.shadowColor = color; g.shadowBlur = 12;
    g.strokeStyle = color; g.lineWidth = 3; g.lineCap = 'round';
    g.stroke();
    g.restore();
    g.lineTo(tipX, y0); g.lineTo(x0, y0); g.closePath();
    const grd = g.createLinearGradient(0, tipY, 0, y0);
    grd.addColorStop(0, `${color}55`); grd.addColorStop(1, `${color}00`);
    g.fillStyle = grd; g.fill();
    g.beginPath(); g.arc(tipX, tipY, 4.5, 0, Math.PI * 2);
    g.fillStyle = '#fff'; g.shadowColor = color; g.shadowBlur = 14; g.fill(); g.shadowBlur = 0;
  }
}

// ─── Oyun ──────────────────────────────────────────────────────────────────
class Game {
  constructor(engine) {
    this.engine = engine;
    this.s = null;              // son sunucu durumu
    this.round = 0;
    this.phase = '';
    this.flightStart = 0;       // uçuşun başladığı an (yerel saat, ms)
    this.betEndsLocal = 0;
    this.offset = 0;            // sunucu saati - yerel saat (ms)
    this.amount = 100;
    this.queued = 0;            // sonraki tura sıradaki bahis
    this.busy = false;
    this.cashing = false;
    this.auto = false;
    this.autoAt = 2;
    this.balance = 0;
    this.prevBets = new Map();
    this.lastTick = 99;
    this.histShown = '';
    this.ready = false;
    this.focus = false;         // odak kipi (son 3 sn + uçuş + patlama anı)
    this.crashAtLocal = 0;
    this.scene = null;
    this.graph = new Graph($('graph'));
    this.#restore();
    this.#bindUi();
    this.#renderChips();
    this.#renderAmount();
    requestAnimationFrame(this.loop);
    window.addEventListener('resize', () => { this.scene?.resize(); this.graph.resize(); });
    // Sahne büyüyüp küçülürken (odak kipi) tuval her karede doğru ölçüde kalsın.
    try {
      new ResizeObserver(() => { this.scene?.resize(); this.graph.resize(); }).observe($('stage'));
    } catch { /* eski tarayıcı */ }
  }

  async init3d() {
    try {
      const mod = await import('./scene.js');
      this.scene = new mod.RocketScene($('scene'));
    } catch (e) {
      console.warn('3D sahne açılamadı', e);
      this.scene = null;
    }
  }

  #restore() {
    try {
      const a = Number(localStorage.getItem('roket_amount'));
      if (a >= MIN_BET && a <= MAX_BET) this.amount = a;
      this.auto = localStorage.getItem('roket_auto') === '1';
      const t = Number(localStorage.getItem('roket_auto_at'));
      if (t >= 1.01 && t <= 1000) this.autoAt = t;
    } catch { /* yok */ }
    $('auto-on').checked = this.auto;
    $('auto-v').textContent = fx(this.autoAt);
  }
  #save() {
    try {
      localStorage.setItem('roket_amount', String(this.amount));
      localStorage.setItem('roket_auto', this.auto ? '1' : '0');
      localStorage.setItem('roket_auto_at', String(this.autoAt));
    } catch { /* yok */ }
  }

  #bindUi() {
    const unlock = () => Sound.unlock();
    document.addEventListener('pointerdown', unlock, { passive: true });
    $('btn-sound').onclick = () => { $('btn-sound').textContent = Sound.toggle() ? '🔊' : '🔈'; };
    $('btn-sound').textContent = Sound.on ? '🔊' : '🔈';
    $('btn-help').onclick = () => this.#open('help-modal');
    $('hist-more').onclick = () => this.#openHistory();
    $('history').onclick = () => this.#openHistory();
    $('sheet-back').onclick = () => this.#closeModals();
    for (const b of document.querySelectorAll('[data-close]')) b.onclick = () => this.#closeModals();
    $('amt-minus').onclick = () => this.#step(-1);
    $('amt-plus').onclick = () => this.#step(1);
    $('main-btn').onclick = () => this.#main();
    $('fb-cash').onclick = () => { Sound.unlock(); this.cashout(); };
    $('auto-on').onchange = (e) => { this.auto = e.target.checked; this.#save(); };
    const autoStep = (d) => {
      const a = this.autoAt;
      const st = a < 2 ? 0.1 : a < 5 ? 0.25 : a < 10 ? 0.5 : a < 50 ? 5 : 25;
      this.autoAt = clamp(Math.round((a + d * st) * 100) / 100, 1.1, 1000);
      $('auto-v').textContent = fx(this.autoAt);
      this.#save();
      Sound.click();
    };
    $('auto-minus').onclick = () => autoStep(-1);
    $('auto-plus').onclick = () => autoStep(1);
  }

  #open(id) { $('sheet-back').hidden = false; $(id).hidden = false; }
  #closeModals() { $('sheet-back').hidden = true; for (const id of ['hist-modal', 'help-modal']) $(id).hidden = true; }

  #step(dir) {
    const i = CHIPS.findIndex((c) => c >= this.amount);
    let next;
    if (dir > 0) next = CHIPS.find((c) => c > this.amount) ?? MAX_BET;
    else next = [...CHIPS].reverse().find((c) => c < this.amount) ?? MIN_BET;
    if (i < 0 && dir < 0) next = CHIPS[CHIPS.length - 1];
    this.#setAmount(next);
  }
  #setAmount(v) {
    this.amount = clamp(Math.round(v), MIN_BET, MAX_BET);
    this.#save();
    this.#renderAmount();
    this.#renderChips();
    this.#renderButton();
    Sound.click();
  }
  #renderAmount() { $('amt').textContent = fmt(this.amount); }
  #renderChips() {
    const box = $('chips');
    box.innerHTML = '';
    const mk = (label, cls, fn) => {
      const b = document.createElement('button');
      b.className = `chip ${cls}`; b.textContent = label; b.onclick = fn; box.appendChild(b);
    };
    mk('½', 'op', () => this.#setAmount(this.amount / 2));
    mk('×2', 'op', () => this.#setAmount(this.amount * 2));
    for (const c of CHIPS) mk(short(c), `${c === this.amount ? 'sel' : ''}${c >= 500000 ? ' big' : ''}`, () => this.#setAmount(c));
  }

  toast(text, err = false) {
    const t = $('toast');
    t.textContent = text;
    t.className = `toast${err ? ' err' : ''}`;
    t.hidden = false;
    clearTimeout(this.toastT);
    this.toastT = setTimeout(() => (t.hidden = true), 2400);
  }

  // ── Saat ──
  get now() { return Date.now() + this.offset; }
  /** Uçuştaki anlık oran (yerel olarak akıcı). */
  get liveMult() {
    const s = this.s;
    if (!s) return 1;
    if (this.phase === 'crashed') return Number(s.crash_mult) || Number(s.mult) || 1;
    if (this.phase !== 'flying' || !this.flightStart) return 1;
    const t = Math.max(0, (this.now - this.flightStart) / 1000);
    return Math.max(1, Math.exp((Number(s.growth) || 0.09) * t));
  }
  get flightT() { return this.flightStart ? Math.max(0, (this.now - this.flightStart) / 1000) : 0; }
  get inFlight() { return this.s && this.s.my_bet > 0 && this.s.my_cashout == null; }
  /** Bahis aşamasında kalan saniye. */
  get betLeft() { return Math.max(0, (this.betEndsLocal - this.now) / 1000); }
  /** Son 3 saniye: bahisler kapalı. */
  get betLocked() { return this.phase === 'betting' && this.betEndsLocal > 0 && this.betLeft <= LOCK_SECONDS; }

  // ── Yoklama ──
  async poll() {
    if (this.polling) return;
    this.polling = true;
    const sent = Date.now();
    try {
      const data = await this.engine.live();
      const recv = Date.now();
      if (data?.server_ms) {
        const est = Number(data.server_ms) - (sent + recv) / 2;
        // Gecikme sıçramalarına karşı yumuşak düzeltme.
        this.offset = this.offsetSet ? this.offset + (est - this.offset) * 0.25 : est;
        this.offsetSet = true;
      }
      this.apply(data);
      this.fails = 0;
    } catch (e) {
      this.fails = (this.fails || 0) + 1;
      if (this.fails === 3) this.toast(errorText(e), true);
    } finally {
      this.polling = false;
      const fast = this.phase === 'flying';
      clearTimeout(this.pollT);
      this.pollT = setTimeout(() => this.poll(), document.hidden ? 3000 : fast ? 500 : 900);
    }
  }

  apply(s) {
    if (!s || typeof s !== 'object') return;
    const prev = this.s;
    const prevPhase = this.phase;
    const prevRound = this.round;
    this.s = s;
    this.round = Number(s.round_no) || 0;
    this.phase = s.phase;

    // Bakiye
    const bal = Number(s.balance) || 0;
    if (this.ready && bal > this.balance && prev && prev.round_no === s.round_no && s.my_payout > (prev.my_payout || 0)) {
      this.#gain(bal - this.balance);
    }
    this.balance = bal;
    $('balance').textContent = fmt(bal);

    // Uçuş zamanı
    if (s.phase === 'flying') {
      const cand = this.now - (Number(s.elapsed) || 0) * 1000;
      if (!this.flightStart || prevRound !== this.round || prevPhase !== 'flying') this.flightStart = cand;
      else if (Math.abs(cand - this.flightStart) > 300) this.flightStart = cand;
      else this.flightStart += (cand - this.flightStart) * 0.15;
    }
    if (s.phase === 'betting' && s.phase_ends_at) {
      this.betEndsLocal = Date.parse(s.phase_ends_at);
    }

    // Faz geçişleri
    const newRound = prevRound && this.round !== prevRound;
    if (s.phase === 'betting' && (newRound || prevPhase !== 'betting')) this.#onBetting();
    if (s.phase === 'flying' && (prevPhase !== 'flying' || newRound)) this.#onLaunch();
    if (s.phase === 'crashed' && (prevPhase !== 'crashed' || newRound)) this.#onCrash(prev);

    $('round-tag').textContent = `Tur #${fmt(this.round)}`;
    $('st-players').textContent = fmt(s.players);
    $('st-pot').textContent = short(s.pot);
    $('st-winners').textContent = fmt(s.winners);
    this.#renderHistory(s.history_long || s.history || []);
    this.#renderPlayers(s);
    this.#renderButton();
    this.#renderMyBet();
  }

  #onBetting() {
    this.lockShown = false;
    this.flightStart = 0;
    this.lastTick = 99;
    this.scene?.reset();
    $('mult').className = 'mult wait';
    $('sub').className = 'sub';
    $('sub').textContent = '';
    this.prevBets.clear();
    if (this.queued) {
      const a = this.queued;
      this.queued = 0;
      setTimeout(() => this.#bet(a), 150);
    }
  }
  #onLaunch() {
    this.scene?.launch();
    Sound.startEngine();
    $('sub').className = 'sub';
    $('sub').textContent = this.inFlight ? `Bahsin ${fmt(this.s.my_bet)} 💎 uçuyor` : '';
  }
  #onCrash(prev) {
    const s = this.s;
    this.crashAtLocal = Date.now();
    Sound.stopEngine();
    if (this.ready) {
      this.scene?.explode();
      Sound.boom();
      const st = $('stage');
      st.classList.remove('shake'); void st.offsetWidth; st.classList.add('shake');
      const fl = $('flash');
      fl.classList.remove('on'); void fl.offsetWidth; fl.classList.add('on');
    }
    const m = Number(s.crash_mult) || 1;
    $('mult').className = 'mult boom';
    $('mult-v').textContent = m.toFixed(2);
    if (s.my_bet > 0 && s.my_cashout == null) {
      $('sub').className = 'sub lose';
      $('sub').textContent = `Patladı · ${fmt(s.my_bet)} 💎 kaybettin`;
      if (this.ready) Sound.lose();
    } else if (s.my_bet > 0 && s.my_cashout != null) {
      $('sub').className = 'sub win';
      $('sub').textContent = `${fx(s.my_cashout)}'te çekildin · +${fmt(s.my_payout)} 💎`;
    } else {
      $('sub').className = 'sub';
      $('sub').textContent = `${fx(m)}'te patladı`;
    }
    void prev;
  }

  #gain(v) {
    const g = $('gain');
    g.textContent = `+${fmt(v)}`;
    g.hidden = false;
    g.style.animation = 'none'; void g.offsetWidth; g.style.animation = '';
    clearTimeout(this.gainT);
    this.gainT = setTimeout(() => (g.hidden = true), 1600);
  }

  // ── Butonlar ──
  async #main() {
    Sound.unlock();
    const s = this.s;
    if (!s || this.busy) return;
    if (this.phase === 'flying' && this.inFlight) return this.cashout();
    if (this.phase === 'betting' && !this.betLocked) return this.#bet(this.amount);
    // Uçuşta / patlamada: sonraki tura sıra
    if (this.queued) { this.queued = 0; this.toast('Sıradaki bahis iptal edildi'); }
    else { this.queued = this.amount; this.toast(`${fmt(this.amount)} 💎 sonraki tura sıraya alındı`); }
    Sound.click();
    this.#renderButton();
  }

  async #bet(amount) {
    if (this.busy) return;
    if (amount > this.balance) { notifyApp('lowbalance'); this.toast('Kristal bakiyen yetersiz.', true); return; }
    this.busy = true;
    this.#renderButton();
    try {
      const s = await this.engine.bet(amount);
      Sound.bet();
      notifyApp('bet');
      this.apply({ ...this.s, ...s, bets: this.s?.bets, history_long: this.s?.history_long, server_ms: undefined });
      this.toast(`Bahis +${fmt(amount)} · toplam ${fmt(s.my_bet)} 💎`);
      this.poll();
    } catch (e) {
      const t = errorText(e);
      if (/havalandi|patladi|Bahisler kapandi/.test(`${e?.message}`)) { this.queued = amount; }
      if (/Yetersiz/.test(`${e?.message}`)) notifyApp('lowbalance');
      this.toast(t, true);
    } finally {
      this.busy = false;
      this.#renderButton();
    }
  }

  async cashout() {
    if (this.cashing || !this.inFlight) return;
    this.cashing = true;
    this.#renderButton();
    try {
      const s = await this.engine.cashout();
      this.apply({ ...this.s, ...s, bets: this.s?.bets, history_long: this.s?.history_long, server_ms: undefined });
      if (s.my_cashout != null) {
        Sound.cash();
        $('sub').className = 'sub win';
        $('sub').textContent = `${fx(s.my_cashout)}'te çekildin · +${fmt(s.my_payout)} 💎`;
        this.#feed({ name: 'Sen', avatar: '', cashout: s.my_cashout, payout: s.my_payout });
        notifyApp(`win:${Math.round(Number(s.my_payout) || 0)}`);
      }
      this.poll();
    } catch (e) {
      this.toast(errorText(e), true);
      this.poll();
    } finally {
      this.cashing = false;
      this.#renderButton();
    }
  }

  #renderButton() {
    const s = this.s;
    const btn = $('main-btn');
    const top = $('mb-top');
    const sub = $('mb-sub');
    btn.disabled = false;
    if (!s) { btn.className = 'main-btn'; top.textContent = 'BAĞLANIYOR'; sub.textContent = '…'; btn.disabled = true; return; }
    if (this.phase === 'flying' && this.inFlight) {
      btn.className = 'main-btn cash';
      top.textContent = this.cashing ? 'ÇEKİLİYOR…' : 'ÇEKİL';
      sub.textContent = `${fmt(s.my_bet * this.liveMult)} 💎`;
      return;
    }
    if (this.phase === 'betting' && this.betLocked && !this.queued) {
      btn.className = 'main-btn queue';
      top.textContent = 'BAHİSLER KAPANDI';
      sub.textContent = `${fmt(this.amount)} 💎 · sonraki tura al`;
      return;
    }
    if (this.phase === 'betting' && !this.betLocked) {
      btn.className = 'main-btn';
      top.textContent = this.busy ? 'GÖNDERİLİYOR…' : s.my_bet > 0 ? 'BAHİS EKLE' : 'BAHİS YAP';
      sub.textContent = `${fmt(this.amount)} 💎`;
      btn.disabled = this.busy;
      return;
    }
    if (this.phase === 'flying' && s.my_cashout != null && !this.queued) {
      btn.className = 'main-btn done';
      top.textContent = `${fx(s.my_cashout)} ÇEKİLDİ`;
      sub.textContent = `+${fmt(s.my_payout)} 💎 · sıraya al`;
      return;
    }
    if (this.queued) {
      btn.className = 'main-btn cancel';
      top.textContent = 'SIRADA · İPTAL';
      sub.textContent = `${fmt(this.queued)} 💎 sonraki tur`;
      return;
    }
    btn.className = 'main-btn queue';
    top.textContent = 'SONRAKİ TUR';
    sub.textContent = `${fmt(this.amount)} 💎`;
  }

  #renderMyBet() {
    const s = this.s;
    const el = $('my-bet');
    if (!s || !(s.my_bet > 0)) { el.hidden = true; return; }
    el.hidden = false;
    el.innerHTML = s.my_cashout != null
      ? `Bahsin <b>${fmt(s.my_bet)}</b> · <b style="color:#8fffc8">${fx(s.my_cashout)}</b>`
      : `Bahsin <b>${fmt(s.my_bet)}</b> 💎`;
  }

  #renderHistory(list) {
    const vals = list.map((h) => Number(h.crash_mult) || 1);
    const sig = vals.slice(0, 20).join(',');
    if (sig === this.histShown) return;
    const fresh = this.histShown !== '';
    this.histShown = sig;
    this.histAll = vals;
    $('history').innerHTML = vals.slice(0, 20)
      .map((m, i) => `<span class="hpill ${pillClass(m)}${fresh && i === 0 ? ' new' : ''}">${fx(m)}</span>`).join('');
  }

  #openHistory() {
    const vals = this.histAll || [];
    const n = vals.length || 1;
    const avg = vals.reduce((s, v) => s + v, 0) / n;
    const over2 = vals.filter((v) => v >= 2).length;
    const over10 = vals.filter((v) => v >= 10).length;
    const max = vals.length ? Math.max(...vals) : 0;
    $('hist-stats').innerHTML = `<span>Ortalama <b>${fx(avg)}</b></span><span>En yüksek <b>${fx(max)}</b></span>`
      + `<span>2x+ <b>${over2}</b></span><span>10x+ <b>${over10}</b></span>`;
    $('hist-grid').innerHTML = vals.map((m) => `<span class="hpill ${pillClass(m)}">${fx(m)}</span>`).join('');
    this.#open('hist-modal');
  }

  #avatar(p) {
    const url = String(p.avatar || '');
    if (/^https:\/\//.test(url)) return `<span class="av" style="background-image:url('${esc(url).replace(/'/g, '%27')}')"></span>`;
    return `<span class="av">${esc((p.name || '?').slice(0, 1).toUpperCase())}</span>`;
  }

  #feed(p) {
    const box = $('feed');
    const el = document.createElement('div');
    el.className = 'feed-item';
    el.innerHTML = `${this.#avatar(p)}<span>${esc(p.name)}</span><b>${fx(p.cashout)}</b><span>+${short(p.payout)}</span>`;
    box.prepend(el);
    while (box.children.length > 4) box.lastChild.remove();
    setTimeout(() => el.remove(), 2700);
  }

  #renderPlayers(s) {
    const bets = Array.isArray(s.bets) ? s.bets : [];
    $('pl-count').textContent = `${fmt(s.players || bets.length)} oyuncu`;
    const crashed = s.phase === 'crashed';
    // Yeni çekilenler: akış balonu + satır parlaması
    const flashKeys = new Set();
    bets.forEach((b, i) => {
      const key = `${b.me ? 'me' : b.name}#${b.me ? 0 : i}`;
      const k2 = `${b.me ? 'me' : b.name}`;
      const was = this.prevBets.get(k2);
      if (b.cashout != null && was === null && !b.me) { this.#feed(b); flashKeys.add(k2); }
      this.prevBets.set(k2, b.cashout ?? null);
      void key;
    });
    this.#renderFocusTop(s, bets);
    const box = $('pl-list');
    if (!bets.length) {
      box.innerHTML = `<div class="pl-empty">${s.phase === 'betting' ? 'Henüz bahis yok · ilk sen ol!' : 'Bu turda oyuncu yok'}</div>`;
      return;
    }
    box.innerHTML = bets.map((b) => {
      const won = b.cashout != null;
      const cls = `pl${b.me ? ' me' : ''}${won ? ' won' : crashed ? ' lost' : ''}${flashKeys.has(b.name) ? ' flash' : ''}`;
      const rs = won
        ? `<span class="xm">${fx(b.cashout)}</span><small>+${short(b.payout)}</small>`
        : crashed ? '<span style="color:#ff8a9c">💥</span>' : '<span class="dash">—</span>';
      return `<div class="${cls}">${this.#avatar(b)}<span class="nm">${esc(b.me ? `${b.name} (sen)` : b.name)}</span><span class="bt">${short(b.amount)} 💎</span><span class="rs">${rs}</span></div>`;
    }).join('');
  }

  /** Odak kipinde üstteki oyuncu şeridi (popup): bu turda kim var. */
  #renderFocusTop(s, bets) {
    const crashed = s.phase === 'crashed';
    const list = bets.slice(0, 10);
    const more = bets.length - list.length;
    $('focus-top').innerHTML = list.map((b) => {
      const won = b.cashout != null;
      const cls = `ft${b.me ? ' me' : ''}${won ? ' won' : crashed ? ' lost' : ''}`;
      const val = won ? `${fx(b.cashout)} +${short(b.payout)}` : short(b.amount);
      return `<span class="${cls}">${this.#avatar(b)}<span>${esc(b.me ? 'Sen' : b.name)}</span><b>${val}</b></span>`;
    }).join('') + (more > 0 ? `<span class="ft more">+${more}</span>` : '');
  }

  /** Odak kipine gir / çık: alt seçenekler kaybolur, sahne tam ekrana büyür. */
  #setFocus(on) {
    if (on === this.focus) return;
    this.focus = on;
    $('app').classList.toggle('focus', on);
    this.scene?.setFocus?.(on);
    if (!on) { this.#renderButton(); }
  }

  /** Odak kipinin alt çubuğu: ÇEKİL + miktar ya da sonuç. */
  #renderFocusBar(m) {
    const s = this.s;
    const cash = $('fb-cash');
    const info = $('fb-info');
    let showCash = false;
    let text = '';
    let cls = 'fb-info';
    if (this.phase === 'flying' && this.inFlight) {
      showCash = true;
      $('fb-label').textContent = this.cashing ? 'ÇEKİLİYOR…' : 'ÇEKİL';
      $('fb-amt').textContent = short(Math.floor(s.my_bet * m));
    } else if (this.phase === 'betting') {
      text = s.my_bet > 0 ? `Bahisler kapandı · bahsin ${short(s.my_bet)} uçuşa hazır` : 'Bahisler kapandı · kalkış!';
      cls += ' wait';
    } else if (s.my_bet > 0 && s.my_cashout != null) {
      text = `${fx(s.my_cashout)} · +${short(s.my_payout)} kazandın`;
      cls += ' win';
    } else if (this.phase === 'crashed') {
      text = s.my_bet > 0 ? `PATLADI · −${short(s.my_bet)}` : `PATLADI · ${fx(Number(s.crash_mult) || 1)}`;
      cls += ' boom';
    } else {
      text = `İzliyorsun · ${fmt(s.players)} oyuncu`;
    }
    if (cash.hidden === showCash) cash.hidden = !showCash;
    if (info.textContent !== text) info.textContent = text;
    if (info.className !== cls) info.className = cls;
  }

  // ── Kare döngüsü ──
  #lastFrame = performance.now();
  loop = (t) => {
    const dt = (t - this.#lastFrame) / 1000;
    this.#lastFrame = t;
    const s = this.s;
    if (s) {
      let countdown = 99;
      if (this.phase === 'betting') {
        const left = Math.max(0, (this.betEndsLocal - this.now) / 1000);
        countdown = left;
        const total = Number(s.bet_seconds) || 15;
        $('countdown').hidden = false;
        $('cd-num').textContent = String(Math.ceil(left));
        $('cd-bar').style.strokeDashoffset = String(119.4 * (1 - clamp(left / total, 0, 1)));
        const locked = left <= LOCK_SECONDS;
        $('phase-chip').className = locked ? 'phase-chip fly' : 'phase-chip';
        $('phase-chip').textContent = locked ? 'Bahisler kapandı · kalkış' : 'Bahisler açık';
        $('mult-v').textContent = '1.00';
        const sec = Math.ceil(left);
        if (sec <= 3 && sec >= 1 && sec !== this.lastTick) { this.lastTick = sec; if (this.ready) Sound.tick(sec === 1); }
        if (!$('sub').textContent) $('sub').textContent = 'Roket kalkışa hazırlanıyor';
        this.graph.clear();
      } else if (this.phase === 'flying') {
        $('countdown').hidden = true;
        const m = this.liveMult;
        $('mult-v').textContent = m.toFixed(2);
        $('mult').className = `mult t-${tierOf(m)}`;
        $('phase-chip').className = 'phase-chip fly';
        $('phase-chip').textContent = 'Roket uçuyor';
        this.graph.draw(this.flightT, m, Number(s.growth) || 0.09, false);
        Sound.engineMult(m);
        if (this.inFlight) {
          $('mb-sub').textContent = `${fmt(s.my_bet * m)} 💎`;
          if (this.auto && !this.cashing && m >= this.autoAt) this.cashout();
        }
      } else if (this.phase === 'crashed') {
        $('countdown').hidden = true;
        $('phase-chip').className = 'phase-chip boom';
        $('phase-chip').textContent = `Patladı · yeni tur ${Math.max(0, Number(s.seconds_left) || 0)} sn`;
        const m = Number(s.crash_mult) || 1;
        this.graph.draw(Math.log(Math.max(1, m)) / (Number(s.growth) || 0.09), m, Number(s.growth) || 0.09, true);
      }
      // **Odak kipi**: son 3 saniye + uçuş + patlamanın ilk anı tam ekran.
      const wantFocus = (this.phase === 'betting' && this.betEndsLocal > 0 && countdown <= LOCK_SECONDS && countdown > 0)
        || this.phase === 'flying'
        || (this.phase === 'crashed' && this.crashAtLocal > 0 && Date.now() - this.crashAtLocal < CRASH_HOLD_MS);
      this.#setFocus(wantFocus);
      if (this.focus) this.#renderFocusBar(this.liveMult);
      if (this.phase === 'betting' && this.betLocked && !this.lockShown) {
        this.lockShown = true;
        this.#renderButton();
      }
      if (this.scene && !document.hidden) {
        this.scene.frame(dt, { mult: this.phase === 'flying' ? this.liveMult : 1, countdown });
      }
    }
    requestAnimationFrame(this.loop);
  };

  markReady() {
    if (this.ready) return;
    this.ready = true;
    notifyApp('ready');
  }
}

// ─── Başlat ────────────────────────────────────────────────────────────────
async function main() {
  Sound.init();
  Sound.unlock();
  let engine;
  if (DEMO) {
    engine = new DemoEngine();
  } else {
    try {
      const { createClient } = await import(SUPABASE_JS);
      const client = createClient(SUPABASE.url, SUPABASE.anonKey, {
        auth: { persistSession: !APP_MODE, autoRefreshToken: true, detectSessionInUrl: false },
      });
      engine = new LiveEngine(client);
    } catch {
      $('gate').hidden = false;
      $('login').hidden = true;
      $('gate-text').textContent = 'Oyun yüklenemedi. İnternetini kontrol et.';
      $('retry').hidden = false;
      $('retry').onclick = () => location.reload();
      notifyApp('ready');
      return;
    }
  }
  const game = new Game(engine);
  window.__roket = game;
  const sceneReady = game.init3d();

  const start = async () => {
    await game.poll();
    await sceneReady;
    // İlk durum: uçuştaysa roket havada başlasın.
    if (game.phase === 'flying') { game.scene?.launch(); Sound.startEngine(); }
    game.markReady();
  };

  if (DEMO) { await start(); return; }
  const ok = await engine.connect();
  if (ok) { await start(); return; }

  $('gate').hidden = false;
  if (APP_MODE) {
    $('login').hidden = true;
    $('gate-text').textContent = 'Hesabına bağlanılamadı.';
    $('retry').hidden = false;
    $('retry').onclick = () => location.reload();
    game.markReady();
    return;
  }
  game.markReady();
  $('login').onsubmit = async (e) => {
    e.preventDefault();
    const ok2 = await engine.signIn($('email').value.trim(), $('password').value);
    if (ok2) { $('gate').hidden = true; await start(); } else $('gate-text').textContent = 'E-posta veya şifre hatalı.';
  };
}

main();
