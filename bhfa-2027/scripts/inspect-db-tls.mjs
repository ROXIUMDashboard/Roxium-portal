/**
 * Prints the certificate chain the database endpoint presents.
 *
 * Supabase's pooler is signed by Supabase's own CA, which is in no public trust
 * store, and their published CA download URLs now 404. Rather than turn
 * certificate verification off for the connection that carries every database
 * credential, this captures the chain once so the root can be pinned as
 * SUPABASE_DB_CA and verification stays on for real connections.
 *
 * This opens an inspection-only TLS socket: it sends no credentials, speaks no
 * Postgres, and closes as soon as the handshake yields the chain.
 */
import tls from 'node:tls';
import { assertBhfaTarget } from './db-target.mjs';

const url = process.env.SUPABASE_DB_URL?.trim();
if (!url) {
  console.log('tls-inspect  SUPABASE_DB_URL is not set — nothing to inspect');
  process.exit(0);
}
assertBhfaTarget(url, process.env.BHFA_DB_TARGET_REF);

const { hostname, port } = new URL(url);
console.log(`tls-inspect  ${hostname}:${port || 5432}`);

/**
 * Postgres requires an SSLRequest before the TLS handshake, so a plain TLS
 * connect would hang. Send the 8-byte SSLRequest, wait for 'S', then upgrade.
 */
const net = await import('node:net');
const socket = net.connect({ host: hostname, port: Number(port) || 5432 });

socket.on('connect', () => {
  const request = Buffer.alloc(8);
  request.writeInt32BE(8, 0);
  request.writeInt32BE(80877103, 4); // SSLRequest magic
  socket.write(request);
});

socket.once('data', (reply) => {
  if (reply.toString('utf8', 0, 1) !== 'S') {
    console.error('tls-inspect  server refused TLS');
    process.exit(1);
  }
  const secure = tls.connect(
    { socket, servername: hostname, rejectUnauthorized: false },
    () => {
      let cert = secure.getPeerCertificate(true);
      const seen = new Set();
      const chain = [];
      while (cert && cert.subject && !seen.has(cert.fingerprint256)) {
        seen.add(cert.fingerprint256);
        chain.push(cert);
        cert = cert.issuerCertificate;
      }
      chain.forEach((entry, index) => {
        console.log(
          `tls-inspect  [${index}] subject=${JSON.stringify(entry.subject)} ` +
            `issuer=${JSON.stringify(entry.issuer)} sha256=${entry.fingerprint256}`,
        );
      });
      const root = chain[chain.length - 1];
      if (root?.raw) {
        const pem =
          '-----BEGIN CERTIFICATE-----\n' +
          (root.raw.toString('base64').match(/.{1,64}/g) ?? []).join('\n') +
          '\n-----END CERTIFICATE-----';
        console.log('tls-inspect  ROOT_PEM_BEGIN');
        for (const line of pem.split('\n')) console.log(`tls-inspect  ${line}`);
        console.log('tls-inspect  ROOT_PEM_END');
      }
      secure.end();
      process.exit(0);
    },
  );
  secure.on('error', (error) => {
    console.error('tls-inspect  handshake error:', error.message);
    process.exit(1);
  });
});

socket.on('error', (error) => {
  console.error('tls-inspect  connect error:', error.message);
  process.exit(1);
});
