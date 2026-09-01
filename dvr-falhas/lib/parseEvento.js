// Extrai os campos de um e-mail de alarme de DVR (formato Intelbras/Dahua) e
// classifica se é uma falha real ou não (ex: "Movimento" não é falha).
//
// Baseado nos e-mails reais confirmados na caixa falhascameras@serviseletronica.com.br:
//
//   Evento de alarme: Perda de vídeo
//   Alarme no Canal No.: 11
//   Nome: CAM 11-AREA DE LAZER
//   Horário do inicio do alarme(D/M/A H:M:S): 01/09/2026 02:54:52
//   Nome do dispositivo de alarme: NOE_FORTES
//   End. IP DVR: 10.20.21.3
//
// Alguns e-mails variam levemente (assunto usa "Tipo de Alarme:" em vez de
// "Evento de alarme:", e alguns canais não tem "Nome:" configurado, ou o
// "Horário..." pode faltar). O parser trata tudo isso sem quebrar.

const PALAVRAS_FALHA = [
  "perda de v", // perda de vídeo
  "falha",
  "hd",
  "disco",
  "sem espa", // sem espaço em disco
  "rede desconectada",
  "conflito de ip",
  "gravação interrompida",
  "gravacao interrompida",
];

// IMPORTANTE: usamos "[ \t]*" (só espaço/tab) em vez de "\s*" entre o rótulo
// e o valor. "\s" também casa com quebra de linha (\n) -- então, quando um
// campo vem vazio (ex: "Nome:" sem nada depois, como acontece em alguns DVRs
// tipo a CELSINA), um "\s*" guloso "pula" a quebra de linha e acaba
// capturando o conteúdo da LINHA SEGUINTE inteira por engano. Com
// "[ \t]*" isso não acontece: se não há valor na própria linha, o campo
// simplesmente fica vazio/nulo, em vez de roubar o valor de outro campo.
const PADROES = {
  tipo_falha: /(?:Evento de alarme|Tipo de Alarme)[ \t]*:[ \t]*([^\n\r]*)/i,
  canal: /Alarme no Canal No\.?[ \t]*:[ \t]*([^\n\r]*)/i,
  nome_camera: /^Nome[ \t]*:[ \t]*([^\n\r]*)$/im,
  dispositivo: /Nome do dispositivo de alarme[ \t]*:[ \t]*([^\n\r]*)/i,
  ip_dvr: /End\.?[ \t]*IP DVR[ \t]*:[ \t]*([^\n\r]*)/i,
};

// O rotulo do horario vem como "Horário do inicio do alarme(D/M/A H:M:S): 01/09/2026 02:54:52"
// -- o "H:M:S" dentro do proprio rotulo tem dois-pontos, o que confunde
// qualquer regex que tente "pegar tudo depois do ultimo ':'". Por isso,
// em vez de tentar recortar depois de um rotulo, procuramos direto o
// formato de data/hora (D/M/A H:M:S) em qualquer lugar do corpo -- é
// simples e não depende de como o rótulo foi escrito.
const DATA_HORA_REGEX = /\d{1,2}\/\d{1,2}\/\d{4}[ \t]+\d{1,2}:\d{2}:\d{2}/;

function limpar(v) {
  return v ? v.trim() : null;
}

/**
 * Converte "01/09/2026 02:54:52" (D/M/A H:M:S, horário de Brasília) em
 * ISO 8601 com offset -03:00, pra gravar certo num timestamptz do Postgres
 * independente do timezone do servidor que roda o script.
 */
function horarioParaISO(horarioRaw) {
  if (!horarioRaw) return null;
  const m = horarioRaw.match(
    /(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})/
  );
  if (!m) return null;
  const [, d, mo, y, h, mi, s] = m;
  const pad = (n) => String(n).padStart(2, "0");
  return `${y}-${pad(mo)}-${pad(d)}T${pad(h)}:${pad(mi)}:${pad(s)}-03:00`;
}

function ehFalhaReal(tipoFalha) {
  if (!tipoFalha) return false;
  const t = tipoFalha.toLowerCase();
  return PALAVRAS_FALHA.some((p) => t.includes(p));
}

/**
 * @param {{ subject: string, textBody: string, messageId: string }} email
 * @returns {null | {
 *   message_id: string, tipo_falha: string, canal: string|null,
 *   nome_camera: string|null, horario_alarme: string|null,
 *   horario_alarme_raw: string|null, dispositivo: string|null,
 *   ip_dvr: string|null, assunto_email: string
 * }}
 *   Retorna null quando o e-mail não é uma falha real (ex: Movimento) ou
 *   quando não bate com o padrão esperado de jeito nenhum.
 */
function parseEvento(email) {
  const corpo = email.textBody || "";

  const tipoFalhaMatch = corpo.match(PADROES.tipo_falha);
  const tipo_falha = limpar(tipoFalhaMatch?.[1]);

  if (!ehFalhaReal(tipo_falha)) {
    return null; // Movimento ou tipo não reconhecido -> ignora
  }

  const canal = limpar(corpo.match(PADROES.canal)?.[1]);
  const nome_camera = limpar(corpo.match(PADROES.nome_camera)?.[1]);
  const horario_alarme_raw = limpar(corpo.match(DATA_HORA_REGEX)?.[0]);
  const dispositivo = limpar(corpo.match(PADROES.dispositivo)?.[1]);
  const ip_dvr = limpar(corpo.match(PADROES.ip_dvr)?.[1]);

  return {
    message_id: email.messageId,
    tipo_falha,
    canal,
    nome_camera,
    horario_alarme: horarioParaISO(horario_alarme_raw),
    horario_alarme_raw,
    dispositivo,
    ip_dvr,
    assunto_email: email.subject || null,
  };
}

module.exports = { parseEvento, ehFalhaReal, horarioParaISO };
