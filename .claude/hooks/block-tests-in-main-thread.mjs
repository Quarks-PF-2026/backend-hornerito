#!/usr/bin/env node
/**
 * block-tests-in-main-thread.mjs — hook PreToolUse (matcher: Bash|PowerShell)
 *
 * Por qué existe: la suite del proyecto son ~154 tests. Si el thread principal
 * (el orquestador) la corre, el output entero le entra al contexto y lo quema
 * para nada, porque el orquestador no es quien va a arreglar el test que falle.
 * El modelo correcto es que la suite la corra el subagente que implementó el
 * cambio, que ya tiene el contexto para interpretar el rojo.
 *
 * El payload del hook NO distingue subagente de main thread: `transcript_path`
 * siempre apunta al de la sesión principal (verificado empíricamente), así que
 * una guardia por path es inviable. La solución es un "capability token" en la
 * línea de comando: quien está autorizado exporta HN_TEST_GATE inline y el hook
 * lo deja pasar. El orquestador no tiene token, y eso es a propósito.
 *
 * Fail-open duro: cualquier excepción termina en exit(0) silencioso. Un hook
 * roto nunca puede trabar la sesión de un integrante del equipo.
 */

// Token de capability. Si aparece en cualquier lado del comando, pasa.
const GATE = /hn_test_gate=(agent|reviewer|ci)/i;

// Comandos bloqueados. Anclados a inicio de string o a un separador REAL de
// shell, para no matchear menciones dentro de argumentos
// (ej: git commit -m "arreglo npm run test" no se bloquea).
const BLOQUEADOS = [
  // npm test / npm run test / npm run test:<variante>
  /(?:^|[&;|(\n])\s*(?:sudo\s+)?npm\s+(?:run\s+)?test(?::[a-z0-9:_-]+)?(?=\s|$|["'&;|)])/i,
  // npx jest / jest --config / jest suelto
  /(?:^|[&;|(\n])\s*(?:sudo\s+)?(?:npx\s+)?jest(?=\s|$|["'&;|)])/i,
];

const RAZON = [
  'Bloqueado: el thread principal no corre la suite de tests. El output de 154 tests quema contexto sin aportar nada.',
  '- El agente que implementó el cambio la corre él: HN_TEST_GATE=agent npm run test:acceptance',
  '- El code-reviewer usa HN_TEST_GATE=reviewer',
  '- CI usa HN_TEST_GATE=ci',
  '- El orquestador no tiene token, es a propósito: delegá la corrida al subagente que hizo el cambio.',
  '- Si el usuario quiere ver la suite, que la corra él desde el prompt: ! npm run test:all',
  'Y nunca spawnees un agente solamente para compilar o correr tests.',
].join('\n');

function leerStdin() {
  return new Promise((resolve) => {
    let datos = '';
    // Si nadie escribe stdin, no nos colgamos: cortamos a los 2 s.
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

async function main() {
  const crudo = await leerStdin();
  if (!crudo || !crudo.trim()) process.exit(0);

  const payload = JSON.parse(crudo);
  const comando = payload?.tool_input?.command;
  if (typeof comando !== 'string' || !comando.trim()) process.exit(0);

  // Tiene el token: pasa sin chistar.
  if (GATE.test(comando)) process.exit(0);

  const bloquea = BLOQUEADOS.some((re) => re.test(comando));
  if (!bloquea) process.exit(0);

  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: RAZON,
      },
    }),
  );
  process.exit(0);
}

main().catch(() => process.exit(0));
