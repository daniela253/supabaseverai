// Etapa 5b do Contrato Técnico. Componente determinístico — sem chamada a
// modelo de linguagem. Combina os sinais das etapas 3, 4 e 5 numa fórmula
// fixa e reproduzível: mesma entrada, mesmos sinais, sempre o mesmo score.
import type { CandidatoNCM, ClassificationResult, ReasoningOutput } from "../types.ts";
import { EMBEDDING_MODELO_ATUAL } from "./findNcmCandidates.ts";
import { MODELO_RACIOCINIO_ATUAL } from "./reasonAboutCandidates.ts";

export const CLASSIFICADOR_VERSAO_ATUAL = "vera-motor-v2.0.0";

function nivelDeScore(score: number): "ALTA" | "MEDIA" | "BAIXA" {
  if (score >= 75) return "ALTA";
  if (score >= 45) return "MEDIA";
  return "BAIXA";
}

export function calculateClassificationScore(
  candidatos: CandidatoNCM[],
  reasoning: ReasoningOutput,
): ClassificationResult {
  const preferidoInfo = candidatos.find((c) => c.ncm === reasoning.candidato_preferido);
  const scoreBase = (preferidoInfo?.score ?? 0) * 70; // similaridade pesa até 70 pontos
  const penalidadeAmbiguidade = reasoning.ambiguidade_residual * 30; // ambiguidade tira até 30

  let score = Math.round(Math.max(0, Math.min(100, scoreBase - penalidadeAmbiguidade + 15)));
  if (!reasoning.candidato_preferido) score = 0;

  // Sinais conflitantes: alta similaridade combinada com alta ambiguidade
  // residual não deveria produzir confiança ALTA. A fórmula já penaliza isso
  // no cálculo acima, mas reforçamos o teto aqui, como manda o Contrato Técnico.
  let nivel = nivelDeScore(score);
  if (reasoning.ambiguidade_residual > 0.4 && nivel === "ALTA") nivel = "MEDIA";

  return {
    ncm_sugerido: reasoning.candidato_preferido,
    score_classificacao: reasoning.candidato_preferido ? score : null,
    nivel_confianca: reasoning.candidato_preferido ? nivel : null,
    candidato_preferido: reasoning.candidato_preferido,
    justificativa: reasoning.justificativa,
    ambiguidade_residual: reasoning.ambiguidade_residual,
    alternativas: candidatos,
    evidencias: reasoning.evidencias_adicionais,
    classificador_versao: CLASSIFICADOR_VERSAO_ATUAL,
    embedding_modelo: EMBEDDING_MODELO_ATUAL,
    modelo_raciocinio: MODELO_RACIOCINIO_ATUAL,
  };
}
