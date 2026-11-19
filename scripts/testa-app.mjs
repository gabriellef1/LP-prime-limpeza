// Casos de uso sobre repositório em memória (mesmo núcleo do adapter mock). node scripts/testa-app.mjs
import { criarSuite, assert } from './lib-teste.mjs';
import { registrarCenarios, registrarCenariosV2, AGORA_TESTE, criarAvulso, segundaRelativa } from './cenarios.mjs';
import { CONFIG_PRECOS } from '../src/config/precos.js';
import { somarDias, diaDaSemana } from '../src/domain/calendario.js';
import { registrarCenariosV3 } from './cenarios-v3.mjs';
import { montarAmbiente } from './ambiente.mjs';

const t = criarSuite('casos de uso (memória)');
const amb = montarAmbiente(AGORA_TESTE);
registrarCenarios(t, { api: amb.casos });
registrarCenariosV2(t, { api: amb.casos });
registrarCenariosV3(t, { api: amb.casos });

t.teste('datas relativas do homolog: pra cada dia de um ano, segunda livre de feriados, depois da antecedência e dentro do horizonte', () => {
  const fer = new Set(CONFIG_PRECOS.feriados);
  for (let i = 0; i < 366; i++) {
    const hoje = somarDias('2026-10-17', i);
    const m = segundaRelativa(hoje, CONFIG_PRECOS);
    assert.equal(diaDaSemana(m), 1, `${hoje}: segunda`);
    assert.ok(somarDias(m, -4) > hoje, `${hoje}: a quinta anterior (relógio dos cenários) fica depois de hoje`);
    for (const d of [-3, 0, 1, 2, 3, 4, 5, 7, 8, 11, 14, 18, 21]) assert.ok(!fer.has(somarDias(m, d)), `${hoje}: ${somarDias(m, d)} é feriado`);
    assert.ok(somarDias(m, 21) <= somarDias(hoje, CONFIG_PRECOS.regrasCalendario.horizonteMaximoDias), `${hoje}: dentro do horizonte`);
  }
});

t.teste('transação tudo-ou-nada: falha no meio não grava nada', async () => {
  const antes = amb.repo.contar('pedidos');
  await assert.rejects(() => amb.repo.transacao(null, async (tx) => {
    await tx.put('pedidos', { id: 'parcial' });
    throw new Error('falha simulada');
  }));
  assert.equal(amb.repo.contar('pedidos'), antes);
});

t.teste('falha de validação na composição não deixa cliente órfão', async () => {
  const antes = amb.repo.contar('clientes');
  await assert.rejects(() => criarAvulso({ confirmarAutoagendamento: (d, o) => amb.casos.confirmarAutoagendamento({ ...d, primeiraData: '2026-10-04' }, o) }));
  assert.equal(amb.repo.contar('clientes'), antes);
});

t.teste('foto de perfil vira o campo foto da profissional (mock); "sem recorte" fica no documento e no cadastro', async () => {
  const { criarDiaristaPendente, chave } = await import('./cenarios.mjs');
  const { ARQUIVOS } = await import('./fixtures/arquivos.mjs');
  const PRIME = { sessao: { ator: 'prime' } };
  const id = await criarDiaristaPendente(amb.casos);
  const a = await amb.casos.obterDiarista(id, PRIME);
  assert.match(a.diarista.foto, /^data:image\/png;base64,/);
  assert.equal(a.diarista.fotoSemRecorte, false);
  assert.equal(a.documentos.find((d) => d.tipo === 'foto_perfil').semRecorte, false);
  assert.equal('semRecorte' in a.documentos.find((d) => d.tipo === 'cnh_frente'), false);
  // a Prime troca a foto por uma que o navegador não conseguiu recortar: o aviso acompanha
  const doc = await amb.casos.salvarDocumento({ diaristaId: id, tipo: 'foto_perfil', nomeArquivo: 'foto-perfil-sem-recorte.png', mime: ARQUIVOS.png.mime, tamanho: ARQUIVOS.png.bytes.length, conteudo: ARQUIVOS.png.bytes, semRecorte: true }, { ...PRIME, chave: chave('foto-sr') });
  assert.equal(doc.semRecorte, true); assert.equal('foto' in doc, false, 'a imagem não vai junto dos metadados do documento');
  const b = await amb.casos.obterDiarista(id, PRIME);
  assert.equal(b.diarista.fotoSemRecorte, true); assert.match(b.diarista.foto, /^data:image\/png;base64,/);
});

await t.fim();
