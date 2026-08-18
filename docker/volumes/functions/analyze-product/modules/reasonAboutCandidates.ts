// Etapa 5 do Contrato Técnico. Versão mock: escolhe o primeiro colocado do
// ranking e escreve uma justificativa fixa. O modelo de raciocínio real entra
// aqui depois, mantendo o mesmo contrato de entrada e saída — inclusive o
// fato de que esta etapa NUNCA calcula score_classificacao nem nivel_confianca
// (isso é responsabilidade exclusiva de calculateClassificationScore, etapa 5b,
// justamente para o mesmo caso não sair com números diferentes de uma vez
// para outra só por causa de como o texto foi formulado).
import type { CandidatoNCM, ClassificationEvidence, ProductNormalized, ReasoningOutput } from "../types.ts";

export const MODELO_RACIOCINIO_ATUAL = "mock-first-candidate-v0";

export async function reasonAboutCandidates(
  produto: ProductNormalized,
  candidatos: CandidatoNCM[],
  ambiguo: boolean,
): Promise<{ resultado: ReasoningOutput; modelo_raciocinio_indisponivel: boolean }> {
  if (candidatos.length === 0) {
    return {
      resultado: {
        candidato_preferido: null,
        justificativa: "Nenhum candidato disponível para avaliação.",
        evidencias_adicionais: [],
        ambiguidade_residual: 1,
      },
      modelo_raciocinio_indisponivel: false,
    };
  }

  const preferido = candidatos[0];
  const evidencias: ClassificationEvidence[] = [{
    tipo: "correspondencia_textual",
    origem: "mock-reasoning",
    trecho: preferido.descricao_oficial,
    peso: preferido.score,
    referencia: preferido.ncm,
  }];

  return {
    resultado: {
      candidato_preferido: preferido.ncm,
      justificativa: `Candidato com maior aderência textual à descrição (${preferido.descricao_oficial}).`,
      evidencias_adicionais: evidencias,
      ambiguidade_residual: ambiguo ? 0.6 : 0.15,
    },
    modelo_raciocinio_indisponivel: false,
  };
}
