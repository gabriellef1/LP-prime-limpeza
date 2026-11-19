// Demonstração da Agenda e Escala (SEED_DEMO=agenda) aberta em dias diferentes, com o relógio do navegador simulado.
// Bug da cliente (19/11/2026): a demo aparecia sem nenhuma diária porque o seed era plantado uma vez só no navegador,
// com as datas do dia da primeira visita, e pulava o domingo. Aqui a demo tem que estar cheia em dia útil, domingo e
// feriado, e continuar cheia quando o mesmo navegador volta dias depois.
// Uso: node scripts/testa-demo-datas.mjs [url da demo publicada]   (sem url: servidor local, mock)
import { criarSuite, assert } from './lib-teste.mjs';
import { abrirNavegador, subirServidor } from './pw.mjs';
import { CREDENCIAIS_MOCK as C } from './fixtures/seed.js';
import { CONFIG_PRECOS } from '../src/config/precos.js';
import { somarDias, diaDaSemana } from '../src/domain/calendario.js';

const externa = /^https?:/.test(process.argv[2] || '') ? process.argv[2].replace(/\/?$/, '/') : null;
const t = criarSuite(`demonstração em qualquer dia${externa ? ` (${externa})` : ' (mock)'}`);
const srv = externa ? null : await subirServidor();
const base = externa || srv.base;
const b = await abrirNavegador();

// três dias fixos de 2026: quinta comum, domingo e feriado (Consciência Negra, sexta); e o 1º do mês (histórico curto)
const DIAS = [['dia útil', '2026-11-19'], ['domingo', '2026-11-22'], ['feriado', '2026-11-20'], ['dia 1º do mês', '2026-12-01']];
assert.equal(diaDaSemana('2026-11-22'), 0); assert.ok(CONFIG_PRECOS.feriados.includes('2026-11-20'));

async function abrir(data) {
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  await ctx.clock.setFixedTime(new Date(`${data}T11:00:00-03:00`));
  const p = await ctx.newPage(); p.erros = [];
  p.on('console', (m) => m.type() === 'error' && p.erros.push(m.text())); p.on('pageerror', (e) => p.erros.push(e.message));
  await p.goto(base);
  await p.evaluate((c) => { localStorage.setItem('prime.seedDemo', 'agenda'); localStorage.setItem('prime.sessao', JSON.stringify({ ator: 'prime', id: c.id, nome: 'Isa', papel: 'prime_admin' })); }, C.prime[0]);
  return { ctx, p };
}
const linhasAgenda = async (p, caminho) => { await p.goto(`${base}${caminho}`); await p.waitForSelector('.ae-tabela, .ae-dia-sec, .p-vazio', { timeout: 30000 }); await p.waitForTimeout(300); return p.locator('tr.ae-lin').count(); };
async function inicio(p) {
  await p.goto(`${base}painel/?tela=inicio`);
  await p.waitForSelector('[data-bloco=inicio-solicitacoes]', { timeout: 30000 });
  await p.waitForFunction(() => document.querySelectorAll('section.p-bloco:not([hidden]) .esqueleto').length === 0, null, { timeout: 30000 });
  return p.evaluate(() => Object.fromEntries([...document.querySelectorAll('section.p-bloco')].map((s) => [s.dataset.bloco.replace('inicio-', ''), s.hidden ? 0 : s.querySelectorAll('tr.p-lin, .p-lista li').length])));
}
async function conferirCheia(p, data, rotulo) {
  assert.equal(await linhasAgenda(p, 'painel/?tela=agenda'), 11, `${rotulo}: Agenda do dia com as 11 diárias`);
  const grupos = await p.locator('body').innerText();
  for (const g of ['Contagem', 'Betim', 'Belo Horizonte']) assert.ok(grupos.includes(g), `${rotulo}: grupo ${g}`);
  for (const s of ['Para revisar', 'Revisada', 'Aguardando aceite', 'Confirmada', 'Em andamento', 'Finalizada']) assert.ok(new RegExp(s, 'i').test(grupos), `${rotulo}: status "${s}" no dia`);
  assert.equal(await linhasAgenda(p, `painel/?tela=agenda&data=${somarDias(data, 1)}`) >= 0, true);
  const semanaAnterior = somarDias(data, -((diaDaSemana(data) + 6) % 7) - 7);
  assert.ok(await linhasAgenda(p, `painel/?tela=agenda&vista=periodo&de=${semanaAnterior}&ate=${somarDias(semanaAnterior, 6)}`) >= 30, `${rotulo}: período da semana anterior com histórico`);
  assert.ok(await linhasAgenda(p, `painel/?tela=agenda&vista=periodo&de=${data}&ate=${somarDias(data, 6)}`) >= 40, `${rotulo}: período dos próximos 7 dias`);
  const ini = await inicio(p);
  assert.equal(ini.hoje, 11, `${rotulo}: Início, diárias de hoje`);
  assert.equal(ini.amanha, 9, `${rotulo}: Início, diárias de amanhã`);
  for (const bl of ['solicitacoes', 'pendencias', 'standby', 'alertas', 'cadastros']) assert.ok(ini[bl] >= 1, `${rotulo}: Início, bloco ${bl} com itens (${ini[bl]})`);
  const meta = await p.locator('[data-bloco=inicio-meta] .p-bloco-cab').innerText();
  const [, feitas, alvo, pct] = meta.match(/(\d+) de (\d+) \((\d+)%\)/) || [];
  assert.ok(Number(alvo) >= 100 && Number(pct) >= 15 && Number(pct) <= 130, `${rotulo}: meta plausível (${feitas} de ${alvo}, ${pct}%)`);
  // motivos de cancelamento e regiões (saíram do Início em 18/11, seguem nos indicadores): dados preenchidos
  const ind = await p.evaluate(async (u) => { const { api } = await import(`${u}src/services/api.js`); const r = await api.painelIndicadoresHome(null); return { motivos: r.cancelamentos.filter((x) => x.total > 0).length, cancelados: r.cancelamentos.reduce((s, x) => s + x.total, 0), cidades: r.regioes.length }; }, base);
  assert.ok(ind.motivos >= 3 && ind.cancelados >= 5, `${rotulo}: motivos de cancelamento (${JSON.stringify(ind)})`);
  assert.ok(ind.cidades >= 3, `${rotulo}: regiões (${ind.cidades} cidades)`);
  assert.deepEqual(p.erros, [], `${rotulo}: sem erro de console`);
}

for (const [rotulo, data] of DIAS) {
  t.teste(`navegador limpo em ${data} (${rotulo}): Agenda (dia e período) e Início cheios`, async () => {
    const { ctx, p } = await abrir(data);
    await conferirCheia(p, data, rotulo);
    await ctx.close();
  });
}

t.teste('o mesmo navegador volta 9 dias depois (e num domingo): a demonstração se renova com as datas do dia', async () => {
  const { ctx, p } = await abrir('2026-11-10');
  assert.equal(await linhasAgenda(p, 'painel/?tela=agenda'), 11);
  for (const [rotulo, data] of [['9 dias depois', '2026-11-19'], ['domingo seguinte', '2026-11-22']]) {
    await ctx.clock.setFixedTime(new Date(`${data}T11:00:00-03:00`));
    await conferirCheia(p, data, rotulo);
  }
  // no mesmo dia nada é refeito: o que a pessoa mexeu na demonstração continua lá ao recarregar
  assert.equal(await p.evaluate(() => localStorage.getItem('prime.demo.dia')), 'agenda:2026-11-22');
  await ctx.close();
});

const falhas = await t.fim();
await b.close(); if (srv) await srv.fechar();
process.exit(falhas ? 1 : 0);
