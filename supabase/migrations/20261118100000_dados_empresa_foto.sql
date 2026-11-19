-- Dados da empresa (cartão CNPJ de 10/11/2026) e foto da profissional com fundo padrão (18/11/2026).
-- NÃO muda preço nem regra de agendamento. Três coisas:
-- 1. versão nova dos textos legais: razão social, CNPJ, endereço, encarregada (LGPD) e estorno em até 24 horas entraram nos
--    Termos de Uso, na Política de Privacidade e nas Condições do atendimento. Quem já tem conta aceita de novo no próximo
--    acesso (regra do L1). Hashes de scripts/hash-documentos.mjs.
-- 2. documentos.sem_recorte: a foto de perfil já chega com o fundo padrão (feito no navegador da profissional); quando o
--    recorte falha fica a original com o fundo desfocado e este campo avisa a equipe.
-- 3. fotos_profissionais(): caminho da foto de perfil vigente de cada profissional, só pra Prime (a function `documentos`
--    assina as URLs; o bucket continua privado e sem policy).
-- A chave Pix real NÃO entra aqui: o homolog segue com o Pix fictício; a real entra na produção (docs/PRODUCAO-PROVISORIA.md).

-- ---------------------------------------------------------------- 1. textos legais
insert into public.documentos_legais (versao, vigente_desde, resumo, texto_sha256)
values ('2026-11-18', '2026-11-18 00:00:00-03',
  'Dados da empresa (razão social, CNPJ e endereço), encarregada pelos dados e estorno em até 24 horas.',
  encode(extensions.digest('termos:4653d46ef98faeecb76d46acfef7539c160d401893d9ea55d1a90580b63d06fb|privacidade:9304b4ab3505bf06d8bb8c2f18e6b6cde6045ca2dc9e4379988014609b17a3cf', 'sha256'), 'hex'));
insert into public.condicoes_atendimento (versao, vigente_desde, resumo, texto_sha256)
values ('2026-11-18', '2026-11-18 00:00:00-03',
  'Termos e Condições do atendimento: estorno em até 24 horas, quando houver. O restante é o texto de 17/10/2026. Pendente de revisão jurídica.',
  'b0f012a324ca3edf0b415c20770886379844d2d3cee1eb973a110c58f7bc98ee');

-- ---------------------------------------------------------------- 2. foto de perfil sem recorte
alter table public.documentos add column sem_recorte boolean not null default false;
comment on column public.documentos.sem_recorte is 'Foto de perfil que o navegador não conseguiu recortar (original com fundo desfocado): a equipe revisa.';

create or replace function privado.j_documento(x public.documentos) returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_build_object('id', x.id, 'diaristaId', x.diarista_id, 'tipo', x.tipo, 'nomeArquivo', x.nome_arquivo, 'mime', x.mime, 'tamanho', x.tamanho,
    'blobRef', x.storage_path, 'criadoEm', to_char(x.criado_em at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
    || case when x.tipo = 'foto_perfil' then jsonb_build_object('semRecorte', x.sem_recorte) else '{}'::jsonb end
$$;

-- igual à versão vigente (20260924210300), mais o sem_recorte no insert e no conteúdo da idempotência (só pra foto de perfil)
create or replace function public.registrar_documento(p_dados jsonb, p_chave text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s jsonb := privado.ator(); r jsonb; d public.diaristas; x public.documentos; conteudo jsonb; did uuid; v_caminho text; meta jsonb;
        v_tipo text := coalesce(p_dados ->> 'tipo', ''); v_ext text; v_mime text; v_tam int; v_hash text := p_dados ->> 'hashSha256';
begin
  conteudo := jsonb_build_object('diaristaId', p_dados -> 'diaristaId', 'tipo', p_dados -> 'tipo', 'nomeArquivo', p_dados -> 'nomeArquivo',
    'hashSha256', p_dados -> 'hashSha256')
    -- o aviso de "sem recorte" faz parte do pedido: repetir a chave mudando o aviso é conflito, não a resposta antiga
    || case when v_tipo = 'foto_perfil' then jsonb_build_object('semRecorte', coalesce(p_dados ->> 'semRecorte', '') = 'true') else '{}'::jsonb end;
  if v_tipo not in ('rg_frente', 'rg_verso', 'cnh_frente', 'cnh_verso', 'cpf', 'comprovante_residencia', 'foto_perfil', 'antecedentes') then perform privado.erro('DADOS_INVALIDOS', 'Tipo de documento inválido'); end if;
  did := privado.uuid_ou_nulo(p_dados ->> 'diaristaId');
  if did is null then perform privado.erro('DADOS_INVALIDOS', 'Id do cadastro inválido'); end if;
  if v_hash is not null and v_hash !~ '^[0-9a-f]{64}$' then perform privado.erro('DADOS_INVALIDOS', 'Hash inválido'); end if;
  r := privado.idem_ler('salvarDocumento', s, p_chave, conteudo);
  if r is not null then return r; end if;
  perform set_config('app.ator', s ->> 'ator', true);
  d := privado.rascunho_da_sessao(s, did);
  if d.status <> 'rascunho' then perform privado.erro('ATOR_SEM_PERMISSAO', 'Cadastro já enviado; fale com a Prime pra trocar documentos'); end if;
  v_caminho := p_dados ->> 'storagePath';
  if v_caminho is null or v_caminho !~ ('^' || d.usuario_id || '/' || d.id || '/' || v_tipo || '-[0-9a-f-]{36}\.(jpg|png|pdf)$') then
    perform privado.erro('DADOS_INVALIDOS', 'Caminho do arquivo inválido');
  end if;
  -- tipo e tamanho vêm do objeto gravado (a function validou os bytes), não do que o chamador declara
  select o.metadata into meta from storage.objects o where o.bucket_id = 'documentos-diaristas' and o.name = v_caminho;
  if meta is null then perform privado.erro('DADOS_INVALIDOS', 'Arquivo não encontrado no armazenamento'); end if;
  v_mime := meta ->> 'mimetype'; v_tam := (meta ->> 'size')::int; v_ext := substring(v_caminho from '\.([a-z]+)$');
  if v_mime is null or (v_mime, v_ext) not in (('image/jpeg', 'jpg'), ('image/png', 'png'), ('application/pdf', 'pdf')) then perform privado.erro('DADOS_INVALIDOS', 'Formato não aceito: use JPG, PNG ou PDF'); end if;
  if v_tam is null or v_tam < 1 or v_tam > 5242880 then perform privado.erro('DADOS_INVALIDOS', 'Arquivo maior que 5 MB'); end if;
  update public.documentos set excluido_em = now() where diarista_id = d.id and tipo = p_dados ->> 'tipo' and excluido_em is null;
  -- foto de perfil: o navegador avisa quando não conseguiu trocar o fundo (a equipe revisa); só vale pra imagem
  insert into public.documentos (diarista_id, tipo, nome_arquivo, mime, tamanho, storage_path, hash_sha256, sem_recorte)
  values (d.id, v_tipo, left(coalesce(p_dados ->> 'nomeArquivo', 'arquivo'), 120), v_mime, v_tam, v_caminho, v_hash,
          v_tipo = 'foto_perfil' and coalesce(p_dados ->> 'semRecorte', '') = 'true') returning * into x;
  r := privado.j_documento(x);
  perform privado.idem_gravar('salvarDocumento', s, p_chave, conteudo, r);
  return r;
end $$;

-- ---------------------------------------------------------------- 3. fotos das profissionais (só Prime)
/** Foto de perfil vigente de cada profissional aprovada: caminho no bucket privado e se ficou sem recorte. */
create or replace function public.fotos_profissionais() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare s jsonb := privado.ator();
begin
  perform privado.exigir_prime(s);
  return jsonb_build_object('itens', (select coalesce(jsonb_agg(jsonb_build_object('diaristaId', x.diarista_id, 'path', x.storage_path, 'semRecorte', x.sem_recorte)), '[]')
    from public.documentos x join public.diaristas d on d.id = x.diarista_id
   where x.tipo = 'foto_perfil' and x.excluido_em is null and x.arquivo_apagado_em is null and x.mime in ('image/jpeg', 'image/png') and d.status = 'aprovada'));
end $$;
revoke execute on function public.fotos_profissionais() from public, anon;
grant execute on function public.fotos_profissionais() to authenticated, service_role;
