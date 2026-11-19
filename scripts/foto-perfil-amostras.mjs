// Antes e depois da foto de perfil (src/ui/foto-perfil.js) em fotos de amostra, no Chromium, pelo servidor local.
// Uso: node scripts/foto-perfil-amostras.mjs <pasta-com-fotos> <pasta-de-saida> [--sem-biblioteca]
// --sem-biblioteca bloqueia o WASM pra mostrar o caminho de falha (original com fundo desfocado).
// Sai <nome>-antes.jpg, <nome>-depois.jpg, <nome>-avatar.png (como aparece no painel, redondo) e um resumo por foto.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, parse } from 'node:path';
import { abrirNavegador, subirServidor } from './pw.mjs';

const [entrada, saida] = process.argv.slice(2);
const semBiblioteca = process.argv.includes('--sem-biblioteca');
if (!entrada || !saida) { console.log('Uso: node scripts/foto-perfil-amostras.mjs <pasta-com-fotos> <pasta-de-saida> [--sem-biblioteca]'); process.exit(2); }
mkdirSync(saida, { recursive: true });
const { base, fechar } = await subirServidor();
const b = await abrirNavegador();
const p = await b.newPage({ viewport: { width: 600, height: 600 } });
const erros = [];
p.on('pageerror', (e) => erros.push(e.message));
if (semBiblioteca) await p.route('**/*.wasm', (r) => r.abort());
await p.goto(`${base}404.html`);
export const resultados = [];
for (const f of readdirSync(entrada).filter((x) => /\.(jpe?g|png)$/i.test(x)).sort()) {
  const bytes = readFileSync(join(entrada, f));
  const r = await p.evaluate(async ({ dados, tipo, mod }) => {
    const { prepararFotoPerfil } = await import(mod);
    const bin = Uint8Array.from(atob(dados), (c) => c.charCodeAt(0));
    const t0 = performance.now();
    const x = await prepararFotoPerfil(new File([bin], 'selfie', { type: tipo }));
    const ms = Math.round(performance.now() - t0);
    const img = await createImageBitmap(x.arquivo);
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0);
    const px = (xx, yy) => [...ctx.getImageData(xx, yy, 1, 1).data.slice(0, 3)];
    const buf = new Uint8Array(await x.arquivo.arrayBuffer()); let s = ''; for (const v of buf) s += String.fromCharCode(v);
    // avatar redondo, como o painel mostra
    document.body.innerHTML = '<div id="av" style="width:160px;height:160px;border-radius:50%;overflow:hidden;margin:20px"><img style="width:100%;height:100%;object-fit:cover"></div>';
    document.querySelector('#av img').src = URL.createObjectURL(x.arquivo); await document.querySelector('#av img').decode();
    return { semRecorte: x.semRecorte, motivo: x.motivo, nome: x.arquivo.name, bytes: buf.length, lado: [img.width, img.height], ms, cantos: [px(3, 3), px(img.width - 4, 3)], jpeg: btoa(s) };
  }, { dados: bytes.toString('base64'), tipo: /png$/i.test(f) ? 'image/png' : 'image/jpeg', mod: `${base}src/ui/foto-perfil.js` });
  const n = parse(f).name;
  writeFileSync(join(saida, `${n}-antes${parse(f).ext}`), bytes);
  writeFileSync(join(saida, `${n}-depois.jpg`), Buffer.from(r.jpeg, 'base64'));
  await p.locator('#av').screenshot({ path: join(saida, `${n}-avatar.png`) });
  delete r.jpeg; resultados.push({ foto: f, ...r });
  console.log(`${f}: ${r.semRecorte ? `SEM RECORTE (${r.motivo})` : 'recortada'} · ${r.lado.join('x')} · ${Math.round(r.bytes / 1024)} KB · ${r.ms} ms · cantos ${JSON.stringify(r.cantos)}`);
}
await b.close(); await fechar();
if (erros.length) console.log(`erros de página: ${erros.join(' | ')}`);
