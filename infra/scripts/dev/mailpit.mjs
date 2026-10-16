// Levanta Mailpit (npm run dev de la raiz). SMTP en 127.0.0.1:1025, bandeja en http://localhost:8025.
// Si ya hay algo escuchando en el 1025 (otro Mailpit), lo reutiliza y no levanta uno nuevo.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { connect } from 'node:net';

const ocupado = await new Promise((resolve) => {
  const s = connect({ host: '127.0.0.1', port: 1025 }, () => (s.destroy(), resolve(true)));
  s.on('error', () => resolve(false));
});

if (ocupado) {
  console.log('Ya hay un SMTP en 127.0.0.1:1025: se reutiliza (bandeja en http://localhost:8025).');
  // concurrently -k corta todo si un proceso termina: este se queda vivo.
  setInterval(() => {}, 1 << 30);
} else {
  const exe = 'tools/mailpit/mailpit.exe';
  if (!existsSync(exe)) {
    console.error('Falta Mailpit. Instalar con: powershell -ExecutionPolicy Bypass -File infra/scripts/dev/instalar_mailpit.ps1');
    process.exit(1);
  }
  spawn(exe, ['--smtp', '127.0.0.1:1025', '--listen', '127.0.0.1:8025'], { stdio: 'inherit' }).on('exit', (codigo) => process.exit(codigo ?? 0));
}
