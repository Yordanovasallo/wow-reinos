/* ================================================================
   REINOS DE AZEROTH - v2
   SOLO EL PORTAL DE USUARIOS (entrar / crear cuenta).
   Datos: Nombre del rey, Nombre del reino y contraseña.
   ================================================================ */
const SB_URL = "https://upvqpyxscajqoszqsowa.supabase.co/rest/v1";
const KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVwdnFweXhzY2FqcW9zenFzb3dhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTEzOTM5NTEsImV4cCI6MjEwNjk2OTk1MX0.JH-kcwpAd6y7BCqzTE5vj_hbNdbxaZecnty6XjPvQwg";

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
  return m.length > 180 ? m.slice(0, 177) + "…" : m;
}
function notice(el, text, cls){
  if(!el) return;
  el.textContent = text;
  el.className = "notice" + (cls ? " " + cls : "");
}
function showScreen(id){
  ["screenPortal", "screenHome", "screenAcct"].forEach(s => {
    const el = document.getElementById(s); if(el) el.classList.toggle("hidden", s !== id);
  });
}

/* ---------------- portal ---------------- */
const App = {
  token: null,
  user: null,

  init(){
    $("#tabLogin").onclick = () => this.tab("login");
    $("#tabReg").onclick = () => this.tab("reg");
    $("#formLogin").onsubmit = e => { e.preventDefault(); this.login(); };
    $("#formReg").onsubmit = e => { e.preventDefault(); this.register(); };
    $("#formPw").onsubmit = e => { e.preventDefault(); this.changePw(); };
    $("#btnAcct").onclick = () => this.acct();
    $("#btnBack").onclick = () => this.home();
    $("#btnLogout").onclick = () => this.logout();
    $("#btnLogout2").onclick = () => this.logout();

    const tok = localStorage.getItem("wow_token");
    if(tok){
      sbRpc("wow_check", { p_token: tok })
        .then(me => { if(me && me.id){ this.token = tok; this.user = me; this.home(); } else this.portal(); })
        .catch(() => this.portal());
    }else{
      this.portal();
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
      this.home();
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
      this.home();
    }catch(e){ notice($("#rgMsg"), shortMsg(e), "danger"); }
  },

  home(){
    if(!this.user) return this.portal();
    $("#hRealm").textContent = "🏰 " + this.user.realm;
    $("#hKing").textContent = this.user.name;
    showScreen("screenHome");
  },

  acct(){
    if(!this.user) return;
    $("#acctInfo").innerHTML = "👑 Rey: <b>" + esc(this.user.name) + "</b> · 🏰 Reino: <b>" + esc(this.user.realm) + "</b>";
    $("#pw1").value = ""; $("#pw2").value = "";
    notice($("#pwMsg"), "");
    showScreen("screenAcct");
  },

  async changePw(){
    const p1 = $("#pw1").value, p2 = $("#pw2").value;
    if(p1.length < 4) return notice($("#pwMsg"), "La contraseña debe tener al menos 4 caracteres.", "danger");
    if(p1 !== p2) return notice($("#pwMsg"), "Las contraseñas no coinciden.", "danger");
    try{
      const salt = newSalt();
      const hash = await pbkdf2Hex(p1, salt, 100000);
      await sbRpc("wow_change_password", { p_token: this.token, p_salt: salt, p_hash: hash });
      notice($("#pwMsg"), "¡Contraseña cambiada!", "ok");
    }catch(e){ notice($("#pwMsg"), shortMsg(e), "danger"); }
  },

  async logout(){
    try{ await sbRpc("wow_logout", { p_token: this.token }); }catch(_){}
    localStorage.removeItem("wow_token");
    this.token = null; this.user = null;
    this.portal();
  }
};

function esc(s){ return String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }

window.addEventListener("error", ev => {
  try{
    const box = document.getElementById("rgMsg") || document.getElementById("liMsg");
    if(box){ box.textContent = "Error inesperado: " + (ev.message || "desconocido"); box.className = "notice danger"; }
  }catch(_){}
});
document.addEventListener("DOMContentLoaded", () => App.init());
