#!/usr/bin/env node
/**
 * codebase-memory.mjs — hook SessionStart
 *
 * Por qué existe: el MCP `codebase-memory-mcp` mantiene un grafo del repo que
 * responde "cómo está armado esto" en una query, en vez de que el modelo se
 * coma medio `src/` con Read/Grep/Glob o spawnee un Explore. Pero el grafo sirve
 * solo si está fresco, y nadie se acuerda de reindexar.
 *
 * Un hook no puede llamar tools MCP. Así que lo que hace es lo único que puede
 * hacer barato y sin tokens de modelo: mirar el mtime del artifact contra el del
 * código, decidir en qué estado está el grafo, e inyectar la instrucción precisa
 * para que el modelo la ejecute al arrancar la sesión.
 *
 * Fail-open duro: cualquier excepción termina en exit(0) silencioso.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.resolve(AQUI, '..', '..'); // .claude/hooks -> raíz del repo
const ARTIFACT = path.join(RAIZ, '.codebase-memory', 'graph.db.zst');
const SRC = path.join(RAIZ, 'src');

// El projectId del MCP es la ruta absoluta con los separadores colapsados.
const PROJECT_ID = RAIZ.replace(/[:/\\]+/g, '-');

const IGNORAR = new Set(['node_modules', 'dist']);

/** mtime del .ts más nuevo bajo src/, recorriendo a mano para poder podar. */
function mtimeCodigoMasNuevo(dir) {
  let masNuevo = 0;
  const pila = [dir];

  while (pila.length) {
    const actual = pila.pop();
    let entradas;
    try {
      entradas = fs.readdirSync(actual, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entradas) {
      if (IGNORAR.has(e.name)) continue;
      const completo = path.join(actual, e.name);
      if (e.isDirectory()) {
        pila.push(completo);
      } else if (e.isFile() && e.name.endsWith('.ts')) {
        try {
          const m = fs.statSync(completo).mtimeMs;
          if (m > masNuevo) masNuevo = m;
        } catch {
          /* archivo que desapareció, ignorar */
        }
      }
    }
  }
  return masNuevo;
}

const SIN_ARTIFACT = [
  `[codebase-memory] No hay grafo indexado para este repo (projectId: \`${PROJECT_ID}\`).`,
  'Antes de explorar el código, indexá UNA SOLA VEZ: llamá a `index_repository` con',
  `\`projectId='${PROJECT_ID}'\`, \`mode='full'\`, \`persistence=true\`.`,
  'No repitas el full index en esta sesión: es caro y solo hace falta una vez.',
].join('\n');

const DESACTUALIZADO = [
  `[codebase-memory] El grafo existe pero quedó viejo respecto de \`src/\` (projectId: \`${PROJECT_ID}\`).`,
  `Actualizalo incremental: primero \`detect_changes\` con \`projectId='${PROJECT_ID}'\`, y después`,
  `\`index_repository\` con \`projectId='${PROJECT_ID}'\`, \`mode='fast'\`, \`persistence=true\`.`,
  'Nunca hagas un full rebuild acá: el incremental alcanza.',
].join('\n');

const FRESCO = [
  `[codebase-memory] El grafo está fresco (projectId: \`${PROJECT_ID}\`). Usalo.`,
  'Para entender el proyecto, sus dependencias o dónde vive algo, usá las tools del grafo:',
  '`search_graph`, `trace_path`, `get_code_snippet`, `search_code`, `get_architecture`, `query_graph`.',
  'NO uses los agentes Explore / general-purpose ni Read/Grep/Glob masivo para "entender el proyecto":',
  'queman tokens y el grafo ya tiene esa información.',
  'Read/Grep quedan solo para el archivo puntual que vas a editar, o para config que no es código.',
].join('\n');

function emitir(texto) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: texto },
    }),
  );
}

function main() {
  let mtimeArtifact = null;
  try {
    mtimeArtifact = fs.statSync(ARTIFACT).mtimeMs;
  } catch {
    emitir(SIN_ARTIFACT);
    process.exit(0);
  }

  const mtimeCodigo = mtimeCodigoMasNuevo(SRC);
  emitir(mtimeCodigo > mtimeArtifact ? DESACTUALIZADO : FRESCO);
  process.exit(0);
}

try {
  main();
} catch {
  process.exit(0);
}
