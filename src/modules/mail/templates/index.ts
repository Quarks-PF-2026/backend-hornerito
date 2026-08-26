import type { MailMessage } from '../mail.service';

/**
 * Escapa todo valor que se interpola en el HTML de un correo.
 *
 * No es defensa en profundidad: `volunteerRequestNoticeMail` recibe el nombre
 * que escribió un visitante **anónimo y sin autenticar** en la ficha pública, y
 * ese correo le llega a quien administra la organización. Sin escapar, cualquiera
 * podría inyectar un link de phishing con el estilo de Hornerito en la casilla
 * de un dueño. Se aplica a todas las plantillas, no solo a esa, porque el resto
 * de los nombres también son texto libre cargado por usuarios.
 */
function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** `action` es opcional: los avisos de solicitud de voluntario informan y no
 * piden hacer nada, así que no llevan botón ni link de respaldo. */
function layout(
  title: string,
  body: string,
  action?: { url: string; label: string },
): string {
  const cta = action
    ? `
      <p style="margin:24px 0">
        <a href="${esc(action.url)}"
           style="display:inline-block;background:#3F8B5C;color:#fff;text-decoration:none;padding:12px 20px;border-radius:12px">
          ${esc(action.label)}
        </a>
      </p>
      <p style="font-size:13px;color:#9A8C7A">Si el botón no funciona, copiá este link:<br>${esc(action.url)}</p>`
    : '';
  return `
    <div style="font-family:system-ui,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#2E2A26">
      <h1 style="font-size:20px;margin:0 0 16px">${esc(title)}</h1>
      ${body}
      ${cta}
    </div>
  `;
}

export function verificationMail(to: string, url: string): MailMessage {
  return {
    to,
    subject: 'Verificá tu cuenta en Hornerito',
    html: layout(
      'Verificá tu cuenta',
      '<p>Confirmá tu correo para empezar a usar Hornerito.</p>',
      { url, label: 'Verificar cuenta' },
    ),
    text: `Verificá tu cuenta en Hornerito: ${url}`,
  };
}

export function invitationMail(
  to: string,
  organizationName: string,
  roleLabel: string,
  url: string,
): MailMessage {
  return {
    to,
    subject: `Te invitaron a ${organizationName} en Hornerito`,
    html: layout(
      `Te invitaron a ${organizationName}`,
      `<p>Vas a unirte con el rol <strong>${esc(roleLabel)}</strong>. La invitación vence en 7 días.</p>`,
      { url, label: 'Aceptar invitación' },
    ),
    text: `Te invitaron a ${organizationName} en Hornerito como ${roleLabel}: ${url}`,
  };
}

export function passwordResetMail(to: string, url: string): MailMessage {
  return {
    to,
    subject: 'Restablecé tu contraseña en Hornerito',
    html: layout(
      'Restablecer contraseña',
      '<p>Recibimos una solicitud para restablecer la contraseña de tu cuenta en Hornerito.</p>',
      { url, label: 'Restablecer contraseña' },
    ),
    text: `Restablecé tu contraseña en Hornerito: ${url}`,
  };
}

/** Acuse al postulante: su solicitud llegó y está en revisión (QK-16). */
export function volunteerRequestReceivedMail(
  to: string,
  organizationName: string,
  target: string | null,
): MailMessage {
  const what = target
    ? `para la actividad <strong>${esc(target)}</strong>`
    : 'para sumarte como voluntario';
  return {
    to,
    subject: `Recibimos tu solicitud para ${organizationName}`,
    html: layout(
      'Recibimos tu solicitud',
      `<p>${esc(organizationName)} recibió tu solicitud ${what}. La van a revisar y te vamos a avisar por este mismo correo.</p>`,
    ),
    text: `${organizationName} recibió tu solicitud. Te avisamos por correo cuando la revisen.`,
  };
}

/** Aviso a quienes gestionan la organización, para que no quede olvidada. */
export function volunteerRequestNoticeMail(
  to: string,
  organizationName: string,
  applicantName: string,
  target: string | null,
  url: string,
): MailMessage {
  const what = target
    ? `se ofreció para <strong>${esc(target)}</strong>`
    : 'se ofreció como voluntario';
  return {
    to,
    subject: `Nueva solicitud de voluntario en ${organizationName}`,
    html: layout(
      'Tenés una solicitud nueva',
      `<p><strong>${esc(applicantName)}</strong> ${what} en ${esc(organizationName)}.</p>`,
      { url, label: 'Ver solicitudes' },
    ),
    text: `${applicantName} se ofreció como voluntario en ${organizationName}: ${url}`,
  };
}

/** Rechazo: se informa siempre con el motivo que escribió la organización. */
export function volunteerRequestRejectedMail(
  to: string,
  organizationName: string,
  reason: string,
): MailMessage {
  return {
    to,
    subject: `Sobre tu solicitud para ${organizationName}`,
    html: layout(
      'Tu solicitud no fue aceptada',
      `<p>${esc(organizationName)} revisó tu solicitud y por ahora no puede sumarte.</p>
       <p style="background:#F6F1E9;border-radius:12px;padding:12px"><strong>Motivo:</strong> ${esc(reason)}</p>`,
    ),
    text: `${organizationName} no aceptó tu solicitud. Motivo: ${reason}`,
  };
}

/** Los montos se muestran como los escribe la gente acá: $1.234,56. */
function money(amount: number): string {
  return `$${amount.toLocaleString('es-AR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/**
 * Acuse al donante que declaró una donación económica (QK-20). Es también el
 * comprobante que le queda: sin cuenta, este correo es el único registro que se
 * lleva de lo que declaró.
 */
export function monetaryDonationReceivedMail(
  to: string,
  organizationName: string,
  amount: number,
  operationNumber: string | null,
): MailMessage {
  const operation = operationNumber
    ? `<p>Número de operación: <strong>${esc(operationNumber)}</strong></p>`
    : '';
  return {
    to,
    subject: `Recibimos tu donación a ${organizationName}`,
    html: layout(
      'Recibimos tu donación',
      `<p>Registramos tu donación de <strong>${money(amount)}</strong> a ${esc(organizationName)}.</p>
       ${operation}
       <p>Queda pendiente hasta que la organización confirme la recepción del dinero. Te avisamos por este mismo correo.</p>`,
    ),
    text: `Registramos tu donación de ${money(amount)} a ${organizationName}. Queda pendiente de confirmación.`,
  };
}

/** Aviso a quienes pueden confirmar la recepción, para que no quede olvidada. */
export function monetaryDonationNoticeMail(
  to: string,
  organizationName: string,
  amount: number,
  donorName: string | null,
  operationNumber: string | null,
  url: string,
): MailMessage {
  const who = donorName ? esc(donorName) : 'Alguien de forma anónima';
  const operation = operationNumber
    ? `<p>Número de operación: <strong>${esc(operationNumber)}</strong></p>`
    : '';
  return {
    to,
    subject: `Nueva donación económica en ${organizationName}`,
    html: layout(
      'Tenés una donación por confirmar',
      `<p><strong>${who}</strong> declaró una donación de <strong>${money(amount)}</strong> a ${esc(organizationName)}.</p>
       ${operation}
       <p>Verificá el movimiento en tu cuenta antes de confirmarla.</p>`,
      { url, label: 'Ver donaciones' },
    ),
    text: `${donorName ?? 'Un donante anónimo'} declaró una donación de ${money(amount)} en ${organizationName}: ${url}`,
  };
}

/** La organización se expidió: confirmó la recepción o la rechazó con motivo. */
export function monetaryDonationDecidedMail(
  to: string,
  organizationName: string,
  amount: number,
  confirmed: boolean,
  rejectReason: string | null,
): MailMessage {
  if (confirmed) {
    return {
      to,
      subject: `${organizationName} confirmó tu donación`,
      html: layout(
        '¡Gracias! Tu donación fue confirmada',
        `<p>${esc(organizationName)} confirmó la recepción de tu donación de <strong>${money(amount)}</strong>.</p>`,
      ),
      text: `${organizationName} confirmó tu donación de ${money(amount)}. ¡Gracias!`,
    };
  }
  const reason = rejectReason
    ? `<p style="background:#F6F1E9;border-radius:12px;padding:12px"><strong>Motivo:</strong> ${esc(rejectReason)}</p>`
    : '';
  return {
    to,
    subject: `Sobre tu donación a ${organizationName}`,
    html: layout(
      'No pudimos confirmar tu donación',
      `<p>${esc(organizationName)} no pudo confirmar la recepción de tu donación de <strong>${money(amount)}</strong>.</p>
       ${reason}
       <p>Si creés que es un error, comunicate con la organización.</p>`,
    ),
    text: `${organizationName} no pudo confirmar tu donación de ${money(amount)}.${
      rejectReason ? ` Motivo: ${rejectReason}` : ''
    }`,
  };
}
