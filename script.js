// Configurar aqui: coloque o ID da sua planilha e o nome da aba
const SHEET_ID = '14CUAbpGUatmHkdDdgcg_cAP7dT2p-55OZOZuAf9M4PQ'; // ID fornecido pelo usuário
const SHEET_NAME = 'Sheet1';

let pedidoInfo = { tamanho: 'M', valor: '19,00' };

async function fetchSheetGviz(sheetId, sheetName = 'Sheet1') {
    const url = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:json&sheet=${encodeURIComponent(sheetName)}`;
    const res = await fetch(url);
    const text = await res.text();
    // remover prefixo e sufixo do GViz
    const jsonText = text.replace(/^[^\{]*/, '').replace(/\);?\s*$/, '');
    return JSON.parse(jsonText);
}

function rowsFromGviz(gjson) {
    const cols = gjson.table.cols.map(c => (c.label || c.id || '').toString());
    return (gjson.table.rows || []).map(r => {
        const obj = {};
        (r.c || []).forEach((cell, i) => {
            let val = '';
            if (cell) {
                if (cell.v !== undefined && cell.v !== null) val = cell.v;
                else if (cell.f !== undefined) val = cell.f;
            }
            obj[cols[i] || i] = String(val);
        });
        return obj;
    });
}

function formatDateVariants(d) {
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yyyy = d.getFullYear();
    return [`${yyyy}-${mm}-${dd}`, `${dd}/${mm}/${yyyy}`];
}

function findMenuForToday(rows) {
    const variants = formatDateVariants(new Date());
    for (const row of rows) {
        for (const key in row) {
            const v = (row[key] || '').toString().trim();
            if (!v) continue;
            if (variants.includes(v)) return row;
            // tenta parse simples dd/mm/yyyy
            if (v.includes('/')) {
                const parts = v.split('/').map(s => s.trim());
                if (parts.length === 3) {
                    const dd = parts[0].padStart(2, '0');
                    const mm = parts[1].padStart(2, '0');
                    const yyyy = parts[2];
                    if (`${dd}/${mm}/${yyyy}` === variants[1]) return row;
                }
            }
            if (v.includes('-') && v.indexOf(variants[0]) !== -1) return row;
        }
    }
    return null;
}

async function loadMenu() {
    console.log('loadMenu function started.');
    if (!SHEET_ID || SHEET_ID === 'SEU_SHEET_ID') {
        console.warn('Defina SHEET_ID no script para carregar o cardápio.');
        return;
    }
    try {
        const gjson = await fetchSheetGviz(SHEET_ID, SHEET_NAME);
        console.log('Fetched Gviz JSON:', gjson);

        const rows = rowsFromGviz(gjson);
        console.log('Parsed rows from Gviz:', rows);

        if (!rows || rows.length === 0) {
            console.warn('No rows found in Google Sheet or parsing failed.');
            return;
        }

        let menuRow = findMenuForToday(rows) || rows[0];
        console.log('Selected menuRow:', menuRow);

        const keys = Object.keys(menuRow);
        const keyLower = k => (k || '').toLowerCase();

        const accompKey = keys.find(k => ['acompanhamentos', 'acomp', 'sides', 'acompanhamento'].includes(keyLower(k)));
        const carnesKey = keys.find(k => ['carnes', 'carne', 'carnes_nome', 'carne_nome', 'prato', 'menu', 'nome'].includes(keyLower(k)));
        const sizesKey = keys.find(k => ['tamanhos_e_precos', 'tamanhos_precos', 'tamanhos', 'precos', 'sizes_prices', 'preco'].includes(keyLower(k)));
        const imgKey = keys.find(k => ['imagem', 'foto', 'image', 'img', 'url'].includes(keyLower(k)));
        const descKey = keys.find(k => ['descricao', 'desc', 'detalhes'].includes(keyLower(k)));

        let title = '';
        let img = '';
        let desc = '';

        if (carnesKey) {
            title = menuRow[carnesKey] || '';
        }

        if (imgKey) img = menuRow[imgKey] || '';
        if (descKey) desc = menuRow[descKey] || '';

        const tituloEl = document.querySelector('.titulo-cardapio');
        if (tituloEl && title) tituloEl.textContent = title.toUpperCase();

        const plateImg = document.querySelector('.plate-img img');
        if (plateImg) {
            if (img) plateImg.src = img;
            plateImg.alt = title || 'Prato do Dia';
        }

        // Tentar ler tamanhos/preços usando cada célula da coluna C (cada linha = um botão)
        let pricesRendered = false;
        try {
            const collected = [];
            (gjson.table.rows || []).forEach((r, idx) => {
                if (!r || !r.c) return;
                const cell = r.c[2]; // Column C
                const rawVal = cell ? (cell.f !== undefined && cell.f !== null ? cell.f : (cell.v !== undefined && cell.v !== null ? cell.v : '')) : '';
                if (!rawVal) return;

                let sizesRaw = String(rawVal || '');
                sizesRaw = sizesRaw.replace(/<\/div>\s*<div[^>]*>/gi, '\n');
                sizesRaw = sizesRaw.replace(/<li>\s*/gi, '\n');
                sizesRaw = sizesRaw.replace(/<br\s*\/?\>/gi, '\n');
                sizesRaw = sizesRaw.replace(/<[^>]+>/g, '');
                sizesRaw = sizesRaw.trim();

                // Split by newline or semicolon to get individual size:price entries
                const entries = sizesRaw.split(/\r?\n|;/).map(s => s.trim()).filter(Boolean);

                entries.forEach(entry => {
                    // FIX: Improved regex to capture size and price more accurately
                    // Size: Allows words with accents and multiple characters (e.g., "Média", "Grande", "Pequena")
                    // Price: Handles optional "R$" prefix, allows comma or period as decimal separators, and optional currency words.
                    const regex = /([\wÀ-ú\s]+?)\s*[:\-]\s*((?:R\$)?\s*[\d.,]+(?:\s*Reais|\s*R\$)?)/i;
                    const match = entry.match(regex);

                    if (match && match[1] && match[2]) {
                        collected.push({
                            size: match[1].trim().toUpperCase(), // Trim and uppercase the size
                            price: match[2].trim()
                        });
                    } else {
                        console.warn(`Could not parse size/price from entry: "${entry}"`);
                    }
                });
            });

            console.log('DEBUG: collected from column C for prices:', collected);
            if (collected.length > 0) { renderPriceCards(collected); pricesRendered = true; }
        } catch (e) { console.error('Erro parsing coluna C', e); }

        // If not rendered from column C, try using a named column (sizesKey) as fallback
        if (!pricesRendered && sizesKey && menuRow[sizesKey]) {
            let sizesRaw = String(menuRow[sizesKey] || '');
            sizesRaw = sizesRaw.replace(/<\/div>\s*<div[^>]*>/gi, '\n');
            sizesRaw = sizesRaw.replace(/<li>\s*/gi, '\n');
            sizesRaw = sizesRaw.replace(/<br\s*\/?\>/gi, '\n');
            sizesRaw = sizesRaw.replace(/<[^>]+>/g, '');
            sizesRaw = sizesRaw.trim();
            console.log('DEBUG sizesKey fallback raw:', sizesRaw);
            const pairs = sizesRaw.split(/\r?\n|;/).map(s => s.trim()).filter(Boolean);
            let parsed = [];
            pairs.forEach(pair => {
                const parts = pair.split(/:|-/).map(s => s.trim());
                if (parts.length >= 2) {
                    parsed.push({ size: parts[0].toUpperCase(), price: parts.slice(1).join(':') });
                }
            });
            if (parsed.length > 0) renderPriceCards(parsed);
        } else if (!pricesRendered) {
            console.warn('No price data found from column C or sizesKey.');
        }

        if (desc) {
            let descEl = document.getElementById('descricao-prato');
            if (!descEl) {
                descEl = document.createElement('p');
                descEl.id = 'descricao-prato';
                descEl.style.padding = '10px 20px';
                descEl.style.color = '#ccc';
                document.querySelector('.main-content').appendChild(descEl);
            }
            descEl.textContent = desc;
        }

        // Buscar acompanhamentos da mesma linha (coluna Acompanhamentos) ou aba separada
        let accompRendered = false;
        if (accompKey && menuRow[accompKey]) {
            const raw = String(menuRow[accompKey]);
            // itens podem estar separados por vírgula ou ponto-e-vírgula
            const items = raw.split(/;|,/).map(s => s.trim()).filter(Boolean);
            if (items.length > 0) { renderAcompanhamentos(items); accompRendered = true; }
        } else {
            // tenta buscar em uma aba separada chamada 'Acompanhamentos'
            try {
                const gjsonAc = await fetchSheetGviz(SHEET_ID, 'Acompanhamentos');
                const rowsAc = rowsFromGviz(gjsonAc);
                if (rowsAc && rowsAc.length > 0) {
                    const items = [];
                    for (const r of rowsAc) {
                        const first = Object.values(r).find(v => v && v.toString().trim());
                        if (first) items.push(String(first).trim());
                    }
                    if (items.length > 0) { renderAcompanhamentos(items); accompRendered = true; }
                }
            } catch (e) { /* não tem aba de acompanhamentos; mantém os padrões estáticos */ }
        }

        // Agora renderizar carnes (coluna B) como checkboxes se disponível
        if (carnesKey && menuRow[carnesKey]) {
            const rawC = String(menuRow[carnesKey]);
            const meatItems = rawC.split(/;|,/).map(s => s.trim()).filter(Boolean);
            if (meatItems.length > 0) renderCarnes(meatItems);
            else renderCarnes(['Carne Assada']); // fallback mínimo
        } else {
            // tenta extrair valores da coluna B (índice 1) de todas as linhas da resposta GViz
            try {
                const meats = [];
                (gjson.table.rows || []).forEach(r => {
                    if (!r || !r.c) return;
                    const cell = r.c[1]; // coluna B
                    if (cell) {
                        const v = (cell.v !== undefined && cell.v !== null) ? cell.v : (cell.f !== undefined ? cell.f : '');
                        const s = String(v).trim();
                        if (s) meats.push(s);
                    }
                });
                // dedupe e normalize
                const uniq = Array.from(new Set(meats.map(m => m))).map(s => s.trim()).filter(Boolean);
                if (uniq.length > 0) renderCarnes(uniq);
                else renderCarnes(['Carne Assada']);
            } catch (e) {
                renderCarnes(['Carne Assada']);
            }
        }

    } catch (err) { console.error('Erro carregando planilha', err); }
}

document.addEventListener('DOMContentLoaded', () => { loadMenu(); });

function renderAcompanhamentos(items) {
    const container = document.getElementById('acompanhamentos');
    if (!container) return;
    // cria HTML dos checkboxes + mantém seção de carnes ao final
    let html = '';
    for (const it of items) {
        const safe = String(it).toUpperCase();
        html += `<label class="item-row"><input type="checkbox" value="${safe}" checked> ${safe}</label>`;
    }
    container.innerHTML = html;
}

function renderCarnes(items) {
    const container = document.getElementById('acompanhamentos');
    if (!container) return;
    let html = container.innerHTML || '';
    html += '<h3 style="margin-top:15px">OPÇÕES DE CARNES</h3>';
    for (const it of items) {
        const safe = String(it).toUpperCase();
        html += `<label class="item-row"><input type="checkbox" value="${safe}" checked> ${safe}</label>`;
    }
    container.innerHTML = html;
}

function renderPriceCards(pairs) {
    console.log('renderPriceCards called with pairs:', pairs);
    const container = document.querySelector('.price-section');
    if (!container) {
        console.error('Price section container not found!');
        return;
    }
    let html = '';
    pairs.forEach((p, i) => {
        const active = i === 0 ? ' active' : '';
        html += `<div class="price-card${active}" data-price="${p.price}" onclick="selectSize('${p.size}', this)">` +
            `<span class="size-tag">${p.size}</span>` +
            `<span class="price-value">${p.price}</span>` +
            `</div>`;
    });
    container.innerHTML = html;
    if (pairs.length > 0) pedidoInfo = { tamanho: pairs[0].size, valor: pairs[0].price };
    console.log('Price cards rendered. Initial pedidoInfo:', pedidoInfo);
}

function selectSize(tam, preco, element) {
    // permitir chamada legacy selectSize('M','19,00', this)
    // ou selectSize('M', this)
    if (!element && typeof preco === 'object') {
        element = preco;
        preco = null;
    }
    document.querySelectorAll('.price-card').forEach(el => el.classList.remove('active'));
    if (element) element.classList.add('active');
    // se preco não informado, pega do elemento
    let finalPrice = preco;
    if (!finalPrice && element) {
        finalPrice = element.dataset.price || (element.querySelector('.price-value') || {}).textContent || finalPrice;
    }
    pedidoInfo = { tamanho: tam, valor: finalPrice || pedidoInfo.valor };
}

function toggleModal(show) {
    document.getElementById('modal-pedido').style.display = show ? 'flex' : 'none';
}

function enviarWhatsApp() {
    const nome = document.getElementById('nome_cli').value;
    const endereco = document.getElementById('end_cli').value;
    const pagamento = document.getElementById('pag_cli').value;

    if (!nome || !endereco) {
        alert("Preencha nome e endereço!");
        return;
    }

    const acompanhamentos = [];
    document.querySelectorAll('#acompanhamentos input:checked').forEach(i => {
        acompanhamentos.push(i.value);
    });

    const telefone = "553498856848";
    
    // CORREÇÃO AQUI: usar concatenação de strings simples
    const msg = "*PEDIDO - CASA DE CARNES FARTURA*\n\n" +
                "*CLIENTE:* " + nome + "\n" +
                "*ENDEREÇO:* " + endereco + "\n\n" +
                "*ITEM:* Marmitex (" + pedidoInfo.tamanho + ")\n" +
                "*ACOMPANHAMENTOS:* " + acompanhamentos.join(', ') + "\n\n" +
                "*PAGAMENTO:* " + pagamento + "\n" +
                "*TOTAL: R$ " + pedidoInfo.valor + "*";

    const url = "https://wa.me/" + telefone + "?text=" + encodeURIComponent(msg);
    
    // Debug: mostrar no console
    console.log('Mensagem WhatsApp:', msg);
    console.log('URL gerada:', url);
    
    // Testar se a URL está correta - abrir em nova janela
    try {
        window.open(url, '_blank');
    } catch (e) {
        console.error('Erro ao abrir WhatsApp:', e);
        alert('Erro ao abrir WhatsApp. Tente novamente ou copie o link:\n' + url);
    }
    
    toggleModal(false);
}

// atualiza ano no rodapé do modal
try { 
    document.getElementById('modal-year').textContent = new Date().getFullYear(); 
} catch (e) { 
    console.log('Elemento modal-year não encontrado');
}