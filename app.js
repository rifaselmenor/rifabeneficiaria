// ╔══════════════════════════════════════════════════════════════╗
// ║  RIFA ANA QUINTERO — app.js (100 Números - 00 al 99)         ║
// ║  100% OPTIMIZADO - SIN RECORTES - LISTO PARA PRODUCCIÓN      ║
// ╚══════════════════════════════════════════════════════════════╝

let PRECIO_BOLETO      = 5;      
let MINIMO_BOLETOS     = 2; // El mínimo por defecto, el admin puede cambiarlo en Supabase
const TOTAL_BOLETOS    = 100;  
const BOLETOS_POR_PAGINA = 100; // Todo en una sola vista

let ticketStates    = new Map();
let availableList   = [];
let currentPage     = 1;
let totalPages      = 1; 
let selectedTickets = new Set();
let cantidadAzar    = MINIMO_BOLETOS;

// ==========================================
// 0. CAPA DE CACHÉ LIGERA PARA SUPABASE
//    Evita repetir consultas idénticas mientras
//    los datos siguen "frescos" (dentro del TTL).
//    Se guarda en sessionStorage: sobrevive entre
//    index.html -> rifas.html en la misma pestaña.
// ==========================================
const RifaCache = {
  get(key, ttlMs) {
    try {
      const raw = sessionStorage.getItem('rifa_cache_' + key);
      if (!raw) return null;
      const { t, v } = JSON.parse(raw);
      if (Date.now() - t > ttlMs) return null; // expiró
      return v;
    } catch (e) { return null; }
  },
  set(key, value) {
    try {
      sessionStorage.setItem('rifa_cache_' + key, JSON.stringify({ t: Date.now(), v: value }));
    } catch (e) { /* sessionStorage lleno o bloqueado: seguimos sin caché */ }
  },
  clear(key) {
    try { sessionStorage.removeItem('rifa_cache_' + key); } catch (e) {}
  }
};

// TTLs: config cambia poco (la toca el admin) -> caché más larga.
// Tickets cambian todo el tiempo (otros compradores) -> caché corta,
// solo para absorber navegaciones rápidas entre páginas, no para
// evitar ver ventas nuevas.
const CACHE_TTL_CONFIG  = 5 * 60 * 1000; // 5 minutos
const CACHE_TTL_TICKETS = 15 * 1000;     // 15 segundos

// Trae landing_config usando caché. Si hay dato en caché lo devuelve
// al instante (sin red); si no, consulta Supabase y guarda el resultado.
async function getLandingConfigCached() {
  const cached = RifaCache.get('landing_config', CACHE_TTL_CONFIG);
  if (cached) return { data: cached, fromCache: true };
  const { data, error } = await db.from('landing_config').select('*').eq('id', 'main').maybeSingle();
  if (!error && data) RifaCache.set('landing_config', data);
  return { data, fromCache: false, error };
}

// IMPORTANTE: disparamos la consulta AHORA MISMO, apenas se parsea este
// script (no esperamos a DOMContentLoaded). Además la guardamos como UNA
// sola promesa compartida en window.rifaConfigPromise: tanto este archivo
// como el script inline de rifas.html/index.html deben usar esta misma
// promesa (await window.rifaConfigPromise) en vez de volver a consultar
// landing_config por su cuenta. Antes, app.js y el inline de rifas.html
// pedían la MISMA fila dos veces en cada carga — esto lo deja en una sola.
window.rifaConfigPromise = getLandingConfigCached();

// ==========================================
// 1. INICIALIZACIÓN AL CARGAR LA PÁGINA
// ==========================================
document.addEventListener('DOMContentLoaded', async () => {
  renderSkeletonGrid(); // Pinta placeholders al instante para que nunca se sienta "congelado"
  try {
    const { data: configData } = await window.rifaConfigPromise;
    if (configData) {
      // Bloqueo de plataforma si el admin pausó las ventas
      if (configData.ventas_activas === false) {
        const mainSection = document.getElementById('mainTicketSection');
        if (mainSection) {
          mainSection.innerHTML = `
            <div style="text-align:center;padding:50px 20px;background:rgba(239,68,68,0.15);border:2px dashed #ef4444;border-radius:16px;margin:20px 0;">
              <div class="animate-pulse" style="font-size:60px; margin-bottom:15px;">🛑</div>
              <h2 style="color:#ef4444;font-size:28px;font-weight:900;margin-bottom:10px;">Plataforma Cerrada</h2>
              <p style="color:#fca5a5;font-size:15px;font-weight:700;">Estamos esperando los resultados. ¡Mucha suerte!</p>
            </div>
          `;
        }
        const buyButtons = document.querySelectorAll('button[onclick="comenzarCompra()"]');
        buyButtons.forEach(btn => {
          btn.textContent = '🛑 PLATAFORMA CERRADA';
          btn.style.background = 'linear-gradient(135deg, #7f1d1d, #ef4444)';
          btn.onclick = null; btn.style.pointerEvents = 'none'; 
        });
        return; 
      }
      // Actualización dinámica desde la BD
      if (configData.precio_boleto) PRECIO_BOLETO = parseFloat(configData.precio_boleto);
      if (configData.minimo_boletos) {
        MINIMO_BOLETOS = parseInt(configData.minimo_boletos, 10);
        cantidadAzar = MINIMO_BOLETOS; 
      }
    }
  } catch (e) { console.error('Error leyendo configuración de Supabase', e); }

  // Actualizar textos en la interfaz
  if (document.getElementById('statPrecio')) document.getElementById('statPrecio').textContent = PRECIO_BOLETO;
  if (document.getElementById('statMin')) document.getElementById('statMin').textContent = MINIMO_BOLETOS;
  if (document.getElementById('minLabel')) document.getElementById('minLabel').textContent = MINIMO_BOLETOS;

  // Ocultar controles de paginación del HTML porque ahora se muestran los 100 números de una vez
  const paginationControls = [
    document.getElementById('btnPrev'),
    document.getElementById('btnNext'),
    document.getElementById('pageIndicator')?.parentElement,
    document.getElementById('pageJump')?.parentElement
  ];
  paginationControls.forEach(el => {
    if(el) el.style.display = 'none';
  });

  configurarBotonesDinamicos();
  await loadTickets(); 
  renderGrid();
  updateUI();
});

// ==========================================
// 2. CONFIGURACIÓN DE BOTONES AL AZAR
// ==========================================
function configurarBotonesDinamicos() {
  const btnRestar = document.getElementById('btnRestarAzar');
  const btnSumar = document.getElementById('btnSumarAzar');
  const displayDiv = document.getElementById('displayCantidadAzar');
  if (btnRestar && btnSumar && displayDiv) {
    displayDiv.textContent = cantidadAzar;
    btnRestar.onclick = () => {
      if (cantidadAzar > MINIMO_BOLETOS) { 
        cantidadAzar -= 1; 
        displayDiv.textContent = cantidadAzar; 
      } else { 
        showToast(`El mínimo de compra es ${MINIMO_BOLETOS}`); 
      }
    };
    btnSumar.onclick = () => { 
      cantidadAzar += 1; 
      displayDiv.textContent = cantidadAzar; 
    };
  }
}

// ==========================================
// 3. CARGA DE TICKETS (00 al 99)
// ==========================================

// Aplica un snapshot de tickets (venido de caché o de Supabase) al estado
// local y repinta. Separado en su propia función porque ahora se llama
// hasta dos veces: una instantánea desde caché (si existe) y otra con el
// dato fresco de la red.
function aplicarTicketsData(data) {
  for (let i = 0; i < TOTAL_BOLETOS; i++) {
    ticketStates.set(i.toString().padStart(2, '0'), 'available');
  }
  (data || []).forEach(t => {
    let numStr = t.numero.toString().padStart(2, '0');
    ticketStates.set(numStr, t.estado);
  });

  availableList = [];
  for (let i = 0; i < TOTAL_BOLETOS; i++) {
    let numStr = i.toString().padStart(2, '0');
    if (ticketStates.get(numStr) !== 'pendiente' && ticketStates.get(numStr) !== 'vendido') {
       availableList.push(numStr);
    }
  }
  totalPages = 1;
  updateSalesBar();
  renderGrid();
}

async function loadTickets() {
  // Fast-path: si hay un snapshot de hace menos de 15s, lo pintamos YA
  // (sin esperar la red) y de todas formas refrescamos en segundo plano
  // por si alguien más compró en ese ratito. Esto es lo que hace que el
  // grid se sienta instantáneo al navegar entre páginas.
  const cachedTickets = RifaCache.get('tickets_estado', CACHE_TTL_TICKETS);
  if (cachedTickets) aplicarTicketsData(cachedTickets);

  try {
    // Pedimos a la BD un límite alto (1000) por seguridad para garantizar traer los 100
    const { data, error } = await db.from('tickets').select('numero,estado').in('estado', ['pendiente','vendido']).range(0, 1000);
    if (error) throw error;
    RifaCache.set('tickets_estado', data || []);
    aplicarTicketsData(data || []);
  } catch(e) { 
    if (!cachedTickets) {
      console.error("Error cargando tickets de Supabase", e); 
      showToast("Error de conexión al cargar números");
      renderGrid(); // saca el skeleton aunque haya fallado, para no dejar la rueda girando
    }
    // Si ya había caché, nos quedamos mostrando ese snapshot en vez de romper la UI.
  }
}

// ==========================================
// 4. ACTUALIZACIÓN VISUAL (BARRAS Y GRID)
// ==========================================
function updateSalesBar() {
  let vendidosOPendientes = TOTAL_BOLETOS - availableList.length;
  const pct = Math.min(Math.round((vendidosOPendientes / TOTAL_BOLETOS) * 100), 100);
  
  const fillEl = document.getElementById('salesFill');
  const pctEl  = document.getElementById('salesPct');
  const soldEl = document.getElementById('salesSold');
  const remEl  = document.getElementById('salesRem');
  const disp   = document.getElementById('statDisp');
  
  if (fillEl) fillEl.style.width = pct + '%';
  if (pctEl) pctEl.textContent = pct + '%';
  if (soldEl) soldEl.textContent = vendidosOPendientes;
  if (remEl) remEl.textContent = availableList.length;
  if (disp) disp.textContent = availableList.length;
}

// Skeleton de carga: pinta placeholders al instante (sin esperar Supabase)
// para que la pantalla nunca se sienta vacía/congelada mientras llegan los datos.
function renderSkeletonGrid() {
  const grid = document.getElementById('ticketGrid');
  if (!grid) return;
  const frag = document.createDocumentFragment();
  for (let i = 0; i < 20; i++) {
    const s = document.createElement('div');
    s.className = 'ticket-skeleton';
    frag.appendChild(s);
  }
  grid.innerHTML = '';
  grid.appendChild(frag);
}

let gridDelegationBound = false;

function renderGrid() {
  const grid = document.getElementById('ticketGrid');
  if (!grid) return;

  // Construimos todos los nodos en un DocumentFragment (memoria, sin tocar
  // el DOM real) y los insertamos de una sola vez -> un solo reflow en vez
  // de 100. Antes cada iteración hacía grid.appendChild(t) directo al DOM.
  const frag = document.createDocumentFragment();
  for (let i = 0; i < availableList.length; i++) {
    let numStr = availableList[i];
    let t = document.createElement('div');
    t.className = 'ticket ' + (selectedTickets.has(numStr) ? 'ticket-selected' : 'ticket-available');
    t.textContent = numStr;
    t.dataset.num = numStr;
    frag.appendChild(t);
  }
  grid.innerHTML = '';
  grid.appendChild(frag);

  // Delegación de eventos: UN solo listener en el contenedor en vez de 100
  // closures individuales (uno por número). Se registra una sola vez y
  // sigue funcionando aunque el grid se repinte, porque escucha en el
  // padre, no en cada ticket.
  if (!gridDelegationBound) {
    grid.addEventListener('click', (e) => {
      const el = e.target.closest('.ticket');
      if (el && el.dataset.num) toggleTicket(el.dataset.num);
    });
    gridDelegationBound = true;
  }
}

function toggleTicket(numStr) {
  if (selectedTickets.has(numStr)) {
    selectedTickets.delete(numStr);
  } else {
    selectedTickets.add(numStr);
  }
  // Antes: cada clic reconstruía los 100 nodos del grid entero.
  // Ahora: solo actualizamos la clase del ticket que cambió -> el clic
  // se siente instantáneo incluso en equipos de gama baja.
  const grid = document.getElementById('ticketGrid');
  const el = grid && grid.querySelector('.ticket[data-num="' + numStr + '"]');
  if (el) {
    el.className = 'ticket ' + (selectedTickets.has(numStr) ? 'ticket-selected' : 'ticket-available');
  }
  updateUI();
}

// ==========================================
// 5. SELECCIÓN ALEATORIA
// ==========================================
function randomSelect() {
  selectedTickets.clear();
  if (availableList.length < cantidadAzar) {
    showToast(`❌ Solo quedan ${availableList.length} boletos disponibles.`);
    return;
  }
  
  // Algoritmo Fisher-Yates para barajar limpiamente
  let pool = [...availableList];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  
  // Seleccionamos los primeros N tickets
  for (let i = 0; i < cantidadAzar; i++) {
    selectedTickets.add(pool[i]);
  }
  
  showToast(`🎲 ¡${cantidadAzar} boletos seleccionados!`);
  renderGrid(); 
  updateUI();
}

function clearSelection() { 
  selectedTickets.clear(); 
  renderGrid(); 
  updateUI(); 
}

function updateUI() {
  let count = selectedTickets.size;
  let label = document.getElementById('countLabel');
  if(label) label.innerHTML = `${count} / <span id="minLabel">${MINIMO_BOLETOS}</span>`;
  
  let total = count * PRECIO_BOLETO;
  let pLabel = document.getElementById('totalPrice');
  if(pLabel) pLabel.textContent = `Bs. ${total}`;
  
  let pct = Math.min((count / MINIMO_BOLETOS) * 100, 100);
  let pBar = document.getElementById('progressBar');
  if(pBar) pBar.style.width = pct + '%';
  
  let btnPagar = document.getElementById('btnPagar');
  if(btnPagar) {
      if (count >= MINIMO_BOLETOS) { 
        btnPagar.disabled = false; 
        btnPagar.style.opacity = '1'; 
      } else { 
        btnPagar.disabled = true; 
        btnPagar.style.opacity = '0.4'; 
      }
  }
}

// ==========================================
// 6. FLUJO DE PAGO Y MODALES
// ==========================================
function openPayModal() {
  if (selectedTickets.size < MINIMO_BOLETOS) return;
  const termsAgreed = localStorage.getItem('termsAgreed');
  const termsModalEl = document.getElementById('termsModal');
  // Antes: si no existía #termsModal en la página, esta línea lanzaba un
  // error no capturado y el modal de pago NUNCA llegaba a abrirse (se
  // sentía "congelado" en el primer intento de compra). Ahora, si el
  // modal de términos no está presente en el HTML, simplemente lo
  // saltamos en vez de romper el flujo.
  if (!termsAgreed && termsModalEl) {
    termsModalEl.style.display = 'flex';
    return;
  }
  let container = document.getElementById('selectedChips');
  if(container) {
      container.innerHTML = '';
      Array.from(selectedTickets).sort().forEach(num => {
        let chip = document.createElement('div');
        chip.className = 'selected-chip'; 
        chip.textContent = num; 
        container.appendChild(chip);
      });
  }
  let total = selectedTickets.size * PRECIO_BOLETO;
  let mTotal = document.getElementById('modalTotal');
  if(mTotal) mTotal.textContent = `Bs. ${total}`;

  // Refleja los boletos elegidos y el total dentro del propio formulario
  // de pago (rifas.html), que no usa chips separados sino el modal actual.
  const payModalEl = document.getElementById('payModal');
  if (payModalEl) payModalEl.style.display = 'flex';
}

function closePayModal() { 
  const el = document.getElementById('payModal');
  if (el) el.style.display = 'none'; 
}

function acceptTerms() {
  localStorage.setItem('termsAgreed', 'true');
  const el = document.getElementById('termsModal');
  if (el) el.style.display = 'none';
  openPayModal();
}

function copyText(text, msg) { 
  navigator.clipboard.writeText(text).then(() => showToast(msg)); 
}

function previewCapture(input) {
  let file = input.files[0];
  if (file) {
    let reader = new FileReader();
    reader.onload = e => {
      let img = document.getElementById('capturePreview');
      if(img) { img.src = e.target.result; img.classList.remove('hidden'); }
      let upText = document.getElementById('uploadText');
      if(upText) upText.textContent = "Capture cargado ✅";
      let upIcon = document.getElementById('uploadIcon');
      if(upIcon) upIcon.textContent = "🖼️";
    };
    reader.readAsDataURL(file);
  }
}

// ==========================================
// 7. PROCESAMIENTO DE COMPRA (SUPABASE)
// ==========================================
async function submitOrder(e) {
  e.preventDefault();
  // Todo el cuerpo de la función va dentro del try: antes, la lectura de
  // los campos del formulario ocurría FUERA del try/catch, así que si un
  // solo getElementById fallaba (por ejemplo por un id que no coincidía
  // con el HTML), la función se detenía con un error no capturado y el
  // botón se quedaba trabado en "Procesando..." para siempre — eso era
  // el "congelamiento" que estás viendo.
  const btn = e.target.querySelector('button[type="submit"]');
  try {
    if (btn) { btn.disabled = true; btn.innerHTML = '⏳ Procesando...'; }

    // OJO: estos ids deben coincidir EXACTO con los del <input> en
    // rifas.html. El formulario actual usa payNombre/payCedula/
    // payWhatsapp/payReferencia/payComprobante (no fNombre/fCedula/...).
    const nombre = document.getElementById('payNombre').value.trim();
    const cedula = document.getElementById('payCedula').value.trim();
    const whatsapp = document.getElementById('payWhatsapp').value.trim();
    const totalPagado = selectedTickets.size * PRECIO_BOLETO;
    const refEl = document.getElementById('payReferencia');
    const referencia = refEl ? refEl.value.trim() : '000000';
    const boletosArray = Array.from(selectedTickets).sort();
    const boletosStr = boletosArray.join(', ');
    const fileInput = document.getElementById('payComprobante');
    const file = fileInput ? fileInput.files[0] : null;

    let captureUrl = null;
    
    // 1. Subir Capture a Supabase Storage
    if (file) {
      const ext = file.name.split('.').pop();
      const fileName = `pagos/${Date.now()}_${cedula}.${ext}`;
      const { error: uploadError } = await db.storage.from('captures').upload(fileName, file, { cacheControl: '3600', upsert: true });
      if (uploadError) throw uploadError;
      const { data: publicUrlData } = db.storage.from('captures').getPublicUrl(fileName);
      captureUrl = publicUrlData.publicUrl;
    }

    // 2. Insertar en tabla de Pedidos
    const { data: pedidoData, error: pedidoError } = await db.from('pedidos').insert([{
        nombre: nombre, 
        cedula: cedula, 
        whatsapp: whatsapp, 
        ref_comprobante: referencia,
        numeros: boletosArray.map(Number), 
        total: totalPagado, 
        capture_url: captureUrl, 
        estado: 'pendiente'
      }]).select().single();
    if (pedidoError) throw pedidoError;

    // 3. Insertar los boletos reservados en la tabla Tickets
    const ticketsToInsert = boletosArray.map(num => ({ 
      numero: parseInt(num, 10), 
      estado: 'pendiente', 
      pedido_id: pedidoData.id 
    }));
    
    const { error: ticketsError } = await db.from('tickets').insert(ticketsToInsert);
    if (ticketsError) {
      // Código 23505 = violación de índice único en Postgres. Esto pasa
      // cuando OTRA persona reservó/compró uno de estos números en el
      // mismo instante (carrera entre dos compradores). Depende de que
      // exista el índice único en la tabla tickets:
      //   create unique index tickets_numero_activo on tickets (numero)
      //   where estado in ('pendiente','vendido');
      if (ticketsError.code === '23505') {
        // El pedido en la tabla "pedidos" ya se creó pero quedó huérfano
        // (sin tickets válidos detrás) porque el número ya no estaba
        // disponible: lo deshacemos para no dejar basura ni cobrar por
        // un número que no se pudo reservar.
        await db.from('pedidos').delete().eq('id', pedidoData.id);

        // Intentamos rescatar el número exacto que chocó del mensaje de
        // Postgres (ej: "Key (numero)=(4) already exists."), si no,
        // avisamos de forma genérica.
        const match = /\(numero\)=\((\d+)\)/.exec(ticketsError.details || ticketsError.message || '');
        const numeroOcupado = match ? match[1].padStart(2, '0') : null;

        throw Object.assign(new Error(
          numeroOcupado
            ? `El número ${numeroOcupado} ya fue comprado por otra persona justo ahora.`
            : 'Uno de los números que elegiste ya fue comprado por otra persona.'
        ), { code: 'NUMERO_OCUPADO' });
      }
      throw ticketsError;
    }

    // 4. Limpiar lista local
    boletosArray.forEach(n => {
       ticketStates.set(n, 'pendiente');
       let idx = availableList.indexOf(n);
       if(idx !== -1) availableList.splice(idx, 1);
    });
    
    updateSalesBar(); 
    renderGrid();
    // Estos boletos ya no están disponibles: invalidamos la caché para que
    // ninguna otra pestaña/página los siga mostrando como libres.
    RifaCache.clear('tickets_estado');
    
    // 5. Notificar por Telegram
    try { 
      await notificarTelegram(nombre, boletosStr, totalPagado, referencia); 
    } catch (telErr) { console.warn("Error enviando Telegram, pero la compra se procesó"); }
    
    // 6. Cerrar modal y mostrar éxito
    closePayModal();
    const summary = document.getElementById('successSummary');
    if(summary) {
        summary.innerHTML = `<div class="text-gray-800 font-bold">👤 ${nombre}</div><div class="text-gray-800">🎟️ ${selectedTickets.size} boletos</div><div class="text-gray-800">💰 Pagado: Bs. ${totalPagado}</div><div class="text-xs mt-1 text-gray-500">Ref: ${referencia}</div>`;
    }
    const successModal = document.getElementById('successModal');
    if (successModal) {
      successModal.style.display = 'flex';
    } else {
      // Ya no redirigimos a ningún WhatsApp VIP: solo confirmamos que la
      // compra quedó registrada y que la revisaremos pronto.
      showToast('✅ ¡Compra registrada! Tu pago está siendo procesado, te informaremos en breve.', 4000);
    }
    
  } catch(error) {
    console.error(error);

    if (error.code === 'NUMERO_OCUPADO') {
      // Pago rechazado: alguien más se adelantó comprando el mismo número.
      // Limpiamos la selección y refrescamos el grid desde Supabase para
      // que el número ocupado desaparezca de inmediato de "disponibles".
      showToast(`❌ Pago rechazado: ${error.message} Elige otro número e inténtalo de nuevo.`, 7000);
      closePayModal();
      selectedTickets.clear();
      RifaCache.clear('tickets_estado');
      await loadTickets();
      renderGrid();
      updateUI();
    } else {
      // Antes esto mostraba un mensaje genérico y el error real solo quedaba
      // en la consola (que nadie revisa en el celular). Ahora mostramos el
      // motivo exacto que devuelve Supabase (ej: política RLS, columna que
      // no existe, etc.) para poder diagnosticar sin herramientas de desarrollador.
      const detalle = error?.message || 'Error desconocido';
      showToast(`❌ No se pudo registrar: ${detalle}`, 7000);
    }

    if (btn) { btn.disabled = false; btn.innerHTML = '✅ Confirmar Boleto y Pago'; }
  }
}

// ==========================================
// 8. NOTIFICACIONES TELEGRAM
// ==========================================
async function notificarTelegram(nombre, boletos, total, ref) {
  const BOT_TOKEN = '8666595624:AAGoWxS-9QGxtB1p4opumRqWoyB4n-Su4tI'; 
  const CHAT_ID = '5873749605'; 
  const mensaje = `🌸 RIFA ANA QUINTERO 🌸\n\n👤 ${nombre}\n🎟️ Boletos: ${boletos}\n💰 Pago: Bs. ${total}\n🔢 Ref: ${ref}`;
  const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
  await fetch(url, { 
    method: 'POST', 
    headers: { 'Content-Type': 'application/json' }, 
    body: JSON.stringify({ chat_id: CHAT_ID, text: mensaje }) 
  });
}

// ==========================================
// 9. BUSCADOR MANUAL Y CONSULTAS
// ==========================================
const searchInput = document.getElementById('searchInput');
if (searchInput) {
  searchInput.addEventListener('input', (e) => {
    let val = e.target.value;
    if (val.length === 2) {
      if(!availableList.includes(val)) { 
        showToast('Número ocupado o inválido'); 
        return; 
      }
      let tickets = document.querySelectorAll('.ticket');
      tickets.forEach(tk => {
        if (tk.textContent === val) {
          tk.style.boxShadow = '0 0 15px #E11D48'; // Respetando tu color rojo/rosa
          setTimeout(() => tk.style.boxShadow = '', 2000);
        }
      });
    }
  });
}

function openVerifyModal() { document.getElementById('verifyModal').style.display = 'flex'; }
function closeVerifyModal() { document.getElementById('verifyModal').style.display = 'none'; document.getElementById('verifyResults').innerHTML=''; }

async function buscarMisBoletos() {
    const btn = document.getElementById('btnBuscarBoletos');
    const cedula = document.getElementById('verifyCedula').value.trim();
    const resultsDiv = document.getElementById('verifyResults');
    
    if(cedula.length < 5) { alert('Ingresa una cédula válida'); return; }
    btn.textContent = '⏳'; 
    btn.disabled = true; 
    resultsDiv.innerHTML = '';
    
    try {
      const { data, error } = await db.from('pedidos').select('id,nombre,cedula,numeros,estado').ilike('cedula', '%' + cedula.replace(/^[VEJvej]-?/,'') + '%');
      if (error) throw error;
      
      if (!data || data.length === 0) {
        resultsDiv.innerHTML = `<div style="background:rgba(239,68,68,.1);border:1px solid rgba(239,68,68,.3);border-radius:14px;padding:16px;text-align:center;color:#FCA5A5;font-weight:700">❌ No se encontraron registros con esa cédula.</div>`;
      } else {
        let html = '';
        data.forEach(p => {
          let badge = '';
          if(p.estado === 'aprobado') badge = '<span style="background:rgba(34,197,94,.2);color:#166534;padding:2px 6px;border-radius:6px;font-size:11px">✅ Aprobado</span>';
          else if (p.estado === 'pendiente') badge = '<span style="background:rgba(234,179,8,.2);color:#854D0E;padding:2px 6px;border-radius:6px;font-size:11px">⏳ En Revisión</span>';
          else badge = '<span style="background:rgba(239,68,68,.2);color:#991B1B;padding:2px 6px;border-radius:6px;font-size:11px">❌ Rechazado</span>';
          
          let numsFormat = Array.isArray(p.numeros) ? p.numeros.map(n => String(n).padStart(2,'0')).join(', ') : String(p.numeros).padStart(2,'0');
          html += `<div style="background:#fff;border:1px solid #fecdd3;border-radius:12px;padding:12px;margin-bottom:8px;font-size:13px;color:#1f2937;">
                      <div class="flex justify-between mb-2"><strong>${p.nombre}</strong>${badge}</div>
                      <div class="text-gray-500 text-xs mb-1">Boletos: <span class="text-gray-900 font-bold">${numsFormat}</span></div>
                   </div>`;
        });
        resultsDiv.innerHTML = html;
      }
    } catch (err) { 
      resultsDiv.innerHTML = '<div style="color:#ef4444;font-weight:700;text-align:center;">❌ Error al consultar. Intenta nuevamente.</div>'; 
    } finally { 
      btn.textContent = 'Buscar'; 
      btn.disabled = false; 
    }
}

// ==========================================
// 10. UTILIDADES EXTRA
// ==========================================
function showToast(msg, duration = 2000) {
  const old = document.querySelector('.toast'); 
  if (old) old.remove();
  
  const t = document.createElement('div');
  // Respetando tus clases de Tailwind rosadas/claras que mandaste
  t.className = 'toast bg-white border border-pink-200 text-gray-900 shadow-xl'; 
  t.textContent = msg;
  
  document.body.appendChild(t); 
  setTimeout(() => t.remove(), duration);
}

function closeSuccessModal() { 
  const el = document.getElementById('successModal');
  if (el) el.style.display = 'none'; 
  window.location.reload(); 
}

// Funciones Dummy para prevenir errores si el HTML aún llama a los botones de Paginación antiguos
function changePage(dir) { showToast('Todos los boletos están listados aquí mismo.'); }
function jumpToPage() { showToast('Todos los boletos están listados aquí mismo.'); }

// ==========================================
// 11. NAVEGACIÓN INICIAL
// ==========================================
function comenzarCompra() {
  const ticketSection = document.getElementById('mainTicketSection');
  const floatingBar = document.getElementById('mainFloatingBar');

  if (ticketSection && floatingBar) {
    ticketSection.style.display = 'block';
    floatingBar.style.display = 'block';
    ticketSection.scrollIntoView({ behavior: 'smooth' });
  } else {
    console.error("Contenedores no encontrados");
  }
}
