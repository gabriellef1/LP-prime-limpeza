// Prova do Pix da Prime (src/config/prime.js): monta um BR Code de teste, desenha o QR do jeito que a página de pagamento
// desenha, salva o PNG e o copia e cola e LÊ o QR de volta com um leitor que não é o nosso (jsQR). O que saiu do leitor é
// conferido por um parser EMV e um CRC16 escritos aqui (tabela), sem usar src/domain/brcode.js: chave, recebedor (até 25),
// cidade (até 15), valor, txid e CRC.
// Uso: node scripts/valida-pix.mjs <pasta-de-saida> [valor-em-centavos]
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import jsQR from 'jsqr';
import { PRIME } from '../src/config/prime.js';
import { montarBRCode } from '../src/domain/brcode.js';
import { gerarQR, svgQR } from '../src/domain/qrcode.js';
import { abrirNavegador } from './pw.mjs';

const saida = process.argv[2] || '.';
const valor = Number(process.argv[3] || 100);
const TXID = 'TESTEPRIME20261118';
mkdirSync(saida, { recursive: true });

// ---- leitor independente (não usa o domínio)
const TABELA = Array.from({ length: 256 }, (_, i) => { let c = i << 8; for (let b = 0; b < 8; b += 1) c = (c & 0x8000) ? ((c << 1) ^ 0x1021) & 0xffff : (c << 1) & 0xffff; return c; });
const crcTabela = (s) => { let c = 0xffff; for (const b of Buffer.from(s, 'utf8')) c = ((c << 8) & 0xffff) ^ TABELA[((c >> 8) ^ b) & 0xff]; return c.toString(16).toUpperCase().padStart(4, '0'); };
function emv(s) {
  const o = {}; let i = 0;
  while (i < s.length) {
    const id = s.slice(i, i + 2); const n = Number(s.slice(i + 2, i + 4));
    if (!/^\d{2}$/.test(id) || !Number.isInteger(n) || i + 4 + n > s.length) throw new Error(`EMV quebrado na posição ${i}`);
    o[id] = s.slice(i + 4, i + 4 + n); i += 4 + n;
  }
  return o;
}
export function conferir(codigo, { chave, valorCentavos, txid }) {
  const erros = []; const ok = (c, m) => { if (!c) erros.push(m); };
  const t = emv(codigo); const conta = emv(t['26'] || '');
  ok(codigo.slice(-8, -4) === '6304', 'o CRC (campo 63) tem que ser o último');
  ok(crcTabela(codigo.slice(0, -4)) === codigo.slice(-4), `CRC errado: esperado ${crcTabela(codigo.slice(0, -4))}, veio ${codigo.slice(-4)}`);
  ok(t['00'] === '01', 'payload format indicator'); ok(conta['00'] === 'br.gov.bcb.pix', 'GUI do Pix');
  ok(conta['01'] === chave, `chave ${conta['01']} diferente de ${chave}`);
  ok(/^\d{14}$/.test(conta['01']), 'chave CNPJ tem 14 dígitos, só números');
  ok(t['52'] === '0000' && t['53'] === '986' && t['58'] === 'BR', 'MCC, moeda ou país');
  ok(t['54'] === (valorCentavos / 100).toFixed(2), `valor ${t['54']}`);
  ok(t['59'].length <= 25 && /^[A-Z0-9 .-]+$/.test(t['59']), `recebedor fora do padrão: ${t['59']}`);
  ok(t['60'].length <= 15 && /^[A-Z0-9 .-]+$/.test(t['60']), `cidade fora do padrão: ${t['60']}`);
  ok(emv(t['62'] || '')['05'] === txid, 'txid');
  return { erros, campos: { chave: conta['01'], recebedor: t['59'], cidade: t['60'], valor: t['54'], txid: emv(t['62'] || '')['05'], crc: t['63'] } };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const codigo = montarBRCode({ chave: PRIME.pix.chave, nome: PRIME.pix.nomeRecebedor, cidade: PRIME.pix.cidadeRecebedor, valorCentavos: valor, txid: TXID });
  writeFileSync(join(saida, 'pix-copia-e-cola.txt'), `${codigo}\n`);
  const b = await abrirNavegador();
  const p = await b.newPage({ viewport: { width: 520, height: 520 }, deviceScaleFactor: 2 });
  await p.setContent(`<body style="margin:0;background:#fff;display:grid;place-items:center;height:100vh"><div id="qr" style="width:440px;height:440px">${svgQR(gerarQR(codigo))}</div><style>#qr svg{width:100%;height:100%}</style></body>`);
  const png = join(saida, 'pix-qr.png');
  await p.locator('#qr').screenshot({ path: png });
  // lê os pixels do PNG salvo (não do SVG) e entrega ao jsQR
  const img = await p.evaluate(async (dados) => {
    const im = new Image(); im.src = `data:image/png;base64,${dados}`; await im.decode();
    const c = document.createElement('canvas'); c.width = im.width; c.height = im.height;
    const x = c.getContext('2d'); x.drawImage(im, 0, 0);
    return { w: c.width, h: c.height, px: Array.from(x.getImageData(0, 0, c.width, c.height).data) };
  }, (await import('node:fs')).readFileSync(png).toString('base64'));
  await b.close();
  const lido = jsQR(Uint8ClampedArray.from(img.px), img.w, img.h);
  if (!lido) { console.log('FALHOU: o leitor não achou QR na imagem'); process.exit(1); }
  const r = conferir(lido.data, { chave: PRIME.pix.chave, valorCentavos: valor, txid: TXID });
  if (lido.data !== codigo) r.erros.push('o texto lido do QR é diferente do copia e cola');
  console.log(`copia e cola: ${codigo}`);
  console.log(`lido do QR (jsQR ${img.w}x${img.h}): ${JSON.stringify(r.campos)}`);
  console.log(r.erros.length ? r.erros.map((e) => `FALHOU ${e}`).join('\n') : `# valida-pix: QR lido, CRC ${r.campos.crc} certo, chave certa; arquivos em ${saida}`);
  process.exit(r.erros.length ? 1 : 0);
}
