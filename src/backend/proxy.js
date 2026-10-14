/**
 * Guardas compartilhadas dos proxies HTTP do backend.
 *
 * Tanto o proxy de ROM (`/api/rom`) quanto a capa manual (`/api/cover?url=`)
 * buscam uma URL escolhida pelo usuário **a partir do servidor**. Sem barreira,
 * isso vira SSRF: alguém poderia apontar para `localhost`/`127.0.0.1` e alcançar
 * serviços internos (ou o endpoint de metadata da nuvem, `169.254.169.254`).
 */

/** Bloqueia loopback/link-local — hosts que só fazem sentido "de dentro". */
export function isBlockedProxyHost(host) {
  if (!host) return true;
  const h = String(host).replace(/^\[|\]$/g, '').toLowerCase();
  if (h === 'localhost' || h === '::1' || h === '0.0.0.0') return true;
  if (/^127\./.test(h)) return true;
  if (/^169\.254\./.test(h)) return true; // inclui 169.254.169.254 (metadata)
  if (/^::ffff:127\./.test(h)) return true;
  return false;
}
