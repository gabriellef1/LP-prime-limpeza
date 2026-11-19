// Foto de perfil da profissional com fundo padrão da Prime. Tudo no navegador: a selfie NÃO sai do aparelho antes de
// virar a versão final (nenhum serviço externo). Segmentação de pessoa e detecção de rosto pelo MediaPipe Tasks Vision
// vendorizado em vendor/ (WASM + dois modelos pequenos), carregado só quando a pessoa escolhe a foto.
// Saída: JPEG quadrado de 512 px, rosto centralizado, fundo em tom da marca. O avatar redondo é do CSS de quem exibe.
// Se o recorte falhar (aparelho sem WASM/SIMD, rosto não encontrado, máscara ruim, demora), sai a ORIGINAL enquadrada com
// o fundo desfocado e `semRecorte: true`, que o cadastro guarda pra equipe revisar.
export const LADO_FOTO = 512;
// Fundo padrão: dourado claro da marca, lido dos tokens (src/ui/tokens.css): --dourado-100 nas bordas, --dourado-50 no centro.
const token = (nome) => getComputedStyle(document.documentElement).getPropertyValue(nome).trim() || 'white';
export const corFundoFoto = () => token('--dourado-100');
const LADO_MAX_ENTRADA = 1024;
const BASE = new URL('../../vendor/mediapipe-tasks-vision@0.10.14/', import.meta.url).href;

let carregando = null;
/** Carrega a biblioteca e os dois modelos uma vez só (promessa guardada; se falhar, a próxima tentativa recomeça). */
function carregar() {
  carregando ||= (async () => {
    const { FilesetResolver, FaceDetector, ImageSegmenter } = await import(`${BASE}vision_bundle.mjs`);
    const arquivos = await FilesetResolver.forVisionTasks(`${BASE}wasm`);
    const [rosto, pessoa] = await Promise.all([
      FaceDetector.createFromOptions(arquivos, { baseOptions: { modelAssetPath: `${BASE}modelos/blaze_face_short_range.tflite`, delegate: 'CPU' }, runningMode: 'IMAGE' }),
      ImageSegmenter.createFromOptions(arquivos, { baseOptions: { modelAssetPath: `${BASE}modelos/selfie_segmenter.tflite`, delegate: 'CPU' }, runningMode: 'IMAGE', outputConfidenceMasks: true, outputCategoryMask: false }),
    ]);
    return { rosto, pessoa };
  })().catch((e) => { carregando = null; throw e; });
  return carregando;
}

const tela = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
const suave = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** Decodifica respeitando a orientação da câmera (EXIF) e reduz pra no máximo 1024 px de lado. */
async function decodificar(file) {
  let img;
  try { img = await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch {
    img = await new Promise((ok, erro) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => erro(new Error('imagem inválida')); i.src = URL.createObjectURL(file); });
  }
  const w0 = img.width || img.naturalWidth; const h0 = img.height || img.naturalHeight;
  if (!w0 || !h0) throw new Error('imagem inválida');
  const f = Math.min(1, LADO_MAX_ENTRADA / Math.max(w0, h0));
  const c = tela(Math.round(w0 * f), Math.round(h0 * f));
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  img.close?.();
  return c;
}

/**
 * Quadrado do recorte na imagem de entrada: o centro do rosto fica no meio na horizontal e a `p` da altura (44%).
 * Foto fechada no rosto (sem imagem abaixo dos ombros): o quadrado encolhe e encosta na base da foto, senão o busto
 * ficaria "flutuando" no fundo; o rosto desce até 60% da altura, no máximo.
 */
function enquadrar(img, rosto) {
  if (!rosto) { const lado = Math.min(img.width, img.height); return { x: (img.width - lado) / 2, y: Math.max(0, (img.height - lado) * 0.25), lado, p: 0.44 }; }
  const cx = rosto.x + rosto.w / 2; const cy = rosto.y + rosto.h / 2; const maior = Math.max(rosto.w, rosto.h);
  const lado = Math.min(2.5 * maior, Math.max(1.5 * maior, (img.height - cy) / 0.4));
  const p = Math.min(0.6, Math.max(0.44, 1 - (img.height - cy) / lado));
  return { x: cx - lado / 2, y: cy - p * lado, lado, p };
}

function fundoDaMarca(ctx) {
  const g = ctx.createRadialGradient(LADO_FOTO / 2, LADO_FOTO * 0.42, LADO_FOTO * 0.1, LADO_FOTO / 2, LADO_FOTO / 2, LADO_FOTO * 0.75);
  g.addColorStop(0, token('--dourado-50')); g.addColorStop(1, corFundoFoto());
  ctx.fillStyle = g; ctx.fillRect(0, 0, LADO_FOTO, LADO_FOTO);
}

/** Maior rosto da imagem em pixels, ou null. */
function maiorRosto(det) {
  const r = (det?.detections || []).map((d) => d.boundingBox).filter(Boolean).sort((a, b) => b.width * b.height - a.width * a.height)[0];
  return r ? { x: r.originX, y: r.originY, w: r.width, h: r.height } : null;
}

/** Máscara de pessoa (0 a 1) no tamanho da imagem; null se o modelo não devolver nada aproveitável. */
function mascaraDePessoa(res, rosto) {
  const masks = res?.confidenceMasks || [];
  if (!masks.length) return null;
  const m = masks[masks.length - 1]; const w = m.width; const h = m.height;
  let v = Float32Array.from(m.getAsFloat32Array());
  // o canal certo é o que marca o rosto como pessoa: se o centro do rosto vier "fundo", o modelo entregou o inverso
  const i = Math.min(h - 1, Math.max(0, Math.round((rosto.y + rosto.h / 2) * (h / res.__alt)))) * w + Math.min(w - 1, Math.max(0, Math.round((rosto.x + rosto.w / 2) * (w / res.__larg))));
  if (v[i] < 0.5) v = v.map((x) => 1 - x);
  return { v, w, h };
}

async function recortar(img, limite) {
  const { rosto: detector, pessoa } = await limite(carregar(), 'carregar');
  const rosto = maiorRosto(detector.detect(img));
  if (!rosto) return { falha: 'rosto não encontrado', rosto: null };
  if (rosto.w < img.width * 0.08) return { falha: 'rosto pequeno demais na foto', rosto };
  const res = pessoa.segment(img); res.__larg = img.width; res.__alt = img.height;
  const m = mascaraDePessoa(res, rosto);
  res.close?.();
  if (!m) return { falha: 'sem máscara', rosto };
  // máscara como canal alfa (borda suavizada entre 50% e 80% de confiança: mais fechada, pra não trazer a cor do fundo antigo em volta do cabelo)
  const cm = tela(m.w, m.h); const dados = cm.getContext('2d').createImageData(m.w, m.h);
  for (let k = 0; k < m.v.length; k += 1) { dados.data[k * 4 + 3] = Math.round(255 * suave(0.5, 0.8, m.v[k])); }
  cm.getContext('2d').putImageData(dados, 0, 0);
  const q = enquadrar(img, rosto);
  const fx = m.w / img.width; const fy = m.h / img.height;
  const camada = tela(LADO_FOTO, LADO_FOTO); const cc = camada.getContext('2d');
  cc.imageSmoothingQuality = 'high';
  cc.drawImage(img, q.x, q.y, q.lado, q.lado, 0, 0, LADO_FOTO, LADO_FOTO);
  cc.globalCompositeOperation = 'destination-in';
  cc.drawImage(cm, q.x * fx, q.y * fy, q.lado * fx, q.lado * fy, 0, 0, LADO_FOTO, LADO_FOTO);
  // confere o resultado: a pessoa ocupa uma parte plausível do quadro e o rosto ficou dentro dela
  const a = cc.getImageData(0, 0, LADO_FOTO, LADO_FOTO).data; let soma = 0;
  for (let k = 3; k < a.length; k += 4) soma += a[k];
  const cobertura = soma / (255 * LADO_FOTO * LADO_FOTO);
  const noRosto = a[(Math.round(LADO_FOTO * q.p) * LADO_FOTO + LADO_FOTO / 2) * 4 + 3];
  if (cobertura < 0.12 || cobertura > 0.93 || noRosto < 128) return { falha: `máscara ruim (cobertura ${Math.round(cobertura * 100)}%)`, rosto };
  const final = tela(LADO_FOTO, LADO_FOTO); const cf = final.getContext('2d');
  fundoDaMarca(cf); cf.drawImage(camada, 0, 0);
  return { final, rosto, cobertura };
}

/** Sem recorte: a original enquadrada, com o fundo desfocado (cópia bem reduzida e ampliada) e a pessoa nítida num oval. */
function semRecorte(img, rosto) {
  const q = enquadrar(img, rosto);
  const final = tela(LADO_FOTO, LADO_FOTO); const cf = final.getContext('2d');
  const mini = tela(20, 20); mini.getContext('2d').drawImage(img, q.x, q.y, q.lado, q.lado, 0, 0, 20, 20);
  cf.fillStyle = corFundoFoto(); cf.fillRect(0, 0, LADO_FOTO, LADO_FOTO);
  cf.imageSmoothingEnabled = true; cf.imageSmoothingQuality = 'high';
  cf.drawImage(mini, 0, 0, 20, 20, 0, 0, LADO_FOTO, LADO_FOTO);
  const nitida = tela(LADO_FOTO, LADO_FOTO); const cn = nitida.getContext('2d');
  cn.drawImage(img, q.x, q.y, q.lado, q.lado, 0, 0, LADO_FOTO, LADO_FOTO);
  cn.globalCompositeOperation = 'destination-in';
  const oval = tela(LADO_FOTO, LADO_FOTO); const co = oval.getContext('2d');
  co.translate(LADO_FOTO / 2, LADO_FOTO * 0.5); co.scale(0.8, 1);
  const g = co.createRadialGradient(0, 0, LADO_FOTO * 0.34, 0, 0, LADO_FOTO * 0.52);
  g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(1, 'rgba(0,0,0,0)');
  co.fillStyle = g; co.fillRect(-LADO_FOTO, -LADO_FOTO, LADO_FOTO * 2, LADO_FOTO * 2);
  cn.drawImage(oval, 0, 0);
  cf.drawImage(nitida, 0, 0);
  return final;
}

const paraJpeg = (c) => new Promise((ok, erro) => c.toBlob((b) => (b ? ok(b) : erro(new Error('não foi possível gerar a foto'))), 'image/jpeg', 0.9));

/**
 * Selfie escolhida no cadastro -> foto final.
 * @param {Blob} file JPG ou PNG
 * @returns {Promise<{arquivo: File, semRecorte: boolean, motivo: string|null}>} arquivo = JPEG 512x512 (só ele é guardado)
 */
export function prepararFotoPerfil(file, opcoes) { return semRuido(() => preparar(file, opcoes)); }

/**
 * O WASM do MediaPipe escreve mensagens informativas pelo console.error ("INFO: Created TensorFlow Lite XNNPACK delegate
 * for CPU."). Não são erros: ficam fora do console enquanto a foto é preparada; erro de verdade continua aparecendo.
 */
async function semRuido(fn) {
  const original = console.error;
  console.error = (...a) => { if (typeof a[0] === 'string' && /^(INFO|[IW]\d{4})[: ]/.test(a[0])) return; original(...a); };
  try { return await fn(); } finally { console.error = original; }
}

async function preparar(file, { tempoMaxMs = 25000 } = {}) {
  const img = await decodificar(file); // imagem inválida lança: quem chama mostra "Envie uma foto em JPG ou PNG"
  const fim = Date.now() + tempoMaxMs;
  const limite = (p, o) => Promise.race([p, new Promise((_, erro) => { setTimeout(() => erro(new Error(`demorou demais (${o})`)), Math.max(1, fim - Date.now())); })]);
  let r;
  try { r = await limite(recortar(img, limite), 'recorte'); } catch (e) { r = { falha: e?.message || 'erro no recorte', rosto: null }; }
  const final = r.final || semRecorte(img, r.rosto);
  const blob = await paraJpeg(final);
  return { arquivo: new File([blob], r.final ? 'foto-perfil.jpg' : 'foto-perfil-sem-recorte.jpg', { type: 'image/jpeg' }), semRecorte: !r.final, motivo: r.final ? null : r.falha };
}
