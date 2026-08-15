#!/usr/bin/env node
/**
 * critical-zone-reminder.mjs — hook Stop
 *
 * Por qué existe: hay cuatro zonas del repo donde un cambio "que compila" puede
 * romper algo que no se ve en el diff — aislamiento entre organizaciones, auth,
 * migraciones y los escenarios de aceptación. El olvido típico no es de código,
 * es de gate: nadie se acuerda de verificar que una org no ve datos de otra, o
 * que la migración corre en base limpia. Este hook mira qué archivos se editaron
 * en el turno y, al cerrar, recuerda el gate que corresponde a cada zona.
 *
 * No decide nada ni bloquea: solo recuerda, y solo si se tocó la zona.
 *
 * Fail-open duro: cualquier excepción termina en exit(0) silencioso.
 */

import fs from 'node:fs';

// Techo de lectura del transcript: si es enorme, leemos solo la cola. Un hook
// Stop no puede tardar, y los edits que importan son los del final igual.
const MAX_BYTES = 8 * 1024 * 1024;

const BUCKETS = [
  {
    id: 'tenant',
    patron: 'src/modules/tenant/',
    texto:
      '**Zona crítica: tenant** — aislamiento entre organizaciones.\n' +
      'Verificá que el escenario de aceptación cubra que una org NO ve datos de otra, y que el servicio siga pasando `organizationId` explícito (RLS es la red, no el filtro).',
  },
  {
    id: 'auth',
    patron: 'src/modules/auth/',
    texto:
      '**Zona crítica: auth** — sesión y permisos.\n' +
      'Verificá login, verificación de email, y que los guards de rol sigan cubiertos por tests.',
  },
  {
    id: 'migrations',
    patron: 'src/database/migrations/',
    texto:
      '**Zona crítica: migraciones** — hay una migración nueva o modificada.\n' +
      'Verificá que corre en una base limpia (`npm run db:test:down && npm run db:test:up`) y que tiene `down()` que revierte de verdad.',
  },
  {
    id: 'acceptance',
    patron: 'test/acceptance/',
    texto:
      '**Zona crítica: aceptación** — se tocó un escenario.\n' +
      'Confirmá que pasó por el gate RED antes de la implementación.',
  },
];

const CIERRE =
  '**Cierre de turno** — se editó código bajo `src/`.\n' +
  'Corré `HN_TEST_GATE=agent npm run test:unit` y considerá si la decisión que tomaste merece un ADR.';

function leerStdin() {
  return new Promise((resolve) => {
    let datos = '';
    const corte = setTimeout(() => resolve(datos), 2000);
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => {
      datos += c;
    });
    process.stdin.on('end', () => {
      clearTimeout(corte);
      resolve(datos);
    });
    process.stdin.on('error', () => {
      clearTimeout(corte);
      resolve(datos);
    });
  });
}

/** Lee el transcript entero, o solo su cola si se pasa del techo. */
function leerTranscript(ruta) {
  const { size } = fs.statSync(ruta);
  if (size <= MAX_BYTES) return fs.readFileSync(ruta, 'utf8');

  const fd = fs.openSync(ruta, 'r');
  try {
    const buf = Buffer.alloc(MAX_BYTES);
    fs.readSync(fd, buf, 0, MAX_BYTES, size - MAX_BYTES);
    const texto = buf.toString('utf8');
    // La primera línea quedó cortada al medio: la tiramos.
    return texto.slice(texto.indexOf('\n') + 1);
  } finally {
    fs.closeSync(fd);
  }
}

/** Junta todos los bloques tool_use de un objeto de línea del JSONL. */
function bloquesToolUse(obj) {
  const contenido = obj?.message?.content ?? obj?.content;
  if (!Array.isArray(contenido)) return [];
  return contenido.filter((b) => b && b.type === 'tool_use');
}

function esRuidoso(p) {
  return (
    p.endsWith('.md') ||
    p.endsWith('.json') ||
    p.includes('node_modules/') ||
    p.includes('dist/')
  );
}

async function main() {
  const crudo = await leerStdin();
  if (!crudo || !crudo.trim()) process.exit(0);

  const payload = JSON.parse(crudo);
  const ruta = payload?.transcript_path;
  if (typeof ruta !== 'string' || !fs.existsSync(ruta)) process.exit(0);

  const editados = new Set();
  for (const linea of leerTranscript(ruta).split('\n')) {
    if (!linea.trim()) continue;
    try {
      for (const bloque of bloquesToolUse(JSON.parse(linea))) {
        if (bloque.name !== 'Edit' && bloque.name !== 'Write') continue;
        const fp = bloque?.input?.file_path;
        if (typeof fp !== 'string' || !fp) continue;
        const norm = fp.replace(/\\/g, '/').toLowerCase();
        if (esRuidoso(norm)) continue;
        editados.add(norm);
      }
    } catch {
      // Línea corrupta o truncada: la salteamos y seguimos.
    }
  }

  if (editados.size === 0) process.exit(0);

  const partes = [];
  for (const bucket of BUCKETS) {
    for (const archivo of editados) {
      if (archivo.includes(bucket.patron)) {
        partes.push(bucket.texto);
        break;
      }
    }
  }

  // Si no disparó ninguna zona pero igual se tocó código de src/, cerramos con
  // el recordatorio genérico.
  if (partes.length === 0) {
    const tocoSrc = [...editados].some((a) => a.includes('src/'));
    if (!tocoSrc) process.exit(0);
    partes.push(CIERRE);
  }

  process.stdout.write(JSON.stringify({ systemMessage: partes.join('\n\n---\n\n') }));
  process.exit(0);
}

main().catch(() => process.exit(0));
