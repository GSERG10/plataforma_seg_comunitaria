// Plataforma Comunitária de Segurança
// Versão integrada ao Supabase: autenticação e ocorrências compartilhadas online.

const SUPABASE_URL = "https://nedzmcdmuwkaveabxmua.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5lZHptY2RtdXdrYXZlYWJ4bXVhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTg1NTE3ODYsImV4cCI6MjA3NDEyNzc4Nn0.wUs7XJlTYb2hohi2MjJeLczwiPoEfk9DibSianjRNGs";

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let usuarios = [];
let ocorrencias = [];
let usuarioLogado = null;
let tempCoords = null;
let filtrosAtivos = { tipo: "", inicio: "", fim: "" };

// --- Inicialização do Mapa ---
const map = L.map("map").setView([-18.9186, -48.2772], 13);

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  attribution: '&copy; <a href="https://www.openstreetmap.org/">OpenStreetMap</a> contributors',
}).addTo(map);

const markersLayer = L.layerGroup().addTo(map);

// --- Geocodificação ---
async function geocodeAddress(fullAddress) {
  const searchAddress = `${fullAddress}, Uberlândia, MG`;
  const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(searchAddress)}&limit=1`;

  try {
    const response = await fetch(url, { headers: { "Accept-Language": "pt-BR" } });
    const data = await response.json();

    if (data && data.length > 0) {
      const result = data[0];
      return {
        lat: parseFloat(result.lat),
        lng: parseFloat(result.lon),
        displayName: result.display_name,
      };
    }
    return null;
  } catch (error) {
    console.error("Erro ao buscar coordenadas:", error);
    return null;
  }
}

document.getElementById("btnGeocode").addEventListener("click", async () => {
  const tipoLogradouro = document.getElementById("tipoLogradouro").value;
  const endereco = document.getElementById("endereco").value.trim();
  const fullAddress = `${tipoLogradouro} ${endereco}`;

  if (!endereco) {
    alert("Por favor, digite o nome do logradouro e bairro para localizar.");
    return;
  }

  const coords = await geocodeAddress(fullAddress);

  if (coords) {
    tempCoords = { lat: coords.lat, lng: coords.lng, address: fullAddress };
    map.setView([coords.lat, coords.lng], 16);
    markersLayer.clearLayers();
    L.marker([coords.lat, coords.lng])
      .addTo(markersLayer)
      .bindPopup(`Localização Confirmada: ${coords.displayName}`)
      .openPopup();
    alert(`Endereço localizado: ${coords.displayName}. Agora você pode registrar!`);
  } else {
    alert("Não foi possível localizar o endereço. Verifique a grafia e tente novamente.");
    tempCoords = null;
  }
});

// --- Autenticação e perfis ---
async function carregarPerfil(userId) {
  const { data, error } = await supabaseClient
    .from("profiles")
    .select("id,nome,sobrenome,email,role,created_at")
    .eq("id", userId)
    .single();

  if (error) {
    console.error("Erro ao carregar perfil:", error);
    return null;
  }
  return data;
}

async function sincronizarSessao() {
  const { data, error } = await supabaseClient.auth.getUser();

  if (error || !data?.user) {
    usuarioLogado = null;
  } else {
    usuarioLogado = await carregarPerfil(data.user.id);
  }

  atualizarAuthBar();
  await carregarOcorrencias();

  if (usuarioLogado?.role === "admin") {
    await carregarUsuarios();
  } else {
    usuarios = [];
    renderizarUsuarios();
  }
}

document.getElementById("loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();

  const email = document.getElementById("logEmail").value.trim();
  const senha = document.getElementById("logSenha").value;

  const { data, error } = await supabaseClient.auth.signInWithPassword({
    email,
    password: senha,
  });

  if (error) {
    alert("Não foi possível entrar. Verifique o e-mail e a senha.");
    console.error(error);
    return;
  }

  usuarioLogado = await carregarPerfil(data.user.id);
  document.getElementById("loginForm").reset();
  alert(`Login bem-sucedido! Olá, ${usuarioLogado?.nome || data.user.email}.`);

  atualizarAuthBar();
  await carregarOcorrencias();
  if (usuarioLogado?.role === "admin") await carregarUsuarios();
});

document.getElementById("cadastroForm").addEventListener("submit", async (e) => {
  e.preventDefault();

  const nome = document.getElementById("cadNome").value.trim();
  const sobrenome = document.getElementById("cadSobrenome").value.trim();
  const email = document.getElementById("cadEmail").value.trim();
  const senha = document.getElementById("cadSenha").value;

  if (!nome || !sobrenome || !email || senha.length < 6) {
    alert("Preencha todos os campos. A senha deve ter pelo menos 6 caracteres.");
    return;
  }

  const { data, error } = await supabaseClient.auth.signUp({
    email,
    password: senha,
    options: {
      data: { nome, sobrenome },
    },
  });

  if (error) {
    alert(error.message || "Não foi possível criar a conta.");
    console.error(error);
    return;
  }

  document.getElementById("cadastroForm").reset();

  if (data.session) {
    usuarioLogado = await carregarPerfil(data.user.id);
    atualizarAuthBar();
    await carregarOcorrencias();
    alert("Conta criada com sucesso! Você já está conectado.");
  } else {
    alert("Conta criada. Verifique seu e-mail para confirmar o cadastro e depois faça login.");
  }
});

document.getElementById("btnLogout").addEventListener("click", async () => {
  await supabaseClient.auth.signOut();
  usuarioLogado = null;
  usuarios = [];
  atualizarAuthBar();
  renderizarUsuarios();
  await carregarOcorrencias();
  alert("Você saiu da plataforma.");
});

supabaseClient.auth.onAuthStateChange(() => {
  // Evita executar novas chamadas do Supabase diretamente dentro do callback.
  setTimeout(() => sincronizarSessao(), 0);
});

function atualizarAuthBar() {
  const loginStatus = document.getElementById("loginStatus");
  const btnLogout = document.getElementById("btnLogout");
  const userManagementCard = document.getElementById("userManagementCard");
  const loginSummary = document.querySelector("details.card summary");
  const loginDetails = document.querySelector("details.card");

  if (usuarioLogado) {
    const papel = usuarioLogado.role === "admin" ? "administrador" : "usuário";
    loginStatus.innerHTML = `<strong>${escapeHtml(usuarioLogado.nome || usuarioLogado.email)}</strong> (${papel})`;
    btnLogout.style.display = "inline-block";
    loginSummary.innerHTML = "<strong>Acesso de Usuário</strong>";
    loginDetails.removeAttribute("open");

    if (usuarioLogado.role === "admin") {
      userManagementCard.style.display = "block";
      userManagementCard.setAttribute("aria-hidden", "false");
    } else {
      userManagementCard.style.display = "none";
      userManagementCard.setAttribute("aria-hidden", "true");
    }
  } else {
    loginStatus.textContent = "Deslogado";
    btnLogout.style.display = "none";
    loginSummary.innerHTML = "<strong>Cadastro / Login</strong>";
    userManagementCard.style.display = "none";
    userManagementCard.setAttribute("aria-hidden", "true");
  }
}

// --- Painel de usuários (somente admin) ---
async function carregarUsuarios() {
  if (usuarioLogado?.role !== "admin") return;

  const { data, error } = await supabaseClient
    .from("profiles")
    .select("id,nome,sobrenome,email,role,created_at")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Erro ao carregar usuários:", error);
    return;
  }

  usuarios = data || [];
  renderizarUsuarios();
}

function renderizarUsuarios() {
  const card = document.getElementById("userManagementCard");
  const total = document.getElementById("totalUsuarios");
  const lista = document.getElementById("listaUsuarios");
  if (!card || !total || !lista) return;

  if (usuarioLogado?.role !== "admin") {
    card.style.display = "none";
    total.textContent = "0";
    lista.innerHTML = "";
    return;
  }

  card.style.display = "block";
  total.textContent = String(usuarios.length);
  lista.innerHTML = "";

  usuarios.forEach((u) => {
    const li = document.createElement("li");
    li.innerHTML = `
      <div>
        <strong>${escapeHtml(`${u.nome || ""} ${u.sobrenome || ""}`.trim() || u.email)}</strong><br>
        <small>${escapeHtml(u.email)}</small>
        ${u.role === "admin" ? '<span class="badge aprovada">Admin</span>' : ""}
      </div>
    `;
    lista.appendChild(li);
  });
}

// --- Ocorrências ---
async function carregarOcorrencias() {
  const { data, error } = await supabaseClient
    .from("ocorrencias")
    .select("id,user_id,nome,tipo,endereco,data_fato,descricao,status,latitude,longitude,created_at")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Erro ao carregar ocorrências:", error);
    ocorrencias = [];
  } else {
    ocorrencias = (data || []).map((o) => ({
      ...o,
      data: o.data_fato,
      lat: o.latitude,
      lng: o.longitude,
    }));
  }

  renderizarOcorrencias();
  atualizarMapa();
  atualizarEstatisticas();
}

document.getElementById("ocorrenciaForm").addEventListener("submit", async (e) => {
  e.preventDefault();

  if (!usuarioLogado) {
    alert("Você precisa estar logado para registrar uma ocorrência.");
    return;
  }
  if (!tempCoords) {
    alert("Clique em 'Localizar' para confirmar as coordenadas no mapa.");
    return;
  }

  const nome = document.getElementById("nome").value.trim() || "Anônimo";
  const tipo = document.getElementById("tipoOcorrencia").value;
  const dataFato = document.getElementById("dataFato").value;
  const descricao = document.getElementById("descricao").value.trim();

  if (!tipo || !dataFato || !descricao) {
    alert("Preencha todos os campos obrigatórios.");
    return;
  }

  const { error } = await supabaseClient.from("ocorrencias").insert({
    user_id: usuarioLogado.id,
    nome,
    tipo,
    endereco: tempCoords.address,
    data_fato: new Date(dataFato).toISOString(),
    descricao,
    status: "pendente",
    latitude: tempCoords.lat,
    longitude: tempCoords.lng,
  });

  if (error) {
    console.error(error);
    alert("Não foi possível registrar a ocorrência.");
    return;
  }

  alert("Ocorrência registrada e enviada para moderação.");
  e.target.reset();
  tempCoords = null;
  markersLayer.clearLayers();
  await carregarOcorrencias();
});

function ocorrenciasFiltradas() {
  return ocorrencias.filter((o) => {
    if (filtrosAtivos.tipo && o.tipo !== filtrosAtivos.tipo) return false;

    const data = new Date(o.data_fato || o.data);
    if (filtrosAtivos.inicio) {
      const ini = new Date(`${filtrosAtivos.inicio}T00:00:00`);
      if (data < ini) return false;
    }
    if (filtrosAtivos.fim) {
      const fim = new Date(`${filtrosAtivos.fim}T23:59:59`);
      if (data > fim) return false;
    }
    return true;
  });
}

function renderizarOcorrencias() {
  const lista = document.getElementById("listaOcorrencias");
  lista.innerHTML = "";

  const dados = ocorrenciasFiltradas();
  if (!dados.length) {
    const li = document.createElement("li");
    li.textContent = "Nenhuma ocorrência encontrada.";
    lista.appendChild(li);
    return;
  }

  dados.forEach((o) => {
    const data = new Date(o.data_fato || o.data);
    const li = document.createElement("li");
    li.innerHTML = `
      <strong>${escapeHtml(o.tipo)}</strong> em ${escapeHtml(o.endereco)} (${data.toLocaleDateString("pt-BR")})<br>
      Relato: ${escapeHtml(o.descricao)}<br>
      <small class="muted">Reportado por: ${escapeHtml(o.nome || "Anônimo")} | ${data.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</small>
      <span class="badge ${escapeHtml(o.status)}">${escapeHtml(o.status)}</span>
    `;

    if (usuarioLogado?.role === "admin") {
      const actions = document.createElement("div");
      actions.classList.add("admin-actions");

      if (o.status !== "aprovada") {
        const btnAprovar = document.createElement("button");
        btnAprovar.textContent = "Aprovar";
        btnAprovar.classList.add("btn", "secondary");
        btnAprovar.onclick = () => atualizarStatus(o.id, "aprovada");
        actions.appendChild(btnAprovar);
      }

      if (o.status !== "rejeitada") {
        const btnRejeitar = document.createElement("button");
        btnRejeitar.textContent = "Rejeitar";
        btnRejeitar.classList.add("btn", "danger");
        btnRejeitar.onclick = () => atualizarStatus(o.id, "rejeitada");
        actions.appendChild(btnRejeitar);
      }

      li.appendChild(actions);
    }

    lista.appendChild(li);
  });
}

async function atualizarStatus(id, status) {
  if (usuarioLogado?.role !== "admin") return;

  const ocorrencia = ocorrencias.find((o) => o.id === id);
  if (!ocorrencia) return;

  const update = { status };

  if (status === "aprovada" && (!ocorrencia.latitude || !ocorrencia.longitude)) {
    const geo = await geocodeAddress(ocorrencia.endereco);
    if (geo) {
      update.latitude = geo.lat;
      update.longitude = geo.lng;
    }
  }

  const { error } = await supabaseClient
    .from("ocorrencias")
    .update(update)
    .eq("id", id);

  if (error) {
    console.error(error);
    alert("Não foi possível atualizar o status.");
    return;
  }

  await carregarOcorrencias();
}

function atualizarMapa() {
  markersLayer.clearLayers();

  ocorrencias
    .filter((o) => o.status === "aprovada" && Number.isFinite(o.latitude) && Number.isFinite(o.longitude))
    .forEach((o) => {
      const marker = L.marker([o.latitude, o.longitude]).addTo(markersLayer);
      marker.bindPopup(
        `<strong>${escapeHtml(o.tipo)}</strong> em ${escapeHtml(o.endereco)}<br>${escapeHtml(o.descricao)}<br><span class="badge ${escapeHtml(o.status)}">${escapeHtml(o.status)}</span>`
      );
    });
}

function atualizarEstatisticas() {
  const lista = document.getElementById("listaEstatisticas");
  const totalConsideradoEl = document.getElementById("totalOcorrenciasAprovadas");
  const totalPendentesEl = document.getElementById("totalPendentes");
  const totalAprovadasEl = document.getElementById("totalAprovadasTotal");
  const totalRejeitadasEl = document.getElementById("totalRejeitadas");

  lista.innerHTML = "";

  const totalPendentes = ocorrencias.filter((o) => o.status === "pendente").length;
  const totalAprovadas = ocorrencias.filter((o) => o.status === "aprovada").length;
  const totalRejeitadas = ocorrencias.filter((o) => o.status === "rejeitada").length;

  totalPendentesEl.textContent = String(totalPendentes);
  totalAprovadasEl.textContent = String(totalAprovadas);
  totalRejeitadasEl.textContent = String(totalRejeitadas);
  totalConsideradoEl.textContent = String(totalAprovadas);

  const contagemTipos = ocorrencias
    .filter((o) => o.status === "aprovada")
    .reduce((acc, o) => {
      acc[o.tipo] = (acc[o.tipo] || 0) + 1;
      return acc;
    }, {});

  Object.entries(contagemTipos).forEach(([tipo, value]) => {
    const percent = totalAprovadas ? (value / totalAprovadas) * 100 : 0;
    const li = document.createElement("li");
    li.classList.add("stats-item");
    li.innerHTML = `
      <div class="stats-label">
        <span>${escapeHtml(tipo)}</span>
        <span>${value} (${Math.round(percent)}%)</span>
      </div>
      <div class="stats-bar-container">
        <div class="stats-bar" style="width:${percent}%"></div>
      </div>
    `;
    lista.appendChild(li);
  });
}

// --- Filtros ---
document.getElementById("btnFiltrar").addEventListener("click", () => {
  filtrosAtivos = {
    tipo: document.getElementById("filtroTipo").value,
    inicio: document.getElementById("filtroIni").value,
    fim: document.getElementById("filtroFim").value,
  };
  renderizarOcorrencias();
});

document.getElementById("btnLimpar").addEventListener("click", () => {
  document.getElementById("filtroTipo").value = "";
  document.getElementById("filtroIni").value = "";
  document.getElementById("filtroFim").value = "";
  filtrosAtivos = { tipo: "", inicio: "", fim: "" };
  renderizarOcorrencias();
});

function escapeHtml(valor) {
  return String(valor ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

// --- Inicialização ---
async function inicializar() {
  atualizarAuthBar();
  await sincronizarSessao();
}

inicializar();

// Ajusta o espaçamento do body para não ficar sob o header fixo.
function ajustarEspacoDoHeader() {
  const header = document.querySelector(".site-header");
  if (!header) return;
  document.body.style.paddingTop = `${header.offsetHeight}px`;
}

window.addEventListener("load", ajustarEspacoDoHeader);
window.addEventListener("resize", ajustarEspacoDoHeader);

(function headerScrollEffect() {
  let ticking = false;
  window.addEventListener(
    "scroll",
    () => {
      if (!ticking) {
        window.requestAnimationFrame(() => {
          const sc = window.scrollY || document.documentElement.scrollTop;
          const header = document.querySelector(".site-header");
          if (sc > 8) {
            document.body.classList.add("scrolled");
            header.classList.add("is-stuck");
          } else {
            document.body.classList.remove("scrolled");
            header.classList.remove("is-stuck");
          }
          ticking = false;
        });
        ticking = true;
      }
    },
    { passive: true }
  );
})();
