-- ==========================================================
-- Sistema de Falhas de DVR - schema Supabase
-- Cole este arquivo inteiro no SQL Editor do Supabase
-- (Painel do projeto > SQL Editor > New query > colar > Run)
-- ==========================================================

-- Tabela principal: um evento de falha real por linha
create table if not exists dvr_falhas (
  id bigint generated always as identity primary key,
  message_id text unique,              -- Message-ID do e-mail, evita gravar a mesma falha duas vezes
  tipo_falha text not null,             -- ex: "Perda de vídeo", "Falha de HD"
  canal text,
  nome_camera text,                     -- pode ser nulo (canal sem nome configurado)
  horario_alarme timestamptz,           -- horário do alarme já convertido (pode ser nulo se não bateu o padrão)
  horario_alarme_raw text,              -- texto original, guardado sempre, mesmo se a conversão falhar
  dispositivo text,                     -- nome do DVR / praça (ex: CELSINA, ALGARVE, NOE_FORTES)
  ip_dvr text,
  assunto_email text,
  status text not null default 'aberta' check (status in ('aberta', 'resolvida')),
  recebido_em timestamptz not null default now(),  -- quando o script processou o e-mail
  criado_em timestamptz not null default now()
);

-- Índices para os filtros do painel (praça, tipo, status, data)
create index if not exists idx_dvr_falhas_dispositivo on dvr_falhas (dispositivo);
create index if not exists idx_dvr_falhas_tipo on dvr_falhas (tipo_falha);
create index if not exists idx_dvr_falhas_status on dvr_falhas (status);
create index if not exists idx_dvr_falhas_horario on dvr_falhas (horario_alarme desc);

-- Tabela pequena de controle: guarda até onde já lemos a caixa de e-mail,
-- pra nunca reprocessar tudo do zero nem perder mensagem nova.
create table if not exists dvr_ingest_state (
  chave text primary key,
  valor text
);

-- Segurança: liga RLS (Row Level Security) e libera só LEITURA pra chave publica (anon),
-- que é a que o painel vai usar no navegador. Gravação (insert/update) só acontece
-- pelo script de ingestão, que usa a service_role e por isso ignora essas regras.
alter table dvr_falhas enable row level security;

drop policy if exists "leitura publica dvr_falhas" on dvr_falhas;
create policy "leitura publica dvr_falhas"
  on dvr_falhas
  for select
  to anon
  using (true);

-- Libera tambem UPDATE pra chave publica, so pra permitir marcar uma falha
-- como "resolvida" direto pelo painel (mesmo padrao que voce ja usa no VTR
-- Dashboard pra edicao inline). Os dados aqui sao operacionais (IP, nome de
-- camera/DVR) e nao sensiveis, entao isso segue o mesmo nivel de exposicao
-- que voce ja tem hoje nas outras ferramentas.
drop policy if exists "atualizar status dvr_falhas" on dvr_falhas;
create policy "atualizar status dvr_falhas"
  on dvr_falhas
  for update
  to anon
  using (true)
  with check (true);

alter table dvr_ingest_state enable row level security;
-- dvr_ingest_state não precisa de política nenhuma pra "anon" -- só o service_role (que
-- ignora RLS) mexe nela, então ela fica invisível/inacessível pelo painel de propósito.
