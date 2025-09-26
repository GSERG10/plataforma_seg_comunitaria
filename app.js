// /// --- Funções de Persistência de Dados ---

/** Salva os arrays globais (usuarios e ocorrencias) no localStorage. */
function salvarDados() {
  localStorage.setItem("usuariosPCS", JSON.stringify(usuarios));
  localStorage.setItem("ocorrenciasPCS", JSON.stringify(ocorrencias));
}

/** Carrega os arrays globais do localStorage, migra chaves antigas e garante que o Admin exista. */
function carregarDados() {
  const usuariosSalvos = localStorage.getItem("usuariosPCS");
  const ocorrenciasSalvas = localStorage.getItem("ocorrenciasPCS");

  // --- MIGRAÇÃO (caso tenha usado chaves antigas em versões anteriores) ---
  if (!usuariosSalvos) {
    const legacyUsers = localStorage.getItem("users");
    if (legacyUsers) {
      try {
        const arr = JSON.parse(legacyUsers);
        if (Array.isArray(arr)) {
          usuarios = arr.map(x => ({
            email: x.email || "",
            password: x.pass || x.password || "",
            nome: x.nome || x.name || "",
            role: x.isAdmin ? "admin" : (x.role || "user"),
          }));
          salvarDados();
          localStorage.removeItem("users");
        }
      } catch {}
    }
  }
  if (!ocorrenciasSalvas) {
    const legacyOcc = localStorage.getItem("ocorrencias");
    if (legacyOcc) {
      try {
        const arr = JSON.parse(legacyOcc);
        if (Array.isArray(arr)) {
          ocorrencias = arr;
          salvarDados();
          localStorage.removeItem("ocorrencias");
        }
      } catch {}
    }
  }
  // --------------------------------------------

  // Carrega usuários
  if (usuariosSalvos) {
    usuarios = JSON.parse(usuariosSalvos);
  } else {
    usuarios = usuarios || [];
  }

  // Garante admin seed
  const adminExiste = usuarios.some((u) => u.email === "admin@pcs.com");
  if (!adminExiste) {
    usuarios.push({ email: "admin@pcs.com", password: "admin", nome: "Admin", role: "admin" });
    salvarDados();
  }

  // Carrega ocorrências
  if (ocorrenciasSalvas) {
    ocorrencias = JSON.parse(ocorrenciasSalvas);
  } else {
    ocorrencias = ocorrencias || [];
  }
}

// --- Dados e Variáveis Globais ---
let usuarios = [];
let ocorrencias = [];
let usuarioLogado = null;
let tempCoords = null;

// Carrega dados ANTES de registrar listeners (evita handlers com arrays vazios)
carregarDados();

// --- Inicialização do Mapa ---
const map = L.map("map").setView([-18.9186, -48.2772], 13);

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  attribution: '&copy; <a href="https://www.openstreetmap.org/">OpenStreetMap</a> contributors',
}).addTo(map);

const markersLayer = L.layerGroup().addTo(map);

// --- 1. Geocodificação ---
async function geocodeAddress(fullAddress) {
  const searchAddress = `${fullAddress}, Uberlândia, MG`;
  const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(searchAddress)}&limit=1`;

  try {
    const response = await fetch(url, { headers: { "Accept-Language": "pt-BR" } });
    const data = await response.json();

    if (data && data.length > 0) {
      const result = data[0];
      return { lat: parseFloat(result.lat), lng: parseFloat(result.lon), displayName: result.display_name };
    } else {
      return null;
    }
  } catch (error) {
    console.error("Erro ao buscar coordenadas:", error);
    return null;
  }
}

document.getElementById("btnGeocode").addEventListener("click", async () => {
  const tipoLogradouro = document.getElementById("tipoLogradouro").value;
  const endereco = document.getElementById("endereco").value;
  const fullAddress = `${tipoLogradouro} ${endereco}`;

  if (!endereco) {
    alert("Por favor, digite o nome do logradouro e bairro (Ex: Flores, Jardim Esperança) para localizar.");
    return;
  }

  const coords = await geocodeAddress(fullAddress);

  if (coords) {
    tempCoords = { lat: coords.lat, lng: coords.lng, address: fullAddress };
    map.setView([coords.lat, coords.lng], 16);
    markersLayer.clearLayers();
    L.marker([coords.lat, coords.lng]).addTo(markersLayer).bindPopup(`Localização Confirmada: ${coords.displayName}`).openPopup();
    alert(`Endereço localizado: ${coords.displayName}. Agora você pode registrar!`);
  } else {
    alert("Não foi possível localizar o endereço. Verifique a grafia e tente incluir o nome completo do bairro. Por exemplo: 'Avenida Brasil, Bairro Umuarama'.");
    tempCoords = null;
  }
});

// --- 2. Autenticação (Login e Cadastro) ---
document.getElementById("loginForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const email = document.getElementById("logEmail").value;
  const senha = document.getElementById("logSenha").value;

  const user = usuarios.find((u) => u.email === email && u.password === senha);

  if (user) {
    usuarioLogado = user;
    salvarDados(); // espelha estado atual imediatamente
    alert(`Login bem-sucedido! Olá, ${user.nome}.`);
    document.getElementById("loginForm").reset();
    document.querySelector("details.card summary").click();
    atualizarAuthBar();
    renderizarOcorrencias();
    if (usuarioLogado.role === "admin") renderizarUsuarios();
  } else {
    alert("Email ou senha inválidos.");
  }
});

document.getElementById("cadastroForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const nome = document.getElementById("cadNome").value;
  const sobrenome = document.getElementById("cadSobrenome").value;
  const email = document.getElementById("cadEmail").value;
  const senha = document.getElementById("cadSenha").value;

  if (usuarios.find((u) => u.email === email)) {
    alert("Este e-mail já está cadastrado.");
    return;
  }

  const novoUsuario = { email, password: senha, nome, sobrenome, role: "user" };
  usuarios.push(novoUsuario);
  salvarDados();

  alert("Conta criada com sucesso! Faça login para continuar.");
  document.getElementById("cadastroForm").reset();

  if (usuarioLogado?.role === "admin") renderizarUsuarios();
});

document.getElementById("btnLogout").addEventListener("click", () => {
  usuarioLogado = null;
  alert("Você saiu da plataforma.");
  const userManagementCard = document.getElementById("userManagementCard");
  if (userManagementCard) userManagementCard.style.display = "none";
  atualizarAuthBar();
  renderizarUsuarios();   // limpa a lista no painel
  renderizarOcorrencias();
});

// Painel/Barra de autenticação
function atualizarAuthBar() {
  const loginStatus = document.getElementById("loginStatus");
  const btnLogout = document.getElementById("btnLogout");
  const userManagementCard = document.getElementById("userManagementCard");
  const loginSummary = document.querySelector("details.card summary");
  const loginDetails = document.querySelector("details.card");

  if (usuarioLogado) {
    loginStatus.innerHTML = `<strong>${usuarioLogado.nome}</strong> (${usuarioLogado.role})`;
    btnLogout.style.display = "inline-block";
    loginSummary.innerHTML = `<strong>Acesso de Usuário</strong>`;
    loginDetails.removeAttribute("open");
    if (usuarioLogado.role === "admin") {
      if (userManagementCard) userManagementCard.style.display = "block";
      renderizarUsuarios();
    } else {
      if (userManagementCard) userManagementCard.style.display = "none";
    }
  } else {
    loginStatus.textContent = "Deslogado";
    btnLogout.style.display = "none";
    loginSummary.innerHTML = `<strong>Cadastro / Login</strong>`;
    if (userManagementCard) userManagementCard.style.display = "none";
  }
}

/* --------- Painel de Usuários (Admin) --------- */
function renderizarUsuarios() {
  const card  = document.getElementById("userManagementCard");
  const total = document.getElementById("totalUsuarios");
  const lista = document.getElementById("listaUsuarios");
  if (!card || !total || !lista) return;

  // mostra o painel apenas para admin logado
  if (!(usuarioLogado && usuarioLogado.role === "admin")) {
    card.style.display = "none";
    total.textContent = "0";
    lista.innerHTML = "";
    return;
  }
  card.style.display = "block";

  total.textContent = String(usuarios.length);
  lista.innerHTML = "";

  usuarios.forEach((u, idx) => {
    const li = document.createElement("li");
    li.innerHTML = `
      <div>
        <strong>${u.nome || u.email}</strong><br/>
        <small>${u.email}</small> ${u.role === "admin" ? '<span class="badge aprovada">Admin</span>' : ''}
      </div>
      <div class="user-actions">
        <button class="btn danger" data-del="${idx}" ${u.role === "admin" ? "disabled" : ""}>Excluir</button>
      </div>
    `;
    lista.appendChild(li);
  });

  // excluir usuário
  lista.onclick = (ev) => {
    const btn = ev.target.closest("button[data-del]");
    if (!btn) return;
    const i = parseInt(btn.getAttribute("data-del"), 10);
    const alvo = usuarios[i];
    if (!alvo) return;
    if (!confirm(`Excluir o usuário ${alvo.email}?`)) return;

    usuarios.splice(i, 1);
    salvarDados();

    // Opcional: marcar autor removido nas ocorrências
    ocorrencias = ocorrencias.map(o =>
      o.reportadoPor === alvo.email ? { ...o, reportadoPor: "(usuário removido)" } : o
    );
    salvarDados();

    renderizarUsuarios();
    renderizarOcorrencias();
    atualizarEstatisticas();
    atualizarMapa();
  };
}

// --- 3. Registro de Ocorrências ---
document.getElementById("ocorrenciaForm").addEventListener("submit", (e) => {
  e.preventDefault();

  if (!usuarioLogado) { alert("Você precisa estar logado para registrar uma ocorrência."); return; }
  if (!tempCoords) { alert("Por favor, clique em 'Localizar' para definir as coordenadas no mapa."); return; }

  const nome = document.getElementById("nome").value || "Anônimo";
  const tipoOcorrencia = document.getElementById("tipoOcorrencia").value;
  const dataFato = document.getElementById("dataFato").value;
  const descricao = document.getElementById("descricao").value;

  if (!tipoOcorrencia || !dataFato || !descricao) {
    alert("Preencha todos os campos obrigatórios (Tipo, Data/Hora, Descrição).");
    return;
  }

  const novaOcorrencia = {
    id: Date.now(),
    nome,
    tipo: tipoOcorrencia,
    endereco: tempCoords.address,
    data: dataFato,
    descricao,
    reportadoPor: usuarioLogado.email,
    status: "pendente",
    lat: tempCoords.lat,
    lng: tempCoords.lng,
  };

  ocorrencias.push(novaOcorrencia);
  salvarDados();

  alert("Ocorrência registrada e enviada para moderação.");

  e.target.reset();
  tempCoords = null;
  markersLayer.clearLayers();

  renderizarOcorrencias();
  atualizarMapa();
  atualizarEstatisticas();
});

// --- Renderização e Admin (lista de ocorrências etc.) ---
function renderizarOcorrencias() {
  const lista = document.getElementById("listaOcorrencias");
  const ocorrenciasFiltradas = ocorrencias;
  lista.innerHTML = "";

  ocorrenciasFiltradas.forEach((o) => {
    const li = document.createElement("li");
    li.innerHTML = `
      <strong>${o.tipo}</strong> em ${o.endereco} (${new Date(o.data).toLocaleDateString("pt-BR")})<br>
      Relato: ${o.descricao} <br>
      <small class="muted">Reportado por: ${o.nome} | ${new Date(o.data).toLocaleTimeString("pt-BR")}</small>
      <span class="badge ${o.status}">${o.status}</span>
    `;

    if (usuarioLogado?.role === "admin" && (o.status === "pendente" || o.status === "rejeitada")) {
      const actions = document.createElement("div");
      actions.classList.add("admin-actions");

      const btnAprovar = document.createElement("button");
      btnAprovar.textContent = "Aprovar";
      btnAprovar.classList.add("btn", "secondary");
      btnAprovar.onclick = () => atualizarStatus(o.id, "aprovada");

      const btnRejeitar = document.createElement("button");
      btnRejeitar.textContent = "Rejeitar";
      btnRejeitar.classList.add("btn", "danger");
      btnRejeitar.onclick = () => atualizarStatus(o.id, "rejeitada");

      actions.appendChild(btnAprovar);
      actions.appendChild(btnRejeitar);
      li.appendChild(actions);
    }
    lista.appendChild(li);
  });
}

// >>> Geocoding na aprovação se faltar lat/lng (garante marcador no mapa)
async function atualizarStatus(id, status) {
  const ocorrencia = ocorrencias.find((o) => o.id === id);
  if (!ocorrencia) return;

  ocorrencia.status = status;

  if (status === "aprovada" && (!ocorrencia.lat || !ocorrencia.lng)) {
    try {
      const geo = await geocodeAddress(ocorrencia.endereco);
      if (geo) {
        ocorrencia.lat = geo.lat;
        ocorrencia.lng = geo.lng;
      }
    } catch (e) {
      console.warn("Geocoding ao aprovar falhou:", e);
    }
  }

  salvarDados();
  renderizarOcorrencias();
  atualizarMapa();
  atualizarEstatisticas();
}

function atualizarMapa() {
  markersLayer.clearLayers();
  ocorrencias.filter((o) => o.status === "aprovada").forEach((o) => {
    const marker = L.marker([o.lat, o.lng]).addTo(markersLayer);
    marker.bindPopup(
      `<strong>${o.tipo}</strong> em ${o.endereco}<br>${o.descricao}<br><span class="badge ${o.status}">${o.status}</span>`
    );
  });
}

function atualizarEstatisticas() {
  const lista = document.getElementById("listaEstatisticas");
  const totalConsideradoEl = document.getElementById("totalOcorrenciasAprovadas");
  const totalPendentesEl = document.getElementById("totalPendentes");
  const totalAprovadasEl = document.getElementById("totalAprovadasTotal");
  const totalRejeitadasEl = document.getElementById("totalRejeitadas");

  if (lista) lista.innerHTML = "";

  const totalPendentes  = ocorrencias.filter(o => o.status === "pendente").length;
  const totalAprovadas  = ocorrencias.filter(o => o.status === "aprovada").length;
  const totalRejeitadas = ocorrencias.filter(o => o.status === "rejeitada").length;

  if (totalPendentesEl)  totalPendentesEl.textContent  = String(totalPendentes);
  if (totalAprovadasEl)  totalAprovadasEl.textContent  = String(totalAprovadas);
  if (totalRejeitadasEl) totalRejeitadasEl.textContent = String(totalRejeitadas);
  if (totalConsideradoEl) totalConsideradoEl.textContent = String(totalAprovadas);

  const contagemTipos = ocorrencias
    .filter(o => o.status === "aprovada")
    .reduce((acc,o)=>{ acc[o.tipo]=(acc[o.tipo]||0)+1; return acc; },{});

  for (const tipo in contagemTipos) {
    const value = contagemTipos[tipo];
    const percent = totalAprovadas ? (value/totalAprovadas)*100 : 0;

    const colorMap = {
      Roubo:"#B00020", Furto:"#DC3545", Drogas:"#8B4513",
      Violência:"#FF6347", Ameaça:"#FFD700", Acidente:"#808080", Outro:"#1F4E79"
    };
    const color = colorMap[tipo] || "#516F91";

    const li = document.createElement("li");
    li.classList.add("stats-item");
    li.innerHTML = `
      <div class="stats-label">
        <span>${tipo}</span>
        <span>${value} (${Math.round(percent)}%)</span>
      </div>
      <div class="stats-bar-container">
        <div class="stats-bar" style="width:${percent}%; background:${color}"></div>
      </div>
    `;
    lista.appendChild(li);
  }
}

// --- Inicialização ---
function inicializar() {
  // carregarDados(); // já foi chamado antes dos listeners
  atualizarAuthBar();
  renderizarOcorrencias();
  atualizarEstatisticas();
  if (usuarioLogado?.role === "admin") renderizarUsuarios();
}
inicializar();

// Ajusta o espaçamento do body para não "ficar sob" o header fixo
function ajustarEspacoDoHeader(){
  const header = document.querySelector('.site-header');
  if (!header) return;
  document.body.style.paddingTop = header.offsetHeight + 'px';
}

// roda no load e no resize
window.addEventListener('load', ajustarEspacoDoHeader);
window.addEventListener('resize', ajustarEspacoDoHeader);

/* ====== Animação do cabeçalho durante o scroll ======
   - O header é fixo (sticky).
   - Ao rolar, aplicamos uma classe no body para intensificar a sombra (efeito sutil).
   - Não ocultamos o cabeçalho (atende seu pedido para não sumir). */
(function headerScrollEffect(){
  let ticking = false;
  window.addEventListener('scroll', () => {
    if (!ticking) {
      window.requestAnimationFrame(() => {
        const sc = window.scrollY || document.documentElement.scrollTop;
        const header = document.querySelector('.site-header');
        if (sc > 8) {
          document.body.classList.add('scrolled');
          header.classList.add('is-stuck');
        } else {
          document.body.classList.remove('scrolled');
          header.classList.remove('is-stuck');
        }
        ticking = false;
      });
      ticking = true;
    }
  }, { passive: true });
})();
