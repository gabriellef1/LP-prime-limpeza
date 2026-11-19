// privacidade/ e termos/: o texto está no HTML (legível sem JavaScript e pelos buscadores); aqui só entra o layout.
import { montarPagina, definirAbertura } from '../layout.js';
import { el, trocar } from '../dom.js';
import { SERVICOS_AGENDAMENTO } from '../../config/agendamento.js';

const artigo = document.getElementById('texto-legal');
artigo.querySelector('h1')?.remove(); // o título vai pra abertura, no padrão das outras páginas
montarPagina(artigo, { demo: false });
definirAbertura({ rotulo: 'Prime Limpeza Especializada', titulo: artigo.dataset.titulo }); // a versão fica na 1ª linha do texto (vale sem JS)
// condicoes/: o escopo de cada serviço vem da mesma fonte do agendamento ("Ver detalhes do serviço"), sem cópia
const escopo = document.getElementById('escopo-servicos');
if (escopo) {
  // item ainda sem texto da Prime (começa com PREENCHER) não é publicado: o serviço aparece com a descrição que já existe
  trocar(escopo, ...Object.values(SERVICOS_AGENDAMENTO).flatMap((s) => {
    const itens = s.incluido.filter((i) => !/^PREENCHER/.test(i));
    return [el('h3', { text: s.nome }), itens.length ? el('ul', {}, itens.map((i) => el('li', { text: i }))) : el('p', { text: s.descricao })];
  }));
}
