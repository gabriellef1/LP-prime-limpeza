# Produção em endereço provisório (decisão da cliente, 18/11/2026)

A cliente quer **testar tudo na produção de verdade antes de trocar o domínio**. Então a produção sobe primeiro num endereço `pages.dev`, com banco próprio (Supabase Pro) e **só dados fictícios**. A base real e o domínio entram por último. Este roteiro reordena os passos do `docs/GO-LIVE.md` (seção 3); os comandos são os mesmos de lá.

Nada daqui foi executado. O projeto pago **não foi criado**: depende do cartão da cliente (passo 1).

## Como fica

| | Homologação (hoje) | Produção provisória | Produção final |
|---|---|---|---|
| Banco | `prime-homolog` (grátis, 3.289 clientes reais importados) | projeto novo, plano Pro, **vazio + fictícios** | o mesmo projeto, com a base real importada |
| Endereço | `prime-limpeza.pages.dev` | endereço `pages.dev` provisório (ver passo 5) | `primelimpezaespecializada.com.br` |
| Mensagens (WhatsApp, e-mail) | nunca saem (`HOMOLOG_REFS`) | **não saem** enquanto o segredo `PRODUCAO_REF` não for posto | saem |
| Pix | chave fictícia | chave real da Prime (CNPJ) | chave real |
| Buscadores | `noindex` | `noindex` (todo `pages.dev` já sai assim) | indexado |

Regra que não muda: **nenhum cliente real entra no banco de produção antes do passo 9**, e a base do homolog nunca é copiada pra lá (a importação é refeita a partir das planilhas atualizadas).

## 1. Cartão da cliente no Supabase (ela cadastra direto; ninguém vê o número)

O Supabase **não tem papel só de cobrança**. Pela tabela de permissões da organização, só **Owner** e **Administrator** cadastram ou trocam cartão e mudam o plano; Developer e Read-only só enxergam. Papel restrito por projeto e Read-only só existem nos planos Team e Enterprise. Então, pra ela pôr o cartão, o convite tem que ser de **Administrator**.

O que um Administrator consegue além do cartão: ver e apagar projetos, ver chaves e convidar gente. Por isso o convite é temporário (opção A) ou a conta dela vira a dona (opção B).

**Opção A (recomendada): convite temporário de Administrator**
1. Você: https://supabase.com/dashboard > organização **Prime-Limpeza** > **Team** > **Invite member**. E-mail da cliente, papel **Administrator**. (Só Owner convida Owner; Administrator convida Administrator pra baixo.)
2. Ela: abre o e-mail do convite, cria a conta do Supabase (ou entra com Google) e aceita. De preferência com verificação em duas etapas ligada (Account > Security).
3. Ela: organização Prime-Limpeza > **Billing** > **Payment methods** > **Add new card**. No mesmo lugar: **Billing email** e **Billing address** com os dados do CNPJ (razão social PRIME LIMPEZA ESPECIALIZADA LTDA, CNPJ 49.450.793/0001-30, Rua Paraíba, 550, Sala 800, Savassi, Belo Horizonte/MG, CEP 30130-141), pra fatura sair no nome da empresa.
4. Ela ou você: **Billing** > **Subscription** > **Change plan** > **Pro** (US$ 25 por mês por organização, mais o uso). Ligar o **Spend cap** pra não haver cobrança acima do plano sem aviso.
5. Você: de volta em **Team**, trocar o papel dela pra **Developer** (continua vendo as faturas, não mexe em projeto) ou remover. O cartão fica na organização mesmo sem ela como Administrator.

**Opção B: a conta dela como dona**
Se a Prime quiser ser a dona da conta (faz sentido: o banco é dela), você (Owner) convida como **Owner** e, depois dos passos 3 e 4, fica como Administrator. A dívida fica clara, mas ela passa a poder tudo, inclusive apagar o projeto. Combinar com ela.

Atenção: o plano é **por organização**. Ao virar Pro, o `prime-homolog` (que está nessa mesma organização) passa a contar no uso da organização. O `prime-carga` está pausado e não custa. Se a ideia for manter o homolog de graça, a alternativa é uma organização nova só pra produção (aí o convite e o cartão são nela); o custo do Pro é o mesmo.

## 2. Projeto de produção (Gabrielle, depois do cartão)
- `SENHA_BANCO_PROD='<senha>' GO_LIVE=sim PROD_REF=novo bash scripts/go-live/02-supabase-producao.sh` (região São Paulo). Depois, no painel: conferir plano Pro e backup diário ligado.
- Guardar o ambiente do homolog (`cp ~/.prime-env ~/.prime-env.homolog`) e montar o `~/.prime-env` de produção com `PRIME_AMBIENTE=producao`, Turnstile e Web Analytics (GO-LIVE seção 8). Enquanto isso for só teste, dá pra trabalhar com `PRIME_ENV=<arquivo>` sem trocar o arquivo padrão.
- `node scripts/confere-config.mjs` sem "MAL CONFIGURADO".

## 3. Banco: migrations, Auth e segredos
- `GO_LIVE=sim PROD_REF=<ref> bash scripts/go-live/03-migrations.sh` (já ensaiado no banco local: `node scripts/ensaio-producao-local.mjs`). Inclui a `20261118100000_dados_empresa_foto.sql`.
- `TURNSTILE_SECRET_PROD='<secret>' GO_LIVE=sim PROD_REF=<ref> bash scripts/go-live/04-segredos.sh` e o deploy das functions.
- **Não pôr o segredo `PRODUCAO_REF` ainda**: sem ele o provedor de mensagens continua `simulado` e nada sai pra WhatsApp nem e-mail de ninguém.
- Auth: Site URL e redirect URLs apontando pro endereço provisório (trocar pelo domínio no passo 10).

## 4. Pix real no banco
A chave do banco é a linha `pix` de `public.configuracao` (é ela que gera o QR no modo Supabase; a de `src/config/prime.js` vale pro mock). Em produção, com confirmação:

```sql
update public.configuracao
   set valor = '{"chave":"49450793000130","nomeRecebedor":"PRIME LIMPEZA ESPECIALIZ","cidadeRecebedor":"BELO HORIZONTE"}'::jsonb
 where chave = 'pix';
```

Conferido em 18/11/2026 no Supabase local (dentro de transação desfeita): com essa linha, `privado.brcode(100, 'TESTEPRIME20261118')` devolve o mesmo código que o front e que `scripts/valida-pix.mjs` leu do QR (CRC `C1A7`). Como a chave é real, um Pix de teste de R$ 1,00 cai na conta da Prime: bom pra ela testar de ponta a ponta.

## 5. Endereço provisório
`prime-limpeza.pages.dev` hoje mostra a main ligada ao **homolog** e é o que a cliente usa pra aprovar telas. Duas saídas:
- **Projeto Pages novo só pra produção** (recomendado), por exemplo `prime-producao` > `prime-producao.pages.dev`. O homolog continua onde está; no fim o domínio é ligado nesse projeto novo. O `scripts/go-live/14-deploy-pages.sh` hoje publica no projeto `prime-limpeza`: precisa aceitar o nome do projeto antes de usar (mudança pequena, não feita). **Antes de usar outro endereço:** as Edge Functions só respondem pra origens conhecidas (a lista `ORIGENS` das functions `documentos` e `conta` só aceita `*.prime-limpeza.pages.dev` e localhost); o endereço novo e o domínio final têm que entrar nessa lista, senão upload de documento e foto falham por CORS.
- **Reaproveitar `prime-limpeza.pages.dev`** como produção e levar o homolog pra um alias (`homolog.prime-limpeza.pages.dev`). Menos coisa pra criar, mas o endereço que a cliente já conhece muda de banco.

Deploy a partir da main: `GO_LIVE=sim PROD_REF=<ref> bash scripts/go-live/14-deploy-pages.sh`. Conferir: `node scripts/confere-config.mjs --url <endereço provisório>`.

## 6. Dados fictícios pra operar
- Admin da cliente (conta dela de verdade, papel `prime_admin`) e as contas da equipe.
- Clientes, profissionais e pedidos **fictícios** (`ficticio = true`, e-mails `@example.com` ou `@prime-homolog.example`, telefones que não existem). `scripts/demo-homolog.mjs` cria o conjunto de demonstração; conferir que roda com `PRIME_ENV` apontando pra produção antes de usar.
- Profissionais: o cadastro é feito do zero (não há importação). As de teste fazem o cadastro pelo site, com selfie, pra exercitar a foto com fundo padrão.

## 7. O que a cliente testa (roteiro de aceite)
Solicitação pelo site, aprovação no painel, Pix de R$ 1,00 de verdade, confirmação do pagamento, recibo em PDF, agenda e escala, cadastro de profissional com foto, aceite dos textos legais, "esqueci a senha" (precisa do SMTP, GO-LIVE P8). Cada rodada: testes de preview contra o endereço provisório (GO-LIVE seção 5).

## 8. Antes da base real
- `bash scripts/backup.sh --storage`.
- Apagar os fictícios (`limparFicticios` e o reset do `demo-homolog.mjs`) e conferir as contagens em zero, menos a admin e a equipe.
- Zerar as sequências que a cliente vê (número de recibo): `scripts/sql/ajusta-sequencias.sql`.

## 9. Base real
`GO_LIVE=sim PROD_REF=<ref> bash scripts/go-live/05-importacao.sh` com as planilhas atualizadas (simulação, contagens, importação, backup).

## 10. Domínio, por último
Seções 4 a 7 do `docs/GO-LIVE.md`: domínio no projeto Pages, DNS, Auth com o domínio, segredo `PRODUCAO_REF` (aí as mensagens passam a sair), fumaça e virada. Volta atrás em menos de 10 minutos (seção 6).

## Custos (pra passar à cliente)
- Supabase Pro: US$ 25 por mês por organização, com US$ 10 de crédito de computação incluído (cobre um projeto pequeno); projeto extra ativo é cobrado à parte. Conferir os valores na página de preços no dia.
- Cloudflare Pages: plano grátis atende.
