import type { MailMessage } from '../mail.service';

function layout(
  title: string,
  body: string,
  action: { url: string; label: string },
): string {
  return `
    <div style="font-family:system-ui,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#2E2A26">
      <h1 style="font-size:20px;margin:0 0 16px">${title}</h1>
      ${body}
      <p style="margin:24px 0">
        <a href="${action.url}"
           style="display:inline-block;background:#3F8B5C;color:#fff;text-decoration:none;padding:12px 20px;border-radius:12px">
          ${action.label}
        </a>
      </p>
      <p style="font-size:13px;color:#9A8C7A">Si el botón no funciona, copiá este link:<br>${action.url}</p>
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
      `<p>Vas a unirte con el rol <strong>${roleLabel}</strong>. La invitación vence en 7 días.</p>`,
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
