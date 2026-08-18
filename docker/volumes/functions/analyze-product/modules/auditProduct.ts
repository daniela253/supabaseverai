// Etapa 7 do Contrato Técnico. Compara o que veio na nota (dados_xml) com o
// que a classificação e a Base Tributária determinam. CFOP e CEST recebem
// só as validações estruturais do V2.0 (ausência, formato, consistência
// interna) — nunca "qual seria o valor correto por estado", que é V3.
import type { AuditFinding, ClassificationResult, ProductNormalized, TaxResult } from "../types.ts";

const CEST_REGEX = /^\d{7}$/;

export function auditProduct(
  produto: ProductNormalized,
  classification: ClassificationResult | null,
  tax: TaxResult | null,
): AuditFinding[] {
  const findings: AuditFinding[] = [];
  const xml = produto.dados_xml ?? {};

  // NCM_INCORRETA: confiança baixa na classificação é o proxy disponível
  // hoje para "a NCM informada provavelmente não é essa".
  if (
    classification?.nivel_confianca === "BAIXA" &&
    produto.ncm_informado &&
    classification.ncm_sugerido &&
    produto.ncm_informado !== classification.ncm_sugerido
  ) {
    findings.push({
      tipo: "NCM_INCORRETA",
      severidade: "media",
      motivo: `A NCM informada (${produto.ncm_informado}) tem baixa aderência com a descrição do produto.`,
      acao_sugerida: `Revisar se ${classification.ncm_sugerido} é mais adequada.`,
    });
  }

  // CST_INCOMPATIVEL: comparar o CST do XML (se houver) com o que a Base
  // Tributária determina para essa NCM.
  const cstXml = xml.cst_ibs_cbs as string | undefined;
  if (tax?.cst_ibs_cbs && cstXml && cstXml !== tax.cst_ibs_cbs) {
    findings.push({
      tipo: "CST_INCOMPATIVEL",
      severidade: "alta",
      motivo: `CST informado (${cstXml}) diverge do determinado pela Base Tributária (${tax.cst_ibs_cbs}).`,
      acao_sugerida: "Corrigir o CST na próxima emissão e avaliar o impacto retroativo.",
    });
  }

  // REDUCAO_NAO_APLICADA
  if (tax?.percentual_reducao && tax.percentual_reducao > 0) {
    const reducaoAplicadaXml = xml.percentual_reducao as number | undefined;
    if (!reducaoAplicadaXml || reducaoAplicadaXml < tax.percentual_reducao) {
      findings.push({
        tipo: "REDUCAO_NAO_APLICADA",
        severidade: "alta",
        motivo: `Existe redução de ${(tax.percentual_reducao * 100).toFixed(0)}% prevista e ela não foi refletida integralmente na nota.`,
        acao_sugerida: "Confirmar a aplicação da redução na próxima operação.",
      });
    }
  }

  // BENEFICIO_SEM_FUNDAMENTO
  const beneficioAplicadoXml = xml.beneficio_aplicado as string | undefined;
  if (beneficioAplicadoXml && !tax?.fundamento_legal) {
    findings.push({
      tipo: "BENEFICIO_SEM_FUNDAMENTO",
      severidade: "critica",
      motivo: `Um benefício (${beneficioAplicadoXml}) foi aplicado sem regra correspondente na Base Tributária.`,
      acao_sugerida: "Verificar a base legal do benefício aplicado antes da próxima emissão.",
    });
  }

  // CEST — validações estruturais apenas
  const cest = xml.cest as string | undefined;
  if (xml.cest_esperado && !cest) {
    findings.push({
      tipo: "CEST_AUSENTE",
      severidade: "media",
      motivo: "O item deveria ter CEST e a nota não o traz.",
      acao_sugerida: "Preencher o CEST na próxima emissão.",
    });
  } else if (cest && !CEST_REGEX.test(cest)) {
    findings.push({
      tipo: "CEST_FORMATO_INVALIDO",
      severidade: "baixa",
      motivo: `CEST informado (${cest}) não segue o formato esperado de 7 dígitos.`,
      acao_sugerida: "Corrigir o formato do CEST.",
    });
  }

  // CFOP — validações estruturais apenas
  const cfop = xml.cfop as string | undefined;
  if (!cfop) {
    findings.push({
      tipo: "CFOP_AUSENTE",
      severidade: "media",
      motivo: "O item não traz CFOP.",
      acao_sugerida: "Preencher o CFOP na próxima emissão.",
    });
  } else if (xml.natureza_operacao && String(xml.natureza_operacao).includes("venda") && cfop.startsWith("1")) {
    // exemplo de checagem interna: CFOP de entrada (1xxx) numa operação de venda
    findings.push({
      tipo: "CFOP_INCONSISTENCIA_INTERNA",
      severidade: "media",
      motivo: `CFOP ${cfop} é típico de entrada, mas a operação está classificada como venda.`,
      acao_sugerida: "Confirmar o CFOP correto para essa natureza de operação.",
    });
  }

  return findings;
}
