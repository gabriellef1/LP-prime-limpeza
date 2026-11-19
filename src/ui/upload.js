// Campo de upload de documento com prévia (imagem ou PDF), validação local (tipo, tamanho, assinatura) e troca.
// O arquivo em si só vai pro storage pelo caso de uso salvarDocumento; aqui é só UI.
import { anexar, el, trocar } from './dom.js';
import { validarArquivo, ROTULOS_DOCUMENTO, LIMITE_ARQUIVO_BYTES } from '../domain/validacao.js';

const ACEITA = 'image/jpeg,image/png,application/pdf,.jpg,.jpeg,.png,.pdf';
const ACEITA_FOTO = 'image/jpeg,image/png,.jpg,.jpeg,.png'; // foto de perfil: só imagem (o fundo é trocado no navegador)
const kb = (n) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(n / 1024)} KB`);

/**
 * @param {{tipo:string, existente?:{nomeArquivo:string, tamanho:number, mime:string}, aoEscolher:(arq:{file:File, cabecalho:Uint8Array})=>Promise<void|{arquivo?:File, aviso?:string}>, obterPrevia?:()=>Promise<Blob|null>, soFoto?:boolean, ajuda?:string}} op
 *   aoEscolher pode devolver o arquivo que foi de fato guardado (a foto de perfil já com o fundo padrão) e um aviso.
 */
export function campoUpload({ tipo, existente, aoEscolher, obterPrevia, soFoto = false, ajuda = '' }) {
  const id = `doc-${tipo}`;
  const input = el('input', { type: 'file', id, accept: soFoto ? ACEITA_FOTO : ACEITA, class: 'visualmente-oculto' });
  const previa = el('div', { class: 'previa', 'aria-hidden': 'true' });
  const nome = el('strong', { text: existente ? existente.nomeArquivo : 'Nenhum arquivo' });
  const detalhe = el('span', { class: 'mudo', text: existente ? ` · ${kb(existente.tamanho)}` : '' });
  const erro = el('p', { class: 'erro-campo', id: `${id}-erro`, 'aria-live': 'polite' });
  const aviso = el('p', { class: 'ajuda', id: `${id}-aviso`, 'aria-live': 'polite', text: ajuda });
  const botao = el('label', { for: id, class: 'btn btn-secundario btn-p', text: existente ? 'Trocar arquivo' : 'Escolher arquivo' });
  const raiz = el('div', { class: `upload${existente ? ' ok' : ''}`, dataset: { doc: tipo, estado: existente ? 'ok' : 'vazio' } }, [
    previa,
    el('div', { class: 'info' }, [el('span', { class: 'rotulo-doc', text: ROTULOS_DOCUMENTO[tipo] }), el('br'), nome, detalhe, erro, aviso]),
    botao, input,
  ]);
  input.setAttribute('aria-describedby', `${id}-erro`);
  input.setAttribute('aria-label', ROTULOS_DOCUMENTO[tipo]);

  function mostrarPrevia(blob) {
    trocar(previa);
    if (!blob) { previa.textContent = 'Sem prévia'; return; }
    if (blob.type === 'application/pdf') { previa.textContent = 'PDF'; return; }
    const img = el('img', { alt: '' });
    img.src = URL.createObjectURL(blob);
    img.addEventListener('load', () => URL.revokeObjectURL(img.src), { once: true });
    anexar(previa, img);
  }
  if (existente && obterPrevia) obterPrevia().then(mostrarPrevia).catch(() => mostrarPrevia(null));
  else mostrarPrevia(null);

  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    if (!file) return;
    const cabecalho = new Uint8Array(await file.slice(0, 8).arrayBuffer());
    const msg = validarArquivo({ nome: file.name, mime: file.type, tamanho: file.size, cabecalho }) || (soFoto && file.type === 'application/pdf' ? 'Envie uma foto em JPG ou PNG' : null);
    if (msg) { erro.textContent = msg; raiz.classList.add('invalido'); raiz.dataset.estado = 'invalido'; input.value = ''; return; }
    erro.textContent = ''; raiz.classList.remove('invalido');
    botao.setAttribute('aria-busy', 'true'); botao.textContent = soFoto ? 'Preparando a foto…' : 'Enviando…';
    try {
      const r = await aoEscolher({ file, cabecalho });
      const guardado = r?.arquivo || file;
      nome.textContent = guardado.name; detalhe.textContent = ` · ${kb(guardado.size)}`;
      raiz.classList.add('ok'); raiz.dataset.estado = 'ok';
      if (r?.aviso !== undefined) aviso.textContent = r.aviso;
      mostrarPrevia(guardado);
      botao.textContent = 'Trocar arquivo';
    } catch (e) {
      erro.textContent = e?.message || 'Não foi possível guardar o arquivo. Tente de novo.';
      raiz.classList.add('invalido'); raiz.dataset.estado = 'invalido';
      botao.textContent = existente || raiz.classList.contains('ok') ? 'Trocar arquivo' : 'Escolher arquivo';
    } finally { botao.removeAttribute('aria-busy'); input.value = ''; }
  });
  return { raiz, erro: (m) => { erro.textContent = m || ''; raiz.classList.toggle('invalido', !!m); }, input };
}

export const AJUDA_UPLOAD = `JPG, PNG ou PDF, até ${Math.round(LIMITE_ARQUIVO_BYTES / 1024 / 1024)} MB cada.`;
