// Rotina de ingestão: lê a caixa de e-mail de falhas de DVR e grava no Supabase.
// Pensada pra rodar via Vercel Cron (ver vercel.json), mas também pode ser
// chamada manualmente (GET) pra testar.
//
// Nunca marca e-mail como lido, nunca apaga, nunca move nada - só leitura.
// Controla o que já processou guardando o maior UID visto na tabela
// dvr_ingest_state, então cada execução só olha mensagens novas.

const { ImapFlow } = require("imapflow");
const { simpleParser } = require("mailparser");
const { createClient } = require("@supabase/supabase-js");
const { parseEvento } = require("../lib/parseEvento");

// Quantas mensagens novas processar no máximo por execução (protege contra
// timeout da função caso fique muito tempo sem rodar e acumule backlog).
// Se sobrar mais que isso, a próxima execução do cron continua de onde parou.
const MAX_PER_RUN = Number(process.env.MAX_PER_RUN || 300);

// Se for a primeira execução (sem estado salvo ainda), quantas mensagens mais
// recentes olhar pra trás, em vez de ignorar todo o histórico ou processar
// as 7000+ mensagens antigas de uma vez.
const BACKFILL_INICIAL = Number(process.env.INITIAL_BACKFILL || 200);

module.exports = async function handler(req, res) {
  // Protege o endpoint: se CRON_SECRET estiver configurado, só aceita chamada
  // que traga esse segredo — seja no header (o Vercel Cron manda assim
  // automaticamente) ou em ?secret=... na URL (pra dar pra testar direto
  // no navegador, sem precisar de terminal/curl).
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = req.headers["authorization"];
    const viaQuery = req.query?.secret;
    const autorizado = auth === `Bearer ${cronSecret}` || viaQuery === cronSecret;
    if (!autorizado) {
      return res.status(401).json({ error: "unauthorized" });
    }
  }

  const obrigatorias = [
    "IMAP_HOST",
    "IMAP_PORT",
    "IMAP_USER",
    "IMAP_PASS",
    "SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
  ];
  const faltando = obrigatorias.filter((k) => !process.env[k]);
  if (faltando.length) {
    return res
      .status(500)
      .json({ error: "variaveis de ambiente faltando", faltando });
  }

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  const client = new ImapFlow({
    host: process.env.IMAP_HOST,
    port: Number(process.env.IMAP_PORT),
    secure: true,
    auth: {
      user: process.env.IMAP_USER,
      pass: process.env.IMAP_PASS,
    },
    logger: false,
  });

  const resultado = {
    lidos: 0,
    falhas_gravadas: 0,
    ignorados_nao_falha: 0,
    erros: [],
  };

  try {
    await client.connect();
    const lock = await client.getMailboxLock("INBOX", { readOnly: true });

    try {
      const status = await client.status("INBOX", { uidNext: true });
      const uidNext = status.uidNext;

      const { data: stateRow, error: stateErr } = await supabase
        .from("dvr_ingest_state")
        .select("valor")
        .eq("chave", "last_uid")
        .maybeSingle();

      if (stateErr) throw stateErr;

      let lastUid = stateRow?.valor ? parseInt(stateRow.valor, 10) : null;
      if (lastUid === null) {
        // primeira execução: começa olhando só as últimas BACKFILL_INICIAL
        lastUid = Math.max(0, uidNext - 1 - BACKFILL_INICIAL);
      }

      if (lastUid >= uidNext - 1) {
        resultado.info = "nada novo desde a ultima execucao";
      } else {
        const range = `${lastUid + 1}:*`;
        let maxUidProcessado = lastUid;
        let processados = 0;

        for await (const msg of client.fetch(
          range,
          { source: true },
          { uid: true }
        )) {
          if (processados >= MAX_PER_RUN) break;
          processados++;
          resultado.lidos++;
          maxUidProcessado = Math.max(maxUidProcessado, msg.uid);

          try {
            const parsed = await simpleParser(msg.source);
            const evento = parseEvento({
              subject: parsed.subject,
              textBody: parsed.text,
              messageId: parsed.messageId || `sem-id-uid-${msg.uid}`,
            });

            if (!evento) {
              resultado.ignorados_nao_falha++;
              continue;
            }

            const { error } = await supabase
              .from("dvr_falhas")
              .upsert(evento, {
                onConflict: "message_id",
                ignoreDuplicates: true,
              });

            if (error) {
              resultado.erros.push({ uid: msg.uid, error: error.message });
            } else {
              resultado.falhas_gravadas++;
            }
          } catch (msgErr) {
            resultado.erros.push({ uid: msg.uid, error: String(msgErr) });
          }
        }

        await supabase
          .from("dvr_ingest_state")
          .upsert({ chave: "last_uid", valor: String(maxUidProcessado) });

        resultado.ultimo_uid_processado = maxUidProcessado;
        resultado.restante_para_proxima_execucao = Math.max(
          0,
          uidNext - 1 - maxUidProcessado
        );
      }
    } finally {
      lock.release();
    }
    await client.logout();
  } catch (err) {
    resultado.erros.push({ error: String(err) });
    return res.status(500).json(resultado);
  }

  return res.status(200).json(resultado);
};
