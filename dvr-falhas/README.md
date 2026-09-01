# Painel de Falhas de DVR

Sistema que lê a caixa de e-mail `falhascameras@serviseletronica.com.br` (onde os
DVRs já mandam os alarmes), separa os eventos que são falha real (perda de vídeo,
HD, disco, rede etc.) dos que são só "Movimento", grava isso no Supabase, e mostra
tudo num painel próprio — parecido com a lista de ocorrências do Sigma.

## O que tem aqui

- `sql/schema.sql` — cria a tabela no Supabase. Rode uma vez só.
- `api/ingest-dvr-falhas.js` — a rotina que lê a caixa de e-mail e grava as falhas.
  Roda sozinha, agendada (cron).
- `lib/parseEvento.js` — a lógica que entende o texto do e-mail e decide o que é
  falha de verdade.
- `index.html` — o painel visual (site próprio, separado de qualquer outro
  painel que você já tenha).
- `.github/workflows/ingest.yml` — forma alternativa (e gratuita) de rodar a
  ingestão de 15 em 15 minutos, veja o motivo no passo 5 abaixo.

## Passo 1 — Criar a tabela no Supabase

1. Entra no painel do seu projeto Supabase (o mesmo do VTR Dashboard).
2. Vai em **SQL Editor > New query**.
3. Cola o conteúdo inteiro de `sql/schema.sql` e clica em **Run**.

Isso cria a tabela `dvr_falhas` (onde ficam os eventos) e `dvr_ingest_state` (um
controle interno pra não reprocessar e-mail duas vezes) — nada é alterado nas
tabelas que o VTR Dashboard já usa.

## Passo 2 — Subir o projeto pro Vercel

Do mesmo jeito que você já fez com o VTR Dashboard:

1. Cria um repositório novo no GitHub e sobe essa pasta inteira nele.
   **Importante:** nunca suba um arquivo com senha/chave de verdade dentro — as
   variáveis sensíveis (`.env.local`, se você criar um pra testar local) já estão
   no `.gitignore` implícito por não estarem listadas aqui; o `.env.example` é só
   modelo, sem segredo real.
2. No painel do Vercel, **Add New > Project**, importa esse repositório.
3. Antes de clicar em Deploy, abre **Environment Variables** e cadastra (valores
   reais, sem aspas):

   | Nome | Valor |
   |---|---|
   | `IMAP_HOST` | `webmail.servisgr.com.br` |
   | `IMAP_PORT` | `993` |
   | `IMAP_USER` | `falhascameras@serviseletronica.com.br` |
   | `IMAP_PASS` | (a senha da caixa) |
   | `SUPABASE_URL` | `https://fxmdsumcqukxuzooiiju.supabase.co` |
   | `SUPABASE_SERVICE_ROLE_KEY` | (a service_role key que você já me passou) |
   | `CRON_SECRET` | invente um texto aleatório qualquer, tipo uma senha |

4. Clica em **Deploy**.

## Passo 3 — Conferir a chave anon no painel

O arquivo `index.html` já vem com a **Project URL** e a chave **anon**
(pública, feita pra ficar exposta no navegador — protegida pelas regras de
segurança que o `schema.sql` configurou) preenchidas. Não precisa mexer nisso,
a não ser que você troque de projeto Supabase no futuro.

## Passo 4 — Testar a ingestão manualmente

Depois do deploy, acesse no navegador (ou peça pra mim testar, se eu tiver como):

```
https://SEU-PROJETO.vercel.app/api/ingest-dvr-falhas
```

Se você configurou `CRON_SECRET`, essa chamada direta pelo navegador vai dar
"unauthorized" — é esperado, é a proteção funcionando. Pra testar de verdade,
use um comando assim (troca os valores):

```
curl -H "Authorization: Bearer SEU_CRON_SECRET" https://SEU-PROJETO.vercel.app/api/ingest-dvr-falhas
```

A resposta mostra quantas mensagens leu, quantas eram falha de verdade e
gravou, e quantas ignorou (Movimento).

## Passo 5 — Sobre a frequência da leitura automática (importante)

O plano **gratuito do Vercel só permite cron job rodando 1x por dia** — não dá
pra configurar de 5 em 5 minutos nesse plano. Isso está refletido no
`vercel.json` (roda todo dia às 12:00 UTC, ~09:00 no horário de Brasília).

Se 1x por dia for pouco pra você (provavelmente é, já que o objetivo é saber
da falha rápido), tem uma saída gratuita: o arquivo
`.github/workflows/ingest.yml` já vem pronto pra chamar essa mesma rotina de
**15 em 15 minutos** usando o GitHub Actions, que não tem essa limitação. Pra
ativar:

1. Sobe esse repositório no GitHub como **público** (não tem segredo nenhum
   no código — as senhas ficam só nas variáveis de ambiente do Vercel — e
   repositório público te dá minutos ilimitados de Actions de graça; se
   preferir privado, o GitHub dá 2.000 minutos grátis por mês, o que também
   cobre tranquilamente rodar de 15 em 15 min).
2. Em **Settings > Secrets and variables > Actions** do repositório, cria dois
   secrets: `DVR_INGEST_URL` (o endereço do seu endpoint no Vercel) e
   `DVR_CRON_SECRET` (o mesmo valor que você colocou em `CRON_SECRET` no
   Vercel).
3. Pronto — o GitHub já assume a leitura frequente sozinho, sem precisar do
   Vercel Pro.

## Passo 6 — Acessar o painel

Depois do deploy, o painel fica direto na raiz do site:
`https://SEU-PROJETO.vercel.app/`. Lá dá pra filtrar por praça, tipo de falha e
status, ver o resumo no topo, e marcar uma falha como "resolvida" direto na
tabela.
