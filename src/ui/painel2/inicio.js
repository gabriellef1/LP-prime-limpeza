// Painel v2, B3: tela Início (spec-painel-v2, seção 2), seguindo as regras da cliente (dashboard-regras-isa).
// Cada bloco carrega sozinho (esqueleto, erro com "Tentar de novo"), é recolhível e some quando não tem o que mostrar
// (stand-by, alertas, novos cadastros); "Precisa de você" vira "Tudo resolvido". Depois de cada ação, os blocos afetados
// e os contadores do menu recarregam. Ações com consequência dizem o que acontece; recusar sempre pede motivo.
import { el, trocar } from '../dom.js';
import { url, ADAPTER } from '../../config/app.js';
import { api } from '../../services/api.js';
import { executarAcao } from '../acoes.js';
import { formatarBRL } from '../../domain/dinheiro.js';
import { somarDias, diaDaSemana, NOMES_DIA } from '../../domain/calendario.js';
import { horariosPermitidos } from '../../domain/agendamento-v3.js';
import { CONFIG_PRECOS as CFG } from '../../config/precos.js';
import { detalhesSolicitacaoV3 } from '../paginas/painel-v3.js';
import { icone, ICONE_SERVICO } from './icones.js';
import { convidarTour, iniciarTour } from './tour.js';
import { anel, rosca, COR_G } from './inicio-vista.js';
import {
  bloco, botao, selo, avatar, zap, tabelaExpansivel, detalhe, filtrosVerticais, tudoResolvido, vazio, pedirMotivo, modal, confirmar,
  painelLateral, barras, esqueleto,
  TOM_SELO,
} from './componentes.js';

const REAL = ADAPTER === 'supabase';
const P = CFG.PRECOS;
const ddmm = (d) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}` : '');
const primeiro = (n) => String(n || '').split(' ')[0];
const NOMES_SERVICO = { residencial: 'Residencial', empresarial: 'Empresarial', condominial: 'Condominial', passadoria: 'Passadoria', pre_pos_mudanca: 'Mudança', pre_pos_evento: 'Eventos', pos_obra: 'Pós-obra' };
const nomeServico = (s) => NOMES_SERVICO[s] || P.tiposServico?.[s]?.nome || s || '';
const ORIGEM = { instagram: 'Instagram', google: 'Google', indicacao: 'Indicação', whatsapp: 'WhatsApp', outro: 'Outro' };
const MODALIDADE = { avulsa: 'Diária avulsa', multi_profissional: 'Mais de uma profissional', pacote: 'Pacote de diárias' };
const ESTADO_DIARIA = {
  agendado: ['A confirmar', 'aguardando'], confirmado: ['Confirmada', 'ok'], diarista_a_caminho: ['A caminho', 'info'], em_andamento: ['Em andamento', 'info'],
  finalizado: ['Concluída', 'ok'], avaliado: ['Concluída', 'ok'],
};
const SITUACAO_PEDIDO = { aguardando_pagamento: ['Aguardando pagamento', 'aguardando'], disponibilidade_confirmada: ['Aguardando pagamento', 'aguardando'], confirmado: ['Confirmada', 'ok'], concluido: ['Concluída', 'ok'], recusado: ['Recusada', 'urgente'], cancelado: ['Cancelada', 'neutro'] };
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const maiuscula = (t) => t.replace(/^./, (c) => c.toUpperCase());
const dataExtensa = (d) => `${Number(d.slice(8, 10))} de ${MESES[Number(d.slice(5, 7)) - 1]} de ${d.slice(0, 4)}`;
// Pagamento pendente não trava nada (spec da Agenda e Escala, seção 7): no Início ele aparece como atenção, nunca como
// urgente vermelho, e não entra na contagem de urgentes do bloco. O procedimento depois do prazo ainda é decisão da Isa.
const PAGAMENTO_SEM_URGENCIA = new Set(['pagamento_vencido', 'pagamento_verificacao']);
const urgenteNaTela = (x) => !!x.urgente && !PAGAMENTO_SEM_URGENCIA.has(x.tipo);
const hhmm = (iso) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });

/** Cache curto (30 s) por bloco, invalidado depois de cada ação. */
const cache = new Map();
async function dado(chave, fn) {
  const c = cache.get(chave);
  if (c && Date.now() - c.em < 30000) return c.valor;
  const valor = await fn();
  cache.set(chave, { valor, em: Date.now() });
  return valor;
}

export async function telaInicio({ sessao, hoje, casca }) {
  const amanha = somarDias(hoje, 1);
  const blocos = {};
  /** Depois de uma ação: limpa o cache, recarrega os blocos afetados e os contadores do menu. */
  const recarregar = (...nomes) => { cache.clear(); for (const n of nomes) blocos[n]?.recarregar(); casca.atualizarContadores(); };
  const motivos = () => dado('motivos', () => api.motivosPadrao().catch(() => ({ recusa: [], cancelamento: [] })));

  // ---------------------------------------------------------------- saudação + sistema trabalhando por você
  const h = Number(new Date().toLocaleString('en-GB', { hour: '2-digit', hourCycle: 'h23', timeZone: 'America/Sao_Paulo' }));
  const saudacao = `${h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite'}, ${primeiro(sessao?.nome) || 'equipe'}!`;
  const sistema = blocoSistema();
  const diaSemana = maiuscula(NOMES_DIA[diaDaSemana(hoje)]);

  // ---------------------------------------------------------------- solicitações novas
  blocos.solicitacoes = bloco({
    id: 'inicio-solicitacoes', titulo: 'Solicitações novas', ic: 'solicitacoes', sub: 'Analise, aprove, recuse ou negocie a data das novas solicitações de atendimento.', rotuloContagem: (n) => `${n} ${n === 1 ? 'solicitação nova' : 'solicitações novas'}`,
    extra: [el('a', { class: 'p-btn', href: url('painel/', { tela: 'solicitacoes' }) }, ['Ver todas', icone('seta', { pequeno: true })])],
    carregar: async () => {
      const r = await dado('solicitacoes', () => api.painelSolicitacoesNovas(20));
      const ms = (await motivos()).recusa || [];
      const linhas = r.itens.slice(0, 4).map((s) => linhaSolicitacao(s, ms, () => recarregar('solicitacoes', 'diariasHoje', 'diariasAmanha', 'pendencias')));
      return {
        contagem: r.total,
        extra: [el('a', { class: 'p-btn', href: url('painel/', { tela: 'solicitacoes' }) }, [r.total > 4 ? `Ver todas (${r.total})` : 'Ver todas', icone('seta', { pequeno: true })])],
        conteudo: r.itens.length ? tabelaExpansivel({
          rotulo: 'Solicitações novas',
          colunas: [{ rotulo: 'Data/Hora' }, { rotulo: 'Cliente', classe: 'p-principal-cel' }, { rotulo: 'Local', classe: 'p-oculta-celular' }, { rotulo: 'Serviço' }, { rotulo: 'Imóvel', classe: 'p-oculta-celular' },
            { rotulo: 'Valor e horas', classe: 'p-dinheiro' }, { rotulo: 'Ações', classe: 'p-acoes-cel', sr: true }],
          linhas,
        }) : tudoResolvido('Nenhuma solicitação nova esperando.'),
      };
    },
  });

  // ---------------------------------------------------------------- diárias de hoje e de amanhã
  blocos.diariasHoje = blocoDiarias({ id: 'inicio-hoje', titulo: 'Diárias de hoje', data: hoje, recarregar });
  blocos.diariasAmanha = blocoDiarias({ id: 'inicio-amanha', titulo: 'Diárias de amanhã', data: amanha, recarregar, recolhidoNoCelular: true });

  // ---------------------------------------------------------------- precisa de você
  let filtro = 'todas';
  blocos.pendencias = bloco({
    id: 'inicio-pendencias', titulo: 'Precisa de você', ic: 'calendario_ok', rotuloContagem: (n) => `${n} ${n === 1 ? 'pendência' : 'pendências'}`,
    carregar: async () => {
      const r0 = await dado('pendencias', () => api.painelPendencias());
      // urgência da tela (pagamento pendente vira atenção) e a ordem acompanha: urgentes primeiro, o resto como veio
      const itens = [...r0.itens].sort((a, b) => Number(urgenteNaTela(b)) - Number(urgenteNaTela(a)));
      const r = { ...r0, itens, urgentes: itens.filter(urgenteNaTela).length };
      if (!r.itens.length) return { contagem: 0, conteudo: tudoResolvido('Tudo resolvido. Nada esperando por você agora.') };
      const CATS = [['todas', 'Todas'], ['escala', 'Escala'], ['financeiro', 'Financeiro'], ['contratos', 'Contratos'], ['ocorrencias', 'Ocorrências'], ['automacoes', 'Automações']];
      // todas inteiras, sem rolagem interna: a lista cortada no meio parecia quebrada e "Mostrar mais" escondia o que o
      // teste do novato alcança em 2 cliques (revisão do acabamento, 21/10)
      const lista = el('ul', { class: 'p-lista', 'aria-live': 'polite', 'aria-label': 'Pendências' });
      const desenhar = () => trocar(lista, ...r.itens.filter((x) => filtro === 'todas' || x.categoria === filtro).map((x) => itemPendencia(x, { hoje, recarregar, motivos })));
      desenhar();
      const ops = CATS.map(([k, rot]) => [k, rot, k === 'todas' ? r.itens.length : r.itens.filter((x) => x.categoria === k).length]).filter(([k, , n]) => k === 'todas' || n);
      // como na imagem 05: no computador a lista mostra uns cinco itens (o resto rola dentro do bloco, nada some da tela)
      // e "Ver todas as pendências" abre a lista inteira no lugar
      lista.id = 'inicio-pend-lista';
      const todas = r.itens.length > 5 ? el('button', { type: 'button', class: 'p-link', 'aria-expanded': 'false', 'aria-controls': 'inicio-pend-lista' }, [`Ver todas as pendências (${r.itens.length})`, icone('seta', { pequeno: true })]) : null;
      todas?.addEventListener('click', () => {
        const abrir = !lista.classList.contains('p-lista-cheia');
        lista.classList.toggle('p-lista-cheia', abrir); todas.setAttribute('aria-expanded', String(abrir));
        trocar(todas, abrir ? 'Mostrar menos' : `Ver todas as pendências (${r.itens.length})`, icone(abrir ? 'acima' : 'seta', { pequeno: true }));
      });
      return {
        contagem: r.itens.length, urgentes: r.urgentes,
        conteudo: el('div', { class: 'p-pend' }, [filtrosVerticais(ops, filtro, (v) => { filtro = v; desenhar(); }), lista]),
        rodape: todas ? [todas] : [],
      };
    },
  });

  // ---------------------------------------------------------------- stand-by de hoje (só se houver)
  blocos.standby = bloco({
    id: 'inicio-standby', titulo: 'Stand-by de hoje', ic: 'usuario', someSeVazio: true,
    carregar: async () => {
      const r = await dado('standby', () => api.painelStandby(hoje));
      if (!r.itens.length) return { vazio: true };
      return { contagem: r.itens.length, conteudo: el('ul', { class: 'p-lista' }, r.itens.slice(0, 3).map((x) => itemStandby(x, { hoje, recarregar }))),
        rodape: [el('a', { class: 'p-link', href: url('painel/', { tela: 'profissionais' }) }, ['Ver todas', icone('seta', { pequeno: true })])] };
    },
  });

  // ---------------------------------------------------------------- alertas importantes (só se houver)
  blocos.alertas = bloco({
    id: 'inicio-alertas', titulo: 'Alertas importantes', ic: 'sino', recolhidoNoCelular: true, someSeVazio: true,
    carregar: async () => {
      const r = await dado('alertas', () => api.painelAlertas());
      if (!r.itens.length) return { vazio: true };
      const destino = (x) => (x.tipo === 'documento_vence' ? url('painel/', { tela: 'profissionais', profissional: x.ref.diaristaId })
        : x.tipo === 'pacotes_semana' ? url('painel/', { tela: 'clientes', aba: 'relacionamento' }) : url('painel/', { tela: 'clientes', cliente: x.ref.clienteId }));
      // recolhido, o cabeçalho continua dizendo o que é (regra da cliente: alertas específicos e urgência visível)
      const sub = `${r.itens[0].titulo}${r.itens.length > 1 ? ` e mais ${r.itens.length - 1}` : ''}`;
      return { contagem: r.itens.length, urgentes: r.itens.filter((x) => x.tipo === 'avaliacao_baixa').length, sub, conteudo: el('ul', { class: 'p-lista' }, r.itens.slice(0, 6).map((x) => el('li', {}, [
        el('a', { class: 'p-texto-item u-sem-sub', href: destino(x) }, [el('b', { text: x.titulo }), el('span', { text: x.sub || '' })]),
      ]))) };
    },
  });

  // ---------------------------------------------------------------- novos cadastros (cadastros sem solicitação)
  blocos.cadastros = bloco({
    id: 'inicio-cadastros', titulo: 'Novos cadastros', ic: 'usuario', recolhidoNoCelular: true, someSeVazio: true,
    carregar: async () => {
      const r = await dado('cadastros', () => api.listarCadastrosSemSolicitacao({ status: 'novo' }));
      if (!r.itens.length) return { vazio: true };
      const quando = (iso) => { const d = iso.slice(0, 10); return d === hoje ? 'Hoje' : d === somarDias(hoje, -1) ? 'Ontem' : ddmm(d); };
      return { contagem: r.total, sub: 'Concluíram o cadastro e não enviaram solicitação.', conteudo: el('ul', { class: 'p-lista' }, r.itens.slice(0, 5).map((c) => el('li', {}, [
        el('a', { class: 'p-texto-item u-sem-sub', href: url('painel/', { tela: 'clientes', cliente: c.id }) }, [el('b', { text: c.nome }), el('span', { text: c.telefone || '' })]),
        zap(c.telefone, c.nome), el('span', { class: 'p-sec', text: quando(c.criadoEm) }),
      ]))), rodape: [el('a', { class: 'p-link', href: url('painel/', { tela: 'clientes', aba: 'prospeccao' }) }, ['Ver todos', icone('seta', { pequeno: true })])] };
    },
  });

  // ---------------------------------------------------------------- indicadores (só os três da Home)
  const ind = () => dado('indicadores', () => api.painelIndicadoresHome(null));
  blocos.meta = bloco({ id: 'inicio-meta', titulo: 'Meta de diárias', ic: 'meta', recolhidoNoCelular: true, carregar: async () => blocoMeta(await ind()) });
  blocos.motivos = bloco({ id: 'inicio-motivos', titulo: 'Motivos de cancelamento', ic: 'calendario_x', recolhidoNoCelular: true, carregar: async () => blocoMotivos(await ind()) });
  blocos.regioes = bloco({ id: 'inicio-regioes', titulo: 'Regiões mais atendidas', ic: 'local', recolhidoNoCelular: true, carregar: async () => blocoRegioes(await ind()) });

  // como na imagem 05 da cliente (17/11/2026): saudação com a coroa, "Sistema trabalhando por você" e a data à direita;
  // solicitações na largura toda, diárias de hoje e de amanhã lado a lado, depois pendências, stand-by, alertas e
  // cadastros numa linha e os três indicadores na última
  casca.conteudo.classList.add('p-ini');
  trocar(casca.conteudo,
    el('div', { class: 'p-cabecalho p-ini-cab' }, [
      el('div', { class: 'p-ini-saudacao' }, [
        el('h1', {}, [saudacao, el('span', { class: 'p-ini-coroa', 'aria-hidden': 'true' }, [icone('coroa_c')])]),
        el('p', {}, ['Tudo organizado para mais um dia de grandes resultados.', el('span', { class: 'p-ini-brilho', 'aria-hidden': 'true' }, [icone('brilho', { pequeno: true })])]),
      ]),
      el('div', { class: 'p-ini-cab-dir' }, [sistema.raiz,
        el('p', { class: 'p-ini-data' }, [el('span', { class: 'p-ini-data-ic', 'aria-hidden': 'true' }, [icone('calendario_d')]), el('span', {}, [`${diaSemana},`, el('br'), dataExtensa(hoje)])])]),
    ]),
    convidarTour(),
    blocos.solicitacoes.raiz,
    el('div', { class: 'p-grade p-ini-l2' }, [blocos.diariasHoje.raiz, blocos.diariasAmanha.raiz]),
    el('div', { class: 'p-grade p-ini-l3' }, [blocos.pendencias.raiz, blocos.standby.raiz, blocos.alertas.raiz, blocos.cadastros.raiz]),
    el('div', { class: 'p-grade p-ini-l4' }, [blocos.meta.raiz, blocos.motivos.raiz, blocos.regioes.raiz]));
  // cada bloco carrega e desenha sozinho (sem travar os outros)
  for (const b of Object.values(blocos)) b.recarregar();
  sistema.carregar();
  if (new URLSearchParams(location.search).get('foco') === 'pendencias') blocos.pendencias.raiz.scrollIntoView({ block: 'start' });
  if (new URLSearchParams(location.search).get('tour')) setTimeout(iniciarTour, 1200); // "Ver o tour de novo" (Ajuda)
}

// ---------------------------------------------------------------- "Sistema trabalhando por você" (pequeno e recolhível)
function blocoSistema() {
  const lista = el('div', { class: 'p-sistema-lista', id: 'p-sistema-lista', hidden: true });
  const resumo = el('small', { text: 'Carregando…' });
  const btn = el('button', { type: 'button', class: 'p-sistema-btn', 'aria-expanded': 'false', 'aria-controls': 'p-sistema-lista' }, [
    el('span', { class: 'p-ponto', 'aria-hidden': 'true' }), el('span', {}, [el('strong', { text: 'Sistema trabalhando por você' }), resumo]), icone('abaixo', { pequeno: true }),
  ]);
  btn.addEventListener('click', () => { const abrir = lista.hidden; lista.hidden = !abrir; btn.setAttribute('aria-expanded', String(abrir)); });
  document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && !lista.hidden) { lista.hidden = true; btn.setAttribute('aria-expanded', 'false'); btn.focus(); } });
  return {
    raiz: el('div', { class: 'p-sistema' }, [btn, lista]),
    async carregar() {
      try {
        const r = await api.painelSistemaHoje();
        resumo.textContent = `${r.total} ${r.total === 1 ? 'ação automática' : 'ações automáticas'} hoje`;
        trocar(lista, el('p', { class: 'p-sec u-mb-2', text: 'Mensagens que o sistema enviou sozinho hoje. As que falharam aparecem em "Precisa de você".' }),
          r.itens.length ? el('ul', { class: 'p-lista' }, r.itens.map((x) => el('li', {}, [el('span', { class: 'p-ic-item ok', 'aria-hidden': 'true' }, [icone('check', { pequeno: true })]),
            el('span', { class: 'p-texto-item' }, [el('b', { text: x.descricao }), el('span', { text: hhmm(x.em) })])]))) : vazio('Nenhuma ainda hoje.'));
      } catch { resumo.textContent = 'Não deu pra carregar agora'; }
    },
  };
}

// ---------------------------------------------------------------- linha da solicitação nova
/** Imóvel em duas linhas (tamanho; animal e refeição): na coluna do computador e no detalhe, que é onde fica no celular. */
function textoImovel(im = {}) {
  return [im.pecas ? `${im.pecas} peças` : [im.metragem ? `${im.metragem} m²` : null, im.ambientes ? `${im.ambientes} amb.` : null].filter(Boolean).join(' · ') || '',
    [im.animais ? 'Com animal' : 'Sem animal', im.refeicao === false ? 'sem refeição' : null].filter(Boolean).join(' · ')];
}
export function linhaSolicitacao(s, motivosRecusa, depois) {
  const quando = el('span', { class: 'p-num' }, [ddmm(s.primeiraData), el('span', { class: 'p-linha2', text: s.horaInicio || '' })]);
  const cliente = el('span', { class: 'u-lin-2' }, [el('span', { class: 'p-forte', text: s.cliente.nome }), zap(s.cliente.telefone, s.cliente.nome)]);
  const [imovel1, imovel2] = textoImovel(s.imovel);
  const imovel = el('span', {}, [el('span', { class: 'u-nowrap', text: imovel1 }), el('span', { class: 'p-linha2', text: imovel2 })]);
  const servico = el('span', {}, [nomeServico(s.servico),
    s.quantidade > 1 ? el('span', { class: 'p-linha2', text: `${s.quantidade} ${s.modalidade === 'multi_profissional' ? 'profissionais' : 'diárias'}` }) : null]);
  const aprovar = botao('Aprovar', { tom: 'ok', ic: 'check', rotulo: `Aprovar a solicitação de ${s.cliente.nome}`, acao: (k) => api.confirmarDisponibilidade(s.pedidoId, {}, { chave: k }),
    sucesso: 'Disponibilidade confirmada. A cliente recebe a cobrança no WhatsApp.', aoSucesso: depois });
  const recusar = botao('Recusar', { ic: 'fechar', rotulo: `Recusar a solicitação de ${s.cliente.nome}`, aoClicar: async () => {
    const m = await pedirMotivo({ titulo: `Recusar a solicitação de ${primeiro(s.cliente.nome)}`, motivos: motivosRecusa, rotuloConfirmar: 'Recusar e avisar a cliente',
      consequencia: 'A cliente recebe a recusa com o motivo pelo WhatsApp. Fica registrado no histórico.' });
    if (m) await executarAcao(recusar, (k) => api.recusarSolicitacao(s.pedidoId, { motivo: m.texto }, { chave: k }), { sucesso: 'Solicitação recusada.', aoSucesso: depois });
  } });
  const negociar = botao('Negociar data', { ic: 'calendario_d', rotulo: `Negociar data com ${s.cliente.nome}`, aoClicar: () => negociarData(s, depois) });
  const mais = botao('Ver a solicitação completa', { ic: 'mais', soIcone: true, aoClicar: () => verSolicitacao(s) });
  const avisos = [s.enderecoNovoPacote ? selo('Endereço novo no pacote', 'aguardando') : null, s.proposta ? selo(`Data proposta: ${ddmm(s.proposta.data)} ${s.proposta.horaInicio}`, 'info') : null].filter(Boolean);
  return {
    rotulo: s.cliente.nome, dataset: { solicitacao: s.pedidoId },
    celulas: [quando, el('span', {}, [cliente, ...avisos.map((a) => el('span', { class: 'u-bloco u-mt-1' }, [a]))]),
      el('span', {}, [[s.local?.bairro, s.local?.cidade === 'Belo Horizonte' ? 'BH' : s.local?.cidade].filter(Boolean).join(' - ')]),
      servico, imovel, el('span', { class: 'p-pilha p-pilha-dir' }, [el('span', { class: 'p-num p-forte', text: formatarBRL(s.valorCentavos) }), el('span', { class: 'p-num p-linha2', text: `${String(s.horas).replace('.', ',')}h` })]),
      s.status && s.status !== 'solicitado'
        ? el('span', { class: 'u-lin' }, [selo(...(SITUACAO_PEDIDO[s.status] || [s.status, 'neutro'])), mais])
        : el('span', { class: 'p-acoes-sol' }, [aprovar, recusar, negociar, mais])],
    detalhe: () => detalheSolicitacao(s),
  };
}

function detalheSolicitacao(s) {
  const caixa = el('div', {}, [esqueleto(2)]);
  api.obterPedido(s.pedidoId).then((c) => {
    const ats = c.atendimentos.filter((a) => a.status !== 'cancelado');
    const a0 = ats[0] || {};
    const end = a0.endereco || c.pedido.endereco || c.cliente?.endereco || {};
    const car = a0.caracteristicas || {};
    trocar(caixa, detalhe([
      ['Nº da solicitação', c.pedido.numeroSolicitacao ? String(c.pedido.numeroSolicitacao).padStart(6, '0') : ''],
      ['Modalidade', `${MODALIDADE[c.pedido.modalidade] || 'Solicitação'}${ats.length > 1 ? ` · ${ats.length} ${c.pedido.modalidade === 'multi_profissional' ? 'profissionais' : 'diárias'}` : ''}`],
      ['Datas', ats.map((a) => `${ddmm(a.data)}${a.horaInicio ? ` ${a.horaInicio}` : ''}`).join(', ')],
      ['Imóvel', textoImovel(s.imovel).filter(Boolean).join(' · ')],
      ['Endereço', [[end.logradouro, end.numero].filter(Boolean).join(', '), end.complemento, end.bairro, end.cidade].filter(Boolean).join(' · '), true],
      ['Características', [car.metragem ? `${car.metragem} m²` : '', car.mobiliado ? `mobiliado: ${car.mobiliado}` : '', car.condicao ? `condição: ${car.condicao}` : '', car.momento ? `momento: ${car.momento}` : '',
        car.animais?.tem ? 'com animais' : car.animais ? 'sem animais' : ''].filter(Boolean).join(' · ')],
      ['Duração', a0.duracaoMinutos ? `${a0.duracaoMinutos / 60}h${a0.duracaoRecomendadaHoras && a0.duracaoRecomendadaHoras * 60 > a0.duracaoMinutos ? ` (sugerida ${a0.duracaoRecomendadaHoras}h)` : ''}` : ''],
      ['Justificativa da duração', a0.justificativa || ''],
      ['Como conheceu', s.origem?.origem ? [ORIGEM[s.origem.origem] || s.origem.origem, s.origem.quemIndicou, s.origem.outroQual].filter(Boolean).join(': ') : ''],
      ['Cupom', c.pedido.cupomCodigo || ''],
      ['Valor', formatarBRL(c.pedido.pacote?.totalCentavos || 0)],
    ]));
  }).catch(() => trocar(caixa, vazio('Não deu pra carregar o detalhe agora.')));
  return caixa;
}

export async function verSolicitacao(s) {
  const corpo = el('div', {}, [esqueleto(4)]);
  painelLateral({ titulo: `Solicitação de ${primeiro(s.cliente.nome)}`, corpo });
  try {
    const c = await api.obterPedido(s.pedidoId);
    trocar(corpo, c.pedido.pacote?.versao === 3 ? detalhesSolicitacaoV3(c.pedido, c.cliente, c.atendimentos) : detalheSolicitacao(s),
      el('p', {}, [el('a', { class: 'p-link', href: url('painel/', { tela: 'solicitacoes' }) }, ['Ajustar horários e outras opções em Solicitações', icone('seta', { pequeno: true })])]));
  } catch { trocar(corpo, vazio('Não deu pra carregar a solicitação agora.')); }
}

/** Negociar data: calendário + horário permitido pela duração; a cliente recebe a proposta pelo WhatsApp (C18). */
function negociarData(s, depois) {
  const minimo = somarDias(new Date().toISOString().slice(0, 10), 1);
  const data = el('input', { type: 'date', id: 'neg-data', min: minimo, value: '' });
  const hora = el('select', { id: 'neg-hora' });
  const msg = el('textarea', { id: 'neg-msg', rows: '2', maxlength: '280', placeholder: 'Opcional: algo pra cliente saber' });
  const erro = el('p', { class: 'p-erro-campo', 'aria-live': 'polite' });
  const horasDia = Math.max(2, Math.round(s.horas || 4));
  const atualizarHoras = () => {
    const opcoes = data.value ? horariosPermitidos(horasDia, data.value, CFG) : [];
    trocar(hora, ...(opcoes.length ? opcoes : ['08:00']).map((x) => el('option', { value: x, text: x, selected: x === (s.horaInicio || '08:00') })));
  };
  data.addEventListener('change', atualizarHoras); atualizarHoras();
  const corpo = el('div', { class: 'u-col' }, [
    el('p', { class: 'p-sec', text: `Pedido pra ${ddmm(s.primeiraData)}${s.horaInicio ? ` às ${s.horaInicio}` : ''}. Proponha outra data e horário.` }),
    el('div', { class: 'campo' }, [el('label', { for: 'neg-data', text: 'Nova data' }), data]),
    el('div', { class: 'campo' }, [el('label', { for: 'neg-hora', text: 'Horário de início' }), hora]),
    el('div', { class: 'campo' }, [el('label', { for: 'neg-msg', text: 'Mensagem (opcional)' }), msg]),
    erro, el('p', { class: 'p-consequencia', text: 'A cliente recebe a proposta pelo WhatsApp e responde por lá. A solicitação continua aqui até você aprovar ou recusar.' }),
  ]);
  modal({ titulo: `Negociar a data com ${primeiro(s.cliente.nome)}`, corpo, botoes: (fechar) => {
    const enviar = botao('Enviar proposta à cliente', { tom: 'primario', aoClicar: () => {
      if (!data.value) { erro.textContent = 'Escolha a nova data'; data.focus(); return; }
      executarAcao(enviar, (k) => api.proporNovaData(s.pedidoId, { data: data.value, horaInicio: hora.value, mensagem: msg.value }, { chave: k }), {
        sucesso: 'Proposta enviada à cliente.', aoSucesso: () => { fechar(); depois(); }, aoErro: (e) => { erro.textContent = e.message || 'Não deu certo. Tente de novo.'; },
      });
    } });
    return [botao('Voltar', { aoClicar: () => fechar() }), enviar];
  } });
}

// ---------------------------------------------------------------- diárias do dia
function blocoDiarias({ id, titulo, data, recolhido = false, recolhidoNoCelular = false }) {
  return bloco({
    id, titulo: `${titulo}`, recolhido, recolhidoNoCelular, ic: 'calendario_ok', rotuloContagem: (n) => `${n} ${n === 1 ? 'diária' : 'diárias'}`,
    carregar: async () => {
      const r = await dado(`diarias:${data}`, () => api.painelDiarias(data));
      const semProf = r.itens.filter((d) => !d.profissional && !['finalizado', 'avaliado'].includes(d.status)).length;
      const extra = [el('span', { class: 'p-pontos' }, [el('span', { text: `${r.confirmadas} ${r.confirmadas === 1 ? 'confirmada' : 'confirmadas'}` }),
        r.pendentes ? el('span', { class: 'aguardando', text: `${r.pendentes} ${r.pendentes === 1 ? 'pendente' : 'pendentes'}` }) : null,
        semProf ? el('span', { class: 'urgente', text: `${semProf} sem profissional` }) : null])];
      // amanhã (escala do dia seguinte): o atalho fica no cabeçalho, onde ficava o selo da escala, visível com o bloco recolhido
      extra.push(el('a', { class: 'p-btn', href: url('painel/', { tela: 'agenda', data }) }, ['Ver agenda completa', icone('seta', { pequeno: true })]));
      return {
        contagem: r.itens.length, urgentes: semProf, extra, rodape: [el('a', { class: 'p-link', href: url('painel/', { tela: 'agenda', data }) }, [r.itens.length > 5 ? `Abrir na Agenda e Escala (${r.itens.length} diárias)` : 'Abrir na Agenda e Escala', icone('seta', { pequeno: true })])],
        conteudo: r.itens.length ? tabelaExpansivel({
          rotulo: titulo,
          colunas: COLUNAS_DIARIA,
          linhas: r.itens.map((d) => linhaDiaria(d)),
        }) : vazio(id === 'inicio-amanha' ? 'Nenhuma diária amanhã.' : 'Nenhuma diária hoje.'),
      };
    },
  });
}

export const COLUNAS_DIARIA = [{ rotulo: 'Horário' }, { rotulo: 'Cliente / Local', classe: 'p-principal-cel' }, { rotulo: 'Serviço', classe: 'p-oculta-celular p-cel-ic' }, { rotulo: 'Horas', classe: 'p-oculta-celular p-col-horas' },
  { rotulo: 'Profissional' }, { rotulo: 'Pagamento' }, { rotulo: 'Status' }];
export function linhaDiaria(d) {
  const [rot] = ESTADO_DIARIA[d.status] || [d.status, 'neutro'];
  // pagamento e status em selos de duas cores, como na imagem 05 (pendente em laranja: avisa, não trava)
  const est = d.pagamento?.estado;
  const pg = el('span', { class: `p-pag ${est === 'pago' ? 'p-pag-ok' : est === 'a_faturar' ? 'p-pag-fat' : 'p-pag-pend'}` }, [
    el('span', { text: est === 'pago' ? 'Pago' : est === 'a_faturar' ? 'A faturar' : 'Pendente' }), el('span', { text: d.pagamento?.forma === 'cartao' ? 'Cartão' : est === 'a_faturar' ? 'Fatura' : 'PIX' })]);
  const concluida = ['finalizado', 'avaliado'].includes(d.status);
  const status = concluida
    ? el('span', { class: 'p-st-concluida' }, [el('span', { text: rot }), d.nota ? el('span', { class: 'p-st-nota' }, [icone('estrela', { pequeno: true }), String(d.nota).replace('.', ',')]) : null])
    : el('span', { class: `p-st p-st-${d.status}`, text: rot });
  const prof = d.profissional ? el('span', { class: 'u-lin' }, [avatar(d.profissional.nome.split(' ')[0], { habilidades: d.profissional.habilidades, foto: d.profissional.foto }), zap(d.profissional.telefone, d.profissional.nome)])
    : selo('Sem profissional', 'urgente');
  const car = d.caracteristicas || {};
  return {
    rotulo: d.cliente.nome, dataset: { diaria: d.id },
    celulas: [el('span', { class: 'p-num p-forte', text: d.horaInicio || '' }),
      el('span', { class: 'u-lin p-dia-cliente' }, [el('span', {}, [el('span', { class: 'p-forte', text: d.cliente.nome }), el('span', { class: 'p-linha2 p-local' }, [icone('local', { pequeno: true }), d.local?.bairro || ''])]), zap(d.cliente.telefone, d.cliente.nome)]),
      el('span', { class: `p-serv-ic p-serv-${d.servico || 'residencial'}`, title: nomeServico(d.servico) }, [icone(ICONE_SERVICO[d.servico] || 'casa', { titulo: nomeServico(d.servico) })]),
      el('span', { class: 'p-num', text: `${String((d.duracaoMinutos || 0) / 60).replace('.', ',')}h` }),
      prof, pg, status],
    detalhe: () => detalhe([
      ['Endereço', [[d.local?.logradouro, d.local?.numero].filter(Boolean).join(', '), d.local?.complemento, d.local?.bairro, d.local?.cidade].filter(Boolean).join(' · '), true],
      ['Ponto de referência', d.local?.pontoReferencia || ''],
      ['Metragem', car.metragem ? `${car.metragem} m²` : ''],
      ['Ambientes', car.ambientes ? Object.entries(car.ambientes).filter(([, v]) => v).map(([k, v]) => `${v} ${k}`).join(', ') : car.ambientesTotal ? String(car.ambientesTotal) : ''],
      ['Animais', car.animais ? (car.animais.tem ? [car.animais.caes && `${car.animais.caes} cão(es)`, car.animais.gatos && `${car.animais.gatos} gato(s)`, car.animais.outros && `${car.animais.outros} ${car.animais.outrosQual || 'outro(s)'}`].filter(Boolean).join(', ') || 'Sim' : 'Não') : ''],
      ['Alimentação', d.localRefeicao === false ? 'Sem local pra aquecer refeição' : d.localRefeicao ? 'Tem local pra refeição' : ''],
      ['Observações', [d.justificativa, d.observacao].filter(Boolean).join(' · ')],
      ['Nº da solicitação', d.numero ? String(d.numero).padStart(6, '0') : ''],
    ]),
  };
}

// ---------------------------------------------------------------- itens de "Precisa de você"

/** Ícone e tom de cada pendência (imagem 05: ícone num quadrado tingido à esquerda). */
const ICONE_PENDENCIA = {
  sem_profissional: ['alerta', 'ouro'], substituicao: ['troca', 'ouro'], recusa_profissional: ['calendario_x', 'ouro'], sem_resposta: ['relogio', 'ouro'],
  falha_envio_escala: ['alerta', 'ouro'], conflito_fixa: ['alerta', 'ouro'], standby_decisao: ['relogio', 'ouro'], pagamento_verificacao: ['dolar', 'ouro'],
  pagamento_informado: ['dolar', 'ouro'], pagamento_vencido: ['dolar', 'ouro'], adiantamento: ['dinheiro_mao', 'ouro'], reembolso_transporte: ['taxi', 'ouro'],
  hora_extra: ['relogio', 'ouro'], pacote_endereco_novo: ['documento', 'info'], cadastro_profissional: ['usuario', 'info'], documento_vencido: ['documento', 'ouro'],
  ocorrencia: ['alerta', 'ouro'], falha_automacao: ['robo', 'ouro'],
};
function itemPendencia(x, { hoje, recarregar, motivos }) {
  const r = ['pendencias', 'diariasHoje', 'diariasAmanha', 'standby', 'solicitacoes'];
  const ok = (rotulo, fn, sucesso) => botao('Aprovar', { ic: 'check', soIcone: true, rotulo: `${rotulo}: aprovar`, acao: fn, sucesso, aoSucesso: () => recarregar(...r) });
  const nao = (rotulo, fn, { titulo, consequencia, comMotivos } = {}) => {
    const b = botao('Recusar', { ic: 'fechar', soIcone: true, rotulo: `${rotulo}: recusar`, aoClicar: async () => {
      const m = await pedirMotivo({ titulo: titulo || `Recusar: ${x.titulo}`, motivos: comMotivos ? await comMotivos() : [], rotuloConfirmar: 'Recusar', consequencia: consequencia || 'O motivo fica registrado no histórico.' });
      if (m) executarAcao(b, (k) => fn(m, k), { sucesso: 'Registrado.', aoSucesso: () => recarregar(...r) });
    } });
    return b;
  };
  const ir = (texto, href) => el('a', { class: 'p-btn', href, text: texto });
  let acoes = [];
  switch (x.tipo) {
    case 'sem_profissional': case 'substituicao': case 'recusa_profissional': case 'sem_resposta': case 'falha_envio_escala': case 'conflito_fixa': case 'standby_decisao': case 'pagamento_verificacao':
      // Agenda e Escala: a pendência abre a própria diária (designar, revisar e enviar ficam num lugar só)
      acoes = [ir('Abrir na agenda', url('painel/', { tela: 'agenda', data: x.ref.data, ...(x.ref.atendimentoId ? { diaria: x.ref.atendimentoId } : {}) }))]; break;
    case 'pagamento_informado':
      acoes = [ok(x.titulo, (k) => api.confirmarPagamento(x.ref.pagamentoId, { chave: k }), 'Pagamento confirmado.'),
        nao(x.titulo, (m, k) => api.recusarInformePagamento(x.ref.pagamentoId, m.texto, { chave: k }), { titulo: 'Pagamento não encontrado no extrato', consequencia: 'A cobrança volta pra pendente e a cliente é avisada pelo WhatsApp, com o PIX de novo.' })]; break;
    case 'pagamento_vencido':
      acoes = REAL ? [botao('Dar prazo', { aoClicar: () => darPrazo(x, hoje, () => recarregar(...r)) }), botao('Liberar vaga', { aoClicar: async () => {
        if (await confirmar({ titulo: 'Liberar a vaga?', texto: 'A diária sai da agenda e a cliente é avisada pelo WhatsApp.', rotuloConfirmar: 'Liberar a vaga e avisar a cliente', tom: 'perigo' })) {
          executarAcao(null, (k) => api.liberarVaga(x.ref.pagamentoId, { chave: k }), { sucesso: 'Vaga liberada.', aoSucesso: () => recarregar(...r) });
        }
      } })] : [ir('Ver', url('painel/', { tela: 'financeiro' }))]; break;
    case 'adiantamento': case 'reembolso_transporte':
      acoes = [ok(x.titulo, (k) => api.decidirSolicitacaoProfissional(x.ref.solicitacaoId, 'aprovada', null, { chave: k }), 'Aprovado.'),
        nao(x.titulo, (m, k) => api.decidirSolicitacaoProfissional(x.ref.solicitacaoId, 'recusada', m.texto, { chave: k }))]; break;
    case 'hora_extra':
      acoes = [ok(x.titulo, (k) => api.decidirHoraExtra(x.ref.horaExtraId, { aprovar: true }, { chave: k }), 'Hora extra aprovada.'),
        nao(x.titulo, (m, k) => api.decidirHoraExtra(x.ref.horaExtraId, { aprovar: false, motivo: m.texto }, { chave: k }))]; break;
    case 'pacote_endereco_novo':
      acoes = [ok(x.titulo, () => api.aprovarEnderecoPacote(x.ref.pedidoId), 'Endereço aprovado.'),
        nao(x.titulo, (m, k) => api.recusarSolicitacao(x.ref.pedidoId, { motivo: m.texto }, { chave: k }), { titulo: 'Recusar o pacote com endereço novo', comMotivos: async () => (await motivos()).recusa, consequencia: 'A solicitação é recusada e a cliente recebe o motivo pelo WhatsApp.' })]; break;
    case 'cadastro_profissional': case 'documento_vencido':
      acoes = [ir('Ver', url('painel/', { tela: 'profissionais', aba: 'cadastros' }))]; break;
    case 'ocorrencia':
      acoes = [ir('Ver', url('painel/', { tela: 'clientes', aba: 'ocorrencias' }))]; break;
    case 'falha_automacao':
      acoes = [botao('Reprocessar', { acao: (k) => api.acaoExecucao(x.ref.execucaoId, 'reenviar', { chave: k }), sucesso: 'Mensagem enviada de novo pra fila.', aoSucesso: () => recarregar('pendencias') })]; break;
    default: acoes = [];
  }
  const urg = urgenteNaTela(x);
  const [ic, tomIc] = ICONE_PENDENCIA[x.tipo] || ['alerta', 'ouro'];
  return el('li', { class: urg ? 'urgente' : PAGAMENTO_SEM_URGENCIA.has(x.tipo) ? 'atencao' : null, dataset: { pendencia: x.id, tipo: x.tipo } }, [
    el('span', { class: `p-ic-item p-pend-ic p-tom-${urg ? 'erro' : tomIc}`, 'aria-hidden': 'true' }, [icone(ic, { pequeno: true })]),
    el('span', { class: 'p-texto-item' }, [el('b', {}, [urg ? el('span', { class: 'p-sr', text: 'Urgente: ' }) : null, x.titulo]), el('span', { text: x.sub || '' })]),
    el('span', { class: 'p-acoes-item' }, acoes),
  ]);
}

function darPrazo(x, hoje, depois) {
  const data = el('input', { type: 'date', id: 'prazo-data', min: hoje, value: somarDias(hoje, 1) });
  const hora = el('input', { type: 'time', id: 'prazo-hora', value: '12:00' });
  modal({ titulo: 'Dar mais prazo', corpo: el('div', { class: 'u-col' }, [
    el('div', { class: 'campo' }, [el('label', { for: 'prazo-data', text: 'Novo prazo (data)' }), data]),
    el('div', { class: 'campo' }, [el('label', { for: 'prazo-hora', text: 'Hora' }), hora]),
    el('p', { class: 'p-consequencia', text: 'A cliente recebe o novo prazo pelo WhatsApp. Sugestão: amanhã às 12h.' })]),
  botoes: (fechar) => { const b = botao('Salvar prazo e avisar', { tom: 'primario', aoClicar: () => executarAcao(b, (k) => api.prorrogarPrazo(x.ref.pagamentoId, { venceEm: data.value, venceAs: hora.value }, { chave: k }), { sucesso: 'Prazo atualizado.', aoSucesso: () => { fechar(); depois(); } }) }); return [botao('Voltar', { aoClicar: () => fechar() }), b]; } });
}

// ---------------------------------------------------------------- stand-by
function itemStandby(s, { hoje, recarregar }) {
  const turnos = (s.turnos || []).map((t) => ({ manha: '08h-12h', tarde: '13h-18h', integral: '08h-18h' }[t] || t)).join(', ');
  const confirmar2 = botao('Confirmar', { ic: 'check', rotulo: `Confirmar ${s.nome}`, aoClicar: async () => {
    const pend = (await api.painelPendencias()).itens.filter((p) => p.tipo === 'sem_profissional' && p.ref.data === hoje);
    const corpo = el('div', { class: 'u-col-2' }, [
      el('p', { class: 'p-sec', text: pend.length ? `Designar ${primeiro(s.nome)} numa diária de hoje sem profissional:` : `Nenhuma diária de hoje sem profissional. Confirmar deixa ${primeiro(s.nome)} de prontidão.` }),
    ]);
    modal({ titulo: `Confirmar ${primeiro(s.nome)}`, corpo, botoes: (fechar) => [
      botao('Voltar', { aoClicar: () => fechar() }),
      ...pend.slice(0, 4).map((p) => botao(`Designar: ${p.sub}`, { tom: 'primario', acao: (k) => api.atribuirDiarista(p.ref.atendimentoId, { diaristaId: s.diaristaId }, { chave: k }),
        sucesso: `${primeiro(s.nome)} designada.`, aoSucesso: () => { fechar(); recarregar('standby', 'pendencias', 'diariasHoje'); } })),
      pend.length ? null : botao('Confirmar prontidão', { tom: 'primario', acao: () => api.decidirStandby(s.diaristaId, hoje, 'confirmada', null), sucesso: 'Stand-by confirmado.', aoSucesso: () => { fechar(); recarregar('standby'); } }),
    ].filter(Boolean) });
  } });
  const liberar = botao('Liberar', { ic: 'fechar', rotulo: `Liberar ${s.nome}`, acao: () => api.decidirStandby(s.diaristaId, hoje, 'liberada', null), sucesso: `${primeiro(s.nome)} liberada hoje.`, aoSucesso: () => recarregar('standby') });
  return el('li', { class: 'p-standby', dataset: { standby: s.diaristaId } }, [
    el('span', { class: 'u-lin-2 p-standby-pessoa' }, [avatar(s.nome, { foto: s.foto, habilidades: s.habilidades, linha2: [turnos, (s.regioes || [])[0]].filter(Boolean).join(' · ') }), zap(s.telefone, s.nome)]),
    s.estado === 'confirmada' ? selo('Confirmada', 'ok') : null, el('span', { class: 'p-acoes-item' }, [confirmar2, liberar])]);
}

// ---------------------------------------------------------------- indicadores
function blocoMeta(r) {
  const m = r.meta;
  const feito = m.realizadas + m.agendadas;
  const pct = m.meta ? (feito / m.meta) * 100 : 0;
  const mes = new Date(`${r.mes}-15T12:00:00Z`).toLocaleDateString('pt-BR', { month: 'long', timeZone: 'UTC' });
  const mesAnt = MESES[(Number(r.mes.slice(5, 7)) + 10) % 12];
  return {
    sub: `${feito} de ${m.meta} (${Math.round(pct)}%) em ${mes} · meta: +${String(m.percentual).replace('.', ',')}% sobre o mês anterior (${mesAnt})`,
    // anel + os quatro números + barra, como na imagem 05 (o mesmo desenho da vista inicio-vista.js)
    conteudo: el('div', { class: 'pn-meta p-ini-meta' }, [
      el('div', { class: 'pn-anel-caixa', role: 'img', 'aria-label': `${Math.round(pct)}% da meta` }, [anel(pct), el('span', { class: 'pn-anel-n' }, [el('b', { text: `${Math.round(pct)}%` }), el('small', { text: 'da meta' })])]),
      el('div', { class: 'pn-meta-dir' }, [
        el('dl', { class: 'pn-meta-n' }, [[[el('span', { class: 'p-sr', text: 'Mês anterior: ' }), maiuscula(mesAnt)], m.mesAnterior], ['Meta', m.meta], ['Realizadas', m.realizadas], ['Agendadas', m.agendadas]]
          .map(([k, v]) => el('div', {}, [el('dt', {}, Array.isArray(k) ? k : [k]), el('dd', { text: String(v) })]))),
        el('div', { class: 'pn-meta-barra', 'aria-hidden': 'true' }, [el('span', { style: `width:${Math.min(100, Math.round(pct))}%` })]),
        el('p', { class: 'pn-meta-falta' }, [el('span', { class: 'p-ini-coroa-p', 'aria-hidden': 'true' }, [icone('coroa_c', { pequeno: true })]),
          m.meta === 0 ? 'Sem diárias no mês anterior: a meta começa no próximo mês.' : m.faltam ? `${m.faltam === 1 ? 'Falta 1 diária' : `Faltam ${m.faltam} diárias`} para atingir a meta.` : 'Meta atingida com as realizadas e agendadas.']),
      ]),
    ]),
  };
}

function blocoMotivos(r) {
  const total = r.cancelamentos.reduce((s, x) => s + x.total, 0);
  // rosca com o total no meio e a legenda em tabela (número e porcentagem junto de cada cor), como na imagem 05
  const itens = r.cancelamentos.slice(0, 5);
  return { sub: total ? `Este mês · ${total} ${total === 1 ? 'diária cancelada' : 'diárias canceladas'}` : 'Este mês',
    conteudo: total ? el('div', { class: 'pn-graf p-ini-graf' }, [
      el('div', { class: 'pn-rosca-caixa' }, [rosca(itens.map((x) => [x.rotulo, x.total])), el('span', { class: 'pn-anel-n' }, [el('b', { text: String(total) }), el('small', { text: total === 1 ? 'diária' : 'diárias' })])]),
      el('table', { class: 'pn-legenda' }, [el('caption', { class: 'p-sr', text: 'Motivos de cancelamento no mês' }), el('tbody', {}, itens.map((x, i) => el('tr', {}, [
        el('th', { scope: 'row', title: x.rotulo }, [el('span', { class: 'pn-leg-ponto', style: `background:${COR_G[i % COR_G.length]}` }), x.rotulo.split(' (')[0]]),
        el('td', { text: `${Math.round((x.total / total) * 100)}%`, title: `${x.total} ${x.total === 1 ? 'diária' : 'diárias'}` }),
      ])))]),
    ]) : vazio('Nenhuma diária cancelada este mês.') };
}

function blocoRegioes(r) {
  let modo = 'cidades'; let cidade = null;
  const caixa = el('div');
  const alt = el('div', { class: 'p-alternancia', role: 'group', 'aria-label': 'Ver por' });
  const btC = el('button', { type: 'button', 'aria-pressed': 'true', text: 'Cidades' });
  const btB = el('button', { type: 'button', 'aria-pressed': 'false', text: 'Bairros' });
  alt.append(btC, btB);
  const desenhar = () => {
    btC.setAttribute('aria-pressed', String(modo === 'cidades')); btB.setAttribute('aria-pressed', String(modo === 'bairros'));
    if (!r.regioes.length) { trocar(caixa, vazio('Sem diárias neste mês ainda.')); return; }
    if (modo === 'cidades') { trocar(caixa, barras(r.regioes.slice(0, 6).map((x) => ({ rotulo: x.cidade, valor: x.total })), { aoClicar: (c) => { cidade = c; modo = 'bairros'; desenhar(); }, rotuloColuna: 'Cidades' })); return; }
    const c = r.regioes.find((x) => x.cidade === cidade) || r.regioes[0];
    trocar(caixa, el('p', { class: 'p-sec u-mb-2', text: `Bairros de ${c.cidade}` }), barras(c.bairros.slice(0, 6).map((x) => ({ rotulo: x.bairro, valor: x.total })), { rotuloColuna: `Bairros de ${c.cidade}` }));
  };
  btC.addEventListener('click', () => { modo = 'cidades'; desenhar(); });
  btB.addEventListener('click', () => { modo = 'bairros'; desenhar(); });
  desenhar();
  return { conteudo: el('div', {}, [el('div', { class: 'p-ini-regioes-alt' }, [alt]), caixa]) };
}

