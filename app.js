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
let selectionMarker = null;
let mapSelectionMode = false;
let ultimaRequisicaoNominatim = 0;

const UF_PARA_ESTADO = {
  AC: "Acre", AL: "Alagoas", AP: "Amapá", AM: "Amazonas", BA: "Bahia", CE: "Ceará",
  DF: "Distrito Federal", ES: "Espírito Santo", GO: "Goiás", MA: "Maranhão", MT: "Mato Grosso",
  MS: "Mato Grosso do Sul", MG: "Minas Gerais", PA: "Pará", PB: "Paraíba", PR: "Paraná",
  PE: "Pernambuco", PI: "Piauí", RJ: "Rio de Janeiro", RN: "Rio Grande do Norte",
  RS: "Rio Grande do Sul", RO: "Rondônia", RR: "Roraima", SC: "Santa Catarina",
  SP: "São Paulo", SE: "Sergipe", TO: "Tocantins"
};
const ESTADO_PARA_UF = Object.fromEntries(
  Object.entries(UF_PARA_ESTADO).map(([uf, estado]) => [estado.toLocaleLowerCase("pt-BR"), uf])
);

// --- Inicialização do Mapa ---
const map = L.map("map").setView([-18.9186, -48.2772], 13);

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  attribution: '&copy; <a href="https://www.openstreetmap.org/">OpenStreetMap</a> contributors',
}).addTo(map);

const markersLayer = L.layerGroup().addTo(map);
const selectionLayer = L.layerGroup().addTo(map);

// --- Endereço, CEP e geocodificação ---
function somenteDigitos(valor) {
  return String(valor || "").replace(/\D/g, "");
}

function formatarCep(valor) {
  const cep = somenteDigitos(valor).slice(0, 8);
  return cep.length > 5 ? `${cep.slice(0, 5)}-${cep.slice(5)}` : cep;
}

function normalizarUF(valor) {
  return String(valor || "").trim().toUpperCase().slice(0, 2);
}

function montarEnderecoDigitado() {
  const logradouro = document.getElementById("logradouro").value.trim();
  const numero = document.getElementById("numero").value.trim();
  const bairro = document.getElementById("bairro").value.trim();
  const cidade = document.getElementById("cidade").value.trim();
  const uf = normalizarUF(document.getElementById("uf").value);
  const cep = formatarCep(document.getElementById("cep").value);
  const complemento = document.getElementById("complemento").value.trim();

  const partes = [];
  if (logradouro) partes.push(numero ? `${logradouro}, ${numero}` : logradouro);
  if (bairro) partes.push(bairro);
  if (cidade || uf) partes.push([cidade, uf].filter(Boolean).join(" - "));
  if (cep) partes.push(`CEP ${cep}`);
  if (complemento) partes.push(complemento);
  return partes.join(", ");
}

function setAddressStatus(texto, tipo = "muted") {
  const el = document.getElementById("addressStatus");
  if (!el) return;
  el.className = `address-status ${tipo}`;
  el.textContent = texto;
}

function limparResultadosEndereco() {
  const container = document.getElementById("addressResults");
  if (!container) return;
  container.innerHTML = "";
  container.hidden = true;
}

function limparSelecaoEndereco(mensagem = "Localização ainda não confirmada.") {
  tempCoords = null;
  selectionMarker = null;
  selectionLayer.clearLayers();
  limparResultadosEndereco();
  setAddressStatus(mensagem, "muted");
}

function preencherCamposComEndereco(address = {}) {
  const logradouro = address.road || address.pedestrian || address.footway || address.path || "";
  const bairro = address.suburb || address.neighbourhood || address.quarter || address.city_district || "";
  const cidade = address.city || address.town || address.municipality || address.village || "";
  const estado = address.state || "";
  const uf = estado ? ESTADO_PARA_UF[estado.toLocaleLowerCase("pt-BR")] || "" : "";
  const cep = address.postcode || "";
  const numero = address.house_number || "";

  if (logradouro) document.getElementById("logradouro").value = logradouro;
  if (bairro) document.getElementById("bairro").value = bairro;
  if (cidade) document.getElementById("cidade").value = cidade;
  if (uf) document.getElementById("uf").value = uf;
  if (cep) document.getElementById("cep").value = formatarCep(cep);
  if (numero && !document.getElementById("numero").value.trim()) {
    document.getElementById("numero").value = numero;
  }
}

async function aguardarLimiteNominatim() {
  const agora = Date.now();
  const espera = Math.max(0, 1100 - (agora - ultimaRequisicaoNominatim));
  if (espera > 0) await new Promise((resolve) => setTimeout(resolve, espera));
  ultimaRequisicaoNominatim = Date.now();
}

async function consultarNominatim(url) {
  await aguardarLimiteNominatim();
  const response = await fetch(url, {
    headers: { "Accept-Language": "pt-BR,pt;q=0.9" },
  });
  if (!response.ok) throw new Error(`Falha na busca de endereço (${response.status}).`);
  return response.json();
}

async function geocodeStructured({ logradouro, numero, bairro, cidade, uf, cep }) {
  const params = new URLSearchParams({
    format: "jsonv2",
    addressdetails: "1",
    limit: "5",
    dedupe: "1",
    country: "Brasil",
    countrycodes: "br",
  });

  const ruaCompleta = [numero, logradouro].filter(Boolean).join(" ").trim();
  if (ruaCompleta) params.set("street", ruaCompleta);
  if (cidade) params.set("city", cidade);
  if (uf) params.set("state", UF_PARA_ESTADO[uf] || uf);
  if (cep) params.set("postalcode", somenteDigitos(cep));

  let resultados = await consultarNominatim(`https://nominatim.openstreetmap.org/search?${params.toString()}`);

  // Alguns números de imóveis não estão mapeados. Nesse caso, tenta a mesma rua sem o número.
  if ((!resultados || resultados.length === 0) && numero && logradouro) {
    params.set("street", logradouro);
    resultados = await consultarNominatim(`https://nominatim.openstreetmap.org/search?${params.toString()}`);
  }

  // Bairro é usado para melhorar a escolha do usuário, mas não como campo estruturado do Nominatim.
  if (bairro && Array.isArray(resultados)) {
    const termoBairro = bairro.toLocaleLowerCase("pt-BR");
    resultados.sort((a, b) => {
      const aTem = String(a.display_name || "").toLocaleLowerCase("pt-BR").includes(termoBairro) ? 1 : 0;
      const bTem = String(b.display_name || "").toLocaleLowerCase("pt-BR").includes(termoBairro) ? 1 : 0;
      return bTem - aTem;
    });
  }

  return resultados || [];
}

async function reverseGeocode(lat, lng) {
  const params = new URLSearchParams({
    format: "jsonv2",
    lat: String(lat),
    lon: String(lng),
    zoom: "18",
    addressdetails: "1",
  });
  return consultarNominatim(`https://nominatim.openstreetmap.org/reverse?${params.toString()}`);
}

function definirPontoSelecionado(lat, lng, endereco, popupText = "Localização confirmada") {
  const latitude = Number(lat);
  const longitude = Number(lng);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return;

  selectionLayer.clearLayers();
  selectionMarker = L.marker([latitude, longitude], { draggable: true }).addTo(selectionLayer);
  selectionMarker.bindPopup(popupText).openPopup();

  selectionMarker.on("dragend", () => {
    const pos = selectionMarker.getLatLng();
    tempCoords = {
      lat: pos.lat,
      lng: pos.lng,
      address: montarEnderecoDigitado() || endereco || "Ponto selecionado no mapa",
    };
    setAddressStatus("Ponto ajustado no mapa. Localização confirmada.", "success-text");
  });

  tempCoords = {
    lat: latitude,
    lng: longitude,
    address: endereco || montarEnderecoDigitado() || "Ponto selecionado no mapa",
  };
  map.setView([latitude, longitude], 17);
  setAddressStatus("Localização confirmada. Você pode arrastar o marcador para ajustar o ponto.", "success-text");
}

function renderizarResultadosEndereco(resultados) {
  const container = document.getElementById("addressResults");
  container.innerHTML = "";

  if (!resultados.length) {
    container.hidden = true;
    return;
  }

  const titulo = document.createElement("strong");
  titulo.textContent = resultados.length === 1 ? "Endereço encontrado:" : "Escolha o endereço correto:";
  container.appendChild(titulo);

  resultados.forEach((resultado, indice) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "address-result-item";
    button.innerHTML = `<span class="result-number">${indice + 1}</span><span>${escapeHtml(resultado.display_name || "Endereço encontrado")}</span>`;
    button.addEventListener("click", () => {
      preencherCamposComEndereco(resultado.address || {});
      const enderecoFinal = montarEnderecoDigitado() || resultado.display_name;
      definirPontoSelecionado(
        parseFloat(resultado.lat),
        parseFloat(resultado.lon),
        enderecoFinal,
        `Localização confirmada: ${escapeHtml(resultado.display_name || enderecoFinal)}`
      );
      container.hidden = true;
    });
    container.appendChild(button);
  });

  container.hidden = false;
}

async function buscarCep() {
  const cepInput = document.getElementById("cep");
  const cep = somenteDigitos(cepInput.value);
  if (cep.length !== 8) {
    alert("Digite um CEP com 8 números.");
    cepInput.focus();
    return false;
  }

  const btn = document.getElementById("btnBuscarCep");
  const original = btn.textContent;
  btn.disabled = true;
  btn.textContent = "Buscando...";
  setAddressStatus("Consultando CEP...", "muted");

  try {
    const response = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
    if (!response.ok) throw new Error("Falha ao consultar o CEP.");
    const data = await response.json();
    if (data.erro) throw new Error("CEP não encontrado.");

    cepInput.value = formatarCep(data.cep || cep);
    document.getElementById("logradouro").value = data.logradouro || "";
    document.getElementById("bairro").value = data.bairro || "";
    document.getElementById("cidade").value = data.localidade || "";
    document.getElementById("uf").value = normalizarUF(data.uf || "");

    limparSelecaoEndereco("CEP encontrado. Informe o número e clique em “Localizar endereço”.");
    document.getElementById("numero").focus();
    return true;
  } catch (error) {
    console.error("Erro ao consultar CEP:", error);
    setAddressStatus("Não foi possível consultar o CEP. Você pode preencher o endereço manualmente.", "error-text");
    alert(error.message || "Não foi possível consultar o CEP.");
    return false;
  } finally {
    btn.disabled = false;
    btn.textContent = original;
  }
}

document.getElementById("cep").addEventListener("input", (e) => {
  e.target.value = formatarCep(e.target.value);
  if (tempCoords) limparSelecaoEndereco("CEP alterado. Localize novamente para confirmar o ponto.");
});

document.getElementById("cep").addEventListener("blur", async (e) => {
  if (somenteDigitos(e.target.value).length === 8 && !document.getElementById("logradouro").value.trim()) {
    await buscarCep();
  }
});

document.getElementById("btnBuscarCep").addEventListener("click", buscarCep);

["numero", "logradouro", "bairro", "cidade", "uf", "complemento"].forEach((id) => {
  document.getElementById(id).addEventListener("input", () => {
    if (tempCoords) limparSelecaoEndereco("Endereço alterado. Localize novamente para confirmar o ponto.");
  });
});

document.getElementById("uf").addEventListener("input", (e) => {
  e.target.value = normalizarUF(e.target.value);
});

document.getElementById("btnGeocode").addEventListener("click", async () => {
  const logradouro = document.getElementById("logradouro").value.trim();
  const numero = document.getElementById("numero").value.trim();
  const bairro = document.getElementById("bairro").value.trim();
  const cidade = document.getElementById("cidade").value.trim();
  const uf = normalizarUF(document.getElementById("uf").value);
  const cep = document.getElementById("cep").value.trim();

  if (!logradouro || !numero || !cidade || !uf) {
    alert("Preencha pelo menos logradouro, número, cidade e UF. Se souber o CEP, use-o para preencher os campos automaticamente.");
    return;
  }

  const botao = document.getElementById("btnGeocode");
  const textoOriginal = botao.textContent;
  botao.disabled = true;
  botao.textContent = "Localizando...";
  limparResultadosEndereco();
  setAddressStatus("Procurando o endereço no mapa...", "muted");

  try {
    const resultados = await geocodeStructured({ logradouro, numero, bairro, cidade, uf, cep });

    if (!resultados.length) {
      tempCoords = null;
      setAddressStatus("Endereço não encontrado automaticamente. Revise os campos ou use “Selecionar no mapa”.", "error-text");
      alert("Não foi possível localizar esse endereço automaticamente. Revise os dados ou use o botão “Selecionar no mapa”.");
      return;
    }

    if (resultados.length === 1) {
      const resultado = resultados[0];
      preencherCamposComEndereco(resultado.address || {});
      const enderecoFinal = montarEnderecoDigitado() || resultado.display_name;
      definirPontoSelecionado(
        parseFloat(resultado.lat),
        parseFloat(resultado.lon),
        enderecoFinal,
        `Localização confirmada: ${escapeHtml(resultado.display_name || enderecoFinal)}`
      );
      return;
    }

    renderizarResultadosEndereco(resultados);
    setAddressStatus("Foram encontrados alguns resultados. Selecione abaixo o endereço correto.", "muted");
  } catch (error) {
    console.error("Erro ao buscar coordenadas:", error);
    tempCoords = null;
    setAddressStatus("A busca de endereço está temporariamente indisponível. Tente novamente ou selecione o ponto no mapa.", "error-text");
    alert("Não foi possível consultar o serviço de mapas agora. Tente novamente em alguns segundos ou selecione o ponto no mapa.");
  } finally {
    botao.disabled = false;
    botao.textContent = textoOriginal;
  }
});

document.getElementById("btnUseLocation").addEventListener("click", () => {
  if (!navigator.geolocation) {
    alert("Seu navegador não oferece suporte à localização do dispositivo.");
    return;
  }

  const botao = document.getElementById("btnUseLocation");
  const textoOriginal = botao.textContent;
  botao.disabled = true;
  botao.textContent = "Obtendo localização...";
  setAddressStatus("Aguardando permissão para acessar sua localização...", "muted");

  navigator.geolocation.getCurrentPosition(
    async (position) => {
      const lat = position.coords.latitude;
      const lng = position.coords.longitude;

      try {
        const resultado = await reverseGeocode(lat, lng);
        if (resultado?.address) preencherCamposComEndereco(resultado.address);
        const enderecoFinal = montarEnderecoDigitado() || resultado?.display_name || "Minha localização atual";
        definirPontoSelecionado(lat, lng, enderecoFinal, "Sua localização atual");
      } catch (error) {
        console.warn("Não foi possível detalhar a localização atual:", error);
        definirPontoSelecionado(lat, lng, montarEnderecoDigitado() || "Minha localização atual", "Sua localização atual");
      } finally {
        botao.disabled = false;
        botao.textContent = textoOriginal;
      }
    },
    (error) => {
      console.error("Erro de geolocalização:", error);
      botao.disabled = false;
      botao.textContent = textoOriginal;
      setAddressStatus("Não foi possível acessar sua localização. Você pode localizar pelo endereço ou pelo mapa.", "error-text");
      alert("Não foi possível obter sua localização. Verifique a permissão de localização do navegador.");
    },
    { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 }
  );
});

document.getElementById("btnSelectMap").addEventListener("click", () => {
  mapSelectionMode = !mapSelectionMode;
  const botao = document.getElementById("btnSelectMap");
  botao.textContent = mapSelectionMode ? "Cancelar seleção" : "Selecionar no mapa";
  botao.classList.toggle("map-selection-active", mapSelectionMode);

  if (mapSelectionMode) {
    setAddressStatus("Clique no ponto exato do mapa. Depois, se precisar, arraste o marcador para ajustar.", "selection-text");
    document.getElementById("map").scrollIntoView({ behavior: "smooth", block: "center" });
  } else if (!tempCoords) {
    setAddressStatus("Seleção no mapa cancelada.", "muted");
  }
});

map.on("click", (event) => {
  if (!mapSelectionMode) return;

  const enderecoFinal = montarEnderecoDigitado();
  if (!enderecoFinal) {
    alert("Antes de selecionar no mapa, preencha pelo menos os dados básicos do endereço para que a ocorrência fique identificada corretamente.");
    return;
  }

  definirPontoSelecionado(event.latlng.lat, event.latlng.lng, enderecoFinal, "Ponto selecionado manualmente");
  mapSelectionMode = false;
  const botao = document.getElementById("btnSelectMap");
  botao.textContent = "Selecionar no mapa";
  botao.classList.remove("map-selection-active");
});

// Compatibilidade com ocorrências antigas que eventualmente não tenham coordenadas salvas.
async function geocodeAddress(fullAddress) {
  const params = new URLSearchParams({
    format: "jsonv2",
    q: `${fullAddress}, Brasil`,
    countrycodes: "br",
    limit: "1",
    addressdetails: "1",
  });
  try {
    const data = await consultarNominatim(`https://nominatim.openstreetmap.org/search?${params.toString()}`);
    if (!data?.length) return null;
    return {
      lat: parseFloat(data[0].lat),
      lng: parseFloat(data[0].lon),
      displayName: data[0].display_name,
    };
  } catch (error) {
    console.error("Erro ao geocodificar ocorrência antiga:", error);
    return null;
  }
}

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

    const info = document.createElement("div");
    info.innerHTML = `
      <strong>${escapeHtml(`${u.nome || ""} ${u.sobrenome || ""}`.trim() || u.email)}</strong><br>
      <small>${escapeHtml(u.email)}</small>
      ${u.role === "admin" ? '<span class="badge aprovada">Admin</span>' : ""}
    `;
    li.appendChild(info);

    const actions = document.createElement("div");
    actions.classList.add("user-actions");

    if (u.id === usuarioLogado.id) {
      const atual = document.createElement("span");
      atual.className = "muted user-current";
      atual.textContent = "Sua conta";
      actions.appendChild(atual);
    } else if (u.role === "admin") {
      const protegido = document.createElement("span");
      protegido.className = "muted user-current";
      protegido.textContent = "Admin protegido";
      actions.appendChild(protegido);
    } else {
      const btnExcluir = document.createElement("button");
      btnExcluir.type = "button";
      btnExcluir.classList.add("btn", "danger", "btn-delete-user");
      btnExcluir.textContent = "Excluir conta";
      btnExcluir.setAttribute("aria-label", `Excluir conta de ${u.email}`);
      btnExcluir.onclick = () => excluirUsuario(u, btnExcluir);
      actions.appendChild(btnExcluir);
    }

    li.appendChild(actions);
    lista.appendChild(li);
  });
}

async function excluirUsuario(usuario, botao) {
  if (usuarioLogado?.role !== "admin") {
    alert("Apenas administradores podem excluir contas.");
    return;
  }

  if (!usuario?.id || usuario.id === usuarioLogado.id || usuario.role === "admin") {
    alert("Esta conta administrativa não pode ser excluída por este painel.");
    return;
  }

  const nome = `${usuario.nome || ""} ${usuario.sobrenome || ""}`.trim() || usuario.email;
  const confirmado = confirm(
    `Excluir permanentemente a conta de ${nome} (${usuario.email})?\n\n` +
    "O usuário perderá o acesso e o login será removido do sistema. Esta ação não pode ser desfeita."
  );

  if (!confirmado) return;

  const textoOriginal = botao?.textContent || "Excluir conta";
  if (botao) {
    botao.disabled = true;
    botao.textContent = "Excluindo...";
  }

  try {
    const { data, error } = await supabaseClient.functions.invoke("admin-delete-user", {
      body: { userId: usuario.id },
    });

    if (error) throw error;
    if (!data?.success) throw new Error(data?.error || "Não foi possível excluir a conta.");

    alert(`Conta ${usuario.email} excluída com sucesso.`);
    await carregarUsuarios();
    await carregarOcorrencias();
  } catch (error) {
    console.error("Erro ao excluir usuário:", error);
    alert(error?.message || "Não foi possível excluir a conta do usuário.");
    if (botao) {
      botao.disabled = false;
      botao.textContent = textoOriginal;
    }
  }
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
  selectionMarker = null;
  selectionLayer.clearLayers();
  limparResultadosEndereco();
  setAddressStatus("Localização ainda não confirmada.", "muted");
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

      const btnAprovar = document.createElement("button");
      btnAprovar.textContent = "Aprovar";
      btnAprovar.classList.add("btn", "secondary");
      btnAprovar.onclick = () => atualizarStatus(o.id, "aprovada");
      actions.appendChild(btnAprovar);

      const btnRejeitar = document.createElement("button");
      btnRejeitar.textContent = "Rejeitar";
      btnRejeitar.classList.add("btn", "danger");
      btnRejeitar.onclick = () => atualizarStatus(o.id, "rejeitada");
      actions.appendChild(btnRejeitar);

      const btnExcluir = document.createElement("button");
      btnExcluir.textContent = "Excluir";
      btnExcluir.classList.add("btn", "danger");
      btnExcluir.onclick = () => excluirOcorrencia(o.id);
      actions.appendChild(btnExcluir);

      li.appendChild(actions);
    }

    lista.appendChild(li);
  });
}

async function excluirOcorrencia(id) {
  if (usuarioLogado?.role !== "admin") return;

  const ocorrencia = ocorrencias.find((o) => o.id === id);
  if (!ocorrencia) return;

  const confirmar = confirm(
    `Tem certeza que deseja excluir definitivamente esta ocorrência?\n\n${ocorrencia.tipo} - ${ocorrencia.endereco}`
  );
  if (!confirmar) return;

  const { error } = await supabaseClient
    .from("ocorrencias")
    .delete()
    .eq("id", id);

  if (error) {
    console.error(error);
    alert("Não foi possível excluir a ocorrência.");
    return;
  }

  await carregarOcorrencias();
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
