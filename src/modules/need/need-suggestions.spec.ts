import { buildSuggestions, SuggestionInput } from './need.service';

const NOW = new Date('2026-10-05T15:00:00Z');
const hace = (d: number) => new Date(NOW.getTime() - d * 86_400_000);

function row(
  supplyId: string,
  haceDias: number,
  closed = true,
): SuggestionInput {
  return {
    supplyId,
    supplyName: supplyId.toUpperCase(),
    category: 'Alimentos secos',
    createdAt: hace(haceDias),
    closedManually: closed,
    coveredQuantity: 0,
    requiredQuantity: 10,
  };
}

describe('buildSuggestions', () => {
  it('Dados insumos con distinto historial, Cuando se sugiere, Entonces van los más pedidos primero y hasta 3', () => {
    const rows = [
      row('a', 5),
      row('b', 5),
      row('b', 10),
      row('c', 5),
      row('c', 10),
      row('c', 15),
      row('d', 5),
    ];
    const out = buildSuggestions(rows, NOW);
    expect(out.map((s) => s.supplyName)).toEqual(['C', 'B', 'A']);
    expect(out[0].timesRequested).toBe(3);
  });

  it('Dado un empate, Cuando se sugiere, Entonces gana el pedido más reciente', () => {
    const out = buildSuggestions([row('a', 20), row('b', 3)], NOW);
    expect(out.map((s) => s.supplyId)).toEqual(['b', 'a']);
  });

  it('Dado un insumo con necesidad abierta, Cuando se sugiere, Entonces no aparece', () => {
    const out = buildSuggestions([row('a', 5), row('a', 0, false)], NOW);
    expect(out).toEqual([]);
  });

  it('Dadas necesidades de hace más de 90 días, Cuando se sugiere, Entonces no cuentan', () => {
    expect(buildSuggestions([row('a', 91)], NOW)).toEqual([]);
  });

  it('Dada una necesidad cubierta por completo, Cuando se sugiere, Entonces cuenta como cerrada', () => {
    const covered = { ...row('a', 5, false), coveredQuantity: 10 };
    expect(buildSuggestions([covered], NOW)).toHaveLength(1);
  });

  it('Cuando se sugiere, Entonces lastRequestedAt es YYYY-MM-DD', () => {
    expect(buildSuggestions([row('a', 1)], NOW)[0].lastRequestedAt).toMatch(
      /^\d{4}-\d{2}-\d{2}$/,
    );
  });
});
