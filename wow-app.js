/* ================================================================
   REINOS DE AZEROTH - multijugador (Supabase + GitHub Pages)
   Recursos que suben solos + edificios y tropas con temporizador.
   ================================================================ */
const SB_URL = "https://upvqpyxscajqoszqsowa.supabase.co/rest/v1";
const KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVwdnFweXhzY2FqcW9zenFzb3dhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTEzOTM5NTEsImV4cCI6MjEwNjk2OTk1MX0.JH-kcwpAd6y7BCqzTE5vj_hbNdbxaZecnty6XjPvQwg";

const $ = sel => document.querySelector(sel);
const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const un = n => Number(n || 0).toLocaleString("es", { maximumFractionDigits: 0 });
const fmt = n => Number(n || 0).toLocaleString("es", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
function tfmt(sec){
  sec = Math.max(0, Math.round(sec));
  if(sec < 60) return sec + "s";
  const m = Math.floor(sec / 60), s = sec % 60;
  if(m < 60) return m + "m " + String(s).padStart(2, "0") + "s";
  const h = Math.floor(m / 60);
  return h + "h " + String(m % 60).padStart(2, "0") + "m";
}

async function sbRpc(fn, body){
  const r = await fetch(`${SB_URL}/rpc/${fn}`, {
    method: "POST",
    headers: { "apikey": KEY, "Authorization": "Bearer " + KEY, "Content-Type": "application/json" },
    body: JSON.stringify(body || {})
  });
  const txt = await r.text();
  let data = null;
  try{ data = txt ? JSON.parse(txt) : null; }catch(_){ data = null; }
  if(!r.ok){
    let msg = "Error del servidor.";
    try{ if(data && data.message) msg = data.message; else if(typeof data === "string") msg = data; }catch(_){}
    throw new Error(msg);
  }
  return data;
}
async function pbkdf2Hex(pass, saltHex, iters){
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(pass), "PBKDF2", false, ["deriveBits"]);
  const salt = new Uint8Array(saltHex.match(/.{2}/g).map(h => parseInt(h, 16)));
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: iters, hash: "SHA-256" }, key, 256);
  return [...new Uint8Array(bits)].map(b => b.toString(16).padStart(2, "0")).join("");
}
function newSalt(){
  const a = new Uint8Array(16);
  crypto.getRandomValues(a);
  return [...a].map(b => b.toString(16).padStart(2, "0")).join("");
}
function shortMsg(e){
  const m = (e && e.message) || "Algo falló.";
  return m.length > 170 ? m.slice(0, 167) + "…" : m;
}
let _toastT;
function toast(msg, bad){
  const t = $("#toast"); if(!t) return;
  t.textContent = msg; t.className = "toast" + (bad ? " bad" : "");
  clearTimeout(_toastT); _toastT = setTimeout(() => t.classList.add("hidden"), 2800);
}
function notice(el, text, cls){
  if(!el) return;
  el.textContent = text;
  el.className = "notice" + (cls ? " " + cls : "");
}
const hora = ms => { try{ return new Date(Number(ms)).toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" }); }catch(_){ return ""; } };
function modalClose(){ const m = $("#modal"); if(m) m.classList.add("hidden"); }
function modal(html){
  const m = $("#modal"), box = $("#modalBox"); if(!m || !box) return;
  box.innerHTML = html + '<div style="text-align:center;margin-top:16px"><button class="btn sm" id="modalClose">Cerrar</button></div>';
  m.classList.remove("hidden");
  const btn = box.querySelector("#modalClose"); if(btn) btn.onclick = modalClose;
  m.onclick = e => { if(e.target === m) modalClose(); };
}
function showScreen(id){
  ["screenPortal", "screenGame", "screenAcct"].forEach(s => {
    const el = document.getElementById(s); if(el) el.classList.toggle("hidden", s !== id);
  });
}

/* ---------------- datos del juego ---------------- */
const BLD = {
  mina:       { e: "⛏️", n: "Mina de Mineral", d: "Extrae mineral del subsuelo",      p: "+{v} mineral/h" },
  aserradero: { e: "🪵", n: "Aserradero",      d: "Corta madera para tus obras",      p: "+{v} madera/h" },
  tesoreria:  { e: "💰", n: "Tesorería",       d: "Genera oro para tu reino",         p: "+{v} oro/h" },
  almacen:    { e: "📦", n: "Almacén",         d: "Guarda más recursos",              p: "Capacidad: {v}" },
  cuartel:    { e: "⚔️", n: "Cuartel",         d: "Entrena a tus tropas",             p: "Necesario para tropas" },
  muralla:    { e: "🛡️", n: "Muralla",         d: "Protege tu reino",                 p: "Defensa de tu reino" }
};
const TRP = {
  soldado: { e: "🗡️", n: "Soldado", d: "Infantería básica" },
  arquero: { e: "🏹", n: "Arquero", d: "Ataca a distancia" },
  jinete:  { e: "🐎", n: "Jinete",  d: "Carga rápida" },
  mago:    { e: "🔮", n: "Mago",    d: "Daño mágico" }
};

/* ---------------- portal (entrar / crear) ---------------- */
const Auth = {
  fac: null,
  init(){
    $("#tabLogin").onclick = () => this.tab("login");
    $("#tabReg").onclick = () => this.tab("reg");
    document.querySelectorAll(".facRow button").forEach(b => {
      b.onclick = () => {
        this.fac = b.dataset.fac;
        document.querySelectorAll(".facRow button").forEach(x => x.classList.toggle("on", x === b));
      };
    });
    $("#formLogin").onsubmit = e => { e.preventDefault(); this.login(); };
    $("#formReg").onsubmit = e => { e.preventDefault(); this.register(); };
    $("#btnLogout").onclick = () => this.logout();
    $("#btnLogout2").onclick = () => this.logout();
    $("#btnAcct").onclick = () => this.acct();
    $("#btnBack").onclick = () => showScreen("screenGame");
    $("#formPw").onsubmit = e => { e.preventDefault(); this.changePw(); };
    document.querySelectorAll(".gameTabs button").forEach(b => {
      b.onclick = () => {
        document.querySelectorAll(".gameTabs button").forEach(x => x.classList.toggle("on", x === b));
        Game.tab = b.dataset.tab;
        $("#tabBld").classList.toggle("hidden", Game.tab !== "bld");
        $("#tabTroop").classList.toggle("hidden", Game.tab !== "troop");
        $("#tabMap").classList.toggle("hidden", Game.tab !== "map");
        $("#tabAlly").classList.toggle("hidden", Game.tab !== "ally");
        $("#tabRank").classList.toggle("hidden", Game.tab !== "rank");
        if(Game.tab === "rank") Game.loadRank();
        if(Game.tab === "bld") Game.renderBld();
        if(Game.tab === "troop") Game.renderTroop();
        if(Game.tab === "map") Game.loadMap();
        if(Game.tab === "ally") Game.renderAlly(); else Game.stopChatPoll();
      };
    });
    this.portal();
    const tok = localStorage.getItem("wow_token");
    if(tok){
      sbRpc("wow_check", { p_token: tok })
        .then(me => { if(me && me.id) Game.start({ token: tok, ...me }); else this.portal(); })
        .catch(() => this.portal());
    }
  },
  tab(which){
    $("#tabLogin").classList.toggle("on", which === "login");
    $("#tabReg").classList.toggle("on", which === "reg");
    $("#formLogin").classList.toggle("hidden", which !== "login");
    $("#formReg").classList.toggle("hidden", which !== "reg");
  },
  portal(){
    showScreen("screenPortal");
    notice($("#liMsg"), ""); notice($("#rgMsg"), "");
  },
  async login(){
    const name = $("#liName").value.trim(), pass = $("#liPass").value;
    if(!name || !pass) return notice($("#liMsg"), "Escribe tu nombre y contraseña.", "danger");
    notice($("#liMsg"), "Entrando…");
    try{
      const salt = await sbRpc("wow_salt", { p_name: name });
      if(!salt) throw new Error("Nombre o contraseña incorrectos.");
      const hash = await pbkdf2Hex(pass, salt, 100000);
      const r = await sbRpc("wow_login", { p_name: name, p_hash: hash });
      localStorage.setItem("wow_token", r.token);
      notice($("#liMsg"), "");
      Game.start({ token: r.token, id: r.id, name: r.name, faction: r.faction });
    }catch(e){ notice($("#liMsg"), shortMsg(e), "danger"); }
  },
  async register(){
    const name = $("#rgName").value.trim(), p1 = $("#rgPass").value, p2 = $("#rgPass2").value;
    if(!name || name.length < 2) return notice($("#rgMsg"), "Escribe un nombre de reino (así entrarás después).", "danger");
    if(!p1 || p1.length < 4) return notice($("#rgMsg"), "La contraseña debe tener al menos 4 caracteres.", "danger");
    if(p1 !== p2) return notice($("#rgMsg"), "Las contraseñas no coinciden.", "danger");
    if(!this.fac) return notice($("#rgMsg"), "Elige tu bando: Alianza o Horda.", "danger");
    notice($("#rgMsg"), "Creando tu reino…");
    try{
      const salt = newSalt();
      const hash = await pbkdf2Hex(p1, salt, 100000);
      await sbRpc("wow_register", { p_name: name, p_faction: this.fac, p_salt: salt, p_hash: hash, p_now: Date.now() });
      const r = await sbRpc("wow_login", { p_name: name, p_hash: hash });
      localStorage.setItem("wow_token", r.token);
      notice($("#rgMsg"), "");
      Game.start({ token: r.token, id: r.id, name: r.name, faction: r.faction });
    }catch(e){ notice($("#rgMsg"), shortMsg(e), "danger"); }
  },
  async logout(){
    try{ await sbRpc("wow_logout", { p_token: Game.me && Game.me.token }); }catch(_){}
    localStorage.removeItem("wow_token");
    Game.stop();
    this.portal();
  },
  acct(){
    if(!Game.me) return;
    $("#acctInfo").textContent = "Reino: " + Game.me.name + " · Bando: " + (Game.me.faction === "horda" ? "Horda" : "Alianza");
    $("#pw1").value = ""; $("#pw2").value = "";
    notice($("#pwMsg"), "");
    showScreen("screenAcct");
  },
  async changePw(){
    const p1 = $("#pw1").value, p2 = $("#pw2").value;
    if(!p1 || p1.length < 4) return notice($("#pwMsg"), "La contraseña debe tener al menos 4 caracteres.", "danger");
    if(p1 !== p2) return notice($("#pwMsg"), "Las contraseñas no coinciden.", "danger");
    try{
      const salt = newSalt();
      const hash = await pbkdf2Hex(p1, salt, 100000);
      await sbRpc("wow_change_password", { p_token: Game.me.token, p_salt: salt, p_hash: hash });
      notice($("#pwMsg"), "¡Contraseña cambiada!", "ok");
    }catch(e){ notice($("#pwMsg"), shortMsg(e), "danger"); }
  }
};

/* ---------------- el reino ---------------- */
const Game = {
  me: null, st: null, stNow: 0, tab: "bld", timer: null, syncing: false, rankLoaded: false, mapList: [], chatTimer: null,

  async start(me){
    this.me = me;
    showScreen("screenGame");
    $("#gName").textContent = me.name;
    const f = $("#gFac");
    f.textContent = me.faction === "horda" ? "⚔️ Horda" : "🛡️ Alianza";
    f.className = "facBadge " + (me.faction === "horda" ? "horda" : "alianza");
    const ab = $("#gAlly"); if(ab){ ab.textContent = ""; ab.style.display = "none"; }
    await this.refresh();
    this.loop();
  },
  stop(){ clearInterval(this.timer); this.timer = null; this.st = null; this.rankLoaded = false; },
  async refresh(){
    try{
      this.st = await sbRpc("wow_state", { p_token: this.me.token });
      this.stNow = Date.now();
      $("#gPts").textContent = un(this.st.points);
      const ab = $("#gAlly");
      if(ab){ ab.textContent = this.st.ally_tag ? "[" + this.st.ally_tag + "]" : ""; ab.style.display = this.st.ally_tag ? "" : "none"; }
      this.renderBld(); this.renderTroop(); this.tick();
      if(this.tab === "rank" && this.rankLoaded) this.loadRank();
      if(this.tab === "map") this.loadMap();
    }catch(e){ toast(shortMsg(e), true); }
  },
  loop(){
    clearInterval(this.timer);
    this.timer = setInterval(() => this.tick(), 500);
    setInterval(() => this.refresh(), 20000);
    this.tick();
  },
  tick(){
    const s = this.st; if(!s) return;
    const now = Date.now(), el = (now - this.stNow) / 3600000;
    const g = Math.min(s.gold + el * s.rate.gold, s.capacity);
    const w = Math.min(s.wood + el * s.rate.wood, s.capacity);
    const o = Math.min(s.ore  + el * s.rate.ore,  s.capacity);
    $("#rGold").textContent = fmt(g);  $("#rGoldH").textContent = "+" + un(s.rate.gold) + "/h";
    $("#rWood").textContent = fmt(w);  $("#rWoodH").textContent = "+" + un(s.rate.wood) + "/h";
    $("#rOre").textContent  = fmt(o);  $("#rOreH").textContent  = "+" + un(s.rate.ore) + "/h";
    $("#rCap").textContent  = un(s.capacity) + " máx.";
    const q = s.queue, box = $("#queueBox");
    if(q && q.finish){
      box.classList.remove("hidden");
      const label = q.kind === "build"
        ? "🔨 Construyendo: " + (BLD[q.ref] ? BLD[q.ref].n : q.ref)
        : "⚔️ Entrenando: " + (TRP[q.ref] ? q.qty + " " + TRP[q.ref].n + (q.qty === 1 ? "" : "s") : q.ref);
      $("#qLabel").textContent = label;
      const total = Math.max(1, q.finish - q.start), done = Math.max(0, now - q.start);
      $("#qFill").style.width = Math.min(100, done / total * 100) + "%";
      const rem = (q.finish - now) / 1000;
      $("#qTime").textContent = rem > 0 ? "⏳ " + tfmt(rem) + " restantes" : "¡Listo! sincronizando…";
      if(rem <= 0 && !this.syncing){ this.syncing = true; this.refresh().finally(() => { this.syncing = false; }); }
    }else{
      box.classList.add("hidden");
    }
  },

  /* ----- edificios ----- */
  renderBld(){
    const s = this.st; if(!s) return;
    const busy = !!s.queue;
    let html = '<div class="grid">';
    (s.buildings || []).forEach(b => {
      const m = BLD[b.key] || { e: "🏰", n: b.key, d: "" };
      const prod = b.key === "almacen" ? m.p.replace("{v}", un(b.prod))
                 : (b.prod > 0 ? m.p.replace("{v}", un(b.prod)) : m.d);
      const noG = s.gold < b.cost.gold, noW = s.wood < b.cost.wood, noO = s.ore < b.cost.ore;
      const can = !busy && !noG && !noW && !noO;
      html += `<div class="card">
        <div class="cardTop">
          <span class="emoji">${m.e}</span>
          <div><div class="bName">${m.n}<span class="lvl">Nv. ${b.level}</span></div>
          <div class="bDesc">${prod}</div></div>
        </div>
        <div class="cardBot">
          <div class="costs">
            <span class="c${noG ? " no" : ""}">💰 ${un(b.cost.gold)}</span>
            <span class="c${noW ? " no" : ""}">🪵 ${un(b.cost.wood)}</span>
            <span class="c${noO ? " no" : ""}">⛏️ ${un(b.cost.ore)}</span>
            <span class="c">⏱ ${tfmt(b.time)}</span>
          </div>
          <button class="btn sm" data-up="${b.key}" ${can ? "" : "disabled"}>⬆️ Subir</button>
        </div>
      </div>`;
    });
    html += "</div>";
    $("#tabBld").innerHTML = html;
    $("#tabBld").querySelectorAll("[data-up]").forEach(btn => {
      btn.onclick = () => this.build(btn.dataset.up);
    });
  },
  async build(k){
    toast("🔨 Construyendo…");
    try{ await sbRpc("wow_build", { p_token: this.me.token, p_key: k }); await this.refresh(); }
    catch(e){ toast(shortMsg(e), true); }
  },

  /* ----- tropas ----- */
  renderTroop(){
    const s = this.st; if(!s) return;
    const busy = !!s.queue;
    const barr = (s.buildings || []).find(b => b.key === "cuartel");
    const lvl = barr ? barr.level : 0;
    const unlocked = lvl >= 1;
    let html = "";
    if(!unlocked){
      html += `<div class="empty">⚔️ Necesitas al menos un <b>Cuartel</b> (nivel 1) para entrenar tropas.<br><br>Sube el Cuartel en la pestaña 🏰 Edificios.</div>`;
    }
    html += '<div class="grid">';
    (s.troops || []).forEach(t => {
      const m = TRP[t.key] || { e: "⚔️", n: t.key, d: "" };
      const noG = s.gold < t.cost.gold, noW = s.wood < t.cost.wood, noO = s.ore < t.cost.ore;
      html += `<div class="card">
        <div class="cardTop">
          <span class="emoji">${m.e}</span>
          <div><div class="bName">${m.n} <span class="troopQty">× ${un(t.qty)}</span></div>
          <div class="bDesc">${m.d}</div></div>
        </div>
        <div class="cardBot">
          <div class="costs">
            <span class="c${noG ? " no" : ""}">💰 ${un(t.cost.gold)}</span>
            <span class="c${noW ? " no" : ""}">🪵 ${un(t.cost.wood)}</span>
            <span class="c${noO ? " no" : ""}">⛏️ ${un(t.cost.ore)}</span>
            <span class="c">⏱ ${t.time}s/ud</span>
          </div>
        </div>
        <div class="troopRow">
          <input id="qty_${t.key}" type="number" min="1" max="100000" value="10" ${(!unlocked || busy) ? "disabled" : ""}>
          <button class="btn sm" data-tr="${t.key}" ${(!unlocked || busy) ? "disabled" : ""}>⚔️ Entrenar</button>
        </div>
      </div>`;
    });
    html += "</div>";
    $("#tabTroop").innerHTML = html;
    $("#tabTroop").querySelectorAll("[data-tr]").forEach(btn => {
      btn.onclick = () => this.train(btn.dataset.tr);
    });
  },
  async train(k){
    const inp = document.getElementById("qty_" + k);
    const qty = Math.max(1, Math.min(100000, parseInt(inp && inp.value, 10) || 0));
    toast("⚔️ Entrenando " + qty + "…");
    try{ await sbRpc("wow_train", { p_token: this.me.token, p_key: k, p_qty: qty }); await this.refresh(); }
    catch(e){ toast(shortMsg(e), true); }
  },

  /* ----- ranking ----- */
  async loadRank(){
    try{
      const list = await sbRpc("wow_leaderboard", { p_token: this.me.token });
      this.rankLoaded = true;
      let html = '<table class="rank"><tr><th>#</th><th>Reino</th><th>Bando</th><th>Puntos</th><th>Nv.</th><th>Tropas</th></tr>';
      (list || []).forEach((r, i) => {
        const cls = r.me ? ' class="me"' : "";
        const fac = r.faction === "horda"
          ? '<span class="rankFac" style="background:var(--red)">Horda</span>'
          : '<span class="rankFac" style="background:var(--blue)">Alianza</span>';
        html += `<tr${cls}><td>${i + 1}</td><td>${r.name}${r.me ? " (tú)" : ""}</td><td>${fac}</td>
          <td><b>${un(r.points)}</b></td><td>${un(r.level_sum)}</td><td>${un(r.troops)}</td></tr>`;
      });
      html += "</table>";
      $("#tabRank").innerHTML = html || '<div class="empty">Aún no hay reinos en el ranking.</div>';
    }catch(e){ toast(shortMsg(e), true); }
  },

  /* ----- mapa ----- */
  async loadMap(){
    try{
      this.mapList = await sbRpc("wow_map", { p_token: this.me.token }) || [];
      this.renderMap();
    }catch(e){ toast(shortMsg(e), true); }
  },
  renderMap(){
    const list = this.mapList || [];
    const byPos = {}; list.forEach(r => byPos[r.pos] = r);
    const maxPos = list.reduce((m, r) => Math.max(m, r.pos), -1);
    const total = Math.max(36, Math.ceil((maxPos + 1) / 6) * 6);
    const TERRAIN = ["🌲", "⛰️", "🌊", "🏔️", "🌳", "🗻", "🌾", "🏞️"];
    let html = '<div class="mapHint">🗺️ Cada recuadro es un reino. Toca uno para ver su ficha.</div><div class="mapGrid">';
    for(let i = 0; i < total; i++){
      const r = byPos[i];
      if(r){
        html += `<div class="tile realm ${r.faction === "horda" ? "horda" : "alianza"}${r.me ? " me" : ""}" data-i="${i}">
          <div class="tEmoji">${r.faction === "horda" ? "⚔️" : "🛡️"}</div>
          <div class="tName">${esc(r.name)}</div>
          ${r.alliance ? `<div class="tTag">[${esc(r.alliance)}]</div>` : ""}
        </div>`;
      }else{
        html += `<div class="tile empty">${TERRAIN[i % TERRAIN.length]}</div>`;
      }
    }
    html += "</div>";
    $("#tabMap").innerHTML = html;
    $("#tabMap").querySelectorAll(".tile.realm").forEach(t => {
      t.onclick = () => this.openProfile(parseInt(t.dataset.i, 10));
    });
  },
  openProfile(pos){
    const r = (this.mapList || []).find(x => x.pos === pos); if(!r) return;
    const fac = r.faction === "horda" ? "⚔️ Horda" : "🛡️ Alianza";
    modal(`<h2 style="margin-top:0;color:var(--gold)">🏰 ${esc(r.name)}</h2>
      ${r.me ? '<p style="color:var(--green);margin:0 0 8px">Este es tu reino</p>' : ""}
      <div class="profRow"><span class="k">Bando</span><span class="v">${fac}</span></div>
      <div class="profRow"><span class="k">Puntos</span><span class="v">${un(r.points)}</span></div>
      <div class="profRow"><span class="k">Alianza</span><span class="v">${r.alliance ? "[" + esc(r.alliance) + "]" : "Sin alianza"}</span></div>`);
  },

  /* ----- alianza ----- */
  async renderAlly(){
    if(!this.st) return;
    try{
      if(this.st.alliance) await this.renderAllyMine(this.st.alliance);
      else await this.renderAllyNone();
    }catch(e){ toast(shortMsg(e), true); }
  },
  async renderAllyNone(){
    this.stopChatPoll();
    const list = await sbRpc("wow_alliance_list", { p_token: this.me.token }) || [];
    let html = `<div class="allyBox">
      <div class="secTitle" style="margin-top:0">🤝 Crear una alianza</div>
      <div class="allyCreate">
        <input id="alName" placeholder="Nombre de la alianza" maxlength="30">
        <input id="alTag" placeholder="Etiqueta (2-5 letras, ej. CRV)" maxlength="5">
        <input id="alDesc" placeholder="Descripción (opcional)" maxlength="200">
        <button class="btn" id="alCreate">Crear alianza</button>
      </div>
      <div class="secTitle">⚔️ Alianzas existentes</div>
      <div class="allyList">`;
    if(!list.length) html += '<div class="empty" style="padding:16px">Todavía no hay alianzas. ¡Crea la primera!</div>';
    list.forEach(a => {
      html += `<div class="allyCard">
        <div class="info"><div class="t">[${esc(a.tag)}] ${esc(a.name)}</div>
        <div class="m">${a.members} miembro${a.members === 1 ? "" : "s"} · ${un(a.points)} pts</div></div>
        <button class="btn sm" data-join="${esc(a.id)}">Unirme</button>
      </div>`;
    });
    html += `</div></div>`;
    $("#tabAlly").innerHTML = html;
    $("#alCreate").onclick = () => this.createAlly();
    $("#tabAlly").querySelectorAll("[data-join]").forEach(b => { b.onclick = () => this.joinAlly(b.dataset.join); });
  },
  async renderAllyMine(id){
    const info = await sbRpc("wow_alliance_info", { p_token: this.me.token, p_id: id });
    let html = `<div class="allyBox">
      <div class="allyHead"><span class="allyTagBig">[${esc(info.tag)}]</span>${esc(info.name)}</div>
      <p class="allyDesc">${info.descr ? esc(info.descr) : "Sin descripción"}</p>
      <div class="secTitle" style="margin-top:0">👥 Miembros (${info.members.length})</div>
      <div class="members">`;
    info.members.forEach(m => {
      html += `<div class="mem${m.me ? " me" : ""}">${m.faction === "horda" ? "⚔️" : "🛡️"} ${esc(m.name)}${m.leader ? " 👑" : ""}<span class="memPts">${un(m.points)} pts</span></div>`;
    });
    html += `</div>
      <div class="secTitle">💬 Chat de la alianza</div>
      <div id="chatMsgs" class="chatBox"></div>
      <div class="chatRow"><input id="chatIn" placeholder="Escribe a tu alianza…" maxlength="300"><button class="btn sm" id="chatSend">Enviar</button></div>
      <div style="margin-top:14px"><button class="btn sm danger" id="allyLeave">🚪 Salir de la alianza</button></div>
    </div>`;
    $("#tabAlly").innerHTML = html;
    $("#chatSend").onclick = () => this.sendChat();
    $("#chatIn").onkeydown = e => { if(e.key === "Enter") this.sendChat(); };
    $("#allyLeave").onclick = () => this.leaveAlly(info.name);
    await this.loadChat();
    this.startChatPoll();
  },
  stopChatPoll(){ clearInterval(this.chatTimer); this.chatTimer = null; },
  startChatPoll(){ this.stopChatPoll(); this.chatTimer = setInterval(() => this.loadChat(), 4000); },
  async loadChat(){
    try{
      const msgs = await sbRpc("wow_chat", { p_token: this.me.token, p_since: 0 });
      const box = document.getElementById("chatMsgs"); if(!box) return;
      box.innerHTML = (msgs && msgs.length)
        ? msgs.map(m => `<div class="cmsg${m.me ? " me" : ""}"><span class="cwho">${esc(m.name)}:</span> ${esc(m.msg)} <span class="ctime">${hora(m.created)}</span></div>`).join("")
        : '<div class="empty" style="padding:14px">Sé el primero en escribir.</div>';
      box.scrollTop = box.scrollHeight;
    }catch(_){}
  },
  async sendChat(){
    const inp = document.getElementById("chatIn"); const msg = inp ? inp.value.trim() : "";
    if(!msg) return;
    try{ await sbRpc("wow_chat_send", { p_token: this.me.token, p_msg: msg }); if(inp) inp.value = ""; await this.loadChat(); }
    catch(e){ toast(shortMsg(e), true); }
  },
  async createAlly(){
    const name = ($("#alName").value || "").trim(), tag = ($("#alTag").value || "").trim(), descr = ($("#alDesc").value || "").trim();
    if(name.length < 3) return toast("El nombre debe tener al menos 3 letras.", true);
    if(tag.length < 2) return toast("La etiqueta debe tener al menos 2 letras.", true);
    try{ await sbRpc("wow_alliance_create", { p_token: this.me.token, p_name: name, p_tag: tag, p_descr: descr }); await this.refresh(); await this.renderAlly(); toast("¡Alianza creada!"); }
    catch(e){ toast(shortMsg(e), true); }
  },
  async joinAlly(id){
    try{ await sbRpc("wow_alliance_join", { p_token: this.me.token, p_id: id }); await this.refresh(); await this.renderAlly(); toast("¡Te uniste a la alianza!"); }
    catch(e){ toast(shortMsg(e), true); }
  },
  async leaveAlly(name){
    if(!confirm("¿Seguro que quieres salir de " + name + "?")) return;
    try{ await sbRpc("wow_alliance_leave", { p_token: this.me.token }); this.stopChatPoll(); await this.refresh(); await this.renderAlly(); toast("Has salido de la alianza."); }
    catch(e){ toast(shortMsg(e), true); }
  }
};

window.addEventListener("error", ev => {
  try{ toast("Error: " + (ev.message || "desconocido"), true); }catch(_){}
});
document.addEventListener("DOMContentLoaded", () => Auth.init());
