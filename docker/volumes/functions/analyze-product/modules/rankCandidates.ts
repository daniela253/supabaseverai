// Etapa 4 do Contrato Técnico. Regras determinísticas internas ao motor,
// não a Base Tributária. Reordena os candidatos usando atributos que a busca
// semântica não enxerga. Nesta primeira versão, os únicos atributos
// disponíveis são o próprio NCM informado (se bater com um candidato, ele
// sobe) — os demais (unidade, histórico de fornecedor) entram quando o
// motor tiver esses dados disponíveis.
import type { CandidatoNCM, ProductNormalized } from "../types.ts";

export interface RankResult {
  candidatos: CandidatoNCM[];
  ambiguo: boolean; // true quando os dois primeiros colocados estão muito próximos
}

const MARGEM_AMBIGUIDADE = 0.08;

export function rankCandidates(produto: ProductNormalized, candidatos: CandidatoNCM[]): RankResult {
  const reordenados = candidatos.map((c) => {
    if (produto.ncm_informado && c.ncm.startsWith(produto.ncm_informado.slice(0, 4))) {
      return { ...c, score: c.score + 0.1, motivo_reordenamento: "coincide com o prefixo do NCM informado" };
    }
    return c;
  }).sort((a, b) => b.score - a.score);

  const ambiguo =
    reordenados.length >= 2 &&
    reordenados[0].score - reordenados[1].score < MARGEM_AMBIGUIDADE;

  return { candidatos: reordenados, ambiguo };
}
