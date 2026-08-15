#!/usr/bin/env node
/**
 * jira-import.mjs — convierte un export CSV de Jira en un Markdown por ticket.
 *
 * Por qué existe: cuando un agente necesita el contexto de QK-42, hoy tiene que
 * tragarse el CSV del sprint entero (o que se lo peguen a mano). Con esto lee
 * `.jira/QK-42.md`: 40 líneas, normalizadas, con los criterios de aceptación
 * arriba de todo. Además deja explícito cuáles tickets NO tienen criterios, que
 * es la información que más duele descubrir tarde: sin criterios no se puede
 * derivar el escenario de aceptación y hay que ir a hablar con el equipo.
 *
 * Uso: node scripts/jira-import.mjs [<ruta-al-csv>] [--out .jira]
 *
 * Sin dependencias externas: el parser CSV es propio, porque los criterios de
 * aceptación de Jira son multilínea y con comillas, que es justo donde un
 * split(',') se rompe.
 */

import fs from 'node:fs';
import path from 'node:path';

// ---------------------------------------------------------------------------
// Parser CSV: máquina de estados sobre el string completo.
// Maneja campos entrecomillados, comas y saltos de línea adentro de comillas,
// y comillas escapadas como "".
// ---------------------------------------------------------------------------
function parsearCSV(textoCrudo) {
  const texto = textoCrudo.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const filas = [];
  let fila = [];
  let campo = '';
  let enComillas = false;

  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];

    if (enComillas) {
      if (c === '"') {
        if (texto[i + 1] === '"') {
          campo += '"'; // comilla escapada
          i++;
        } else {
          enComillas = false;
        }
      } else {
        campo += c;
      }
      continue;
    }

    if (c === '"') {
      enComillas = true;
    } else if (c === ',') {
      fila.push(campo);
      campo = '';
    } else if (c === '\n') {
      fila.push(campo);
      filas.push(fila);
      fila = [];
      campo = '';
    } else {
      campo += c;
    }
  }

  // Último campo/fila si el archivo no termina en salto de línea.
  if (campo !== '' || fila.length > 0) {
    fila.push(campo);
    filas.push(fila);
  }

  // Descartamos filas totalmente vacías (típico del final del archivo).
  return filas.filter((f) => f.some((v) => v.trim() !== ''));
}

// ---------------------------------------------------------------------------
// Detección de columnas: Jira cambia los headers según idioma y configuración,
// así que buscamos por alias, primero exacto y después parcial.
// ---------------------------------------------------------------------------
const ALIAS = {
  clave: ['Issue key', 'Clave de incidencia', 'Key', 'Clave'],
  resumen: ['Summary', 'Resumen'],
  tipo: ['Issue Type', 'Tipo de Incidencia', 'Tipo'],
  estado: ['Status', 'Estado'],
  responsable: ['Assignee', 'Persona asignada', 'Responsable'],
  sprint: ['Sprint'],
  puntos: ['Story Points', 'Story point estimate', 'Puntos'],
  descripcion: ['Description', 'Descripción', 'Descripcion'],
  epica: ['Parent', 'Epic Link', 'Parent summary', 'Épica', 'Epica'],
};

function buscarColumna(headers, alias, usados) {
  const norm = headers.map((h) => (h ?? '').trim().toLowerCase());
  const libres = (i) => !usados.has(i);

  // 1) coincidencia exacta
  for (const a of alias) {
    const objetivo = a.toLowerCase();
    const i = norm.findIndex((h, idx) => libres(idx) && h === objetivo);
    if (i !== -1) return i;
  }
  // 2) empieza con
  for (const a of alias) {
    const objetivo = a.toLowerCase();
    const i = norm.findIndex((h, idx) => libres(idx) && h.startsWith(objetivo));
    if (i !== -1) return i;
  }
  // 3) contiene
  for (const a of alias) {
    const objetivo = a.toLowerCase();
    const i = norm.findIndex((h, idx) => libres(idx) && h.includes(objetivo));
    if (i !== -1) return i;
  }
  return -1;
}

/** Todas las columnas cuyo header contenga alguno de los fragmentos. */
function buscarColumnasMulti(headers, fragmentos) {
  const salida = [];
  headers.forEach((h, i) => {
    const norm = (h ?? '').trim().toLowerCase();
    if (fragmentos.some((f) => norm.includes(f.toLowerCase()))) salida.push(i);
  });
  return salida;
}

// ---------------------------------------------------------------------------
// Limpieza del markup de Jira.
// ---------------------------------------------------------------------------
function limpiarMarkupJira(entrada) {
  if (!entrada) return '';
  let t = entrada.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  // {code:java}...{code} y {noformat}...{noformat} -> bloques markdown.
  // Vienen de a pares, así que alternamos apertura y cierre.
  {
    let abierto = false;
    t = t.replace(/\{code(?::([^}]*))?\}/g, (_m, meta) => {
      if (abierto) {
        abierto = false;
        return '```';
      }
      abierto = true;
      const lenguaje = (meta || '').split(/[:|]/)[0].trim();
      return '```' + lenguaje;
    });
    if (abierto) t += '\n```';
  }
  {
    let abierto = false;
    t = t.replace(/\{noformat\}/g, () => {
      abierto = !abierto;
      return '```';
    });
    if (abierto) t += '\n```';
  }

  // Viñetas de Jira: * / ** (lista) y # / ## (numerada), solo a principio de línea.
  t = t.replace(/^(\s*)(\*+)\s+(?=\S)/gm, (_m, sangria, marcas) => `${sangria}${'  '.repeat(marcas.length - 1)}- `);
  t = t.replace(/^(\s*)(#+)\s+(?=\S)/gm, (_m, sangria, marcas) => `${sangria}${'  '.repeat(marcas.length - 1)}1. `);

  // Encabezados h1. .. h6.
  t = t.replace(/^\s*h([1-6])\.\s*/gm, (_m, n) => '#'.repeat(Number(n)) + ' ');

  // Enlaces [texto|url] -> [texto](url)
  t = t.replace(/\[([^\]|]+)\|([^\]]+)\]/g, (_m, texto, url) => `[${texto.trim()}](${url.trim()})`);

  // Negrita *texto* -> **texto** (ya no quedan asteriscos de viñeta a inicio).
  t = t.replace(/(^|[^*\w])\*([^*\n]+)\*(?![*\w])/g, (_m, previo, cuerpo) => `${previo}**${cuerpo}**`);

  // Colapsamos 3+ saltos a 2.
  t = t.replace(/\n{3,}/g, '\n\n');

  return t.trim();
}

// ---------------------------------------------------------------------------
// Salida
// ---------------------------------------------------------------------------
const SIN_CRITERIOS =
  '> **Sin criterios de aceptación en Jira.** El escenario de aceptación no se puede derivar ' +
  'automáticamente: hay que acordarlos con el equipo antes de escribir el .feature.';

function yaml(valor) {
  const v = (valor ?? '').toString().replace(/\n/g, ' ').trim();
  if (!v) return '""';
  return `"${v.replace(/"/g, '\\"')}"`;
}

function armarMarkdown(t, origen) {
  const lineas = [];
  lineas.push('---');
  lineas.push(`clave: ${yaml(t.clave)}`);
  lineas.push(`tipo: ${yaml(t.tipo)}`);
  lineas.push(`estado: ${yaml(t.estado)}`);
  lineas.push(`responsable: ${yaml(t.responsable)}`);
  lineas.push(`sprint: ${yaml(t.sprint)}`);
  lineas.push(`puntos: ${yaml(t.puntos)}`);
  lineas.push(`epica: ${yaml(t.epica)}`);
  lineas.push(`importado: ${yaml(new Date().toISOString())}`);
  lineas.push(`origen: ${yaml(origen)}`);
  lineas.push('---');
  lineas.push('');
  lineas.push(`# ${t.clave} — ${t.resumen || '(sin resumen)'}`);
  lineas.push('');
  lineas.push('## Descripción');
  lineas.push('');
  lineas.push(t.descripcion || '_Sin descripción en Jira._');
  lineas.push('');
  lineas.push('## Criterios de aceptación');
  lineas.push('');
  lineas.push(t.criterios || SIN_CRITERIOS);
  lineas.push('');

  if (t.etiquetas.length) {
    lineas.push('## Etiquetas');
    lineas.push('');
    lineas.push(t.etiquetas.map((e) => `- ${e}`).join('\n'));
    lineas.push('');
  }
  if (t.comentarios.length) {
    lineas.push('## Comentarios');
    lineas.push('');
    lineas.push(t.comentarios.map((c) => `- ${c.replace(/\n+/g, ' ').trim()}`).join('\n'));
    lineas.push('');
  }

  lineas.push('---');
  lineas.push('');
  lineas.push(
    '_Archivo generado automáticamente desde el export de Jira. No lo edites a mano: se regenera con `npm run jira:import`._',
  );
  lineas.push('');

  return lineas.join('\n');
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
function morir(mensaje) {
  console.error(`\nError: ${mensaje}\n`);
  process.exit(1);
}

function parsearArgs(argv) {
  let csv = null;
  let out = '.jira';
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--out') {
      out = argv[++i] ?? out;
    } else if (a.startsWith('--out=')) {
      out = a.slice('--out='.length);
    } else if (!a.startsWith('--') && csv === null) {
      csv = a;
    }
  }
  return { csv, out };
}

function csvMasReciente(dirRaw) {
  let entradas;
  try {
    entradas = fs.readdirSync(dirRaw, { withFileTypes: true });
  } catch {
    return null;
  }
  const candidatos = entradas
    .filter((e) => e.isFile() && e.name.toLowerCase().endsWith('.csv'))
    .map((e) => {
      const completo = path.join(dirRaw, e.name);
      return { completo, mtime: fs.statSync(completo).mtimeMs };
    })
    .sort((a, b) => b.mtime - a.mtime);
  return candidatos.length ? candidatos[0].completo : null;
}

function main() {
  const raiz = process.cwd();
  const { csv, out } = parsearArgs(process.argv.slice(2));

  let rutaCsv = csv ? path.resolve(raiz, csv) : null;
  if (!rutaCsv) {
    const dirRaw = path.resolve(raiz, '.jira', 'raw');
    rutaCsv = csvMasReciente(dirRaw);
    if (!rutaCsv) {
      morir(
        'No encontré ningún CSV en `.jira/raw/`.\n' +
          'Exportá el sprint desde Jira (Issues > Export > CSV, "all fields") y dejá el archivo\n' +
          `en \`${path.relative(raiz, dirRaw) || '.jira/raw'}\`. También podés pasar la ruta:\n` +
          '  node scripts/jira-import.mjs ruta/al/export.csv',
      );
    }
  }

  if (!fs.existsSync(rutaCsv)) {
    morir(`No existe el archivo \`${rutaCsv}\`. Revisá la ruta que pasaste.`);
  }

  const filas = parsearCSV(fs.readFileSync(rutaCsv, 'utf8'));
  if (filas.length < 2) {
    morir(`El CSV \`${path.basename(rutaCsv)}\` no tiene filas de datos (solo el header, o está vacío).`);
  }

  const headers = filas[0];
  const usados = new Set();
  const col = {};
  // El orden importa: los campos más específicos reservan su columna primero.
  for (const campo of ['clave', 'resumen', 'tipo', 'estado', 'responsable', 'sprint', 'puntos', 'descripcion', 'epica']) {
    const i = buscarColumna(headers, ALIAS[campo], usados);
    col[campo] = i;
    if (i !== -1) usados.add(i);
  }

  if (col.clave === -1) {
    morir(
      'No encontré la columna de clave del ticket en el CSV.\n' +
        `Headers detectados: ${headers.filter(Boolean).join(' | ')}\n` +
        'Re-exportá desde Jira incluyendo la columna "Issue key" (o "Clave de incidencia").',
    );
  }

  const colsCriterios = buscarColumnasMulti(headers, ['acceptance', 'criterio']);
  const colsEtiquetas = buscarColumnasMulti(headers, ['labels', 'etiqueta']);
  const colsComentarios = buscarColumnasMulti(headers, ['comment', 'comentario']);

  const dirOut = path.resolve(raiz, out);
  fs.mkdirSync(dirOut, { recursive: true });

  const origen = path.basename(rutaCsv);
  const generados = [];
  const sinCriterios = [];

  for (let f = 1; f < filas.length; f++) {
    const fila = filas[f];
    const val = (i) => (i >= 0 && i < fila.length ? (fila[i] ?? '').trim() : '');
    const multi = (indices) =>
      indices.map((i) => (fila[i] ?? '').trim()).filter((v) => v !== '');

    const clave = val(col.clave);
    if (!clave) continue;

    const criteriosCrudo = multi(colsCriterios).join('\n\n');

    const ticket = {
      clave,
      resumen: val(col.resumen),
      tipo: val(col.tipo),
      estado: val(col.estado),
      responsable: val(col.responsable),
      sprint: val(col.sprint),
      puntos: val(col.puntos),
      epica: val(col.epica),
      descripcion: limpiarMarkupJira(val(col.descripcion)),
      criterios: limpiarMarkupJira(criteriosCrudo),
      etiquetas: multi(colsEtiquetas),
      comentarios: multi(colsComentarios).map((c) => limpiarMarkupJira(c)),
    };

    if (!ticket.criterios) sinCriterios.push(clave);

    const destino = path.join(dirOut, `${clave}.md`);
    fs.writeFileSync(destino, armarMarkdown(ticket, origen), 'utf8');
    generados.push(clave);
  }

  if (generados.length === 0) {
    morir(
      `Leí \`${origen}\` pero no salió ningún ticket con clave. ` +
        'Revisá que el export tenga la columna "Issue key" poblada.',
    );
  }

  // Resumen
  const rel = (path.relative(raiz, dirOut) || dirOut).split(path.sep).join('/');
  console.log(`\nImportados ${generados.length} tickets desde ${origen} -> ${rel}/`);
  console.log(generados.map((k) => `  - ${k}.md`).join('\n'));

  if (sinCriterios.length) {
    console.log(
      `\n  ATENCIÓN: ${sinCriterios.length} ticket(s) quedaron SIN criterios de aceptación:`,
    );
    console.log(sinCriterios.map((k) => `  - ${k}`).join('\n'));
    console.log(
      '  No se les puede derivar el escenario de aceptación automáticamente.\n' +
        '  Acordalos con el equipo antes de escribir el .feature.',
    );
  }
  console.log('');
}

main();
