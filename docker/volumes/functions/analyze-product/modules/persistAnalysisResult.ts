// Última etapa. Não processa nada novo — grava o que as etapas anteriores
// produziram. Só o objeto completo (ou explicitamente marcado por uma
// execution_flag) vira analysis_item com status_geral preenchido; nunca um
// resultado parcial "escondido" como se fosse concluído.
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import type {
  AuditFinding, ClassificationResult, ExecutionFlags, ImpactEstimate,
  ProductNormalized, StatusGeral, TaxResult,
} from "../types.ts";

export interface PersistInput {
  analysisId: string;
  organizationId: string;
  produto: ProductNormalized;
  executionFlags: ExecutionFlags;
  statusGeral: StatusGeral;
  classification: ClassificationResult | null;
  tax: TaxResult | null;
  findings: AuditFinding[];
  impact: ImpactEstimate | null;
}

export async function persistAnalysisResult(
  supabase: SupabaseClient,
  input: PersistInput,
): Promise<{ item_id: string }> {
  const { data: item, error: itemError } = await supabase
    .from("analysis_items")
    .insert({
      analysis_id: input.analysisId,
      organization_id: input.organizationId,
      input_hash: input.produto.input_hash,
      descricao: input.produto.descricao,
      codigo_interno: input.produto.codigo_interno ?? null,
      ncm_informado: input.produto.ncm_informado ?? null,
      dados_xml: input.produto.dados_xml ?? null,
      data_referencia_tributaria: input.produto.data_referencia_tributaria,
      execution_flags: input.executionFlags,
      status_geral: input.statusGeral,
    })
    .select("id")
    .single();

  if (itemError || !item) {
    throw new Error(`falha ao persistir analysis_item: ${itemError?.message}`);
  }
  const itemId = item.id as string;

  if (input.classification) {
    const { data: cr, error: crError } = await supabase
      .from("classification_results")
      .insert({
        item_id: itemId,
        ncm_sugerido: input.classification.ncm_sugerido,
        score_classificacao: input.classification.score_classificacao,
        nivel_confianca: input.classification.nivel_confianca,
        candidato_preferido: input.classification.candidato_preferido,
        justificativa: input.classification.justificativa,
        ambiguidade_residual: input.classification.ambiguidade_residual,
        classificador_versao: input.classification.classificador_versao,
        embedding_modelo: input.classification.embedding_modelo,
        modelo_raciocinio: input.classification.modelo_raciocinio,
      })
      .select("id")
      .single();

    if (!crError && cr) {
      const resultId = cr.id as string;
      if (input.classification.alternativas.length) {
        await supabase.from("classification_candidates").insert(
          input.classification.alternativas.map((c) => ({
            result_id: resultId,
            ncm: c.ncm,
            score: c.score,
            motivo_reordenamento: c.motivo_reordenamento ?? null,
          })),
        );
      }
      if (input.classification.evidencias.length) {
        await supabase.from("classification_evidence").insert(
          input.classification.evidencias.map((e) => ({
            result_id: resultId,
            tipo: e.tipo,
            origem: e.origem,
            trecho: e.trecho,
            peso: e.peso,
            referencia: e.referencia ?? null,
          })),
        );
      }
    }
  }

  if (input.tax) {
    const { data: tr, error: trError } = await supabase
      .from("tax_results")
      .insert({
        item_id: itemId,
        rule_version_id: input.tax.rule_version_id,
        cst_ibs_cbs: input.tax.cst_ibs_cbs,
        cclasstrib: input.tax.cclasstrib,
        percentual_reducao: input.tax.percentual_reducao,
        fundamento_legal: input.tax.fundamento_legal,
        anexo: input.tax.anexo,
        fonte: input.tax.fonte,
      })
      .select("id")
      .single();

    if (!trError && tr && input.tax.evidencias.length) {
      await supabase.from("tax_evidence").insert(
        input.tax.evidencias.map((e) => ({
          result_id: tr.id,
          fonte: e.fonte,
          dispositivo: e.dispositivo,
          trecho_relevante: e.trecho_relevante,
          url_referencia: e.url_referencia ?? null,
          data_consulta: e.data_consulta,
        })),
      );
    }
  }

  if (input.findings.length) {
    await supabase.from("audit_findings").insert(
      input.findings.map((f) => ({
        item_id: itemId,
        tipo: f.tipo,
        severidade: f.severidade,
        motivo: f.motivo,
        acao_sugerida: f.acao_sugerida,
      })),
    );
  }

  if (input.impact) {
    await supabase.from("impact_estimates").insert({
      item_id: itemId,
      valor_operacao: input.impact.valor_operacao,
      impacto_potencial_estimado: input.impact.impacto_potencial_estimado,
      nivel_confianca_impacto: input.impact.nivel_confianca_impacto,
      premissas_calculo: input.impact.premissas_calculo,
      requer_revisao_profissional: input.impact.requer_revisao_profissional,
    });
  }

  // status_revisao nasce sempre PENDENTE — a Central de Divergências decide
  // se cria a review; aqui só garantimos que todo item auditável tem uma.
  await supabase.from("reviews").insert({ item_id: itemId, status_revisao: "PENDENTE" });

  return { item_id: itemId };
}
