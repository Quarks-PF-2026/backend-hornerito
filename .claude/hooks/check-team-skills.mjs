#!/usr/bin/env node
/**
 * check-team-skills.mjs — hook SessionStart
 *
 * Por qué existe: somos 6 con SO mixto y cada uno instala plugins a mano. Si a
 * alguien le falta una skill que el equipo declaró requerida, la sesión "anda"
 * pero se comporta distinto que la del resto, y eso se descubre tarde y mal.
 * Este hook avisa en el arranque, sin gastar un solo token de modelo: solo lee
 * archivos y, únicamente si falta algo, inyecta una línea corta.
 *
 * No bloquea nada nunca. El catálogo vive en el repo `lab-hornerito`, que no
 * todos tienen clonado: si no está, salimos en silencio, no es un error.
 *
 * Fail-open duro: cualquier excepción termina en exit(0) silencioso.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.resolve(AQUI, '..', '..'); // .claude/hooks -> raíz del repo
const CATALOGO = path.resolve(RAIZ, '..', 'lab-hornerito', 'equipo', 'skills-catalogo.md');
const CACHE = path.join(RAIZ, '.claude', '.cache', 'skills-check.json');
const VENCE_MS = 24 * 60 * 60 * 1000;

/** Lista bajo el heading `## Requeridas`, hasta el próximo heading. */
function parsearRequeridas(texto) {
  const lineas = texto.split(/\r?\n/);
  const requeridas = [];
  let dentro = false;

  for (const linea of lineas) {
    if (/^#{1,6}\s/.test(linea)) {
      // Entramos en la sección justo cuando el heading dice "Requeridas".
      dentro = /^##\s+requeridas\s*$/i.test(linea.trim());
      continue;
    }
    if (!dentro) continue;

    const item = linea.match(/^\s*[-*]\s+(.+)$/);
    if (!item) continue;

    // Cortamos descripciones del estilo "nombre — para tal cosa".
    let nombre = item[1].split(/\s+[—-]\s+/)[0].trim();
    nombre = nombre.replace(/^[`'"]|[`'"]$/g, '').trim();
    if (nombre) requeridas.push(nombre);
  }
  return [...new Set(requeridas)];
}

/** Plugins instalados: cache de plugins + enabledPlugins de settings.json. */
function detectarInstalados() {
  const instalados = new Set();
  const base = path.join(os.homedir(), '.claude');

  // 1) ~/.claude/plugins/cache/<marketplace>/<plugin>/
  try {
    const cacheDir = path.join(base, 'plugins', 'cache');
    for (const mercado of fs.readdirSync(cacheDir, { withFileTypes: true })) {
      if (!mercado.isDirectory()) continue;
      const nivel1 = path.join(cacheDir, mercado.name);
      for (const plugin of fs.readdirSync(nivel1, { withFileTypes: true })) {
        if (!plugin.isDirectory()) continue;
        // Algunas versiones meten un nivel extra "plugins/" en el medio.
        if (plugin.name === 'plugins') {
          try {
            for (const p2 of fs.readdirSync(path.join(nivel1, 'plugins'), { withFileTypes: true })) {
              if (p2.isDirectory()) instalados.add(p2.name.toLowerCase());
            }
          } catch {
            /* ignorar */
          }
          continue;
        }
        instalados.add(plugin.name.toLowerCase());
      }
    }
  } catch {
    /* no hay cache de plugins, seguimos */
  }

  // 2) enabledPlugins de ~/.claude/settings.json (clave "plugin@marketplace")
  try {
    const ajustes = JSON.parse(fs.readFileSync(path.join(base, 'settings.json'), 'utf8'));
    for (const clave of Object.keys(ajustes?.enabledPlugins ?? {})) {
      instalados.add(String(clave).split('@')[0].trim().toLowerCase());
    }
  } catch {
    /* no hay settings.json o está roto, seguimos */
  }

  // 3) Servidores MCP configurados.
  //
  // No todo lo que el catálogo puede requerir es un plugin de marketplace:
  // `codebase-memory-mcp` es un servidor MCP, y CLAUDE.md §5 lo da por
  // presente. Si no lo contáramos como instalado, el hook le avisaría a las 6
  // personas que les falta algo que sí tienen — y un aviso que siempre miente
  // es un aviso que todos aprenden a ignorar, que es peor que no tenerlo.
  for (const archivo of [
    path.join(os.homedir(), '.claude.json'),
    path.join(base, 'settings.json'),
    path.join(RAIZ, '.mcp.json'),
  ]) {
    try {
      const json = JSON.parse(fs.readFileSync(archivo, 'utf8'));
      for (const nombre of Object.keys(json?.mcpServers ?? {})) {
        instalados.add(String(nombre).trim().toLowerCase());
      }
      // ~/.claude.json guarda además los MCP por proyecto.
      for (const proyecto of Object.values(json?.projects ?? {})) {
        for (const nombre of Object.keys(proyecto?.mcpServers ?? {})) {
          instalados.add(String(nombre).trim().toLowerCase());
        }
      }
    } catch {
      /* no existe o está roto, seguimos */
    }
  }

  return instalados;
}

function leerCache() {
  try {
    return JSON.parse(fs.readFileSync(CACHE, 'utf8'));
  } catch {
    return null;
  }
}

function guardarCache(datos) {
  try {
    fs.mkdirSync(path.dirname(CACHE), { recursive: true });
    fs.writeFileSync(CACHE, JSON.stringify(datos, null, 2), 'utf8');
  } catch {
    /* si no se puede cachear, no pasa nada */
  }
}

function emitir(faltantes) {
  const texto = [
    `Plugins requeridos por el equipo que no tenés instalados: ${faltantes.join(', ')}.`,
    'Instalalos con /plugin (elegí el marketplace del equipo y activalos).',
    'Es informativo: no bloquea nada, podés seguir trabajando igual.',
  ].join('\n');

  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: texto },
    }),
  );
}

function main() {
  // El payload de stdin no nos aporta nada acá, así que ni lo esperamos.
  let mtimeCatalogo;
  try {
    mtimeCatalogo = fs.statSync(CATALOGO).mtimeMs;
  } catch {
    // No tiene el repo lab clonado. No es un error.
    process.exit(0);
  }

  const cache = leerCache();
  const fresco =
    cache &&
    typeof cache.ts === 'number' &&
    Date.now() - cache.ts < VENCE_MS &&
    cache.mtimeCatalogo === mtimeCatalogo;

  if (fresco) {
    const faltantes = Array.isArray(cache.faltantes) ? cache.faltantes : [];
    if (faltantes.length === 0) process.exit(0);
    emitir(faltantes);
    process.exit(0);
  }

  const requeridas = parsearRequeridas(fs.readFileSync(CATALOGO, 'utf8'));
  if (requeridas.length === 0) {
    guardarCache({ ts: Date.now(), mtimeCatalogo, faltantes: [] });
    process.exit(0);
  }

  const instalados = detectarInstalados();
  const faltantes = requeridas.filter((r) => !instalados.has(r.toLowerCase()));

  guardarCache({ ts: Date.now(), mtimeCatalogo, faltantes });

  if (faltantes.length === 0) process.exit(0);
  emitir(faltantes);
  process.exit(0);
}

try {
  main();
} catch {
  process.exit(0);
}
