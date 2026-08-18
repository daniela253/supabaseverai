// Etapa 8 do Contrato Técnico. Só estima quando há valor_operacao e a
// divergência tem efeito financeiro identificável. Sempre expõe as
// premissas usadas, para que a estimativa seja auditável por um humano.
import type { AuditFinding, ImpactEstimate, ProductNormalized, TaxResult } from "../types.ts";

export function estimateImpact(
  produto: ProductNormalized,
  findings: AuditFinding[],
  tax: TaxResult | null,
): ImpactEstimate | null {
  const valorOperacao = (produto.dados_xml?.valor_total as number | undefined) ?? null;

  const relevantes = findings.filter((f) =>
    f.tipo === "REDUCAO_NAO_APLICADA" || f.tipo === "CST_INCOMPATIVEL"
  );

  if (!valorOperacao || relevantes.length === 0 || !tax?.percentual_reducao) {
    return {
      valor_operacao: valorOperacao,
      impacto_potencial_estimado: null,
      nivel_confianca_impacto: null,
      premissas_calculo: { motivo: "dados insuficientes para estimar impacto financeiro" },
      requer_revisao_profissional: findings.some((f) => f.severidade === "alta" || f.severidade === "critica"),
    };
  }

  const impactoEstimado = valorOperacao * tax.percentual_reducao;
  const confiancaImpacto = relevantes.length > 1 ? "MEDIA" : "ALTA";

  return {
    valor_operacao: valorOperacao,
    impacto_potencial_estimado: Math.round(impactoEstimado * 100) / 100,
    nivel_confianca_impacto: confiancaImpacto,
    premissas_calculo: {
      percentual_reducao_usado: tax.percentual_reducao,
      base_calculo: "valor_total do item, sem dedução de outros tributos",
    },
    requer_revisao_profissional: true,
  };
}
