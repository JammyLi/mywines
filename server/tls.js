// 內網 HTTPS：第一次啟動時建立本機憑證機構（CA），再為這台電腦的內網 IP 簽發憑證。
// 手機安裝一次 CA 後，相機掃描與離線功能（需要 HTTPS）就能使用。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import forge from 'node-forge';

// 只列出公司網路的 IP；排除 Mac／電腦上的虛擬網路（虛擬機、Docker、VPN 通道等）
const VIRTUAL = /^(bridge|vmnet|vboxnet|docker|br-|veth|virbr|utun|tun|tap|awdl|llw|anpi|ap\d|vEthernet|VirtualBox|VMware|Hyper-V|ZeroTier|tailscale|wg)/i;
export function lanAddresses() {
  const all = [], real = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) for (const a of list || []) {
    if (a.family !== 'IPv4' || a.internal || a.address.startsWith('169.254.')) continue;
    all.push(a.address);
    if (!VIRTUAL.test(name)) real.push(a.address);
  }
  return real.length ? real : all;
}

function keypair() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048, publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });
  return { privateKey: forge.pki.privateKeyFromPem(privateKey), publicKey: forge.pki.publicKeyFromPem(publicKey) };
}
const serial = () => '01' + crypto.randomBytes(15).toString('hex');

export function ensureTls(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const f = (n) => path.join(dir, n);
  let caCert, caKey;
  if (fs.existsSync(f('ca.crt')) && fs.existsSync(f('ca.key'))) {
    caCert = forge.pki.certificateFromPem(fs.readFileSync(f('ca.crt'), 'utf8'));
    caKey = forge.pki.privateKeyFromPem(fs.readFileSync(f('ca.key'), 'utf8'));
  } else {
    const k = keypair();
    caCert = forge.pki.createCertificate();
    caCert.publicKey = k.publicKey;
    caCert.serialNumber = serial();
    caCert.validity.notBefore = new Date(Date.now() - 86400e3);
    caCert.validity.notAfter = new Date(Date.now() + 10 * 365 * 86400e3);
    const attrs = [{ name: 'commonName', value: `MyWines Local CA (${os.hostname().replace(/[^\x20-\x7e]/g, '')})` }, { name: 'organizationName', value: 'MyWines' }];
    caCert.setSubject(attrs); caCert.setIssuer(attrs);
    caCert.setExtensions([{ name: 'basicConstraints', cA: true, critical: true }, { name: 'keyUsage', keyCertSign: true, cRLSign: true, critical: true }, { name: 'subjectKeyIdentifier' }]);
    caCert.sign(k.privateKey, forge.md.sha256.create());
    caKey = k.privateKey;
    fs.writeFileSync(f('ca.crt'), forge.pki.certificateToPem(caCert));
    fs.writeFileSync(f('ca.key'), forge.pki.privateKeyToPem(caKey), { mode: 0o600 });
  }
  const host = os.hostname().replace(/\.local$/, '');
  const names = ['localhost', host, host + '.local'];
  const ips = ['127.0.0.1', ...lanAddresses()];
  const want = JSON.stringify({ names, ips });
  const have = fs.existsSync(f('server.json')) ? fs.readFileSync(f('server.json'), 'utf8') : '';
  let fresh = false;
  if (want !== have || !fs.existsSync(f('server.crt'))) {
    const k = keypair();
    const c = forge.pki.createCertificate();
    c.publicKey = k.publicKey;
    c.serialNumber = serial();
    c.validity.notBefore = new Date(Date.now() - 86400e3);
    c.validity.notAfter = new Date(Date.now() + 800 * 86400e3); // iPhone 要求 825 天以內
    c.setSubject([{ name: 'commonName', value: ips[1] || host }]);
    c.setIssuer(caCert.subject.attributes);
    c.setExtensions([
      { name: 'basicConstraints', cA: false },
      { name: 'keyUsage', digitalSignature: true, keyEncipherment: true, critical: true },
      { name: 'extKeyUsage', serverAuth: true },
      { name: 'subjectAltName', altNames: [...names.map((value) => ({ type: 2, value })), ...ips.map((ip) => ({ type: 7, ip }))] },
    ]);
    c.sign(caKey, forge.md.sha256.create());
    fs.writeFileSync(f('server.crt'), forge.pki.certificateToPem(c));
    fs.writeFileSync(f('server.key'), forge.pki.privateKeyToPem(k.privateKey), { mode: 0o600 });
    fs.writeFileSync(f('server.json'), want);
    fresh = true;
  }
  return { key: fs.readFileSync(f('server.key')), cert: fs.readFileSync(f('server.crt')), ca: fs.readFileSync(f('ca.crt')), caPath: f('ca.crt'), fresh, ips: ips.slice(1) };
}
