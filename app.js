// ╔══════════════════════════════════════════════════════════════╗
// ║  RIFA ANA QUINTERO — app.js (100 Números - 00 al 99)         ║
// ║  100% OPTIMIZADO - SIN RECORTES - LISTO PARA PRODUCCIÓN      ║
// ╚══════════════════════════════════════════════════════════════╝

let PRECIO_BOLETO      = 5;      
let MINIMO_BOLETOS     = 2; // El mínimo por defecto, el admin puede cambiarlo en Supabase
const TOTAL_BOLETOS    = 100;  
const BOLETOS_POR_PAGINA = 100; // Todo en una sola vista
let VIP_URL = 'https://chat.whatsapp.com/CT7Vkzgt81ZCrXsdbLLp3T?mode=gi_t';

let ticketStates    = new Map();
let availableList   = [];
let currentPage     = 1;
let totalPages      = 1; 
let selectedTickets = new Set();
let cdInterval      = null;
let cantidadAzar    = MINIMO_BOLETOS;

// ==========================================
// 1. INICIALIZACIÓN AL CARGAR LA PÁGINA
// ==========================================
document.addEventListener('DOMContentLoaded', async () => {
  try {
    const { data: configData } = await db.from('landing_config').select('*').eq('id', 'main').single();
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
      if (configData.enlace_vip) VIP_URL = configData.enlace_vip;
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
  showToast('⏳ Cargando boletos...');
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
async function loadTickets() {
  // Inicializamos los 100 boletos con formato de 2 dígitos (00, 01, ..., 99)
  for (let i = 0; i < TOTAL_BOLETOS; i++) {
    let numStr = i.toString().padStart(2, '0');
    ticketStates.set(numStr, 'available');
  }
  
  try {
    // Pedimos a la BD un límite alto (1000) por seguridad para garantizar traer los 100
    const { data, error } = await db.from('tickets').select('numero,estado').in('estado', ['pendiente','vendido']).range(0, 1000);
    if (error) throw error;
    
    if (data && data.length > 0) {
      data.forEach(t => {
        let numStr = t.numero.toString().padStart(2, '0');
        ticketStates.set(numStr, t.estado);
      });
    }
    
    availableList = [];
    for (let i = 0; i < TOTAL_BOLETOS; i++) {
      let numStr = i.toString().padStart(2, '0');
      if (ticketStates.get(numStr) !== 'pendiente' && ticketStates.get(numStr) !== 'vendido') {
         availableList.push(numStr);
      }
    }
    totalPages = 1;
    updateSalesBar();
  } catch(e) { 
    console.error("Error cargando tickets de Supabase", e); 
    showToast("Error de conexión al cargar números");
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

function renderGrid() {
  const grid = document.getElementById('ticketGrid');
  if (!grid) return;
  grid.innerHTML = '';
  
  // Como es de 100, pintamos directo la lista completa, sin paginador real.
  // Pero necesitamos renderizar todos los números (00 al 99) y pintar los que no estén en availableList como ocupados si queremos mostrarlos,
  // O como lo solicitaste: solo pintamos availableList o pintamos la cuadricula entera.
  // Tu código original de la IA anterior pintaba SOLO los disponibles. Mantengo tu lógica exacta:
  for (let i = 0; i < availableList.length; i++) {
    let numStr = availableList[i];
    let t = document.createElement('div');
    t.className = 'ticket ' + (selectedTickets.has(numStr) ? 'ticket-selected' : 'ticket-available');
    t.textContent = numStr;
    t.onclick = () => toggleTicket(numStr);
    grid.appendChild(t);
  }
}

function toggleTicket(numStr) {
  if (selectedTickets.has(numStr)) {
    selectedTickets.delete(numStr);
  } else {
    selectedTickets.add(numStr);
  }
  renderGrid(); 
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
  if (!termsAgreed) { 
    document.getElementById('termsModal').style.display = 'flex'; 
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
  document.getElementById('payModal').style.display = 'flex';
}

function closePayModal() { 
  document.getElementById('payModal').style.display = 'none'; 
}

function acceptTerms() {
  localStorage.setItem('termsAgreed', 'true');
  document.getElementById('termsModal').style.display = 'none';
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
  const btn = e.target.querySelector('button[type="submit"]');
  btn.disabled = true; 
  btn.innerHTML = '⏳ Procesando...';
  
  const nombre = document.getElementById('fNombre').value;
  const cedula = document.getElementById('fCedula').value;
  const whatsapp = document.getElementById('fWhatsapp').value;
  const totalPagado = selectedTickets.size * PRECIO_BOLETO;
  const refEl = document.getElementById('fRef');
  const referencia = refEl ? refEl.value : '000000';
  const boletosArray = Array.from(selectedTickets).sort();
  const boletosStr = boletosArray.join(', ');
  const fileInput = document.getElementById('fCapture');
  const file = fileInput ? fileInput.files[0] : null;

  try {
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
    if (ticketsError) throw ticketsError;

    // 4. Limpiar lista local
    boletosArray.forEach(n => {
       ticketStates.set(n, 'pendiente');
       let idx = availableList.indexOf(n);
       if(idx !== -1) availableList.splice(idx, 1);
    });
    
    updateSalesBar(); 
    renderGrid();
    
    // 5. Notificar por Telegram
    try { 
      await notificarTelegram(nombre, boletosStr, totalPagado, referencia); 
    } catch (telErr) { console.warn("Error enviando Telegram, pero la compra se procesó"); }
    
    // 6. Cerrar modal y mostrar éxito
    document.getElementById('payModal').style.display = 'none';
    const summary = document.getElementById('successSummary');
    if(summary) {
        summary.innerHTML = `<div class="text-gray-800 font-bold">👤 ${nombre}</div><div class="text-gray-800">🎟️ ${selectedTickets.size} boletos</div><div class="text-gray-800">💰 Pagado: Bs. ${totalPagado}</div><div class="text-xs mt-1 text-gray-500">Ref: ${referencia}</div>`;
    }
    const successModal = document.getElementById('successModal');
    if(successModal) successModal.style.display = 'flex';
    
    startVIPCountdown();
    
  } catch(error) {
    console.error(error);
    showToast('❌ Compra detenida. Revisa tu conexión.');
    btn.disabled = false; 
    btn.innerHTML = '🚀 Confirmar y Reservar';
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

function startVIPCountdown() {
  let c = 3; 
  let cdNum = document.getElementById('cdNum'); 
  if(cdNum) cdNum.textContent = c;
  
  let cdRing = document.getElementById('cdRing'); 
  if(cdRing) cdRing.style.setProperty('--pct', '100%');
  
  if (cdInterval) clearInterval(cdInterval);
  
  cdInterval = setInterval(() => {
    c--; 
    if(cdNum) cdNum.textContent = c; 
    if(cdRing) cdRing.style.setProperty('--pct', (c/3)*100 + '%');
    
    if (c <= 0) { 
      clearInterval(cdInterval); 
      goVIP(); 
    }
  }, 1000);
}

function goVIP() { 
  window.location.href = VIP_URL; 
}

function closeSuccessModal() { 
  document.getElementById('successModal').style.display = 'none'; 
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
