/* ================================================================
   REINOS DE AZEROTH - v3
   Portal de usuarios + menú plegable + Edificios (construir).
   ================================================================ */
const SB_URL = "https://upvqpyxscajqoszqsowa.supabase.co/rest/v1";
const KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVwdnFweXhzY2FqcW9zenFzb3dhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTEzOTM5NTEsImV4cCI6MjEwNjk2OTk1MX0.JH-kcwpAd6y7BCqzTE5vj_hbNdbxaZecnty6XjPvQwg";

const BLD = {
  ayuntamiento: { e:"🏛️", n:"Ayuntamiento", d:"El corazón de tu reino." },
  mina:         { e:"⛏️", n:"Mina",         d:"Extrae mineral." },
  granja:       { e:"🌾", n:"Granja",       d:"Alimenta a tu pueblo." },
  aserradero:   { e:"🪵", n:"Aserradero",   d:"Corta y guarda madera." },
  cuartel:      { e:"⚔️", n:"Cuartel",      d:"Entrena a tus tropas." },
  herreria:     { e:"🔨", n:"Herrería",     d:"Forja armas y armaduras." },
  mercado:      { e:"🏪", n:"Mercado",      d:"Comercia con otros reinos." },
  muralla:      { e:"🛡️", n:"Muralla",      d:"Protege tu reino." },
  torre:        { e:"🔭", n:"Torre",        d:"Vigila el horizonte." }
};

const $ = sel => document.querySelector(sel);

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
  const bits = await crypto.subtle.deriveBits({ name:"PBKDF2", salt, iterations:iters, hash:"SHA-256" }, key, 256);
  return [...new Uint8Array(bits)].map(b => b.toString(16).padStart(2, "0")).join("");
}
function newSalt(){
  const a = new Uint8Array(16);
  crypto.getRandomValues(a);
  return [...a].map(b => b.toString(16).padStart(2, "0")).join("");
}
const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
function shortMsg(e){
  const m = (e && e.message) || "Algo falló.";
  return m.length > 180 ? m.slice(0, 177) + "…" : m;
}
function notice(el, text, cls){
  if(!el) return;
  el.textContent = text;
  el.className = "notice" + (cls ? " " + cls : "");
}

const App = {
  token: null,
  user: null,
  page: "home",

  init(){
    $("#tabLogin").onclick = () => this.tab("login");
    $("#tabReg").onclick = () => this.tab("reg");
    $("#formLogin").onsubmit = e => { e.preventDefault(); this.login(); };
    $("#formReg").onsubmit = e => { e.preventDefault(); this.register(); };

    $("#menuBtn").onclick = () => this.toggleMenu();
    $("#menuOver").onclick = () => this.closeMenu();
    $("#mLogout").onclick = () => this.logout();
    document.querySelectorAll(".menuItem").forEach(btn => {
      btn.onclick = () => this.go(btn.dataset.page);
    });

    const tok = localStorage.getItem("wow_token");
    if(tok){
      sbRpc("wow_check", { p_token: tok })
        .then(me => { if(me && me.id){ this.token = tok; this.user = me; this.enterGame(); } else this.portal(); })
        .catch(() => this.portal());
    }else{
      this.portal();
    }
  },

  /* ---------- portal ---------- */
  portal(){
    this.show("screenPortal");
    notice($("#liMsg"), ""); notice($("#rgMsg"), "");
  },
  tab(which){
    $("#tabLogin").classList.toggle("on", which === "login");
    $("#tabReg").classList.toggle("on", which === "reg");
    $("#formLogin").classList.toggle("hidden", which !== "login");
    $("#formReg").classList.toggle("hidden", which !== "reg");
  },
  async login(){
    const name = $("#liName").value.trim(), pass = $("#liPass").value;
    if(!name || !pass) return notice($("#liMsg"), "Escribe tu nombre de rey y tu contraseña.", "danger");
    notice($("#liMsg"), "Entrando…");
    try{
      const salt = await sbRpc("wow_salt", { p_name: name });
      if(!salt) throw new Error("Nombre o contraseña incorrectos.");
      const hash = await pbkdf2Hex(pass, salt, 100000);
      const r = await sbRpc("wow_login", { p_name: name, p_hash: hash });
      localStorage.setItem("wow_token", r.token);
      this.token = r.token; this.user = { id: r.id, name: r.name, realm: r.realm };
      notice($("#liMsg"), "");
      this.enterGame();
    }catch(e){ notice($("#liMsg"), shortMsg(e), "danger"); }
  },
  async register(){
    const name = $("#rgName").value.trim(), realm = $("#rgRealm").value.trim(), pass = $("#rgPass").value;
    if(name.length < 2) return notice($("#rgMsg"), "Escribe tu nombre de rey (así entrarás después).", "danger");
    if(realm.length < 2) return notice($("#rgMsg"), "Escribe el nombre de tu reino.", "danger");
    if(pass.length < 4) return notice($("#rgMsg"), "La contraseña debe tener al menos 4 caracteres.", "danger");
    notice($("#rgMsg"), "Creando tu cuenta…");
    try{
      const salt = newSalt();
      const hash = await pbkdf2Hex(pass, salt, 100000);
      await sbRpc("wow_register", { p_name: name, p_realm: realm, p_salt: salt, p_hash: hash, p_now: Date.now() });
      const r = await sbRpc("wow_login", { p_name: name, p_hash: hash });
      localStorage.setItem("wow_token", r.token);
      this.token = r.token; this.user = { id: r.id, name: r.name, realm: r.realm };
      notice($("#rgMsg"), "");
      this.enterGame();
    }catch(e){ notice($("#rgMsg"), shortMsg(e), "danger"); }
  },
  async logout(){
    try{ await sbRpc("wow_logout", { p_token: this.token }); }catch(_){}
    localStorage.removeItem("wow_token");
    this.token = null; this.user = null;
    this.portal();
  },

  /* ---------- juego ---------- */
  show(id){
    ["screenPortal","screenGame"].forEach(s => {
      const el = document.getElementById(s); if(el) el.classList.toggle("hidden", s !== id);
    });
  },
  enterGame(){
    if(!this.user) return this.portal();
    $("#topRealm").textContent = "🏰 " + this.user.realm;
    $("#topKing").textContent = "👑 " + this.user.name;
    $("#menuRealm").textContent = this.user.realm;
    this.show("screenGame");
    this.go("home");
  },
  toggleMenu(){ document.getElementById("menu").classList.contains("hidden") ? this.openMenu() : this.closeMenu(); },
  openMenu(){
    $("#menu").classList.remove("hidden"); $("#menuOver").classList.remove("hidden");
    requestAnimationFrame(() => $("#menu").classList.add("open"));
  },
  closeMenu(){
    $("#menu").classList.remove("open");
    setTimeout(() => { $("#menu").classList.add("hidden"); $("#menuOver").classList.add("hidden"); }, 250);
  },
  go(page){
    this.page = page;
    document.querySelectorAll(".menuItem").forEach(b => b.classList.toggle("on", b.dataset.page === page));
    this.closeMenu();
    if(page === "buildings") return this.renderBuildings();
    if(page === "account")   return this.renderAccount();
    return this.renderHome();
  },

  renderHome(){
    $("#page").innerHTML = `
      <div class="cardHome">
        <h1 class="realmTitle">🏰 ${esc(this.user.realm)}</h1>
        <p class="kingLine">👑 Rey <b>${esc(this.user.name)}</b></p>
        <p class="hint">Toca el botón <b>☰</b> de arriba a la izquierda para abrir el menú.<br>
        Empieza en <b>🏰 Edificios</b> para construir tu reino.</p>
      </div>`;
  },

  async renderBuildings(){
    $("#page").innerHTML = `<h2 class="pageTitle">🏰 Edificios</h2>
      <p class="pageSub">Construye los edificios de tu reino.</p>
      <div id="bGrid" class="grid"></div>
      <div id="bMsg" class="notice"></div>`;
    try{
      const list = await sbRpc("wow_buildings", { p_token: this.token });
      this.drawBuildings(list);
    }catch(e){ notice($("#bMsg"), shortMsg(e), "danger"); }
  },
  drawBuildings(list){
    const grid = $("#bGrid"); if(!grid) return;
    if(!list.length){ grid.innerHTML = `<p class="hint">No hay edificios disponibles.</p>`; return; }
    grid.innerHTML = list.map(it => {
      const c = BLD[it.key] || { e:"🏠", n:it.key, d:"" };
      if(it.built){
        return `<div class="bcard done">
            <div class="bcardTop"><span class="emoji">${c.e}</span>
              <div><div class="bName">${esc(c.n)}</div><div class="bDesc">${esc(c.d)}</div></div></div>
            <div class="built">✅ Construido <span class="lvl">Nivel ${it.level}</span></div>
          </div>`;
      }
      return `<div class="bcard">
          <div class="bcardTop"><span class="emoji">${c.e}</span>
            <div><div class="bName">${esc(c.n)}</div><div class="bDesc">${esc(c.d)}</div></div></div>
          <button class="btn" data-build="${esc(it.key)}">🔨 Construir</button>
        </div>`;
    }).join("");
    grid.querySelectorAll("[data-build]").forEach(btn => {
      btn.onclick = () => this.build(btn);
    });
  },
  async build(btn){
    const key = btn.dataset.build;
    btn.disabled = true; btn.textContent = "Construyendo…";
    try{
      await sbRpc("wow_build", { p_token: this.token, p_key: key });
      const list = await sbRpc("wow_buildings", { p_token: this.token });
      this.drawBuildings(list);
      notice($("#bMsg"), "✅ ¡Construido!", "ok");
    }catch(e){
      notice($("#bMsg"), shortMsg(e), "danger");
      btn.disabled = false; btn.textContent = "🔨 Construir";
    }
  },

  renderAccount(){
    $("#page").innerHTML = `
      <h2 class="pageTitle">👤 Mi cuenta</h2>
      <p class="pageSub">Estos son los datos de tu rey.</p>
      <div class="cardHome">
        <p class="kingLine">👑 Rey: <b>${esc(this.user.name)}</b><br>🏰 Reino: <b>${esc(this.user.realm)}</b></p>
        <h3 class="bName" style="margin:6px 0 8px">Cambiar contraseña</h3>
        <form id="formPw">
          <input id="pw1" type="password" placeholder="Nueva contraseña" autocomplete="new-password">
          <input id="pw2" type="password" placeholder="Repite la contraseña" autocomplete="new-password">
          <button class="btn">Guardar contraseña</button>
          <div id="pwMsg" class="notice"></div>
        </form>
        <div class="rowBtns"><button class="btn sm" id="accLogout">🚪 Salir de mi cuenta</button></div>
      </div>`;
    $("#formPw").onsubmit = e => { e.preventDefault(); this.changePw(); };
    $("#accLogout").onclick = () => this.logout();
  },
  async changePw(){
    const p1 = $("#pw1").value, p2 = $("#pw2").value;
    if(p1.length < 4) return notice($("#pwMsg"), "La contraseña debe tener al menos 4 caracteres.", "danger");
    if(p1 !== p2) return notice($("#pwMsg"), "Las contraseñas no coinciden.", "danger");
    try{
      const salt = newSalt();
      const hash = await pbkdf2Hex(p1, salt, 100000);
      await sbRpc("wow_change_password", { p_token: this.token, p_salt: salt, p_hash: hash });
      $("#pw1").value = ""; $("#pw2").value = "";
      notice($("#pwMsg"), "¡Contraseña cambiada!", "ok");
    }catch(e){ notice($("#pwMsg"), shortMsg(e), "danger"); }
  }
};

window.addEventListener("error", ev => {
  const box = document.getElementById("rgMsg") || document.getElementById("liMsg");
  if(box){ box.textContent = "Error inesperado: " + (ev.message || "desconocido"); box.className = "notice danger"; }
});
document.addEventListener("DOMContentLoaded", () => App.init());
